package com.margelo.nitro.nitroinput

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * EXPERIMENT (branch experiment/kotlin-reflow-engine, not for release): the
 * operations [NitroTextView] needs from a reflow engine, so it can run on the
 * C++ engine over JNI ([CppReflowFrames]) or on [ReflowEngineKt], a line-for-line
 * Kotlin port of `cpp/ReflowEngine.cpp`, to compare the two.
 */
interface ReflowFrames {
  fun setTiming(durationSeconds: Double, easing: Int, bounce: Double)
  fun setEffect(effect: Int)
  fun setRightToLeft(rightToLeft: Boolean)
  fun reset()
  fun needsFrames(): Boolean
  fun glyphCount(): Int
  fun frameInto(out: DoubleArray): Int
  fun commitLine(
    characters: IntArray, kinds: IntArray, widths: DoubleArray, count: Int,
    role: Int, reduceMotion: Boolean, caret: Int, now: Double,
  ): Boolean
  fun tickInto(now: Double, out: DoubleArray): Int
}

internal class CppReflowFrames : ReflowFrames {
  val engine = ReflowEngine()
  override fun setTiming(durationSeconds: Double, easing: Int, bounce: Double) = engine.setTiming(durationSeconds, easing, bounce)
  override fun setEffect(effect: Int) = engine.setEffect(effect)
  override fun setRightToLeft(rightToLeft: Boolean) = engine.setRightToLeft(rightToLeft)
  override fun reset() = engine.reset()
  override fun needsFrames() = engine.needsFrames()
  override fun glyphCount() = engine.glyphCount()
  override fun frameInto(out: DoubleArray) = engine.frameInto(out)
  override fun commitLine(
    characters: IntArray, kinds: IntArray, widths: DoubleArray, count: Int,
    role: Int, reduceMotion: Boolean, caret: Int, now: Double,
  ) = engine.commitLine(characters, kinds, widths, count, role, reduceMotion, caret, now)
  override fun tickInto(now: Double, out: DoubleArray) = engine.tickInto(now, out)
}

/** `cpp/ReflowEngine.cpp`, ported to Kotlin as literally as the languages allow. */
class ReflowEngineKt : ReflowFrames {
  companion object {
    const val TEXT = 0
    const val DIGIT = 1
    const val SEPARATOR = 2
    const val DECIMAL = 3
    const val PREFIX = 0
    const val BODY = 1
    const val SUFFIX = 2

    private const val PI = 3.14159265358979323846
    private const val FADE_SCALE = 0.95
    private const val TEXT_ENTER_FADE_FROM = 0.25
    private const val TEXT_ENTER_FADE_TO = 0.75
    private const val TEXT_EXIT_FADE_TO = 0.25
    private const val SLIDE_ENTER_FADE_TO = 0.25
    private const val SLIDE_EXIT_FADE_TO = 0.45
    private const val PERSIST_FADE_TO = 0.25
    private const val GROUP_MIN = 6
    private const val GROUP_SCALE = 0.8
    private const val GROUP_EXIT_FADE_TO = 0.45
    private const val GROUP_ENTER_FADE_TO = 0.35
    private const val MAGNITUDE_JUMP = 3

    private fun clamp01(v: Double): Double = if (v < 0) 0.0 else (if (v > 1) 1.0 else v)

    private fun cubicBezier(x1: Double, y1: Double, x2: Double, y2: Double, x: Double): Double {
      if (x <= 0) return 0.0
      if (x >= 1) return 1.0
      fun sampleX(t: Double) = ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t
      fun sampleY(t: Double) = ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t
      fun slopeX(t: Double) = 3 * (1 - 3 * x2 + 3 * x1) * t * t + 2 * (3 * x2 - 6 * x1) * t + 3 * x1
      var t = x
      for (i in 0 until 8) {
        val err = sampleX(t) - x
        if (abs(err) < 1e-7) return sampleY(t)
        val slope = slopeX(t)
        if (abs(slope) < 1e-6) break
        t -= err / slope
      }
      var lo = 0.0
      var hi = 1.0
      t = x
      while (hi - lo > 1e-7) {
        if (sampleX(t) < x) lo = t else hi = t
        t = (lo + hi) / 2
      }
      return sampleY(t)
    }

    private fun spring(t: Double, bounce: Double): Double {
      val zeta = min(1.0, max(0.05, 1.0 - clamp01(bounce)))
      val omega = 3.0 * PI
      val k = zeta * omega
      if (zeta >= 0.999) return 1 - (1 + k * t) * exp(-k * t)
      val wd = omega * sqrt(1 - zeta * zeta)
      return 1 - exp(-k * t) * (cos(wd * t) + (k / wd) * sin(wd * t))
    }

    /** Longest common subsequence as index pairs (i into [outI], j into [outJ]), ties to the earliest match. */
    private inline fun lcsPairs(m: Int, n: Int, equal: (Int, Int) -> Boolean, outI: IntList, outJ: IntList) {
      if (m == 0 || n == 0) return
      val w = n + 1
      val dp = IntArray((m + 1) * w)
      for (i in m - 1 downTo 0) {
        for (j in n - 1 downTo 0) {
          dp[i * w + j] = if (equal(i, j)) dp[(i + 1) * w + j + 1] + 1 else max(dp[(i + 1) * w + j], dp[i * w + j + 1])
        }
      }
      var i = 0
      var j = 0
      while (i < m && j < n) {
        if (equal(i, j)) {
          outI.add(i); outJ.add(j); i++; j++
        } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
          i++
        } else {
          j++
        }
      }
    }

    private fun ramp(p: Double, from: Double, to: Double): Double {
      if (to <= from) return if (p >= to) 1.0 else 0.0
      return clamp01((p - from) / (to - from))
    }

    private fun isSpace(c: Int) = c == 0x20 || c == 0xA0 || c == 0x2009 || c == 0x202F
  }

  /** A growable int list without boxing. */
  internal class IntList {
    var data = IntArray(16)
    var size = 0
    fun add(v: Int) {
      if (size == data.size) data = data.copyOf(size * 2)
      data[size++] = v
    }
    operator fun get(i: Int) = data[i]
    fun clear() { size = 0 }
    fun isEmpty() = size == 0
  }

  private class Input(var character: Int, var role: Int, var kind: Int, var width: Double, var placeholder: Boolean)

  /** A slot: its glyph (inlined) and its animation. */
  private class Slot {
    var id = 0L
    var character = 0
    var role = 0
    var kind = 0
    var width = 0.0
    var placeholder = false
    var x = 0.0
    var y = 0.0
    var opacity = 1.0
    var scale = 1.0
    var exiting = false

    var start = 0.0
    var fromX = 0.0; var toX = 0.0
    var fromY = 0.0; var toY = 0.0
    var fromOpacity = 1.0; var toOpacity = 1.0
    var fromScale = 1.0; var toScale = 1.0
    var fadeFrom = 0.0; var fadeTo = 1.0
    var anchorId = -1L
    var anchorBaseX = 0.0
    var entering = false
    var slide = false
    var grouped = false
    var groupCentre = 0.0

    fun copy(): Slot {
      val s = Slot()
      s.id = id; s.character = character; s.role = role; s.kind = kind; s.width = width; s.placeholder = placeholder
      s.x = x; s.y = y; s.opacity = opacity; s.scale = scale; s.exiting = exiting
      s.start = start; s.fromX = fromX; s.toX = toX; s.fromY = fromY; s.toY = toY
      s.fromOpacity = fromOpacity; s.toOpacity = toOpacity; s.fromScale = fromScale; s.toScale = toScale
      s.fadeFrom = fadeFrom; s.fadeTo = fadeTo; s.anchorId = anchorId; s.anchorBaseX = anchorBaseX
      s.entering = entering; s.slide = slide; s.grouped = grouped; s.groupCentre = groupCentre
      return s
    }
  }

  /** A published glyph (what `glyphs_` holds). */
  private class Glyph {
    var id = 0L; var character = 0; var role = 0; var kind = 0; var width = 0.0; var placeholder = false
    var x = 0.0; var y = 0.0; var opacity = 1.0; var scale = 1.0; var exiting = false
    fun from(s: Slot) {
      id = s.id; character = s.character; role = s.role; kind = s.kind; width = s.width; placeholder = s.placeholder
      x = s.x; y = s.y; opacity = s.opacity; scale = s.scale; exiting = s.exiting
    }
  }

  private var duration = 0.4
  private var easing = 0
  private var bounce = 0.15
  private var effect = 0
  private var reduceMotion = false
  private var rightToLeft = false

  private val pending = ArrayList<Input>()
  private var slots = ArrayList<Slot>()
  private val glyphs = ArrayList<Glyph>()
  private var glyphCount = 0
  private var committed = false
  private var animating = false
  private var now = 0.0
  private var contentWidth = 0.0
  private var targetWidth = 0.0
  private var widthFrom = 0.0
  private var widthStart = 0.0
  private var nextId = 1L

  // MARK: Configuration

  override fun setTiming(durationSeconds: Double, easing: Int, bounce: Double) {
    duration = max(0.0, durationSeconds)
    this.easing = easing
    this.bounce = bounce
  }

  override fun setEffect(effect: Int) {
    this.effect = effect
  }

  fun setReduceMotion(reduceMotion: Boolean) {
    this.reduceMotion = reduceMotion
  }

  private fun ease(tIn: Double): Double {
    val t = clamp01(tIn)
    return when (easing) {
      1 -> 1 - (1 - t).pow(3)
      2 -> if (t < 0.5) 4 * t * t * t else 1 - (-2 * t + 2).pow(3) / 2
      3 -> t
      4 -> spring(t, bounce)
      else -> cubicBezier(0.19, 1.0, 0.22, 1.0, t)
    }
  }

  private fun slides(kind: Int): Boolean {
    if (effect == 1) return true
    if (effect == 2) return false
    return kind != TEXT
  }

  private fun same(input: Input, slot: Slot): Boolean =
    input.character == slot.character && input.kind == slot.kind && input.role == slot.role && input.placeholder == slot.placeholder

  private fun slotIndexOf(id: Long): Int {
    for (i in slots.indices) if (slots[i].id == id) return i
    return -1
  }

  // MARK: Text

  fun beginText() {
    pending.clear()
  }

  fun addGlyph(character: Int, role: Int, kind: Int, width: Double, placeholder: Boolean) {
    pending.add(Input(character, role, kind, max(0.0, width), placeholder))
  }

  private fun snapTo(inputs: List<Input>) {
    slots.clear()
    var x = 0.0
    for (input in inputs) {
      val s = Slot()
      s.id = nextId++; s.character = input.character; s.role = input.role; s.kind = input.kind
      s.width = input.width; s.placeholder = input.placeholder; s.x = x; s.y = 0.0; s.opacity = 1.0; s.scale = 1.0; s.exiting = false
      s.fromX = x; s.toX = x
      s.slide = slides(input.kind) && !input.placeholder
      slots.add(s)
      x += input.width
    }
    contentWidth = x; targetWidth = x; widthFrom = x
    animating = false
    publish()
  }

  private fun classifyNumericBody(inputs: List<Input>) {
    var digits = false
    for (input in inputs) {
      if (input.role != BODY) continue
      if (input.kind != TEXT) return
      val c = input.character
      if (c >= '0'.code && c <= '9'.code) {
        digits = true
      } else if ((c >= 'a'.code && c <= 'z'.code) || (c >= 'A'.code && c <= 'Z'.code) || c > 0x7f) {
        return
      }
    }
    if (!digits) return
    for (input in inputs) {
      if (input.role != BODY) continue
      val c = input.character
      input.kind = if (c >= '0'.code && c <= '9'.code) DIGIT else SEPARATOR
    }
    var decimal = -1
    for (i in inputs.indices) {
      if (inputs[i].role != BODY) continue
      if (inputs[i].character == '.'.code || inputs[i].character == ','.code) decimal = i
    }
    if (decimal < 0) return
    var occurrences = 0
    for (input in inputs) {
      if (input.role == BODY && input.character == inputs[decimal].character) occurrences++
    }
    if (occurrences == 1) inputs[decimal].kind = DECIMAL
  }

  // Scratch, as the C++ keeps it between commits.
  private var runBuf = IntList()
  private var groupFlag = BooleanArray(0)
  private var groupCentre = DoubleArray(0)

  fun commitText(caretIndex: Int, now: Double) {
    this.now = now
    val inputs = ArrayList(pending)
    pending.clear()
    classifyNumericBody(inputs)

    var fromPlaceholder = false
    for (s in slots) if (!s.exiting && s.placeholder) { fromPlaceholder = true; break }
    if (!committed || duration <= 0 || reduceMotion || fromPlaceholder) {
      snapTo(inputs)
      committed = true
      return
    }

    val oldByRole = arrayOf(IntList(), IntList(), IntList())
    val newByRole = arrayOf(IntList(), IntList(), IntList())
    for (i in slots.indices) if (!slots[i].exiting) oldByRole[slots[i].role.coerceIn(0, 2)].add(i)
    for (i in inputs.indices) newByRole[inputs[i].role.coerceIn(0, 2)].add(i)

    val matchOfNew = IntArray(inputs.size) { -1 }
    matchBySequence(inputs, oldByRole[PREFIX], newByRole[PREFIX], matchOfNew)
    matchBody(inputs, oldByRole[BODY], newByRole[BODY], caretIndex, matchOfNew)
    matchBySequence(inputs, oldByRole[SUFFIX], newByRole[SUFFIX], matchOfNew)

    val used = BooleanArray(slots.size)
    for (m in matchOfNew) if (m >= 0) used[m] = true

    val targetX = DoubleArray(inputs.size)
    var x = 0.0
    for (i in inputs.indices) {
      targetX[i] = x
      x += inputs[i].width
    }

    fun anchorForNew(index: Int): Int {
      var j = index
      while (j-- > 0) if (matchOfNew[j] >= 0) return matchOfNew[j]
      for (k in index + 1 until inputs.size) if (matchOfNew[k] >= 0) return matchOfNew[k]
      return -1
    }
    val oldLive = IntList()
    for (i in slots.indices) if (!slots[i].exiting) oldLive.add(i)
    fun anchorForOld(slotIndex: Int): Int {
      var pos = 0
      while (pos < oldLive.size && oldLive[pos] != slotIndex) pos++
      for (j in pos + 1 until oldLive.size) if (used[oldLive[j]]) return oldLive[j]
      var j = pos
      while (j-- > 0) if (used[oldLive[j]]) return oldLive[j]
      return -1
    }

    fun closeRun(left: (Int) -> Double, right: (Int) -> Double) {
      if (runBuf.size >= GROUP_MIN) {
        var lo = 0.0
        var hi = 0.0
        for (k in 0 until runBuf.size) {
          val l = left(runBuf[k])
          val r = right(runBuf[k])
          if (k == 0) { lo = l; hi = r } else { lo = min(lo, l); hi = max(hi, r) }
        }
        val mid = (lo + hi) / 2
        for (k in 0 until runBuf.size) { groupFlag[runBuf[k]] = true; groupCentre[runBuf[k]] = mid }
      }
      runBuf.clear()
    }

    groupFlag = BooleanArray(slots.size)
    groupCentre = DoubleArray(slots.size)
    runBuf.clear()
    val oldLeft = { i: Int -> slots[i].x }
    val oldRight = { i: Int -> slots[i].x + slots[i].width }
    for (i in slots.indices) {
      if (slots[i].exiting) continue
      if (used[i]) { closeRun(oldLeft, oldRight); continue }
      runBuf.add(i)
    }
    closeRun(oldLeft, oldRight)

    val next = ArrayList<Slot>(slots.size + inputs.size)

    for (i in slots.indices) {
      val s = slots[i].copy()
      if (s.exiting) {
        if (s.anchorId >= 0) {
          val a = slotIndexOf(s.anchorId)
          if (a < 0 || !used[a]) {
            s.anchorId = -1
            s.fromX = s.x
          }
        }
        next.add(s)
        continue
      }
      if (used[i]) continue
      s.exiting = true
      s.entering = false
      s.start = now
      s.fromX = s.x; s.toX = s.x
      s.fromY = s.y
      s.toY = if (s.slide) 1.0 else 0.0
      s.fromOpacity = s.opacity
      s.toOpacity = 0.0
      s.fadeFrom = 0.0
      s.fadeTo = if (s.slide) SLIDE_EXIT_FADE_TO else TEXT_EXIT_FADE_TO
      s.fromScale = s.scale
      s.toScale = if (s.slide) 1.0 else FADE_SCALE
      if (groupFlag[i]) {
        s.grouped = true
        s.groupCentre = groupCentre[i]
        s.toY = s.fromY
        s.fromScale = s.scale
        s.toScale = GROUP_SCALE
        s.fadeTo = GROUP_EXIT_FADE_TO
        s.anchorId = -1
        next.add(s)
        continue
      }
      val a = anchorForOld(i)
      s.anchorId = if (a >= 0) slots[a].id else -1
      s.anchorBaseX = if (a >= 0) slots[a].x else 0.0
      next.add(s)
    }

    groupFlag = BooleanArray(inputs.size)
    groupCentre = DoubleArray(inputs.size)
    runBuf.clear()
    val newLeft = { i: Int -> targetX[i] }
    val newRight = { i: Int -> targetX[i] + inputs[i].width }
    for (i in inputs.indices) {
      if (matchOfNew[i] >= 0) { closeRun(newLeft, newRight); continue }
      runBuf.add(i)
    }
    closeRun(newLeft, newRight)

    for (i in inputs.indices) {
      val input = inputs[i]
      val m = matchOfNew[i]
      if (m >= 0) {
        val s = slots[m].copy()
        s.width = input.width
        s.entering = false
        s.slide = slides(input.kind) && !input.placeholder
        s.start = now
        s.fromX = s.x
        s.toX = targetX[i]
        s.fromY = s.y
        s.toY = 0.0
        s.fromOpacity = s.opacity
        s.toOpacity = 1.0
        s.fadeFrom = 0.0
        s.fadeTo = PERSIST_FADE_TO
        s.fromScale = s.scale
        s.toScale = 1.0
        s.anchorId = -1
        next.add(s)
      } else {
        val s = Slot()
        val slide = slides(input.kind) && !input.placeholder
        s.slide = slide
        s.entering = true
        s.start = now
        s.fromX = targetX[i]; s.toX = targetX[i]
        s.fromY = if (slide) (if (input.kind == SEPARATOR || input.kind == DECIMAL) 1.0 else -1.0) else 0.0
        s.toY = 0.0
        s.fromOpacity = 0.0
        s.toOpacity = 1.0
        s.fadeFrom = if (slide) 0.0 else TEXT_ENTER_FADE_FROM
        s.fadeTo = if (slide) SLIDE_ENTER_FADE_TO else TEXT_ENTER_FADE_TO
        s.fromScale = if (slide) 1.0 else FADE_SCALE
        s.toScale = 1.0
        if (groupFlag[i]) {
          s.grouped = true
          s.groupCentre = groupCentre[i]
          s.fromY = 0.0; s.toY = 0.0
          s.fromScale = GROUP_SCALE
          s.fadeTo = GROUP_ENTER_FADE_TO
        } else {
          val a = anchorForNew(i)
          s.anchorId = if (a >= 0) slots[a].id else -1
          s.anchorBaseX = 0.0
          if (a >= 0) {
            for (j in inputs.indices) {
              if (matchOfNew[j] == a) {
                s.anchorBaseX = targetX[j]
                break
              }
            }
          }
        }
        s.id = nextId++; s.character = input.character; s.role = input.role; s.kind = input.kind
        s.width = input.width; s.placeholder = input.placeholder
        s.x = s.fromX; s.y = s.fromY; s.opacity = 0.0; s.scale = s.fromScale; s.exiting = false
        next.add(s)
      }
    }

    slots = next
    widthFrom = contentWidth
    targetWidth = x
    widthStart = now
    animating = true
    tick(now)
  }

  // MARK: Matching

  private fun matchBySequence(inputs: List<Input>, oldIdx: IntList, newIdx: IntList, matchOfNew: IntArray) {
    val pi = IntList()
    val pj = IntList()
    lcsPairs(oldIdx.size, newIdx.size, { i, j -> same(inputs[newIdx[j]], slots[oldIdx[i]]) }, pi, pj)
    for (k in 0 until pi.size) matchOfNew[newIdx[pj[k]]] = oldIdx[pi[k]]
  }

  private fun matchBody(inputs: List<Input>, oldBody: IntList, newBody: IntList, caretIndex: Int, matchOfNew: IntArray) {
    if (caretIndex >= 0) {
      matchByCaret(inputs, oldBody, newBody, caretIndex, matchOfNew)
      return
    }
    var hasDigits = false
    for (k in 0 until oldBody.size) hasDigits = hasDigits || slots[oldBody[k]].kind == DIGIT
    for (k in 0 until newBody.size) hasDigits = hasDigits || inputs[newBody[k]].kind == DIGIT
    if (hasDigits) matchByPlace(inputs, oldBody, newBody, matchOfNew)
    else matchBySequence(inputs, oldBody, newBody, matchOfNew)
  }

  private fun matchByCaret(inputs: List<Input>, oldBody: IntList, newBody: IntList, caretIndex: Int, matchOfNew: IntArray) {
    val keptOld = IntList(); val keptNew = IntList(); val sepOld = IntList(); val sepNew = IntList()
    for (p in 0 until oldBody.size) (if (slots[oldBody[p]].kind == SEPARATOR) sepOld else keptOld).add(p)
    for (p in 0 until newBody.size) (if (inputs[newBody[p]].kind == SEPARATOR) sepNew else keptNew).add(p)
    fun pairPositions(newPos: Int, oldPos: Int) {
      val ni = newBody[newPos]
      val oi = oldBody[oldPos]
      if (same(inputs[ni], slots[oi])) matchOfNew[ni] = oi
    }
    fun pairKept(i: Int, o: Int) {
      if (i < 0 || o < 0 || i >= keptNew.size || o >= keptOld.size) return
      pairPositions(keptNew[i], keptOld[o])
    }

    var keptCursor = 0
    while (keptCursor < keptNew.size && keptNew[keptCursor] < caretIndex) keptCursor++
    val lenDiff = keptNew.size - keptOld.size

    if (lenDiff > 0) {
      val editStart = keptCursor - lenDiff
      for (i in 0 until editStart) pairKept(i, i)
      for (i in keptCursor until keptNew.size) pairKept(i, i - lenDiff)
    } else if (lenDiff < 0) {
      for (i in 0 until keptCursor) pairKept(i, i)
      for (i in keptCursor until keptNew.size) pairKept(i, i - lenDiff)
    } else {
      for (i in 0 until keptNew.size) pairKept(i, i)
    }

    var uniform = true
    fun sepChar(positions: IntList, body: IntList, i: Int, old: Boolean): Int {
      val index = body[positions[i]]
      return if (old) slots[index].character else inputs[index].character
    }
    run {
      var i = 1
      while (i < sepOld.size && uniform) { uniform = sepChar(sepOld, oldBody, i, true) == sepChar(sepOld, oldBody, 0, true); i++ }
      i = 0
      while (i < sepNew.size && uniform) { uniform = sepOld.isEmpty() || sepChar(sepNew, newBody, i, false) == sepChar(sepOld, oldBody, 0, true); i++ }
    }
    fun integerDigits(body: IntList, old: Boolean): Int {
      var count = 0
      for (p in 0 until body.size) {
        val index = body[p]
        val kind = if (old) slots[index].kind else inputs[index].kind
        if (kind == DECIMAL) break
        if (kind == DIGIT) count++
      }
      return count
    }
    var carried = false
    for (p in 0 until newBody.size) {
      if (carried) break
      val index = newBody[p]
      if (inputs[index].kind == DECIMAL) break
      if (inputs[index].kind == DIGIT && matchOfNew[index] >= 0) carried = true
    }
    val reshaped = carried && integerDigits(oldBody, true) != integerDigits(newBody, false)
    if (uniform) {
      if (!reshaped) {
        var k = 1
        while (k <= sepOld.size && k <= sepNew.size) { pairPositions(sepNew[sepNew.size - k], sepOld[sepOld.size - k]); k++ }
      }
    } else {
      val pi = IntList(); val pj = IntList()
      lcsPairs(sepOld.size, sepNew.size, { i, j -> same(inputs[newBody[sepNew[j]]], slots[oldBody[sepOld[i]]]) }, pi, pj)
      for (k in 0 until pi.size) pairPositions(sepNew[pj[k]], sepOld[pi[k]])
    }
  }

  private fun matchByPlace(inputs: List<Input>, oldBody: IntList, newBody: IntList, matchOfNew: IntArray) {
    val n = oldBody.size
    val m = newBody.size
    fun oldSlot(p: Int) = slots[oldBody[p]]
    fun newIn(p: Int) = inputs[newBody[p]]
    fun pair(newPos: Int, oldPos: Int) {
      if (same(newIn(newPos), oldSlot(oldPos))) matchOfNew[newBody[newPos]] = oldBody[oldPos]
    }

    var start = 0
    while (start < n && start < m && oldSlot(start).kind != DIGIT && same(newIn(start), oldSlot(start))) {
      pair(start, start)
      start++
    }
    var oldEnd = n
    var newEnd = m
    while (oldEnd > start && newEnd > start && oldSlot(oldEnd - 1).kind != DIGIT && same(newIn(newEnd - 1), oldSlot(oldEnd - 1))) {
      pair(newEnd - 1, oldEnd - 1)
      oldEnd--
      newEnd--
    }

    var oldPivot = oldEnd
    var newPivot = newEnd
    for (i in oldEnd - 1 downTo start) if (oldSlot(i).kind == DECIMAL) { oldPivot = i; break }
    for (i in newEnd - 1 downTo start) if (newIn(i).kind == DECIMAL) { newPivot = i; break }

    val oldInt = IntList(); val newInt = IntList()
    for (i in start until oldPivot) if (oldSlot(i).kind == DIGIT) oldInt.add(i)
    for (i in start until newPivot) if (newIn(i).kind == DIGIT) newInt.add(i)

    if (!oldInt.isEmpty() && !newInt.isEmpty() && abs(oldInt.size - newInt.size) >= MAGNITUDE_JUMP) return

    var reshaped = false
    if (oldInt.size == newInt.size) {
      for (k in 0 until oldInt.size) pair(newInt[k], oldInt[k])
    } else {
      val pi = IntList(); val pj = IntList()
      lcsPairs(oldInt.size, newInt.size, { i, j -> same(newIn(newInt[newInt.size - 1 - j]), oldSlot(oldInt[oldInt.size - 1 - i])) }, pi, pj)
      for (k in 0 until pi.size) pair(newInt[newInt.size - 1 - pj[k]], oldInt[oldInt.size - 1 - pi[k]])
      reshaped = !pi.isEmpty()
    }

    if (!reshaped) {
      var k = 1
      while (oldPivot - k >= start && newPivot - k >= start) {
        if (oldSlot(oldPivot - k).kind != DIGIT) pair(newPivot - k, oldPivot - k)
        k++
      }
    }

    if (oldPivot < oldEnd && newPivot < newEnd) {
      pair(newPivot, oldPivot)
      var k = 1
      while (oldPivot + k < oldEnd && newPivot + k < newEnd) {
        if (oldSlot(oldPivot + k).kind != DIGIT) pair(newPivot + k, oldPivot + k)
        k++
      }
      val oldFrac = IntList(); val newFrac = IntList()
      for (i in oldPivot + 1 until oldEnd) if (oldSlot(i).kind == DIGIT) oldFrac.add(i)
      for (i in newPivot + 1 until newEnd) if (newIn(i).kind == DIGIT) newFrac.add(i)
      var f = 0
      while (f < oldFrac.size && f < newFrac.size) { pair(newFrac[f], oldFrac[f]); f++ }
    }
  }

  // MARK: Frames

  private fun progress(start: Double, now: Double) = if (duration > 0) clamp01((now - start + 1e-9) / duration) else 1.0

  fun tick(now: Double): Boolean {
    this.now = now
    if (!animating) return false
    var moving = false
    val wp = progress(widthStart, now)
    contentWidth = widthFrom + (targetWidth - widthFrom) * ease(wp)
    if (wp < 1) moving = true

    for (pass in 0 until 2) {
      for (s in slots) {
        val anchored = s.anchorId >= 0
        if ((pass == 0) == anchored) continue
        val p = progress(s.start, now)
        val e = ease(p)
        if (anchored) {
          val a = slotIndexOf(s.anchorId)
          val base = if (s.exiting) s.fromX else s.toX
          if (a >= 0) {
            s.x = base + (slots[a].x - s.anchorBaseX)
          } else {
            s.anchorId = -1
            s.fromX = base; s.toX = base
            s.x = base
          }
        } else if (s.grouped) {
          val sc = s.fromScale + (s.toScale - s.fromScale) * e
          val rest = s.toX + s.width / 2
          s.x = s.groupCentre + sc * (rest - s.groupCentre) - s.width / 2
        } else {
          s.x = s.fromX + (s.toX - s.fromX) * e
        }
        s.y = s.fromY + (s.toY - s.fromY) * e
        s.scale = s.fromScale + (s.toScale - s.fromScale) * e
        s.opacity = s.fromOpacity + (s.toOpacity - s.fromOpacity) * ramp(p, s.fadeFrom, s.fadeTo)
        if (p < 1) moving = true
      }
    }

    slots.removeAll { it.exiting && progress(it.start, now) >= 1 }

    animating = moving
    publish()
    return moving
  }

  override fun needsFrames(): Boolean = animating

  // MARK: Render state

  private class Block {
    var start = 0.0; var end = 0.0; var any = false
    fun add(x: Double, width: Double) {
      if (!any) { start = x; end = x + width; any = true } else { start = min(start, x); end = max(end, x + width) }
    }
  }

  private class Blocks {
    val prefix = Block(); val prefixGap = Block(); val sign = Block(); val rest = Block(); val suffixGap = Block(); val suffix = Block()
    val wholePrefix = Block()
    var prefixInkEnd = 0.0
    var suffixInkStart = 0.0
    fun aheadOfPrefix(g: Glyph) = wholePrefix.any && g.x + g.width <= wholePrefix.start + 1e-6
    fun prefixGapGlyph(g: Glyph) = g.role == PREFIX && isSpace(g.character) && g.x >= prefixInkEnd - 1e-6
    fun suffixGapGlyph(g: Glyph) = g.role == SUFFIX && isSpace(g.character) && g.x + g.width <= suffixInkStart + 1e-6
    fun of(g: Glyph): Block {
      if (g.role == PREFIX) return if (prefixGapGlyph(g)) prefixGap else prefix
      if (g.role == SUFFIX) return if (suffixGapGlyph(g)) suffixGap else suffix
      return if (aheadOfPrefix(g)) sign else rest
    }
  }

  private fun blocksOf(list: List<Glyph>, count: Int): Blocks {
    val b = Blocks()
    var prefixInk = false
    var suffixInk = false
    for (i in 0 until count) {
      val g = list[i]
      if (g.role == PREFIX) {
        b.wholePrefix.add(g.x, g.width)
        if (!isSpace(g.character)) {
          b.prefixInkEnd = if (prefixInk) max(b.prefixInkEnd, g.x + g.width) else g.x + g.width
          prefixInk = true
        }
      } else if (g.role == SUFFIX && !isSpace(g.character)) {
        b.suffixInkStart = if (suffixInk) min(b.suffixInkStart, g.x) else g.x
        suffixInk = true
      }
    }
    if (!prefixInk) b.prefixInkEnd = if (b.wholePrefix.any) b.wholePrefix.end else 0.0
    if (!suffixInk) b.suffixInkStart = -1.0
    for (i in 0 until count) {
      val g = list[i]
      if (g.role == PREFIX) {
        (if (b.prefixGapGlyph(g)) b.prefixGap else b.prefix).add(g.x, g.width)
      } else if (g.role == SUFFIX) {
        (if (b.suffixGapGlyph(g)) b.suffixGap else b.suffix).add(g.x, g.width)
      } else if (b.aheadOfPrefix(g)) {
        b.sign.add(g.x, g.width)
      } else {
        b.rest.add(g.x, g.width)
      }
    }
    return b
  }

  /** Copies the slots' frames into `glyphs`, mirrored when right-to-left (reusing the glyph objects). */
  private fun publish() {
    while (glyphs.size < slots.size) glyphs.add(Glyph())
    for (i in slots.indices) glyphs[i].from(slots[i])
    glyphCount = slots.size
    if (!rightToLeft || glyphCount == 0) return
    val b = blocksOf(glyphs, glyphCount)
    val total = contentWidth
    for (i in 0 until glyphCount) {
      val g = glyphs[i]
      val block = b.of(g)
      g.x = total - block.end + (g.x - block.start)
    }
  }

  override fun setRightToLeft(rightToLeft: Boolean) {
    if (this.rightToLeft == rightToLeft) return
    this.rightToLeft = rightToLeft
    publish()
  }

  override fun reset() {
    duration = 0.4
    easing = 0
    bounce = 0.15
    effect = 0
    pending.clear()
    slots.clear()
    glyphCount = 0
    committed = false
    animating = false
    contentWidth = 0.0; targetWidth = 0.0; widthFrom = 0.0
  }

  override fun glyphCount(): Int = glyphCount

  /** The same layout as the C++ `frameInto`: [count, contentWidth, targetWidth, 11 fields per glyph]. */
  override fun frameInto(out: DoubleArray): Int {
    val needed = 3 + glyphCount * 11
    if (out.size < needed) return -1
    out[0] = glyphCount.toDouble()
    out[1] = contentWidth
    out[2] = targetWidth
    var k = 3
    for (i in 0 until glyphCount) {
      val g = glyphs[i]
      out[k++] = g.id.toDouble()
      out[k++] = g.character.toDouble()
      out[k++] = g.role.toDouble()
      out[k++] = g.kind.toDouble()
      out[k++] = g.width
      out[k++] = if (g.placeholder) 1.0 else 0.0
      out[k++] = g.x
      out[k++] = g.y
      out[k++] = g.opacity
      out[k++] = g.scale
      out[k++] = if (g.exiting) 1.0 else 0.0
    }
    return needed
  }

  override fun commitLine(
    characters: IntArray, kinds: IntArray, widths: DoubleArray, count: Int,
    role: Int, reduceMotion: Boolean, caret: Int, now: Double,
  ): Boolean {
    setReduceMotion(reduceMotion)
    beginText()
    for (i in 0 until count) addGlyph(characters[i], role, kinds[i], widths[i], false)
    commitText(caret, now)
    return needsFrames()
  }

  override fun tickInto(now: Double, out: DoubleArray): Int {
    tick(now)
    val written = frameInto(out)
    val more = if (needsFrames()) ReflowEngine.MORE_FRAMES else 0
    return if (written < 0) -1 else (written or more)
  }
}
