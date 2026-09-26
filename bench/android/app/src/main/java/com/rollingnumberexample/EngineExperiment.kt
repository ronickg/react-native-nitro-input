package com.rollingnumberexample

import android.util.Log
import com.margelo.nitro.nitroinput.ReflowEngine
import com.margelo.nitro.nitroinput.ReflowEngineKt
import kotlin.math.abs
import kotlin.random.Random

/**
 * EXPERIMENT (branch experiment/kotlin-reflow-engine): the C++ ReflowEngine
 * over JNI against its Kotlin port, ReflowEngineKt.
 *
 * - [check]: random text changes through both, every frame compared.
 * - [bench]: NitroText's workload for 1000 labels (a line changes, then
 *   25 frames are read), interleaved rounds, timed per engine.
 */
object EngineExperiment {
  private fun report(json: String) = Log.i("BENCH", json)

  // ---- Differential check -------------------------------------------------

  private data class G(val c: Int, val role: Int, val kind: Int, val w: Double, val ph: Boolean)

  private fun randomLine(r: Random): List<G> {
    val out = ArrayList<G>()
    val prefix = r.nextInt(4)
    if (prefix == 1) out.add(G('$'.code, 0, 0, 9.0, false))
    if (prefix == 2) { out.add(G('U'.code, 0, 0, 10.0, false)); out.add(G('S'.code, 0, 0, 9.0, false)); out.add(G(' '.code, 0, 0, 4.0, false)) }
    val placeholder = r.nextInt(12) == 0
    when (r.nextInt(3)) {
      0 -> { // an amount: digits, grouping, maybe a decimal
        val digits = 1 + r.nextInt(9)
        val s = StringBuilder()
        for (i in 0 until digits) s.append(('0'.code + r.nextInt(10)).toChar())
        var body = s.toString().trimStart('0').ifEmpty { "0" }
        val grouped = StringBuilder()
        for ((i, ch) in body.withIndex()) {
          if (i > 0 && (body.length - i) % 3 == 0 && r.nextInt(5) != 0) grouped.append(',')
          grouped.append(ch)
        }
        body = grouped.toString()
        if (r.nextBoolean()) body += "." + (0 until 1 + r.nextInt(2)).joinToString("") { ('0'.code + r.nextInt(10)).toChar().toString() }
        for (ch in body) {
          val kind = when {
            ch.isDigit() -> 1
            ch == ',' -> 2
            ch == '.' -> 3
            else -> 0
          }
          out.add(G(ch.code, 1, kind, if (ch.isDigit()) 10.0 else 4.0, placeholder))
        }
      }
      1 -> { // plain text (classified as text, or numeric-in-disguise by the engine)
        val words = listOf("Sign in", "Signing in…", "Signed in", "Total 1,204", "Total 1,318", "Step 3 of 5", "(555) 123-4567", "21.09.2026", "Label number 17")
        for (ch in words[r.nextInt(words.size)]) out.add(G(ch.code, 1, 0, 5.0 + (ch.code % 7), placeholder))
      }
      else -> { // random short digits as text kind
        for (i in 0 until r.nextInt(6)) out.add(G('0'.code + r.nextInt(10), 1, 0, 10.0, false))
      }
    }
    if (r.nextInt(4) == 0) { out.add(G(' '.code, 2, 0, 4.0, false)); out.add(G('U'.code, 2, 0, 10.0, false)) }
    return out
  }

  fun check(sequences: Int = 400, steps: Int = 30) {
    val r = Random(1234)
    val a = DoubleArray(4096)
    val b = DoubleArray(4096)
    var frames = 0
    var maxDiff = 0.0
    var mismatches = 0
    var firstMismatch = ""
    for (seq in 0 until sequences) {
      val cpp = ReflowEngine()
      val kt = ReflowEngineKt()
      val duration = listOf(0.25, 0.4, 0.6)[r.nextInt(3)]
      val easing = r.nextInt(5)
      val bounce = r.nextDouble()
      val effect = r.nextInt(3)
      cpp.setTiming(duration, easing, bounce); kt.setTiming(duration, easing, bounce)
      cpp.setEffect(effect); kt.setEffect(effect)
      val rtl = r.nextInt(4) == 0
      cpp.setRightToLeft(rtl); kt.setRightToLeft(rtl)
      var t = 10.0
      for (step in 0 until steps) {
        val line = randomLine(r)
        val bodyCount = line.count { it.role == 1 }
        val caret = if (r.nextBoolean()) -1 else r.nextInt(bodyCount + 1)
        val reduce = r.nextInt(20) == 0
        cpp.setReduceMotion(reduce); kt.setReduceMotion(reduce)
        cpp.beginText(); kt.beginText()
        for (g in line) { cpp.addGlyph(g.c, g.role, g.kind, g.w, g.ph); kt.addGlyph(g.c, g.role, g.kind, g.w, g.ph) }
        cpp.commitText(caret, t); kt.commitText(caret, t)
        // A few frames, sometimes interrupted early by the next change.
        val ticks = 1 + r.nextInt(12)
        for (k in 0 until ticks) {
          t += 1.0 / 60 * (1 + r.nextInt(3))
          val mc = cpp.tick(t)
          val mk = kt.tick(t)
          val na = cpp.frameInto(a)
          val nb = kt.frameInto(b)
          frames++
          var diff = if (mc != mk || na != nb) Double.POSITIVE_INFINITY else 0.0
          if (diff == 0.0) for (i in 0 until na) diff = maxOf(diff, abs(a[i] - b[i]))
          if (diff > 1e-9) {
            mismatches++
            if (firstMismatch.isEmpty()) firstMismatch = "seq $seq step $step tick $k moving ${mc}/${mk} len ${na}/${nb} diff $diff"
          } else if (diff > maxDiff) maxDiff = diff
        }
      }
    }
    report("{\"event\":\"engine-check\",\"sequences\":$sequences,\"frames\":$frames,\"mismatches\":$mismatches,\"maxDiff\":$maxDiff,\"first\":\"$firstMismatch\"}")
  }

  // ---- Micro benchmark ----------------------------------------------------

  private const val LABELS = 1000
  private const val FRAMES = 25

  private fun label(n: Int) = "Label number $n"

  private class Lines {
    val chars = Array(2) { Array(LABELS) { IntArray(0) } }
    val kinds = Array(2) { Array(LABELS) { IntArray(0) } }
    val widths = Array(2) { Array(LABELS) { DoubleArray(0) } }
    init {
      for (v in 0 until 2) for (i in 0 until LABELS) {
        val s = label(i + 1 + v * 1000)
        chars[v][i] = IntArray(s.length) { s[it].code }
        kinds[v][i] = IntArray(s.length) { if (s[it].isDigit()) 1 else 0 }
        widths[v][i] = DoubleArray(s.length) { if (s[it].isDigit()) 20.0 else 12.0 + (s[it].code % 9) }
      }
    }
  }

  /** One round: every label changes (a morph), then FRAMES frames are ticked and read. Returns ns. */
  private fun roundCpp(engines: Array<ReflowEngine>, lines: Lines, v: Int, t0: Double, out: DoubleArray): Long {
    val start = System.nanoTime()
    for (i in 0 until LABELS) {
      val c = lines.chars[v][i]
      engines[i].commitLine(c, lines.kinds[v][i], lines.widths[v][i], c.size, 1, false, -1, t0)
    }
    for (f in 1..FRAMES) {
      val t = t0 + f / 60.0
      for (i in 0 until LABELS) engines[i].tickInto(t, out)
    }
    return System.nanoTime() - start
  }

  private fun roundKt(engines: Array<ReflowEngineKt>, lines: Lines, v: Int, t0: Double, out: DoubleArray): Long {
    val start = System.nanoTime()
    for (i in 0 until LABELS) {
      val c = lines.chars[v][i]
      engines[i].commitLine(c, lines.kinds[v][i], lines.widths[v][i], c.size, 1, false, -1, t0)
    }
    for (f in 1..FRAMES) {
      val t = t0 + f / 60.0
      for (i in 0 until LABELS) engines[i].tickInto(t, out)
    }
    return System.nanoTime() - start
  }

  fun bench(rounds: Int = 12) {
    val lines = Lines()
    val out = DoubleArray(4096)
    val cpp = Array(LABELS) { ReflowEngine() }
    val kt = Array(LABELS) { ReflowEngineKt() }
    // First commit shows the text without animation, as a label's mount does.
    for (i in 0 until LABELS) {
      val c = lines.chars[0][i]
      cpp[i].commitLine(c, lines.kinds[0][i], lines.widths[0][i], c.size, 1, true, -1, 0.0)
      kt[i].commitLine(c, lines.kinds[0][i], lines.widths[0][i], c.size, 1, true, -1, 0.0)
    }
    val cppNs = ArrayList<Long>()
    val ktNs = ArrayList<Long>()
    var t = 1.0
    // Warm-up (JIT and caches), then interleaved measured rounds.
    for (w in 0 until 4) { roundCpp(cpp, lines, (w + 1) % 2, t, out); roundKt(kt, lines, (w + 1) % 2, t, out); t += 1.0 }
    for (round in 0 until rounds) {
      val v = (round + 1) % 2
      if (round % 2 == 0) {
        cppNs.add(roundCpp(cpp, lines, v, t, out)); ktNs.add(roundKt(kt, lines, v, t, out))
      } else {
        ktNs.add(roundKt(kt, lines, v, t, out)); cppNs.add(roundCpp(cpp, lines, v, t, out))
      }
      t += 1.0
    }
    fun median(xs: List<Long>) = xs.sorted()[xs.size / 2] / 1e6
    report("{\"event\":\"engine-bench\",\"labels\":$LABELS,\"frames\":$FRAMES,\"cppMs\":${median(cppNs)},\"kotlinMs\":${median(ktNs)},\"cppRounds\":\"${cppNs.joinToString(",") { "%.1f".format(it / 1e6) }}\",\"kotlinRounds\":\"${ktNs.joinToString(",") { "%.1f".format(it / 1e6) }}\"}")
  }
}
