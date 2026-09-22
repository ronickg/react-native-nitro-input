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
      .put("threads", threads)
      .toString()
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

  override fun report(line: String) {
    Log.i("BENCH", line)
    try {
      File(reactApplicationContext.filesDir, "bench-results.ndjson").appendText(line + "\n")
    } catch (e: Exception) {
      // The file is a convenience copy; logcat is the channel that matters.
    }
  }
}
