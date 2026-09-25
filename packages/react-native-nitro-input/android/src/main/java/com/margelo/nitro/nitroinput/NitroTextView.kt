package com.margelo.nitro.nitroinput

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.AssetManager
import android.content.res.Configuration
import android.content.res.Resources
import android.database.ContentObserver
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.TextPaint
import android.util.SparseArray
import android.util.TypedValue
import android.view.Choreographer
import android.view.View
import android.view.accessibility.AccessibilityEvent
import androidx.annotation.RequiresApi
import com.facebook.react.common.assets.ReactFontManager
import com.margelo.nitro.NitroModules
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * A single line of text that morphs to the next (NitroText). The C++
 * `ReflowEngine` decides where every character is; this view draws them in
 * one pass: at rest the whole line in one draw (per font run, glyphs shaped
 * once and placed where the engine put them), and while a morph runs every
 * character at its own position, opacity and scale, frame by frame. There is
 * no text field and no child view, so mounting a thousand of them costs about
 * what a thousand labels do. [HybridNitroTextMeasure] measures a line the same
 * way ([NitroTextFonts]), so the JS side gives the view its size in the commit
 * that mounts it.
 *
 * Mirrors `NitroTextView.swift` on iOS.
 */
// `ReflowEngine::Kind` / `Role`.
private const val KIND_TEXT = 0
private const val KIND_DIGIT = 1
private const val KIND_SEPARATOR = 2
private const val KIND_DECIMAL = 3
private const val ROLE_BODY = 1
/** Doubles per glyph in the engine's frame buffer (`ReflowEngine.frameInto`). */
private const val GLYPH_FIELDS = 11
/** The loading fade, in seconds. */
private const val LOADING_FADE = 0.25
/** Where the glint starts its sweep, as NitroNumber's. */
private const val SHIMMER_SEED = 0.25f

/**
 * The fonts NitroText draws with, shared by every view and the measurer: a
 * paint per size, weight and family, and each character's advance (and, on
 * API 31+, its shaped glyphs) in it. Measured on the JS thread and drawn on
 * the main thread, so it locks. Sizes are in dp going in, px coming out.
 */
internal object NitroTextFonts {
  class Entry(val paint: TextPaint) {
    private val metrics: Paint.FontMetrics = paint.fontMetrics
    /** The line box, in px. */
    val lineHeight: Float = ceil(metrics.descent - metrics.ascent)
    /** From the line box's top to the baseline, in px. */
    val baseline: Float = -metrics.ascent
    internal val advances = SparseArray<Float>()
    internal val shaped = SparseArray<Any>()
  }

  /** The one density the views and the measurer convert with. */
  val density: Float =
    (NitroModules.applicationContext?.resources ?: Resources.getSystem()).displayMetrics.density

  private val entries = HashMap<String, Entry>()
  private val lock = Any()
  /** A code point's UTF-16 units, reused under [lock]. */
  private val chars = CharArray(2)

  fun entry(fontSize: Double, fontWeight: Double, fontFamily: String, assets: AssetManager? = null): Entry {
    val size = if (fontSize.isFinite() && fontSize > 0) fontSize else 17.0
    val weight = if (fontWeight.isFinite()) fontWeight else 400.0
    val key = "$size|$weight|$fontFamily"
    synchronized(lock) {
      entries[key]?.let { return it }
      val entry = Entry(makePaint(size, weight, fontFamily, assets ?: NitroModules.applicationContext?.assets))
      if (entries.size > 64) entries.clear()
      entries[key] = entry
      return entry
    }
  }

  /** A drawing copy of [entry]'s paint (the shared one is only measured with). */
  fun paintCopy(entry: Entry): TextPaint = synchronized(lock) { TextPaint(entry.paint) }

  /** One character's advance in px, as the view lays it out (no kerning with its neighbours). */
  fun advance(codePoint: Int, entry: Entry): Float = synchronized(lock) {
    entry.advances.get(codePoint)?.let { return it }
    val n = Character.toChars(codePoint, chars, 0)
    val width = entry.paint.measureText(chars, 0, n)
    entry.advances.put(codePoint, width)
    width
  }

  /** The line's width in px: every character's advance and the letter spacing after it. */
  fun width(text: String, entry: Entry, letterSpacingPx: Float): Float {
    var total = 0f
    var i = 0
    while (i < text.length) {
      val cp = text.codePointAt(i)
      total += advance(cp, entry) + letterSpacingPx
      i += Character.charCount(cp)
    }
    return total
  }

  /** One character shaped once, for [Canvas.drawGlyphs]. */
  @RequiresApi(Build.VERSION_CODES.S)
  fun shaped(codePoint: Int, entry: Entry): NitroTextGlyphs = synchronized(lock) {
    (entry.shaped.get(codePoint) as NitroTextGlyphs?)?.let { return it }
    val n = Character.toChars(codePoint, chars, 0)
    val glyphs = NitroTextGlyphs.of(chars, n, entry.paint)
    entry.shaped.put(codePoint, glyphs)
    glyphs
  }

  private fun makePaint(sizeDp: Double, weight: Double, family: String, assets: AssetManager?): TextPaint {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
    paint.typeface = makeTypeface(Math.rint(weight).toInt().coerceIn(1, 1000), family, assets)
    paint.textSize = (sizeDp * density).toFloat()
    // Tabular digits: a column keeps its width while its digit morphs.
    paint.fontFeatureSettings = "tnum"
    return paint
  }

  private fun makeTypeface(weight: Int, family: String, assets: AssetManager?): Typeface = try {
    if (family.isNotEmpty() && assets != null) {
      ReactFontManager.getInstance().getTypeface(family, Typeface.NORMAL, weight, assets)
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      Typeface.create(Typeface.DEFAULT, weight, false)
    } else if (weight >= 600) {
      Typeface.DEFAULT_BOLD
    } else {
      Typeface.DEFAULT
    }
  } catch (e: Throwable) {
    if (weight >= 600) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
  }
}

/**
 * A character shaped once ([android.graphics.text.TextRunShaper]): runs of
 * glyphs per font (a fallback font gets its own run), positions relative to
 * the character's origin on the baseline.
 */
@RequiresApi(Build.VERSION_CODES.S)
internal class NitroTextGlyphs private constructor(
  val fonts: Array<android.graphics.fonts.Font>,
  val ids: Array<IntArray>,
  val positions: Array<FloatArray>,
) {
  /** Draws at ([x], [baseline]); [scratch] is replaced (and returned) when a run is longer. */
  fun draw(canvas: Canvas, x: Float, baseline: Float, paint: Paint, scratch: FloatArray): FloatArray {
    var buffer = scratch
    for (r in fonts.indices) {
      val pos = positions[r]
      if (buffer.size < pos.size) buffer = FloatArray(pos.size)
      var i = 0
      while (i < pos.size) {
        buffer[i] = pos[i] + x
        buffer[i + 1] = pos[i + 1] + baseline
        i += 2
      }
      canvas.drawGlyphs(ids[r], 0, buffer, 0, ids[r].size, fonts[r], paint)
    }
    return buffer
  }

  companion object {
    fun of(chars: CharArray, count: Int, paint: Paint): NitroTextGlyphs {
      val glyphs = android.graphics.text.TextRunShaper.shapeTextRun(chars, 0, count, 0, count, 0f, 0f, false, paint)
      val runFonts = ArrayList<android.graphics.fonts.Font>()
      val runIds = ArrayList<IntArray>()
      val runPositions = ArrayList<FloatArray>()
      var start = 0
      val total = glyphs.glyphCount()
      while (start < total) {
        val font = glyphs.getFont(start)
        var end = start + 1
        while (end < total && glyphs.getFont(end) == font) end++
        val n = end - start
        val ids = IntArray(n)
        val pos = FloatArray(n * 2)
        for (i in 0 until n) {
          ids[i] = glyphs.getGlyphId(start + i)
          pos[i * 2] = glyphs.getGlyphX(start + i)
          pos[i * 2 + 1] = glyphs.getGlyphY(start + i)
        }
        runFonts.add(font); runIds.add(ids); runPositions.add(pos)
        start = end
      }
      return NitroTextGlyphs(runFonts.toTypedArray(), runIds.toTypedArray(), runPositions.toTypedArray())
    }
  }
}

class NitroTextView(context: Context) : View(context) {

  data class Style(
    /** In dp. */
    val fontSize: Double = 17.0,
    val fontWeight: Double = 400.0,
    /** Empty: the system font. */
    val fontFamily: String = "",
    /** Null: the theme's primary text colour. */
    val color: Int? = null,
    /** After every character, in dp. */
    val letterSpacing: Float = 0f,
    val textAlign: NitroNumberView.Alignment = NitroNumberView.Alignment.AUTO,
  )

  data class Timing(
    val durationSeconds: Double = 0.4,
    /** 0 expo, 1 easeOut, 2 easeInOut, 3 linear, 4 spring. */
    val easing: Int = 0,
    val bounce: Double = 0.15,
    /** 0 auto, 1 slide, 2 fade. */
    val effect: Int = 0,
    val respectReduceMotion: Boolean = true,
  )

  var style: Style = Style()
    set(value) {
      if (field == value) return
      field = value
      applyFonts()
      // New advances: lay the same text out again, at once.
      if (committed) commit(animated = false)
      invalidate()
    }

  var timing: Timing = Timing()
    set(value) {
      if (field == value) return
      field = value
      engine.setTiming(value.durationSeconds, value.easing, value.bounce)
      engine.setEffect(value.effect)
    }

  var shimmer: NitroNumberView.Shimmer = NitroNumberView.Shimmer()
    set(value) {
      if (field == value) return
      field = value
      if (loading) invalidate()
    }

  var text: String
    get() = shownText
    set(value) {
      if (shownText == value) return
      shownText = value
      commit(animated = committed)
      // A no-op unless an accessibility service is on.
      sendAccessibilityEvent(AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED)
    }

  var loading: Boolean = false
    set(value) {
      if (field == value) return
      field = value
      loadingFrom = loadingProgress
      loadingStart = now()
      scheduleFrameIfNeeded()
      invalidate()
    }

  var rightToLeft: Boolean = false
    set(value) {
      if (field == value) return
      field = value
      engine.setRightToLeft(value)
      restValid = false
      invalidate()
    }

  private val engine = ReflowEngine()
  private var shownText = ""
  /** `ReflowEngine::hasText()`: something was committed since the last reset. */
  private var committed = false
  private var fonts: NitroTextFonts.Entry = NitroTextFonts.entry(17.0, 400.0, "", context.assets)
  private var paint: TextPaint = NitroTextFonts.paintCopy(fonts)
  private var letterSpacingPx = 0f
  private var defaultInk = defaultTextColor()
  private var loadingProgress = 0f
  private var loadingFrom = 0f
  private var loadingStart = 0.0
  private var frameScheduled = false
  /** Reused every frame so the JNI hop never allocates once warm. */
  private var frameBuffer = DoubleArray(3 + GLYPH_FIELDS * 64)
  private var frameCount = 0
  private var frameContentWidth = 0f
  /** A code point's UTF-16 units for `drawText` (API < 31). */
  private val chars = CharArray(2)
  /** Positions handed to `drawGlyphs` (API 31+), grown when a run is longer. */
  private var glyphPositions = FloatArray(16)

  /**
   * The line at rest (API 31+): every glyph of every character, by font,
   * positioned where the engine laid it out, so a settled line is one
   * `drawGlyphs` per font. Rebuilt after every morph, reused in between.
   */
  private class RestRun {
    var font: Any? = null
    var ids = IntArray(16)
    var positions = FloatArray(32)
    var count = 0
  }
  private val restRuns = ArrayList<RestRun>()
  private var restRunCount = 0
  private var restContentWidth = 0f
  private var restValid = false

  private val frameCallback = Choreographer.FrameCallback { frameTimeNanos ->
    frameScheduled = false
    engine.tick(frameTimeNanos / 1e9)
    val target = if (loading) 1f else 0f
    if (loadingProgress != target) {
      val t = min(1.0, (now() - loadingStart) / LOADING_FADE).toFloat()
      loadingProgress = loadingFrom + (target - loadingFrom) * t
    }
    invalidate()
    scheduleFrameIfNeeded()
  }

  private val shimmerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_ATOP)
  }
  /** The glint's gradient, rebuilt only when its colours or size change; a frame just slides it. */
  private var shimmerGradient: LinearGradient? = null
  private var shimmerGradientBase = 0
  private var shimmerGradientHighlight = 0
  private var shimmerGradientLength = -1f
  private var shimmerGradientSlant = Float.NaN
  private val shimmerMatrix = Matrix()

  /** An `accessibilityLabel` the app set, which TalkBack reads instead of the text. */
  private var explicitDescription: CharSequence? = null

  init {
    setWillNotDraw(false)
    isFocusable = false
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    engine.setTiming(timing.durationSeconds, timing.easing, timing.bounce)
  }

  // region Accessibility

  override fun setContentDescription(contentDescription: CharSequence?) {
    explicitDescription = contentDescription
    super.setContentDescription(contentDescription)
  }

  override fun getContentDescription(): CharSequence? {
    explicitDescription?.let { if (it.isNotEmpty()) return it }
    if (text.isEmpty()) return null
    return if (loading) "$text, loading" else text
  }

  // endregion

  // region Lifecycle

  /** Fabric is about to reuse this view: forget the text and every animation. */
  fun resetForRecycle() {
    stopFrames()
    engine.reset()
    engine.setTiming(timing.durationSeconds, timing.easing, timing.bounce)
    engine.setEffect(timing.effect)
    engine.setRightToLeft(rightToLeft)
    committed = false
    restValid = false
    frameCount = 0
    // Not through the setter: nothing is committed, so the next text shows at once, as on a fresh mount.
    shownText = ""
    loadingProgress = 0f
    loadingFrom = 0f
    loading = false
    explicitDescription = null
    invalidate()
  }

  fun stopFrames() {
    if (frameScheduled) {
      Choreographer.getInstance().removeFrameCallback(frameCallback)
      frameScheduled = false
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      animatorScale = -1f
      context.contentResolver.registerContentObserver(
        Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, animatorScaleObserver,
      )
    }
    scheduleFrameIfNeeded()
  }

  override fun onDetachedFromWindow() {
    stopFrames()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      context.contentResolver.unregisterContentObserver(animatorScaleObserver)
    }
    super.onDetachedFromWindow()
  }

  override fun onConfigurationChanged(newConfig: Configuration?) {
    super.onConfigurationChanged(newConfig)
    // The default ink and the glint follow the theme (light / dark).
    defaultInk = defaultTextColor()
    invalidate()
  }

  // endregion

  // region Text

  private fun applyFonts() {
    fonts = NitroTextFonts.entry(style.fontSize, style.fontWeight, style.fontFamily, context.assets)
    paint = NitroTextFonts.paintCopy(fonts)
    letterSpacingPx = style.letterSpacing * NitroTextFonts.density
    restValid = false
  }

  /**
   * Hands the engine the text, one glyph per code point with its advance;
   * digits match by place and separators travel with their digits, the rest
   * by the longest common run.
   */
  private fun commit(animated: Boolean) {
    engine.setReduceMotion(!animated || (timing.respectReduceMotion && animationsDisabled()))
    engine.beginText()
    val s = shownText
    val entry = fonts
    var previous = -1
    var i = 0
    while (i < s.length) {
      val cp = s.codePointAt(i)
      val next = i + Character.charCount(cp)
      val following = if (next < s.length) s.codePointAt(next) else -1
      val width = NitroTextFonts.advance(cp, entry) + letterSpacingPx
      engine.addGlyph(cp, ROLE_BODY, kind(cp, previous, following), width.toDouble(), false)
      previous = cp
      i = next
    }
    engine.commitText(-1, now())
    committed = true
    restValid = false
    scheduleFrameIfNeeded()
    invalidate()
  }

  private fun isDigit(cp: Int): Boolean = cp in 48..57

  private fun kind(cp: Int, previous: Int, following: Int): Int {
    if (isDigit(cp)) return KIND_DIGIT
    // A comma or a point between two digits belongs to the number.
    if (!isDigit(previous) || !isDigit(following)) return KIND_TEXT
    return when (cp) {
      ','.code, 0x202F, 0x00A0, '\''.code -> KIND_SEPARATOR
      '.'.code -> KIND_DECIMAL
      else -> KIND_TEXT
    }
  }

  // endregion

  // region Frames

  private fun now(): Double = SystemClock.uptimeMillis() / 1000.0

  private fun needsFrames(): Boolean = engine.needsFrames() || loading || loadingProgress > 0f

  private fun scheduleFrameIfNeeded() {
    if (!frameScheduled && needsFrames()) {
      frameScheduled = true
      Choreographer.getInstance().postFrameCallback(frameCallback)
    }
  }

  /**
   * The animator duration scale on API < 33, read once and refreshed by
   * [animatorScaleObserver]. -1 = not read yet.
   */
  private var animatorScale = -1f
  private val animatorScaleObserver = object : ContentObserver(Handler(Looper.getMainLooper())) {
    override fun onChange(selfChange: Boolean) {
      animatorScale = -1f
    }
  }

  /** True when the user removed animations (Android's animator scale is 0), the equivalent of Reduce Motion. */
  private fun animationsDisabled(): Boolean {
    val scale = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ValueAnimator.getDurationScale()
    } else {
      if (animatorScale < 0f) {
        animatorScale = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
      }
      animatorScale
    }
    return scale <= 0f
  }

  /** Pulls the engine's glyphs into [frameBuffer] (no allocation once warm). */
  private fun readFrame(): Boolean {
    var written = engine.frameInto(frameBuffer)
    if (written < 0) {
      frameBuffer = DoubleArray(3 + GLYPH_FIELDS * (engine.glyphCount() + 32))
      written = engine.frameInto(frameBuffer)
      if (written < 0) return false
    }
    frameCount = frameBuffer[0].toInt()
    frameContentWidth = frameBuffer[1].toFloat()
    return true
  }

  // endregion

  // region Drawing

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (!committed) return
    val entry = fonts
    val lineHeight = entry.lineHeight
    val moving = engine.needsFrames()
    val useRest = !moving && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && (restValid || (readFrame() && buildRestLine(entry)))
    if (!useRest && !readFrame()) return
    val content = if (useRest) restContentWidth else frameContentWidth
    val originX = when (style.textAlign) {
      NitroNumberView.Alignment.LEFT -> 0f
      NitroNumberView.Alignment.RIGHT -> width - content
      NitroNumberView.Alignment.CENTER -> (width - content) / 2f
      NitroNumberView.Alignment.AUTO -> if (rightToLeft) width - content else 0f
    }
    val originY = (height - lineHeight) / 2f
    val ink = style.color ?: defaultInk
    paint.color = ink

    val dim = loadingProgress.coerceIn(0f, 1f)
    // Everything drawn in this layer is what the glint is composited onto;
    // a line height of room around the line for glyphs sliding through it.
    val layerLeft = originX - lineHeight
    val layerTop = originY - lineHeight
    val layerRight = originX + content + lineHeight
    val layerBottom = originY + lineHeight * 2f
    val layer = if (dim > 0f) canvas.saveLayer(layerLeft, layerTop, layerRight, layerBottom, null) else -1
    if (useRest) {
      drawRest(canvas, originX, originY + entry.baseline)
    } else {
      drawGlyphs(canvas, entry, originX, originY, lineHeight, ink)
    }
    if (dim > 0f) {
      drawShimmer(canvas, ink, originX, content, originY, dim, layerLeft, layerTop, layerRight, layerBottom)
      canvas.restoreToCount(layer)
    }
  }

  /**
   * Gathers the settled line into [restRuns]: each character's shaped glyphs
   * at the engine's x, grouped by font. False when the frame is not at rest
   * after all (a glyph still faded, scaled or offset), so it is drawn glyph by glyph.
   */
  @RequiresApi(Build.VERSION_CODES.S)
  private fun buildRestLine(entry: NitroTextFonts.Entry): Boolean {
    for (r in 0 until restRunCount) restRuns[r].count = 0
    restRunCount = 0
    val f = frameBuffer
    for (i in 0 until frameCount) {
      val base = 3 + i * GLYPH_FIELDS
      if (f[base + 10] != 0.0) {
        if (f[base + 8] > 0.002) return false
        continue
      }
      if (f[base + 8] < 0.998 || f[base + 7] != 0.0 || f[base + 9] != 1.0) return false
      val x = f[base + 6].toFloat()
      val shaped = NitroTextFonts.shaped(f[base + 1].toInt(), entry)
      for (r in shaped.fonts.indices) {
        val run = restRun(shaped.fonts[r])
        val ids = shaped.ids[r]
        val pos = shaped.positions[r]
        if (run.ids.size < run.count + ids.size) {
          run.ids = run.ids.copyOf(max(run.ids.size * 2, run.count + ids.size))
          run.positions = run.positions.copyOf(run.ids.size * 2)
        }
        for (g in ids.indices) {
          run.ids[run.count] = ids[g]
          run.positions[run.count * 2] = pos[g * 2] + x
          run.positions[run.count * 2 + 1] = pos[g * 2 + 1]
          run.count++
        }
      }
    }
    restContentWidth = frameContentWidth
    restValid = true
    return true
  }

  /** The rest run drawn in [font], reusing the run objects of earlier lines. */
  private fun restRun(font: Any): RestRun {
    for (r in 0 until restRunCount) {
      if (restRuns[r].font == font) return restRuns[r]
    }
    if (restRunCount == restRuns.size) restRuns.add(RestRun())
    val run = restRuns[restRunCount++]
    run.font = font
    run.count = 0
    return run
  }

  /** At rest: the whole line, one `drawGlyphs` per font. */
  @RequiresApi(Build.VERSION_CODES.S)
  private fun drawRest(canvas: Canvas, x: Float, baseline: Float) {
    val saved = canvas.save()
    canvas.translate(x, baseline)
    for (r in 0 until restRunCount) {
      val run = restRuns[r]
      if (run.count == 0) continue
      canvas.drawGlyphs(run.ids, 0, run.positions, 0, run.count, run.font as android.graphics.fonts.Font, paint)
    }
    canvas.restoreToCount(saved)
  }

  /** Every glyph at its own position, opacity and scale (a morph, or any line below API 31). */
  private fun drawGlyphs(canvas: Canvas, entry: NitroTextFonts.Entry, originX: Float, originY: Float, lineHeight: Float, ink: Int) {
    val f = frameBuffer
    val inkAlpha = Color.alpha(ink)
    for (i in 0 until frameCount) {
      val base = 3 + i * GLYPH_FIELDS
      val opacity = f[base + 8].toFloat().coerceIn(0f, 1f)
      if (opacity <= 0.002f) continue
      val alpha = Math.round(inkAlpha * opacity).coerceIn(0, 255)
      if (alpha == 0) continue
      paint.alpha = alpha
      val codePoint = f[base + 1].toInt()
      val x = originX + f[base + 6].toFloat()
      val top = originY + f[base + 7].toFloat() * lineHeight
      val scale = f[base + 9].toFloat()
      val scaled = Math.abs(scale - 1f) > 0.0001f
      val saved = if (scaled) canvas.save() else -1
      if (scaled) canvas.scale(scale, scale, x + f[base + 4].toFloat() / 2f, top + lineHeight / 2f)
      val baseline = top + entry.baseline
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        glyphPositions = NitroTextFonts.shaped(codePoint, entry).draw(canvas, x, baseline, paint, glyphPositions)
      } else if (Character.isValidCodePoint(codePoint)) {
        val n = Character.toChars(codePoint, chars, 0)
        canvas.drawText(chars, 0, n, x, baseline, paint)
      }
      if (scaled) canvas.restoreToCount(saved)
    }
    paint.alpha = inkAlpha
  }

  /**
   * The loading glint, as NitroNumber draws it: a slanted band recolouring
   * the ink from the base colour to the highlight and back ([base, highlight,
   * base] at 10/50/90 %), composited SRC_ATOP so only the glyphs light up.
   */
  private fun drawShimmer(
    canvas: Canvas, ink: Int, left: Float, width: Float, top: Float, dim: Float,
    layerLeft: Float, layerTop: Float, layerRight: Float, layerBottom: Float,
  ) {
    if (width <= 0f) return
    val base = shimmer.baseColor ?: ink
    val highlight = shimmer.color ?: defaultShimmerColor()
    // One sweep takes `durationMs`; the band then waits off the far edge for `delayMs`.
    // On the shared clock, so every loading line on screen sweeps together.
    val durationMs = max(1L, shimmer.durationMs)
    val cycleMs = durationMs + max(0L, shimmer.delayMs)
    val reduceMotion = timing.respectReduceMotion && animationsDisabled()
    val elapsedMs = if (reduceMotion) 0L else SystemClock.uptimeMillis() % cycleMs
    val phase = min(1f, elapsedMs.toFloat() / durationMs)
    val seeded = SHIMMER_SEED + (1f - SHIMMER_SEED) * phase
    val ltr = shimmer.leftToRight ?: !rightToLeft
    val progress = if (ltr) seeded else 1f - seeded
    // The gradient runs `length` along x (its slant on top): it enters at the
    // left edge and leaves past the right, or the mirror image.
    val length = width * shimmer.width.coerceAtLeast(0.05f)
    val startX = left + (width + length) * progress - length
    val slant = Math.tan(Math.toRadians(shimmer.angle.coerceIn(-75f, 75f).toDouble())).toFloat() * (if (ltr) 1f else -1f)
    var gradient = shimmerGradient
    if (gradient == null || shimmerGradientBase != base || shimmerGradientHighlight != highlight ||
      shimmerGradientLength != length || shimmerGradientSlant != slant
    ) {
      gradient = LinearGradient(
        0f, 0f, length, slant * length,
        intArrayOf(base, highlight, base), floatArrayOf(0.1f, 0.5f, 0.9f), Shader.TileMode.CLAMP,
      )
      shimmerGradient = gradient
      shimmerGradientBase = base
      shimmerGradientHighlight = highlight
      shimmerGradientLength = length
      shimmerGradientSlant = slant
      shimmerPaint.shader = gradient
    }
    shimmerMatrix.setTranslate(startX, top)
    gradient.setLocalMatrix(shimmerMatrix)
    shimmerPaint.alpha = (dim * 255f).toInt().coerceIn(0, 255)
    canvas.drawRect(layerLeft, layerTop, layerRight, layerBottom, shimmerPaint)
  }

  /** Default glint colour: a near-background neutral so the ink "lights up". */
  private fun defaultShimmerColor(): Int {
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    return if (night) 0xFF2B2E37.toInt() else 0xFFD6D9E1.toInt()
  }

  private fun defaultTextColor(): Int {
    val value = TypedValue()
    return if (context.theme.resolveAttribute(android.R.attr.textColorPrimary, value, true)) {
      if (value.resourceId != 0) {
        context.resources.getColorStateList(value.resourceId, context.theme).defaultColor
      } else {
        value.data
      }
    } else {
      Color.BLACK
    }
  }

  // endregion
}
