package com.margelo.nitro.nitrorollingnumber

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.Configuration
import android.database.ContentObserver
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.RenderNode
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.TextPaint
import android.util.TypedValue
import android.view.Choreographer
import android.view.View
import android.view.accessibility.AccessibilityEvent
import com.facebook.react.common.assets.ReactFontManager
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Draws the rolling number. All behaviour (wheel positions, rolls, stagger,
 * easing, loading fade, shimmer phase) lives in the shared C++ `RollingEngine`
 * (cpp/RollingEngine.hpp, reached through the [RollingEngine] JNI handle); this
 * view owns fonts, layout, fit-to-width and Canvas drawing, and drives the
 * engine from a Choreographer frame loop.
 *
 * Mirrors `RollingNumberView.swift` on iOS.
 */
// The numeric transition's geometry, in line heights; mirrors
// `RollingEngine::kNumeric*`, where the effect is described.
private const val NUMERIC_OFFSET = 0.4f
private const val NUMERIC_SCALE = 0.6f
private const val NUMERIC_BLUR = 0.16f

class RollingNumberView(context: Context) : View(context) {

  // region Configuration

  data class Format(
    val fractionDigits: Int = 0,
    val minimumIntegerDigits: Int = 1,
    val groupingSeparator: String = "",
    val decimalSeparator: String = ".",
    val prefix: String = "",
    val suffix: String = "",
  )

  enum class AffixAlign { BASELINE, CENTER, TOP, BOTTOM }

  data class Typography(
    val fontSize: Float = 32f,
    val prefixFontSize: Float? = null,
    val suffixFontSize: Float? = null,
    val fontWeight: Int = 400,
    val fontFamily: String? = null,
    val color: Int? = null,
    val prefixAlign: AffixAlign = AffixAlign.BASELINE,
    val suffixAlign: AffixAlign = AffixAlign.BASELINE,
    val adjustsFontSizeToFit: Boolean = false,
    val minimumFontScale: Float = 0.5f,
    val allowFontScaling: Boolean = false,
    val maxFontSizeMultiplier: Float = 0f,
  )

  enum class Easing(val raw: Int) { LINEAR(0), EASE_IN(1), EASE_OUT(2), EASE_IN_OUT(3), SPRING(4) }

  enum class Direction(val raw: Int) { AUTO(0), UP(1), DOWN(2) }

  data class Timing(
    /** The odometer roll, or one of the glyph-swap transitions. */
    val transition: Transition = Transition.ROLL,
    /** A punch of the whole figure on every change, peak overshoot 0 (none) to 1. */
    val popOnChange: Double = 0.0,
    val durationMs: Long = 500,
    val easing: Easing = Easing.EASE_IN_OUT,
    val bounce: Double = 0.15,
    /** Delay between the start of each wheel's roll, least significant first. */
    val staggerMs: Long = 0,
    val direction: Direction = Direction.AUTO,
    /** Length of a jackpot reveal (the count, or until the last reel locks). */
    val revealDurationMs: Long = 2200,
    /** Peak overshoot of the reveal's landing pop (0 = none). */
    val revealBounce: Double = 0.12,
    /** Count style: how much smaller the figure opens, growing to full size over the count. */
    val revealGrow: Double = 0.2,
    /** The reveal's presentation. */
    val revealStyle: RevealStyle = RevealStyle.COUNT,
    /** Spin style: delay between reel stops, from the left. */
    val revealStaggerMs: Long = 200,
    /** Count style: how long the count pauses on each milestone. */
    val revealMilestoneHoldMs: Long = 0,
  )

  enum class RevealStyle(val raw: Int) { COUNT(0), SPIN(1) }

  enum class Transition(val raw: Int) { ROLL(0), NUMERIC(1), FLIP(2), SCRAMBLE(3), MORPH(4) }

  /** The change flash: the colours a changed digit lights up in (null = off) and how long the light lasts. */
  data class Flash(
    val upColor: Int? = null,
    val downColor: Int? = null,
    val durationMs: Long = 600,
  )

  data class Shimmer(
    /** Color of the glint's core; null uses a light neutral (dark neutral in dark mode). */
    val color: Int? = null,
    /** Duration of one sweep across the number. */
    val durationMs: Long = 950,
  )

  /** `AUTO` is the start edge of the layout direction, as `Text` with no `textAlign`; the rest are absolute. */
  enum class Alignment { AUTO, LEFT, CENTER, RIGHT }

  var format: Format = Format()
    set(value) {
      if (field == value) return
      field = value
      affixBlocksDirty = true
      engine.setFormat(value.fractionDigits, value.minimumIntegerDigits)
      if (engine.hasShownValue()) reportIntrinsicSize()
      invalidate()
    }

  var typography: Typography = Typography()
    set(value) {
      if (field == value) return
      field = value
      rebuildFonts()
    }

  var timing: Timing = Timing()
    set(value) {
      field = value
      engine.setTiming(value.durationMs / 1000.0, value.easing.raw, value.bounce, value.staggerMs / 1000.0, value.direction.raw)
      engine.setTransition(value.transition.raw)
      engine.setPopOnChange(value.popOnChange)
      engine.setRevealTiming(value.revealDurationMs / 1000.0, value.revealBounce, value.revealStyle.raw, value.revealStaggerMs / 1000.0)
      engine.setRevealGrow(value.revealGrow)
      engine.setRevealMilestoneHold(value.revealMilestoneHoldMs / 1000.0)
    }

  /** Win tiers of a count-style reveal, in the figure's units. */
  var revealMilestones: DoubleArray = DoubleArray(0)
    set(value) {
      if (field.contentEquals(value)) return
      field = value
      engine.clearRevealMilestones()
      for (milestone in value) engine.addRevealMilestone(milestone)
    }

  var shimmer: Shimmer = Shimmer()
    set(value) {
      if (field == value) return
      field = value
      invalidate()
    }

  var flash: Flash = Flash()
    set(value) {
      if (field == value) return
      field = value
      engine.setFlash(if (value.upColor != null || value.downColor != null) value.durationMs / 1000.0 else 0.0)
      invalidate()
    }

  /** Loading glint: full-color ink with a light band sweeping through it. */
  var loading: Boolean = false
    set(value) {
      if (field == value) return
      field = value
      engine.setReduceMotion(animationsDisabled())
      engine.setLoading(value, now())
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) stateDescription = if (value) "Loading" else null
      scheduleFrameIfNeeded()
      invalidate()
    }

  var alignment: Alignment = Alignment.AUTO
    set(value) {
      field = value
      invalidate()
    }

  /** Called with the settled (target) intrinsic size, in dp, whenever it changes. */
  var onIntrinsicSizeChange: ((widthDp: Float, heightDp: Float) -> Unit)? = null
  /** Called once a jackpot reveal has landed (count finished, pop rung out). */
  var onRevealEnd: (() -> Unit)? = null
  /** Called when a count-style reveal reaches a milestone (its index and value). */
  var onRevealMilestone: ((index: Int, value: Double) -> Unit)? = null

  /** The value currently shown or being rolled towards. */
  val targetValue: Double
    get() = engine.targetValue()

  /** True while a jackpot reveal counts or its landing pop rings out. */
  val isRevealing: Boolean
    get() = engine.isRevealing()

  // endregion

  // region Fonts

  private enum class GlyphRole { DIGIT, PREFIX, SUFFIX }

  /** Digit / prefix / suffix paints with per-glyph width caches. */
  private inner class FontSet(t: Typography) {
    private val scale = systemFontMultiplier(t)
    val digit = makePaint(t, t.fontSize * scale)
    val prefix = makePaint(t, (t.prefixFontSize ?: t.fontSize) * scale)
    val suffix = makePaint(t, (t.suffixFontSize ?: t.fontSize) * scale)
    private val prefixAlign = t.prefixAlign
    private val suffixAlign = t.suffixAlign
    private val digitMetrics: Paint.FontMetrics = digit.fontMetrics
    /** Height of the line box (the digit paint's line height), in px. */
    val lineHeight: Float = ceil(digitMetrics.descent - digitMetrics.ascent)
    /** Width of the widest digit glyph, in px. */
    val digitWidth: Float
    private val widthCache = HashMap<String, Float>()
    /**
     * A wheel's whole digit strip, per blank-zero variant: 12 slots for index
     * -1 (blank) to 10 (the 0 that follows 9 on a wrap), each `lineHeight`
     * tall with the digit centred in `digitWidth`. The digits are rasterized
     * once by the software text renderer into a bitmap, and the bitmap is the
     * whole content of a `RenderNode` layer; a wheel then draws one slot-high
     * window of that layer, one quad, and a frame costs no glyph work at all:
     * the same thing the iOS view does with a CALayer strip.
     *
     * Why both. Text rasterized by the GPU straight into a hardware layer came
     * out thinner and paler than the glyphs drawn beside it (a small red digit
     * next to its sign, visibly), and a bitmap's pixels are exactly what the
     * text renderer put there. But drawing the bitmap itself per wheel costs
     * the renderer several milliseconds a frame more than drawing a layer, so
     * the bitmap goes into a layer once. Below Android 10 there is no public
     * RenderNode and the bitmap is drawn directly.
     *
     * The strips are shared by every rolling number drawn with the same
     * typography (see [StripCache]).
     */
    private val stripKey: String =
      "${t.fontFamily}|${t.fontWeight}|${digit.textSize}|${digit.color}|${digit.typeface?.hashCode()}"

    fun strip(blankZero: Boolean): Strip? {
      if (digitWidth <= 0f || lineHeight <= 0f) return null
      val strip = StripCache.get("$stripKey|$blankZero") {
        Strip(renderStrip(blankZero), if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) RenderNode("rolling-number-strip") else null)
      }
      val node = strip.node
      // HWUI deletes a node's display list once nothing in the view tree draws
      // it any more (the last view drawing this strip was dropped, or the
      // window gave its hardware resources back), and a node drawn without
      // one draws nothing. Record again whenever that happened: one bitmap
      // draw, and only then.
      if (node != null && !node.hasDisplayList()) {
        node.setPosition(0, 0, strip.bitmap.width, strip.bitmap.height)
        node.setUseCompositingLayer(true, null)
        val canvas = node.beginRecording(strip.bitmap.width, strip.bitmap.height)
        try {
          canvas.drawBitmap(strip.bitmap, 0f, 0f, null)
        } finally {
          node.endRecording()
        }
      }
      return strip
    }

    /**
     * The digit out of focus, for the numeric transition: the glyph drawn
     * into a padded bitmap and blurred in software (three box passes, which
     * is a Gaussian to the eye; HWUI has no hardware mask filter), once per
     * font, colour and density and shared like the strips. A transitioning
     * glyph is its sharp text and this bitmap cross-faded, a fixed cost per
     * frame instead of a blur pass. The bitmap is `digitWidth + 2 pad` wide
     * and `lineHeight + 2 pad` tall with the glyph centred in the column.
     */
    fun blurred(digitIndex: Int): Bitmap? {
      if (digitWidth <= 0f || lineHeight <= 0f) return null
      return BlurredGlyphCache.get("$stripKey|$digitIndex") {
        val text = DIGITS[digitIndex]
        val pad = blurPad
        val w = ceil(digitWidth).toInt() + 2 * pad
        val h = ceil(lineHeight).toInt() + 2 * pad
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawText(text, pad + (digitWidth - width(text, GlyphRole.DIGIT)) / 2f, pad + baseline(GlyphRole.DIGIT, text, 0f), digit)
        boxBlurAlpha(bitmap, digit.color, Math.round(lineHeight * NUMERIC_BLUR * 0.6f).coerceAtLeast(1))
        bitmap
      }
    }

    /** Padding around a blurred glyph's bitmap, enough for the blur's tail. */
    val blurPad: Int = ceil(lineHeight * NUMERIC_BLUR * 3f).toInt()

    /** A digit paint in another colour, for the change flash; one per colour. */
    private val tintedPaints = HashMap<Int, TextPaint>()
    fun tinted(color: Int): TextPaint = tintedPaints.getOrPut(color) { TextPaint(digit).apply { this.color = color } }

    /**
     * A digit's outline for the morph transition: `getTextPath` walked with a
     * `PathMeasure`, in the line box's coordinates (the glyph centred in
     * `digitWidth`, its baseline at the digit baseline), normalized once by
     * [GlyphMorph] so two digits interpolate point to point.
     */
    private val outlines = HashMap<Int, DoubleArray>()
    fun outline(digitIndex: Int): DoubleArray = outlines.getOrPut(digitIndex) {
      val text = DIGITS[digitIndex]
      val path = Path()
      digit.getTextPath(text, 0, 1, (digitWidth - width(text, GlyphRole.DIGIT)) / 2f, baseline(GlyphRole.DIGIT, text, 0f), path)
      val points = ArrayList<Double>()
      val sizes = ArrayList<Int>()
      val measure = PathMeasure(path, false)
      val pos = FloatArray(2)
      do {
        val length = measure.length
        if (length > 0f) {
          // About one vertex every 1.5 px, at least 24 per contour: enough for the resampling.
          val n = max(24, (length / 1.5f).toInt())
          for (i in 0 until n) {
            measure.getPosTan(length * i / n, pos, null)
            points.add(pos[0].toDouble())
            points.add(pos[1].toDouble())
          }
          sizes.add(n)
        }
      } while (measure.nextContour())
      val out = DoubleArray(sizes.size * GlyphMorph.CONTOUR_DOUBLES)
      val count = GlyphMorph.normalize(points.toDoubleArray(), sizes.toIntArray(), out)
      if (count <= 0) DoubleArray(0) else out.copyOf(count * GlyphMorph.CONTOUR_DOUBLES)
    }

    private fun renderStrip(blankZero: Boolean): Bitmap {
      val w = ceil(digitWidth).toInt()
      val h = ceil(lineHeight * STRIP_SLOTS).toInt()
      val drawn = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(drawn)
      val baseline = baseline(GlyphRole.DIGIT, "0", 0f)
      for (index in -1 until STRIP_SLOTS - 1) {
        if (index < 0 || (blankZero && index == 0)) continue
        val text = DIGITS[index % 10]
        canvas.drawText(text, (digitWidth - width(text, GlyphRole.DIGIT)) / 2f, (index + 1) * lineHeight + baseline, digit)
      }
      // Immutable: the renderer uploads it once and keeps the texture.
      val strip = drawn.copy(Bitmap.Config.ARGB_8888, false)
      if (strip !== drawn) drawn.recycle()
      return strip
    }
    private val capHeightCache = HashMap<GlyphRole, Float>()
    private val inkDescentCache = HashMap<String, Float>()

    init {
      digitWidth = (0..9).maxOf { width(it.toString(), GlyphRole.DIGIT) }
    }

    fun paint(role: GlyphRole): TextPaint = when (role) {
      GlyphRole.DIGIT -> digit
      GlyphRole.PREFIX -> prefix
      GlyphRole.SUFFIX -> suffix
    }

    fun width(text: String, role: GlyphRole): Float =
      widthCache.getOrPut(role.name + "|" + text) { paint(role).measureText(text) }

    /** Baseline y for `role` drawing `text`, given the top of the digit line box. */
    fun baseline(role: GlyphRole, text: String, lineTop: Float): Float {
      val digitBaseline = lineTop - digitMetrics.ascent
      if (role == GlyphRole.DIGIT) return digitBaseline
      val p = paint(role)
      val m = p.fontMetrics
      return when (if (role == GlyphRole.PREFIX) prefixAlign else suffixAlign) {
        AffixAlign.BASELINE -> digitBaseline
        AffixAlign.CENTER -> lineTop + (lineHeight - (m.descent - m.ascent)) / 2f - m.ascent
        AffixAlign.TOP -> lineTop + (-digitMetrics.ascent - capHeight(GlyphRole.DIGIT)) + capHeight(role)
        // Pin the bottom of the ink, not of the line boxes: the digits' ink ends
        // on the baseline, so "USD" sits on it too instead of hanging down to
        // where a comma's tail reaches.
        AffixAlign.BOTTOM -> digitBaseline + inkDescent(ALL_DIGITS, GlyphRole.DIGIT) - inkDescent(text, role)
      }
    }

    /** How far `text`'s ink hangs below the baseline (0 for digits and capitals). */
    private fun inkDescent(text: String, role: GlyphRole): Float = inkDescentCache.getOrPut(role.name + "|" + text) {
      val bounds = Rect()
      paint(role).getTextBounds(text, 0, text.length, bounds)
      max(0, bounds.bottom).toFloat()
    }

    private fun capHeight(role: GlyphRole): Float = capHeightCache.getOrPut(role) {
      val bounds = Rect()
      paint(role).getTextBounds("0", 0, 1, bounds)
      -bounds.top.toFloat()
    }
  }

  /**
   * Blurs a single-colour glyph in place: the alpha channel gets three box
   * passes of [radius] in each axis, and every pixel is put back as [color]
   * at its blurred coverage.
   */
  private fun boxBlurAlpha(bitmap: Bitmap, color: Int, radius: Int) {
    val w = bitmap.width
    val h = bitmap.height
    val pixels = IntArray(w * h)
    bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
    val alpha = FloatArray(w * h) { (pixels[it] ushr 24).toFloat() }
    val scratch = FloatArray(w * h)
    val window = (2 * radius + 1).toFloat()
    repeat(3) {
      // horizontal
      for (y in 0 until h) {
        val row = y * w
        var sum = 0f
        for (x in -radius..radius) sum += alpha[row + x.coerceIn(0, w - 1)]
        for (x in 0 until w) {
          scratch[row + x] = sum / window
          sum += alpha[row + (x + radius + 1).coerceIn(0, w - 1)] - alpha[row + (x - radius).coerceIn(0, w - 1)]
        }
      }
      // vertical
      for (x in 0 until w) {
        var sum = 0f
        for (y in -radius..radius) sum += scratch[y.coerceIn(0, h - 1) * w + x]
        for (y in 0 until h) {
          alpha[y * w + x] = sum / window
          sum += scratch[(y + radius + 1).coerceIn(0, h - 1) * w + x] - scratch[(y - radius).coerceIn(0, h - 1) * w + x]
        }
      }
    }
    val rgb = color and 0x00FFFFFF
    val tint = (color ushr 24).toFloat() / 255f
    for (i in pixels.indices) {
      val a = Math.round(alpha[i] * tint).coerceIn(0, 255)
      pixels[i] = (a shl 24) or rgb
    }
    bitmap.setPixels(pixels, 0, w, 0, 0, w, h)
  }

  /** System font scale for `allowFontScaling`, capped by `maxFontSizeMultiplier`. */
  private fun systemFontMultiplier(t: Typography): Float {
    if (!t.allowFontScaling) return 1f
    val multiplier = context.resources.configuration.fontScale
    return if (t.maxFontSizeMultiplier > 0f) min(multiplier, t.maxFontSizeMultiplier) else multiplier
  }

  private fun makePaint(t: Typography, sizeDp: Float): TextPaint {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
    paint.typeface = makeTypeface(t)
    paint.textSize = sizeDp * density
    paint.color = t.color ?: defaultTextColor()
    paint.fontFeatureSettings = "tnum"
    return paint
  }

  private fun makeTypeface(t: Typography): Typeface {
    val family = t.fontFamily
    return try {
      if (!family.isNullOrEmpty()) {
        ReactFontManager.getInstance().getTypeface(family, Typeface.NORMAL, t.fontWeight, context.assets)
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        Typeface.create(Typeface.DEFAULT, t.fontWeight, false)
      } else if (t.fontWeight >= 600) {
        Typeface.DEFAULT_BOLD
      } else {
        Typeface.DEFAULT
      }
    } catch (e: Throwable) {
      if (t.fontWeight >= 600) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
    }
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

  // region State

  private class Wheel(
    var position: Double = 0.0,
    var width: Double = 1.0,
    var linear: Boolean = false,
    var blankZero: Boolean = false,
    /** The numeric transition's swap, as the engine reports it (see `RollingEngine.hpp`). */
    var fromGlyph: Double = -1.0,
    var toGlyph: Double = -1.0,
    var blend: Double = 1.0,
    var fromAbove: Boolean = true,
    var flash: Double = 0.0,
    var flashUp: Boolean = true,
  )

  private val engine = RollingEngine()
  /** Reused every frame so the draw path stops allocating once warm. */
  private val frameElements = ElementList()
  private val settledElements = ElementList()
  private val settledWheels = ArrayList<Wheel>()
  /** The affixes split from the space they keep against the digits (RTL only). */
  private var affixBlocksDirty = true
  private var affixRtl = false
  private var prefixInk = ""
  private var prefixGap = ""
  private var suffixInk = ""
  private var suffixGap = ""
  private val density = context.resources.displayMetrics.density
  private var fonts: FontSet = FontSet(Typography())
  private var fontScale = 1f
  private var lastReportedWidth = -1f
  private var lastReportedHeight = -1f
  private val wheels = ArrayList<Wheel>()
  private var signFactor = 0.0
  private var loadingProgress = 0f
  private var revealScale = 1f
  private var frameScheduled = false
  private val frameCallback = Choreographer.FrameCallback { frameTimeNanos ->
    frameScheduled = false
    val wasRevealing = engine.isRevealing()
    val reachedBefore = engine.revealMilestonesReached()
    engine.tick(frameTimeNanos / 1e9)
    if (pendingSizeReport && !engine.isRolling()) reportIntrinsicSize()
    invalidate()
    scheduleFrameIfNeeded()
    if (wasRevealing) {
      reportMilestones(reachedBefore)
      if (!engine.isRevealing()) onRevealEnd?.invoke()
    }
  }

  /** Fires [onRevealMilestone] for every milestone reached since [reachedBefore]. */
  private fun reportMilestones(reachedBefore: Int) {
    val reached = engine.revealMilestonesReached()
    val listener = onRevealMilestone ?: return
    for (index in reachedBefore until reached) listener(index, engine.revealMilestoneValue(index))
  }
  /** Filtered so a strip window in motion between two pixel rows blends rather than steps. */
  private val stripPaint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val shimmerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_ATOP)
  }
  /** The glint's gradient, rebuilt only when its colors or the content width change; a frame just slides it. */
  private var shimmerGradient: LinearGradient? = null
  private var shimmerGradientWidth = -1f
  private var shimmerGradientBase = 0
  private var shimmerGradientHighlight = 0
  private val shimmerMatrix = Matrix()

  init {
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
  }

  // endregion

  // region Public API

  fun stopAnimation() {
    if (frameScheduled) {
      Choreographer.getInstance().removeFrameCallback(frameCallback)
      frameScheduled = false
    }
  }

  /**
   * Returns the view to its pristine state so Fabric can reuse it for a new
   * element (RecyclableView). Props are re-applied by Nitro afterwards.
   */
  fun resetForRecycle() {
    stopAnimation()
    engine.reset()
    wheels.clear()
    signFactor = 0.0
    loadingProgress = 0f
    revealScale = 1f
    fontScale = 1f
    lastReportedWidth = -1f
    lastReportedHeight = -1f
    format = Format()
    typography = Typography()
    timing = Timing()
    shimmer = Shimmer()
    alignment = Alignment.AUTO
    revealMilestones = DoubleArray(0)
    // onIntrinsicSizeChange, onRevealEnd and onRevealMilestone are the hybrid's
    // wiring, not the element's props: they stay across recycling (the hybrid
    // clears its own callback props).
    invalidate()
  }

  /**
   * Shows [value] immediately with continuously positioned wheels (odometer
   * style). Cancels any running roll. Intended to be called every frame.
   */
  fun setValue(value: Double) {
    engine.setValue(value)
    reportIntrinsicSize()
    scheduleFrameIfNeeded()
    invalidate()
  }

  /** Rolls every wheel to [value] (snaps on first show, duration 0 or "remove animations"). */
  fun animateTo(value: Double) {
    engine.setReduceMotion(animationsDisabled())
    engine.animateTo(value, now())
    reportIntrinsicSize()
    scheduleFrameIfNeeded()
    invalidate()
  }

  /**
   * Shows the opening frame of a jackpot reveal for [value] ("$0.00" in the
   * target's layout), waiting for [reveal].
   */
  fun holdReveal(value: Double) {
    engine.holdReveal(value)
    reportIntrinsicSize()
    scheduleFrameIfNeeded()
    invalidate()
  }

  /** Counts up from 0 to [value] and lands with a pop (snaps when animations are off). */
  fun reveal(value: Double) {
    engine.setReduceMotion(animationsDisabled())
    engine.reveal(value, now())
    reportIntrinsicSize()
    scheduleFrameIfNeeded()
    invalidate()
    reportMilestones(0)
    // Snapped (animations off / duration 0): the reveal is over before it began.
    if (!engine.isRevealing()) onRevealEnd?.invoke()
  }

  /** Re-sends the last reported intrinsic size (e.g. after a listener was attached). */
  fun resendIntrinsicSize() {
    if (lastReportedWidth < 0f) return
    onIntrinsicSizeChange?.invoke(lastReportedWidth, lastReportedHeight)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    // The shrink-to-fit scale depends on the width; it is re-evaluated in onDraw().
    invalidate()
  }

  override fun onDetachedFromWindow() {
    stopAnimation()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      context.contentResolver.unregisterContentObserver(animatorScaleObserver)
    }
    super.onDetachedFromWindow()
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

  override fun onConfigurationChanged(newConfig: Configuration?) {
    super.onConfigurationChanged(newConfig)
    // The paints resolve the theme's text color and the system font scale when
    // they are built; a light/dark switch or a text-size change rebuilds them.
    rebuildFonts()
  }

  // endregion

  // region Frame loop

  private fun now(): Double = SystemClock.uptimeMillis() / 1000.0

  private fun scheduleFrameIfNeeded() {
    if (!frameScheduled && engine.needsFrames()) {
      frameScheduled = true
      Choreographer.getInstance().postFrameCallback(frameCallback)
    }
  }

  /**
   * The animator duration scale on API < 33, read once and refreshed by
   * [animatorScaleObserver] (a settings query per `animateTo` was a binder
   * call on every value update). -1 = not read yet.
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

  /** Reused per frame so the JNI hop never allocates (room for far more wheels than the engine's 18). */
  private val frameBuffer = DoubleArray(4 + 10 * 32)

  /** Pulls the engine's render state into reusable [Wheel] objects (no per-frame allocation once warm). */
  private fun syncFromEngine() {
    val f = frameBuffer
    if (engine.frameInto(f) < 0) return
    signFactor = f[0]
    loadingProgress = f[1].toFloat()
    revealScale = f[2].toFloat()
    val count = f[3].toInt()
    while (wheels.size < count) wheels.add(Wheel())
    while (wheels.size > count) wheels.removeAt(wheels.size - 1)
    for (i in 0 until count) {
      val base = 4 + i * 10
      val w = wheels[i]
      w.position = f[base]
      w.width = f[base + 1]
      w.linear = f[base + 2] != 0.0
      w.blankZero = f[base + 3] != 0.0
      w.fromGlyph = f[base + 4]
      w.toGlyph = f[base + 5]
      w.blend = f[base + 6]
      w.fromAbove = f[base + 7] != 0.0
      w.flash = f[base + 8]
      w.flashUp = f[base + 9] != 0.0
    }
  }

  // endregion

  // region Typography

  private fun rebuildFonts() {
    fonts = FontSet(typography)
    fontScale = 1f
    if (engine.hasShownValue()) reportIntrinsicSize()
    invalidate()
  }

  /**
   * Shrink-to-fit scale for the current width and the content as it is drawn
   * *right now* (including half-appeared wheels): the amount shrinks and grows
   * continuously in step with the roll and never overflows.
   */
  private fun updateFontScale(contentWidth: Float) {
    var scale = 1f
    if (typography.adjustsFontSizeToFit && width > 0 && contentWidth > width) {
      scale = max(min(1f, typography.minimumFontScale), width / contentWidth)
    }
    fontScale = scale
  }

  // endregion

  // region Layout

  private class Element {
    var wheelIndex = -1 // -1 for glyph elements
    var text: String? = null
    var role = GlyphRole.DIGIT
    var width = 0f
    var fullWidth = 0f
    var factor = 0.0
  }

  /** A list of pooled [Element]s: filling it allocates nothing once it has grown to the run's length. */
  private class ElementList {
    private val items = ArrayList<Element>()
    var size = 0
      private set

    fun clear() {
      size = 0
    }

    fun next(): Element {
      if (size == items.size) items.add(Element())
      return items[size++]
    }

    operator fun get(index: Int): Element = items[index]

    fun totalWidth(): Float {
      var total = 0f
      for (i in 0 until size) total += items[i].width
      return total
    }
  }

  /** Lays the run out into [out] (emptied first). */
  private fun buildElements(fonts: FontSet, wheels: List<Wheel>, signFactor: Double, out: ElementList) {
    out.clear()
    val fd = format.fractionDigits

    fun addGlyph(text: String, role: GlyphRole, factor: Double) {
      if (text.isEmpty() || factor <= 0.0) return
      val width = fonts.width(text, role)
      val e = out.next()
      e.wheelIndex = -1
      e.text = text
      e.role = role
      e.width = (width * factor).toFloat()
      e.fullWidth = width
      e.factor = factor
    }

    // Under a right-to-left layout the prefix belongs at the start edge - the
    // right - and the suffix at the end, while the digits stay a left-to-right
    // run: a number reads the same way in every script. So the run is laid out
    // block by block in mirror order, each block keeping its own order, and the
    // space an affix keeps against the digits stays against them: " USD" after
    // the number is "USD " before it.
    val rtl = isRtl
    if (affixBlocksDirty || affixRtl != rtl) updateAffixBlocks(rtl)
    if (rtl) {
      addGlyph(suffixInk, GlyphRole.SUFFIX, 1.0)
      addGlyph(suffixGap, GlyphRole.SUFFIX, 1.0)
    } else {
      // Sign first, then the currency prefix: "-$1,234.50".
      addGlyph("-", GlyphRole.DIGIT, signFactor)
      addGlyph(prefixInk, GlyphRole.PREFIX, 1.0)
    }
    for (power in wheels.indices.reversed()) {
      val wheel = wheels[power]
      if (wheel.width > 0.0) {
        val e = out.next()
        e.wheelIndex = power
        e.text = null
        e.role = GlyphRole.DIGIT
        e.width = (fonts.digitWidth * wheel.width).toFloat()
        e.fullWidth = fonts.digitWidth
        e.factor = wheel.width
      }
      if (power > fd && (power - fd) % 3 == 0) addGlyph(format.groupingSeparator, GlyphRole.DIGIT, wheel.width)
      if (fd > 0 && power == fd) addGlyph(format.decimalSeparator, GlyphRole.DIGIT, 1.0)
    }
    if (rtl) {
      addGlyph(prefixGap, GlyphRole.PREFIX, 1.0)
      addGlyph(prefixInk, GlyphRole.PREFIX, 1.0)
      addGlyph("-", GlyphRole.DIGIT, signFactor)
    } else {
      addGlyph(suffixInk, GlyphRole.SUFFIX, 1.0)
    }
  }

  private fun updateAffixBlocks(rtl: Boolean) {
    val prefix = if (rtl) splitAffix(format.prefix, spaceAtEnd = true) else Pair(format.prefix, "")
    val suffix = if (rtl) splitAffix(format.suffix, spaceAtEnd = false) else Pair(format.suffix, "")
    prefixInk = prefix.first
    prefixGap = prefix.second
    suffixInk = suffix.first
    suffixGap = suffix.second
    affixRtl = rtl
    affixBlocksDirty = false
  }

  /** Whether this view is laid out right-to-left. The hybrid sets it from the `rightToLeft` prop. */
  val isRtl: Boolean get() = layoutDirection == LAYOUT_DIRECTION_RTL

  /** `AUTO` resolved against the layout direction; the rest are already absolute. */
  private val resolvedAlignment: Alignment
    get() = if (alignment == Alignment.AUTO) (if (isRtl) Alignment.RIGHT else Alignment.LEFT) else alignment

  override fun onRtlPropertiesChanged(layoutDirection: Int) {
    super.onRtlPropertiesChanged(layoutDirection)
    invalidate()
  }

  /**
   * Splits an affix from the space it keeps against the digits - a prefix's
   * trailing run, a suffix's leading one - as (ink, gap). An affix that is all
   * space is one block.
   */
  private fun splitAffix(text: String, spaceAtEnd: Boolean): Pair<String, String> {
    val isSpace = { c: Char -> c == ' ' || c == '\u00A0' || c == '\u2009' || c == '\u202F' }
    var n = 0
    while (n < text.length && isSpace(if (spaceAtEnd) text[text.length - 1 - n] else text[n])) n++
    if (n == 0 || n == text.length) return Pair(text, "")
    return if (spaceAtEnd) Pair(text.substring(0, text.length - n), text.substring(text.length - n))
    else Pair(text.substring(n), text.substring(0, n))
  }

  private fun settledWidth(): Float {
    val count = engine.settledPowerCount()
    while (settledWheels.size < count) settledWheels.add(Wheel())
    while (settledWheels.size > count) settledWheels.removeAt(settledWheels.size - 1)
    buildElements(fonts, settledWheels, if (engine.settledNegative()) 1.0 else 0.0, settledElements)
    return settledElements.totalWidth()
  }

  /** Formats the target the way it is displayed, for TalkBack. */
  private fun accessibleText(): String {
    val fd = format.fractionDigits
    val sb = StringBuilder()
    if (engine.settledNegative()) sb.append('-')
    sb.append(format.prefix)
    for (power in engine.settledPowerCount() - 1 downTo 0) {
      sb.append(engine.targetDigit(power))
      if (power > fd && (power - fd) % 3 == 0) sb.append(format.groupingSeparator)
      if (fd > 0 && power == fd) sb.append(format.decimalSeparator)
    }
    sb.append(format.suffix)
    return sb.toString()
  }

  // TalkBack reads the settled figure when it asks for it, so a value update
  // (which can come every frame) formats nothing.
  override fun getContentDescription(): CharSequence? {
    if (!engine.hasShownValue()) return null
    return if (loading) accessibleText() + ", loading" else accessibleText()
  }

  /** A narrower settled size waiting for the current roll to finish before it is reported. */
  private var pendingSizeReport = false

  private fun reportIntrinsicSize() {
    // A no-op unless an accessibility service is on; then a focused figure re-announces.
    sendAccessibilityEvent(AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED)
    // The reported size is always the full-size one: with shrink-to-fit the view
    // keeps its height and the scaled number is centred inside it when drawing.
    val widthDp = ceil(settledWidth() / density)
    val heightDp = ceil(fonts.lineHeight / density)
    if (abs(widthDp - lastReportedWidth) <= 0.01f && abs(heightDp - lastReportedHeight) <= 0.01f) {
      pendingSizeReport = false
      return
    }
    // Growing: report right away so React widens the box before the new digit has
    // fully appeared (the view is not clipped meanwhile). Shrinking mid-roll: keep
    // the wider box until the roll has finished, otherwise adjustsFontSizeToFit
    // would squeeze the still-rolling digits into the smaller box and the whole
    // amount would visibly shrink and grow back.
    if (lastReportedWidth > 0f && widthDp < lastReportedWidth && engine.isRolling()) {
      pendingSizeReport = true
      return
    }
    pendingSizeReport = false
    lastReportedWidth = widthDp
    lastReportedHeight = heightDp
    onIntrinsicSizeChange?.invoke(widthDp, heightDp)
  }

  // endregion

  // region Drawing

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (!engine.hasShownValue()) return
    syncFromEngine()
    val fonts = this.fonts
    val elements = frameElements
    buildElements(fonts, wheels, signFactor, elements)
    val total = elements.totalWidth()
    updateFontScale(total)
    val fit = fontScale

    // Position the (scaled) content, then draw everything in unscaled font space.
    // The reveal's landing pop scales about the content's centre on top of the fit.
    var originX = when (resolvedAlignment) {
      Alignment.AUTO, Alignment.LEFT -> 0f
      Alignment.CENTER -> (width - total * fit) / 2f
      Alignment.RIGHT -> width - total * fit
    }
    var originY = (height - fonts.lineHeight * fit) / 2f
    val pop = revealScale
    if (pop != 1f) {
      originX += total * fit * (1f - pop) / 2f
      originY += fonts.lineHeight * fit * (1f - pop) / 2f
    }
    val scale = fit * pop
    val outer = canvas.save()
    canvas.translate(originX, originY)
    canvas.scale(scale, scale)

    val dim = loadingProgress.coerceIn(0f, 1f)
    // Everything drawn in this layer is what the sweep gets composited onto.
    val layer = if (dim > 0f) canvas.saveLayer(-1f, -1f, total + 1f, fonts.lineHeight + 1f, null) else -1
    var x = 0f
    for (i in 0 until elements.size) {
      val element = elements[i]
      val text = element.text
      if (element.wheelIndex >= 0) {
        drawWheel(canvas, fonts, wheels[element.wheelIndex], x, element.width, originX, originY, scale)
      } else if (text != null) {
        drawGlyph(canvas, fonts, text, element.role, x, element.width, element.fullWidth, element.factor)
      }
      x += element.width
    }
    if (dim > 0f) {
      drawShimmer(canvas, fonts, total, dim)
      canvas.restoreToCount(layer)
    }
    canvas.restoreToCount(outer)
  }

  /**
   * A "shine" glint: a text-wide, slanted band that recolors the ink from the text
   * color to the highlight and back ([base, highlight, base] at 10/50/90 %),
   * composited SRC_ATOP so only the glyphs light up.
   */
  private fun drawShimmer(canvas: Canvas, fonts: FontSet, contentWidth: Float, dim: Float) {
    if (contentWidth <= 0f) return
    val base = fonts.digit.color
    val highlight = shimmer.color ?: defaultShimmerColor()
    val phase = engine.shimmerPhase(now(), shimmer.durationMs / 1000.0).toFloat()
    val progress = SHIMMER_SEED + (1f - SHIMMER_SEED) * phase
    // Core at width * (2p - 0.5): enters at the left edge, exits past the right.
    val startX = contentWidth * (2f * progress - 1f)
    var gradient = shimmerGradient
    if (gradient == null || shimmerGradientWidth != contentWidth || shimmerGradientBase != base || shimmerGradientHighlight != highlight) {
      gradient = LinearGradient(
        0f, 0f, contentWidth, SHIMMER_SLANT * contentWidth,
        intArrayOf(base, highlight, base), floatArrayOf(0.1f, 0.5f, 0.9f), Shader.TileMode.CLAMP,
      )
      shimmerGradient = gradient
      shimmerGradientWidth = contentWidth
      shimmerGradientBase = base
      shimmerGradientHighlight = highlight
      shimmerPaint.shader = gradient
    }
    shimmerMatrix.setTranslate(startX, 0f)
    gradient.setLocalMatrix(shimmerMatrix)
    shimmerPaint.alpha = (dim * 255f).toInt().coerceIn(0, 255)
    canvas.drawRect(-1f, -1f, contentWidth + 1f, fonts.lineHeight + 1f, shimmerPaint)
  }

  /** Default glint color: a near-background neutral so the ink "lights up". */
  private fun defaultShimmerColor(): Int {
    val night = (context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
      android.content.res.Configuration.UI_MODE_NIGHT_YES
    return if (night) 0xFF2B2E37.toInt() else 0xFFD6D9E1.toInt()
  }

  private fun drawGlyph(canvas: Canvas, fonts: FontSet, text: String, role: GlyphRole, x: Float, width: Float, fullWidth: Float, alpha: Double) {
    if (width <= 0f) return
    val paint = fonts.paint(role)
    canvas.save()
    canvas.clipRect(x, 0f, x + width, fonts.lineHeight)
    paint.alpha = (alpha * 255).toInt().coerceIn(0, 255)
    canvas.drawText(text, x + width - fullWidth, fonts.baseline(role, text, 0f), paint)
    canvas.restore()
  }

  /**
   * [originX], [originY] and [scale] are the content transform already on the
   * canvas, so the strip window can be landed on whole device pixels.
   */
  private fun drawWheel(canvas: Canvas, fonts: FontSet, wheel: Wheel, x: Float, width: Float, originX: Float, originY: Float, scale: Float) {
    if (width <= 0f) return
    val lineHeight = fonts.lineHeight
    if (wheel.blend < 1.0) {
      when (timing.transition) {
        Transition.FLIP -> drawFlip(canvas, fonts, wheel, x, width)
        Transition.MORPH -> drawMorph(canvas, fonts, wheel, x, width)
        else -> drawSwap(canvas, fonts, wheel, x, width)
      }
      drawFlash(canvas, fonts, wheel, x, width)
      return
    }
    // A settled-width wheel is a window onto the shared strip (the strip has
    // no per-wheel alpha, so a wheel still growing or shrinking, and any
    // canvas without a GPU, which cannot draw a hardware bitmap, draws its
    // two glyphs the old way).
    if (wheel.width >= 1.0 && canvas.isHardwareAccelerated) {
      val strip = fonts.strip(wheel.blankZero)
      if (strip != null) {
        // An interior wheel wraps modulo 10, negatives included (rolling down
        // through 0 shows 9); a linear wheel never wraps and uses -1 for the
        // blank slot. Either way the window lands inside the strip.
        val position = if (wheel.linear) wheel.position.coerceIn(-1.0, 10.0) else wrap10(wheel.position)
        var tx = x + width - fonts.digitWidth
        var ty = (-(position + 1) * lineHeight).toFloat()
        if (scale == 1f && position == floor(position)) {
          // At rest, land the window on whole device pixels: composited at a
          // fractional offset (a centred number, a fractional digit width) the
          // layer is resampled and a small digit goes soft. In motion the
          // fractional offsets are the motion, and stay.
          tx = Math.round(originX + tx) - originX
          ty = Math.round(originY + ty) - originY
        }
        canvas.save()
        canvas.clipRect(x, 0f, x + width, lineHeight)
        canvas.translate(tx, ty)
        if (strip.node != null) canvas.drawRenderNode(strip.node) else canvas.drawBitmap(strip.bitmap, 0f, 0f, stripPaint)
        canvas.restore()
        drawFlash(canvas, fonts, wheel, x, width)
        return
      }
    }
    val paint = fonts.digit
    val baseline = fonts.baseline(GlyphRole.DIGIT, "0", 0f)
    canvas.save()
    canvas.clipRect(x, 0f, x + width, lineHeight)
    paint.alpha = (wheel.width * 255).toInt().coerceIn(0, 255)
    val base = floor(wheel.position)
    val fraction = (wheel.position - base).toFloat()
    val index = base.toInt()
    val columnLeft = x + width - fonts.digitWidth
    glyphAt(index, wheel)?.let { glyph ->
      canvas.drawText(glyph, columnLeft + (fonts.digitWidth - fonts.width(glyph, GlyphRole.DIGIT)) / 2f, baseline - fraction * lineHeight, paint)
    }
    if (fraction > 0.0001f) {
      glyphAt(index + 1, wheel)?.let { glyph ->
        canvas.drawText(glyph, columnLeft + (fonts.digitWidth - fonts.width(glyph, GlyphRole.DIGIT)) / 2f, baseline + (1f - fraction) * lineHeight, paint)
      }
    }
    canvas.restore()
    drawFlash(canvas, fonts, wheel, x, width)
  }

  /**
   * The change flash: the glyph showing (or arriving), in the up or down
   * colour, drawn over it at the flash's opacity.
   */
  private fun drawFlash(canvas: Canvas, fonts: FontSet, wheel: Wheel, x: Float, width: Float) {
    if (wheel.flash <= 0.002) return
    val color = (if (wheel.flashUp) flash.upColor else flash.downColor) ?: return
    // A flipping or morphing glyph tints its own paint instead (see drawFlip / drawMorph).
    if (wheel.blend < 1.0 && (timing.transition == Transition.FLIP || timing.transition == Transition.MORPH)) return
    val swapping = wheel.blend < 1.0
    val glyphIndex = if (wheel.blend < 1.0) wheel.toGlyph.toInt() else ((Math.round(wheel.position) % 10 + 10) % 10).toInt()
    if (glyphIndex < 0 || (wheel.blankZero && glyphIndex == 0)) return
    val text = DIGITS[glyphIndex]
    val lineHeight = fonts.lineHeight
    val b = wheel.blend.toFloat()
    val d = if (wheel.fromAbove) 1f else -1f
    val offset = if (swapping) -d * lineHeight * NUMERIC_OFFSET * (1f - b) else 0f
    val scale = if (swapping) NUMERIC_SCALE + (1f - NUMERIC_SCALE) * b else 1f
    val alpha = wheel.flash.toFloat() * (if (swapping) b else 1f) * wheel.width.toFloat().coerceIn(0f, 1f)
    val paint = fonts.tinted(color)
    canvas.save()
    canvas.clipRect(x, 0f, x + width, lineHeight)
    canvas.translate(x + width - fonts.digitWidth / 2f, lineHeight / 2f + offset)
    canvas.scale(scale, scale)
    paint.alpha = (alpha * 255f).toInt().coerceIn(0, 255)
    canvas.drawText(text, -fonts.width(text, GlyphRole.DIGIT) / 2f, fonts.baseline(GlyphRole.DIGIT, text, 0f) - lineHeight / 2f, paint)
    paint.alpha = 255
    canvas.restore()
  }

  private val flipCamera = android.graphics.Camera()
  private val flipMatrix = Matrix()

  /**
   * The split-flap for this frame: the next card's top half and the current
   * card's bottom half stay; the flap (the current card's top on its front,
   * the next card's bottom on its back) turns about the centre line, with the
   * perspective of a [android.graphics.Camera].
   */
  private fun drawFlip(canvas: Canvas, fonts: FontSet, wheel: Wheel, x: Float, width: Float) {
    val lineHeight = fonts.lineHeight
    val mid = lineHeight / 2f
    val b = wheel.blend.toFloat()
    val angle = if (b < 0.5f) 2f * b * b else 1f - 2f * (1f - b) * (1f - b)
    val current = wheel.fromGlyph.toInt()
    val next = wheel.toGlyph.toInt()
    val cx = x + width - fonts.digitWidth / 2f
    val column = wheel.width.toFloat().coerceIn(0f, 1f)
    val paint = flashedPaint(fonts, wheel)
    fun half(glyphIndex: Int, top: Boolean, degrees: Float, shade: Float) {
      if (glyphIndex < 0) return
      val text = DIGITS[glyphIndex]
      canvas.save()
      if (top) canvas.clipRect(x, 0f, x + width, mid - 0.5f) else canvas.clipRect(x, mid + 0.5f, x + width, lineHeight)
      if (degrees != 0f) {
        // Turn about the hinge: the centre line of the cell, at the digit's centre.
        flipCamera.save()
        flipCamera.setLocation(0f, 0f, -8f * lineHeight / 72f * 4f)
        flipCamera.rotateX(degrees)
        flipCamera.getMatrix(flipMatrix)
        flipCamera.restore()
        flipMatrix.preTranslate(-cx, -mid)
        flipMatrix.postTranslate(cx, mid)
        canvas.concat(flipMatrix)
      }
      paint.alpha = (column * (1f - shade) * 255f).toInt().coerceIn(0, 255)
      canvas.drawText(text, cx - fonts.width(text, GlyphRole.DIGIT) / 2f, fonts.baseline(GlyphRole.DIGIT, text, 0f), paint)
      paint.alpha = 255
      canvas.restore()
    }
    half(next, true, 0f, 0f)            // the next card's top, under the flap
    half(current, false, 0f, 0f)        // the current card's bottom, until the flap lands
    if (angle < 0.5f) {
      half(current, true, -angle * 180f, angle * 0.6f)          // the flap's front, falling
    } else {
      half(next, false, (1f - angle) * 180f, (1f - angle) * 0.6f) // the flap's back, landing
    }
    // The board's hinge line.
    canvas.save()
    canvas.clipRect(x, mid - 0.5f, x + width, mid + 0.5f)
    canvas.drawColor(0, android.graphics.PorterDuff.Mode.CLEAR)
    canvas.restore()
  }

  private val morphPath = Path()
  private var morphBuffer = DoubleArray(3 * GlyphMorph.CONTOUR_DOUBLES)

  /** The morph for this frame: the outline between the two digits, filled even-odd. */
  private fun drawMorph(canvas: Canvas, fonts: FontSet, wheel: Wheel, x: Float, width: Float) {
    val from = wheel.fromGlyph.toInt()
    val to = wheel.toGlyph.toInt()
    val a = if (from >= 0) fonts.outline(from) else DoubleArray(0)
    val b = if (to >= 0) fonts.outline(to) else DoubleArray(0)
    val ca = a.size / GlyphMorph.CONTOUR_DOUBLES
    val cb = b.size / GlyphMorph.CONTOUR_DOUBLES
    val count = max(ca, cb)
    if (count == 0) return
    if (morphBuffer.size < count * GlyphMorph.CONTOUR_DOUBLES) morphBuffer = DoubleArray(count * GlyphMorph.CONTOUR_DOUBLES)
    val t = wheel.blend
    var contours = 0
    if (ca > 0 && cb > 0) {
      contours = GlyphMorph.interpolate(a, ca, b, cb, t, morphBuffer)
    } else {
      // One side blank: the other shape grows from, or shrinks to, its centre.
      val src = if (ca > 0) a else b
      val scale = if (ca > 0) 1.0 - t else t
      contours = src.size / GlyphMorph.CONTOUR_DOUBLES
      for (c in 0 until contours) {
        val base = c * GlyphMorph.CONTOUR_DOUBLES
        var cx = 0.0
        var cy = 0.0
        for (i in 0 until GlyphMorph.SAMPLES) { cx += src[base + 2 * i]; cy += src[base + 2 * i + 1] }
        cx /= GlyphMorph.SAMPLES
        cy /= GlyphMorph.SAMPLES
        for (i in 0 until GlyphMorph.SAMPLES) {
          morphBuffer[base + 2 * i] = cx + (src[base + 2 * i] - cx) * scale
          morphBuffer[base + 2 * i + 1] = cy + (src[base + 2 * i + 1] - cy) * scale
        }
      }
    }
    if (contours <= 0) return
    val paint = flashedPaint(fonts, wheel)
    val columnLeft = x + width - fonts.digitWidth
    morphPath.rewind()
    morphPath.fillType = Path.FillType.EVEN_ODD
    for (c in 0 until contours) {
      val base = c * GlyphMorph.CONTOUR_DOUBLES
      morphPath.moveTo(columnLeft + morphBuffer[base].toFloat(), morphBuffer[base + 1].toFloat())
      for (i in 1 until GlyphMorph.SAMPLES) {
        morphPath.lineTo(columnLeft + morphBuffer[base + 2 * i].toFloat(), morphBuffer[base + 2 * i + 1].toFloat())
      }
      morphPath.close()
    }
    canvas.save()
    canvas.clipRect(x, 0f, x + width, fonts.lineHeight)
    paint.alpha = (wheel.width.toFloat().coerceIn(0f, 1f) * 255f).toInt()
    canvas.drawPath(morphPath, paint)
    paint.alpha = 255
    canvas.restore()
  }

  /** The digit paint, or a copy mixed towards the change flash's colour by the wheel's flash. */
  private fun flashedPaint(fonts: FontSet, wheel: Wheel): TextPaint {
    if (wheel.flash <= 0.002) return fonts.digit
    val tint = (if (wheel.flashUp) flash.upColor else flash.downColor) ?: return fonts.digit
    val t = wheel.flash.toFloat()
    val base = fonts.digit.color
    fun ch(shift: Int) = ((base ushr shift and 0xff) + (((tint ushr shift and 0xff) - (base ushr shift and 0xff)) * t)).toInt().coerceIn(0, 255)
    return fonts.tinted(Color.argb(ch(24), ch(16), ch(8), ch(0)))
  }

  /**
   * The numeric transition: the leaving glyph and the arriving one, each
   * scaled about its centre, offset along the axis, faded, and cross-faded
   * with its blurred bitmap as it goes out of, or comes into, focus; the
   * geometry is `RollingEngine.hpp`'s.
   */
  private fun drawSwap(canvas: Canvas, fonts: FontSet, wheel: Wheel, x: Float, width: Float) {
    val lineHeight = fonts.lineHeight
    val b = wheel.blend.toFloat()
    val d = if (wheel.fromAbove) 1f else -1f
    val offset = lineHeight * NUMERIC_OFFSET
    val cx = x + width - fonts.digitWidth / 2f
    val cy = lineHeight / 2f
    val column = wheel.width.toFloat().coerceIn(0f, 1f)
    canvas.save()
    canvas.clipRect(x, 0f, x + width, lineHeight)
    val from = wheel.fromGlyph.toInt()
    val to = wheel.toGlyph.toInt()
    if (from >= 0) {
      drawSwapGlyph(canvas, fonts, from % 10, cx, cy + d * offset * b, 1f - (1f - NUMERIC_SCALE) * b, (1f - b) * column, min(1f, 2f * b))
    }
    if (to >= 0) {
      drawSwapGlyph(canvas, fonts, to % 10, cx, cy - d * offset * (1f - b), NUMERIC_SCALE + (1f - NUMERIC_SCALE) * b, b * column, 1f - b)
    }
    canvas.restore()
  }

  private fun drawSwapGlyph(canvas: Canvas, fonts: FontSet, digitIndex: Int, cx: Float, cy: Float, scale: Float, alpha: Float, blur: Float) {
    if (alpha <= 0.002f) return
    val text = DIGITS[digitIndex]
    val paint = fonts.digit
    val lineHeight = fonts.lineHeight
    canvas.save()
    canvas.translate(cx, cy)
    canvas.scale(scale, scale)
    val sharpAlpha = alpha * (1f - blur)
    if (sharpAlpha > 0.002f) {
      paint.alpha = (sharpAlpha * 255f).toInt().coerceIn(0, 255)
      canvas.drawText(text, -fonts.width(text, GlyphRole.DIGIT) / 2f, fonts.baseline(GlyphRole.DIGIT, text, 0f) - lineHeight / 2f, paint)
      paint.alpha = 255
    }
    val blurAlpha = alpha * blur
    if (blurAlpha > 0.002f) {
      val bitmap = fonts.blurred(digitIndex)
      if (bitmap != null) {
        stripPaint.alpha = (blurAlpha * 255f).toInt().coerceIn(0, 255)
        canvas.drawBitmap(bitmap, -fonts.digitWidth / 2f - fonts.blurPad, -lineHeight / 2f - fonts.blurPad, stripPaint)
        stripPaint.alpha = 255
      }
    }
    canvas.restore()
  }

  private fun glyphAt(index: Int, wheel: Wheel): String? {
    if (wheel.linear && index < 0) return null
    if (wheel.blankZero && index == 0) return null
    val digit = ((index % 10) + 10) % 10
    return DIGITS[digit]
  }

  // endregion

  /**
   * Fabric dropped the view. It stays allocated until the JS side's handle to
   * it is collected (Hermes decides when), so everything that could outlive
   * the drop stops here and everything sizeable is let go of: the frame
   * callback, the engine's wheels and the layout buffers. The strips are
   * shared and stay in their cache. The view stays usable: with view
   * recycling on, Fabric hands it to [resetForRecycle] and a new element next.
   */
  fun release() {
    stopAnimation()
    engine.reset()
    wheels.clear()
    frameElements.clear()
    settledElements.clear()
  }

  /**
   * What one mounted rolling number costs, for the JS garbage collector
   * (Nitro's `memorySize`). Measured, not estimated: the example's
   * `footprint` benchmark mounts 100 copies, forces a collection before and
   * with them, and divides the difference; the median of three interleaved
   * rounds. Galaxy A22, Android 13, 2026-09-22: 46 KB of malloc (engine,
   * display list, paints) and 8 KB of Java heap per copy, rounds within
   * ±30 KB; plain `Text` is 26 + 5 KB. A constant, because Nitro reads it
   * from the JS thread; the shared strips are not per copy.
   */
  fun memoryEstimateBytes(): Long = 64L * 1024

  /** Interior wheels wrap modulo 10; a roll can be any real, so fold it onto 0 ≤ p < 10. */
  private fun wrap10(position: Double): Double {
    val r = position % 10.0
    return if (r < 0) r + 10.0 else r
  }

  /** A digit strip: the software-rendered bitmap and, from Android 10, the layer that holds it. */
  class Strip(val bitmap: Bitmap, val node: RenderNode?)

  /** The blurred digit bitmaps of the numeric transition, shared like the strips and bounded the same way. */
  private object BlurredGlyphCache {
    private const val CAPACITY = 64
    private val entries =
      object : LinkedHashMap<String, Bitmap>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>): Boolean = size > CAPACITY
      }

    @Synchronized
    fun get(key: String, make: () -> Bitmap): Bitmap = entries.getOrPut(key, make)
  }

  /** The digit strips every rolling number shares, most recently used last; the ones that fall off the end drop their layer. */
  private object StripCache {
    private const val CAPACITY = 24
    private val strips =
      object : LinkedHashMap<String, Strip>(CAPACITY, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Strip>): Boolean {
          val evict = size > CAPACITY
          if (evict) {
            eldest.value.node?.setUseCompositingLayer(false, null)
            eldest.value.node?.discardDisplayList()
          }
          return evict
        }
      }

    fun get(key: String, build: () -> Strip): Strip = strips[key] ?: build().also { strips[key] = it }
  }

  companion object {
    /** Strip slots: blank, 0–9, and the 0 that follows 9 when a wheel wraps. */
    private const val STRIP_SLOTS = 12
    private val DIGITS = Array(10) { it.toString() }
    private const val ALL_DIGITS = "0123456789"
    /** The core starts at the glyphs' left edge instead of parked off-screen. */
    private const val SHIMMER_SEED = 0.25f
    /** How far the top of the band leads the bottom, as a fraction of the height ("/" slant). */
    private const val SHIMMER_SLANT = 0.6f
  }
}
