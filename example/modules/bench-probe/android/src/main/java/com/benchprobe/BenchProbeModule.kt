package com.benchprobe

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.system.Os
import android.system.OsConstants
import android.util.Base64
import android.util.Log
import android.view.Choreographer
import android.view.Display
import android.view.WindowManager
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.ExtractedTextRequest
import android.view.inputmethod.InputConnection
import android.widget.EditText
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The frame meter is a Choreographer callback on the main thread: it fires once
 * per vsync as long as the main thread gets to service it, so a gap of several
 * vsync periods is a frame the main thread missed. CPU comes from
 * /proc/self/task, the same source `top -H` reads.
 */
class BenchProbeModule(reactContext: ReactApplicationContext) : NativeBenchProbeSpec(reactContext) {
  private val lock = Any()
  private val gaps = ArrayList<Double>(8192)

  @Volatile private var running = false
  private var lastFrameNanos = 0L
  private var nominalHz = 0f

  private val frameCallback =
    object : Choreographer.FrameCallback {
      override fun doFrame(frameTimeNanos: Long) {
        if (!running) return
        if (lastFrameNanos != 0L) {
          synchronized(lock) { gaps.add((frameTimeNanos - lastFrameNanos) / 1_000_000.0) }
        }
        lastFrameNanos = frameTimeNanos
        Choreographer.getInstance().postFrameCallback(this)
      }
    }

  private fun display(): Display? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val fromActivity = reactApplicationContext.currentActivity?.display
      if (fromActivity != null) return fromActivity
    }
    val wm = reactApplicationContext.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    @Suppress("DEPRECATION")
    return wm?.defaultDisplay
  }

  private fun refreshRate(): Float = display()?.refreshRate ?: 60f

  private fun powerManager(): PowerManager? =
    reactApplicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager

  override fun getDeviceInfo(): String =
    JSONObject()
      .put("platform", "android")
      .put("model", Build.MODEL)
      .put("name", "${Build.MANUFACTURER} ${Build.MODEL}")
      .put("os", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
      .put("refreshRate", refreshRate().toDouble())
      .put("cpuCores", Runtime.getRuntime().availableProcessors())
      .put("lowPowerMode", powerManager()?.isPowerSaveMode ?: false)
      .put("thermal", thermalState())
      .put("debug", BuildConfig.DEBUG)
      .toString()

  /**
   * A plan runs for minutes with nobody touching the screen, so the screen
   * timeout must not end it; and an adaptive-refresh panel idles at 60 Hz
   * unless a window asks for more, so ask for the fastest mode at the current
   * resolution: "every frame" then means the panel's maximum on Android too.
   * Returns that mode's refresh rate, or null when there is no window yet.
   */
  private fun prepareWindow(): Float? {
    val activity = reactApplicationContext.currentActivity ?: return null
    val display = display() ?: return null
    val current = display.mode
    val fastest =
      display.supportedModes
        .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
        .maxByOrNull { it.refreshRate } ?: current
    UiThreadUtil.runOnUiThread {
      val window = activity.window ?: return@runOnUiThread
      window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      val params = window.attributes
      if (params.preferredDisplayModeId != fastest.modeId) {
        params.preferredDisplayModeId = fastest.modeId
        window.attributes = params
      }
    }
    return fastest.refreshRate
  }

  override fun getLaunchPlan(): String {
    val extra = reactApplicationContext.currentActivity?.intent?.getStringExtra("BENCH_PLAN") ?: return ""
    val plan =
      try {
        String(Base64.decode(extra, Base64.DEFAULT), Charsets.UTF_8)
      } catch (e: IllegalArgumentException) {
        ""
      }
    if (plan.isNotEmpty()) prepareWindow()
    return plan
  }

  override fun thermalState(): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "unknown"
    return when (powerManager()?.currentThermalStatus) {
      PowerManager.THERMAL_STATUS_NONE -> "none"
      PowerManager.THERMAL_STATUS_LIGHT -> "light"
      PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
      PowerManager.THERMAL_STATUS_SEVERE -> "severe"
      PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
      PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
      PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
      else -> "unknown"
    }
  }

  override fun sample(): String {
    val ticksPerSecond = Os.sysconf(OsConstants._SC_CLK_TCK).toDouble()
    val pid = Process.myPid()
    val threads = JSONArray()
    File("/proc/self/task").listFiles()?.forEach { dir ->
      val tid = dir.name.toIntOrNull() ?: return@forEach
      val stat = try { File(dir, "stat").readText() } catch (e: Exception) { return@forEach }
      val open = stat.indexOf('(')
      val close = stat.lastIndexOf(')')
      if (open < 0 || close < open) return@forEach
      val name = stat.substring(open + 1, close)
      // Fields after the comm: state is field 3, utime field 14, stime field 15.
      val fields = stat.substring(close + 1).trim().split(' ')
      if (fields.size < 13) return@forEach
      val ticks = (fields[11].toLongOrNull() ?: 0L) + (fields[12].toLongOrNull() ?: 0L)
      threads.put(
        JSONObject()
          .put("id", tid)
          .put("name", name)
          .put("main", tid == pid)
          .put("cpuMs", ticks * 1000.0 / ticksPerSecond),
      )
    }
    val rssMb =
      try {
        val statm = File("/proc/self/statm").readText().trim().split(' ')
        statm[1].toLong() * Os.sysconf(OsConstants._SC_PAGESIZE) / (1024.0 * 1024.0)
      } catch (e: Exception) {
        0.0
      }
    return JSONObject()
      .put("wallMs", SystemClock.elapsedRealtimeNanos() / 1_000_000.0)
      .put("rssMb", rssMb)
      .put("nativeHeapMb", android.os.Debug.getNativeHeapAllocatedSize() / (1024.0 * 1024.0))
      .put("javaHeapMb", (Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()) / (1024.0 * 1024.0))
      .put("threads", threads)
      .toString()
  }

  override fun forceGc() {
    // A detached view is freed by the Java collector; the C++ engine behind it
    // (an fbjni HybridData) by the destructor thread after that. Two rounds so
    // what the first round's finalizers released is collected too.
    System.gc()
    System.runFinalization()
    SystemClock.sleep(150)
    System.gc()
    System.runFinalization()
    SystemClock.sleep(100)
  }

  override fun startFrames() {
    val requested = prepareWindow()
    UiThreadUtil.runOnUiThread {
      synchronized(lock) { gaps.clear() }
      lastFrameNanos = 0L
      nominalHz = requested ?: refreshRate()
      running = true
      Choreographer.getInstance().postFrameCallback(frameCallback)
    }
  }

  override fun stopFrames(): String {
    running = false
    val copy = synchronized(lock) { ArrayList(gaps) }
    // The panel's rate is read from the display at the start and the end of the
    // window (a stalled main thread must not look like a slower panel); if the
    // mode changed in between, the faster of the two is the stricter yardstick.
    val hzEnd = refreshRate()
    val hz = maxOf(nominalHz, hzEnd).let { if (it > 0f) it else 60f }
    val expected = 1000.0 / hz
    var seconds = 0.0
    var dropped = 0.0
    var longFrames = 0
    for (gap in copy) {
      seconds += gap / 1000.0
      if (gap > 1.5 * expected) dropped += Math.round(gap / expected) - 1
      if (gap > 2.5 * expected) longFrames++
    }
    val sorted = copy.sorted()
    fun percentile(p: Double): Double =
      if (sorted.isEmpty()) 0.0 else sorted[minOf(sorted.size - 1, Math.floor(p * sorted.size).toInt())]
    return JSONObject()
      .put("frames", if (copy.isEmpty()) 0 else copy.size + 1)
      .put("seconds", seconds)
      .put("fps", if (seconds > 0) copy.size / seconds else 0.0)
      .put("hz", Math.round(hz.toDouble()))
      .put("hzEnd", Math.round(hzEnd.toDouble()))
      .put("dropped", dropped)
      .put("long", longFrames)
      .put("p50", percentile(0.5))
      .put("p95", percentile(0.95))
      .put("p99", percentile(0.99))
      .put("max", sorted.lastOrNull() ?: 0.0)
      .toString()
  }

  // region Typing driver

  private var typing: TypingDriver? = null

  /** Cumulative CPU time of the main thread (its tid is the pid), in ms. */
  private fun mainThreadCpuMs(): Double {
    val pid = Process.myPid()
    val stat = try { File("/proc/self/task/$pid/stat").readText() } catch (e: Exception) { return 0.0 }
    val close = stat.lastIndexOf(')')
    val fields = stat.substring(close + 1).trim().split(' ')
    if (fields.size < 13) return 0.0
    val ticks = (fields[11].toLongOrNull() ?: 0L) + (fields[12].toLongOrNull() ?: 0L)
    return ticks * 1000.0 / Os.sysconf(OsConstants._SC_CLK_TCK).toDouble()
  }

  /**
   * Types into the focused field one key at a time from a Choreographer
   * callback, through the input connection (the IME's path), and watches the
   * field's text on every following frame: a key whose text is rewritten in a
   * later frame (the raw digit first, the formatted amount a frame or two
   * later) is the flicker of a JS round trip, counted per key.
   */
  private inner class TypingDriver(text: String, keysPerSecond: Double, private val done: (String) -> Unit) : Choreographer.FrameCallback {
    private val keys: List<String> = text.codePoints().toArray().map { String(Character.toChars(it)) }
    private val intervalNs = if (keysPerSecond > 0) (1e9 / keysPerSecond).toLong() else 100_000_000L
    private val records = ArrayList<JSONObject>()
    private var next = 0
    private var nextAt = 0L
    private var startNs = 0L
    private var lastNs = 0L
    private var lastText = ""
    private var pendingKey = -1
    private var pendingAt = 0L
    private var quietFrames = 0
    private var cpuAtKey = 0.0
    private var frames = 0
    private var dropped = 0.0
    private val expectedNs = (1e9 / (display()?.refreshRate ?: 60f)).toLong()

    fun start() {
      Choreographer.getInstance().postFrameCallback(this)
    }

    /** The focused view: an EditText, or a Compose host (Expo UI) that owns a text field. */
    private fun field(): View? = reactApplicationContext.currentActivity?.currentFocus

    /** The IME's channel to the focused field, whatever draws it. */
    private fun connection(field: View): InputConnection? = field.onCreateInputConnection(EditorInfo())

    /** The field's text as the IME sees it (works for Compose too); an EditText's own text as a fallback. */
    private fun textOf(field: View?, connection: InputConnection?): String {
      val extracted = try { connection?.getExtractedText(ExtractedTextRequest(), 0)?.text?.toString() } catch (e: Exception) { null }
      return extracted ?: (field as? EditText)?.text?.toString() ?: ""
    }

    override fun doFrame(frameTimeNanos: Long) {
      if (startNs == 0L) {
        startNs = frameTimeNanos
        nextAt = frameTimeNanos
      } else {
        val gap = frameTimeNanos - lastNs
        frames++
        if (gap > 1.5 * expectedNs) dropped += Math.round(gap.toDouble() / expectedNs) - 1
      }
      lastNs = frameTimeNanos
      val field = field()
      val connection = field?.let { connection(it) }
      val text = textOf(field, connection)

      if (pendingKey >= 0) {
        val record = records[pendingKey]
        if (text != lastText) {
          record.put("rewrites", record.getInt("rewrites") + 1)
          record.put("settledMs", (frameTimeNanos - pendingAt) / 1e6)
          quietFrames = 0
        } else {
          quietFrames++
        }
        record.put("cpuMs", mainThreadCpuMs() - cpuAtKey)
        if (quietFrames >= 3 && frameTimeNanos >= nextAt) {
          record.put("text", text)
          pendingKey = -1
        }
      }
      lastText = text

      if (pendingKey < 0 && next < keys.size && frameTimeNanos >= nextAt) {
        if (field == null || (connection == null && field !is EditText)) {
          finish("no focused text field")
          return
        }
        val record = JSONObject().put("key", keys[next]).put("rewrites", 0).put("settledMs", 0.0).put("cpuMs", 0.0)
        records.add(record)
        cpuAtKey = mainThreadCpuMs()
        if (connection != null) connection.commitText(keys[next], 1)
        else (field as EditText).text?.insert(field.selectionStart.coerceAtLeast(0), keys[next])
        // The key's own frame is not a rewrite: what the field shows right after
        // the insert is the baseline the later frames are compared against.
        lastText = textOf(field, connection)
        pendingKey = next
        pendingAt = frameTimeNanos
        quietFrames = 0
        next++
        nextAt = frameTimeNanos + intervalNs
      } else if (pendingKey < 0 && next >= keys.size) {
        finish(null)
        return
      }
      Choreographer.getInstance().postFrameCallback(this)
    }

    private fun finish(error: String?) {
      val keysJson = JSONArray()
      for (r in records) keysJson.put(r)
      val summary = JSONObject()
        .put("keys", keysJson)
        .put("typed", records.size)
        .put("seconds", (lastNs - startNs) / 1e9)
        .put("frames", frames)
        .put("dropped", dropped)
        .put("error", error ?: JSONObject.NULL)
      done(summary.toString())
    }
  }

  override fun typeText(text: String, keysPerSecond: Double, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      if (typing != null) {
        promise.reject("busy", "a typing run is already in progress")
        return@runOnUiThread
      }
      val driver = TypingDriver(text, keysPerSecond) { json ->
        typing = null
        promise.resolve(json)
      }
      typing = driver
      driver.start()
    }
  }

  // endregion

  override fun report(line: String) {
    Log.i("BENCH", line)
    try {
      File(reactApplicationContext.filesDir, "bench-results.ndjson").appendText(line + "\n")
    } catch (e: Exception) {
      // The file is a convenience copy; logcat is the channel that matters.
    }
  }
}
