package com.margelo.nitro.nitroinput

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
import android.graphics.RenderNode
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
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
import java.util.concurrent.atomic.AtomicReferenceArray
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Draws a NitroNumber. All behaviour (wheel positions, rolls, stagger,
 * easing, loading fade, shimmer phase) lives in the shared C++ `RollingEngine`
 * (cpp/RollingEngine.hpp, reached through the [RollingEngine] JNI handle); this
 * view owns fonts, layout, fit-to-width and Canvas drawing, and drives the
 * engine from a Choreographer frame loop.
 *
 * Mirrors `NitroNumberView.swift` on iOS.
 */
// The numeric transition's geometry, in line heights; mirrors
// `RollingEngine::kNumeric*`, where the effect is described.
private const val NUMERIC_OFFSET = 0.34f
private const val NUMERIC_SCALE = 0.4f
/** The blur radius at full blur, in line heights: SwiftUI's own. */
private const val NUMERIC_BLUR = 0.08f
/** Blurred copies per digit, from a touch of blur to the full one. */
private const val NUMERIC_BLUR_LEVELS = 6

/** `RollingEngine::TextSlot`. */
private const val TEXT_PREFIX = 0
private const val TEXT_SUFFIX = 1
private const val TEXT_GROUPING = 2
private const val TEXT_DECIMAL = 3
private const val TEXT_SIGN = 4
private const val TEXT_SLOTS = 5
/** Doubles per wheel in the engine's frame buffer (`RollingEngine.frameInto`): the engine's wheel, then its modulus. */
private const val WHEEL_FIELDS = 15

class NitroNumberView(context: Context) : View(context) {

  // region Configuration

  data class Format(
    val fractionDigits: Int = 0,
    val minimumIntegerDigits: Int = 1,
    val groupingSeparator: String = "",
    val decimalSeparator: String = ".",
    val prefix: String = "",
    val suffix: String = "",
    /** ECMA-402's signDisplay (`RollingEngine.setSignDisplay`), and the glyphs drawn for the two signs. */
    val signDisplay: Int = 0,
    val plusSign: String = "+",
    val minusSign: String = "-",
    /**
     * Digit group sizes counted from the decimal point, the first then every
     * later one (empty: threes). [3, 2] is Indian grouping, [2] a clock's.
     */
    val groupingSizes: List<Int> = emptyList(),
    /** Per integer position, the highest digit its wheel shows before it wraps (a clock's 5). */
    val digitMax: List<Int> = emptyList(),
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
    /** Dp added after every glyph, as `Text`'s letterSpacing; an affix gets it in proportion to its size. */
    val letterSpacing: Float = 0f,
    /** Dp between the prefix and the digits, and between the digits and the suffix, in place of the letter spacing there. */
    val prefixSpacing: Float? = null,
    val suffixSpacing: Float? = null,
    /** Dp an affix is moved down (negative: up) after its alignment. */
    val prefixOffset: Float = 0f,
    val suffixOffset: Float = 0f,
    /** Every digit as wide as the widest (tabular figures, the default), or each at its own width. */
    val tabularNums: Boolean = true,
    /** The prefix's, the suffix's and the fraction's colours (null: [color]). */
    val prefixColor: Int? = null,
    val suffixColor: Int? = null,
    val fractionColor: Int? = null,
    /** The fraction digits' and decimal separator's size (null: [fontSize]) and how they line up. */
    val fractionFontSize: Float? = null,
    val fractionAlign: AffixAlign = AffixAlign.BASELINE,
    /** The glyphs drawn for 0…9 (anything but ten non-empty strings: "0"…"9"). */
    val digitGlyphs: List<String> = emptyList(),
    val adjustsFontSizeToFit: Boolean = false,
    val minimumFontScale: Float = 0.5f,
    val allowFontScaling: Boolean = false,
    val maxFontSizeMultiplier: Float = 0f,
  )

  enum class Easing(val raw: Int) { LINEAR(0), EASE_IN(1), EASE_OUT(2), EASE_IN_OUT(3), SPRING(4) }

  enum class Direction(val raw: Int) { AUTO(0), UP(1), DOWN(2), SHORTEST(3) }

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
    /** Rolls turn the lower wheels a full turn too (`RollingEngine.setContinuous`). */
    val continuous: Boolean = false,
    /** Snap while the user has removed animations. */
    val respectReduceMotion: Boolean = true,
  )

  enum class RevealStyle(val raw: Int) { COUNT(0), SPIN(1) }

  enum class Transition(val raw: Int) { ROLL(0), NUMERIC(1), SCRAMBLE(2) }

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
      val old = field
      field = value
      // A prefix, suffix or separator that changes while a value is shown
      // swaps like a digit (`RollingEngine::changeText`): keep the text that leaves.
      if (engine.hasShownValue()) {
        val rtl = isRtl
        fun ink(prefix: String) = if (rtl) splitAffix(prefix, spaceAtEnd = true).first else prefix
        fun suffixInk(suffix: String) = if (rtl) splitAffix(suffix, spaceAtEnd = false).first else suffix
        val t = now()
        fun change(slot: Int, from: String, to: String) {
          if (from == to) return
          leavingText[slot] = from
          engine.changeText(slot, t)
        }
        change(TEXT_PREFIX, ink(old.prefix), ink(value.prefix))
        change(TEXT_SUFFIX, suffixInk(old.suffix), suffixInk(value.suffix))
        change(TEXT_GROUPING, old.groupingSeparator, value.groupingSeparator)
        change(TEXT_DECIMAL, old.decimalSeparator, value.decimalSeparator)
        val positive = engine.signPositive()
        change(TEXT_SIGN, if (positive) old.plusSign else old.minusSign, if (positive) value.plusSign else value.minusSign)
      }
      engine.setSignDisplay(value.signDisplay)
      if (value.digitMax != old.digitMax) {
        engine.clearDigitMax()
        for ((power, max) in value.digitMax.withIndex()) if (max in 0..8) engine.setDigitMax(power, max)
      }
      affixBlocksDirty = true
      // Played in a glyph-swap transition; snaps otherwise (see the engine).
      engine.changeFormat(value.fractionDigits, value.minimumIntegerDigits, now())
      if (engine.hasShownValue()) reportIntrinsicSize()
      invalidate()
      scheduleFrameIfNeeded()
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
      warmSwapMasks()
      engine.setPopOnChange(value.popOnChange)
      engine.setRevealTiming(value.revealDurationMs / 1000.0, value.revealBounce, value.revealStyle.raw, value.revealStaggerMs / 1000.0)
      engine.setRevealGrow(value.revealGrow)
      engine.setRevealMilestoneHold(value.revealMilestoneHoldMs / 1000.0)
      engine.setContinuous(value.continuous)
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
      applyReduceMotion()
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
  /** Called when the figure starts moving from rest, and when it comes to rest (with its value). */
  var onAnimationStart: (() -> Unit)? = null
  var onAnimationEnd: ((value: Double) -> Unit)? = null
  /** A roll or a reveal is under way ([onAnimationStart] has fired, [onAnimationEnd] not yet). */
  private var moving = false

  /** The value currently shown or being rolled towards. */
  val targetValue: Double
    get() = engine.targetValue()

  /** True while a jackpot reveal counts or its landing pop rings out. */
  val isRevealing: Boolean
    get() = engine.isRevealing()

  // endregion

  // region Fonts

  private enum class GlyphRole {
    /** The integer digits, the sign and the grouping separators. */
    DIGIT,
    PREFIX,
    SUFFIX,
    /** The fraction digits and the decimal separator (`fractionFontSize`, `fractionColor`). */
    FRACTION,
  }

  /** Digit / prefix / suffix / fraction paints with per-glyph width caches. */
  private inner class FontSet(t: Typography) {
    private val scale = systemFontMultiplier(t)
    private val ink = t.color ?: defaultTextColor()
    val digit = makePaint(t, t.fontSize * scale, ink)
    val prefix = makePaint(t, (t.prefixFontSize ?: t.fontSize) * scale, t.prefixColor ?: ink)
    val suffix = makePaint(t, (t.suffixFontSize ?: t.fontSize) * scale, t.suffixColor ?: ink)
    val fraction = makePaint(t, (t.fractionFontSize ?: t.fontSize) * scale, t.fractionColor ?: ink)
    private val prefixAlign = t.prefixAlign
    private val suffixAlign = t.suffixAlign
    private val fractionAlign = t.fractionAlign
    /** The glyphs drawn for 0…9. */
    val glyphs: Array<String> =
      if (t.digitGlyphs.size == 10 && t.digitGlyphs.none { it.isEmpty() }) t.digitGlyphs.toTypedArray() else DIGITS
    private val glyphsKey = glyphs.joinToString("|")
    /** Every glyph in a row, whose ink the bottom alignment pins to. */
    private val allGlyphs = glyphs.joinToString("")
    /** Letter spacing after a digit / prefix / suffix / fraction glyph, the seams (null: the letter spacing) and the affix offsets, in px. */
    val digitSpacing = t.letterSpacing * scale * density
    val prefixLetterSpacing = digitSpacing * ((t.prefixFontSize ?: t.fontSize) / t.fontSize)
    val suffixLetterSpacing = digitSpacing * ((t.suffixFontSize ?: t.fontSize) / t.fontSize)
    val fractionLetterSpacing = digitSpacing * ((t.fractionFontSize ?: t.fontSize) / t.fontSize)
    val prefixSeam = t.prefixSpacing?.let { it * scale * density }
    val suffixSeam = t.suffixSpacing?.let { it * scale * density }
    private val prefixOffset = t.prefixOffset * scale * density
    private val suffixOffset = t.suffixOffset * scale * density
    private val digitMetrics: Paint.FontMetrics = digit.fontMetrics
    /** Each role's metrics, read once: `Paint.getFontMetrics()` allocates, and the layout asks per glyph per frame. */
    private val roleMetrics = Array(GlyphRole.entries.size) { paint(GlyphRole.entries[it]).fontMetrics }
    /** Height of the line box (the digit paint's line height), in px. */
    val lineHeight: Float = ceil(digitMetrics.descent - digitMetrics.ascent)
    /** The numeric transition's blur radius at full blur, in line heights. */
    val numericBlur: Float = NUMERIC_BLUR
    /** Width of the widest digit glyph, in px. */
    val digitWidth: Float
    /** The same for the fraction digits, in their own font. */
    val fractionDigitWidth: Float
    /** Each digit at its own advance instead of the widest's (`tabularNums={false}`). */
    val proportional = !t.tabularNums
    /** The advance of each digit 0…9, in px. */
    val digitWidths = FloatArray(10)
    val fractionDigitWidths = FloatArray(10)
    private val widthCache = Array(GlyphRole.entries.size) { java.util.concurrent.ConcurrentHashMap<String, Float>() }
    /**
     * A wheel's whole digit strip, per role, blank-zero variant and modulus:
     * `modulus + 2` slots for index -1 (blank) to `modulus` (the 0 that
     * follows the last digit on a wrap: 10 on a plain wheel, 6 on a clock's
     * tens), each `lineHeight` tall with the digit centred in the role's
     * widest digit; a fraction digit set smaller sits at its aligned height in
     * the slot. The digits are rasterized
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
     * typography (see [StripCache]); this font set keeps the ones it has used
     * by [stripVariant], so a frame looks them up without building a key.
     */
    private val strips = android.util.SparseArray<Strip>()

    /**
     * This font set's digit masks by role (digit, fraction), digit and level,
     * filled from the shared cache: a swapping glyph looks two up every frame,
     * and a lookup there built a key string each time. Written by the warm-up
     * thread too.
     */
    private val digitMasks = AtomicReferenceArray<Bitmap>(2 * 10 * (NUMERIC_BLUR_LEVELS + 1))

    fun strip(role: GlyphRole, blankZero: Boolean, modulus: Int): Strip? {
      val cell = digitWidth(role)
      if (cell <= 0f || lineHeight <= 0f) return null
      val variant = stripVariant(role, blankZero, modulus)
      var strip = strips.get(variant)
      if (strip == null) {
        strip = StripCache.get("${key(role)}|$blankZero|$modulus") {
          Strip(renderStrip(role, blankZero, modulus), if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) RenderNode("rolling-number-strip") else null)
        }
        strips.put(variant, strip)
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
     * frame instead of a blur pass. The bitmap is `digitWidth(role) + 2 pad`
     * wide and `lineHeight + 2 pad` tall with the glyph centred in the column
     * at its role's height in the line box.
     */
    fun blurred(role: GlyphRole, digitIndex: Int, level: Int): Bitmap? {
      val cell = digitWidth(role)
      if (cell <= 0f || lineHeight <= 0f) return null
      // Level 0 (or no blur at all) is the glyph unblurred, still a mask: a
      // swapping glyph's two copies must be the same kind of thing, drawn the
      // same way at the same sub-pixel position. Hardware text snaps to whole
      // pixels as it moves and a bitmap does not, and cross-faded they slid in
      // and out of register as the spring settled, a bold/pale flicker.
      val slot = (if (role == GlyphRole.FRACTION) 10 * (NUMERIC_BLUR_LEVELS + 1) else 0) +
        digitIndex * (NUMERIC_BLUR_LEVELS + 1) + level.coerceIn(0, NUMERIC_BLUR_LEVELS)
      digitMasks.get(slot)?.let { return it }
      val radius = if (level <= 0 || numericBlur <= 0f) 0 else Math.round(lineHeight * numericBlur * level / NUMERIC_BLUR_LEVELS).coerceAtLeast(1)
      val mask = BlurredGlyphCache.get("${key(role)}|$digitIndex|$radius|$blurPad") {
        val text = glyphs[digitIndex]
        val pad = blurPad
        val w = ceil(cell).toInt() + 2 * pad
        val h = ceil(lineHeight).toInt() + 2 * pad
        // An alpha mask, not a coloured bitmap: the glyph's coverage, blurred,
        // that a draw fills with the digit paint's colour. A coloured
        // ARGB_8888 bitmap round-tripped through get/setPixels came back with
        // its whole rectangle faintly inked on the GPU; a mask has no colour
        // to get wrong, and is a quarter of the memory.
        val mask = Bitmap.createBitmap(w, h, Bitmap.Config.ALPHA_8)
        val canvas = Canvas(mask)
        // A paint of its own: the masks are warmed off the main thread, where
        // the digit paint's alpha is being changed by the draws.
        val paint = TextPaint(paint(role)).apply { alpha = 255 }
        canvas.drawText(text, pad + (cell - width(text, role)) / 2f, pad + digitBaseline(role), paint)
        if (radius > 0) boxBlurMask(mask, radius)
        // Immutable and uploaded ahead of its first draw: HWUI re-pins a mutable
        // bitmap at every sync, and the first frame that drew a fresh mask paid
        // for its texture upload.
        val done = mask.copy(Bitmap.Config.ALPHA_8, false) ?: mask
        if (done !== mask) mask.recycle()
        done.prepareToDraw()
        done
      }
      digitMasks.set(slot, mask)
      return mask
    }

    /**
     * [text] of [role] as an alpha mask blurred to [level] (of
     * [NUMERIC_BLUR_LEVELS]; 0 sharp), `width + 2 pad` by `lineHeight + 2 pad`
     * with the text's left edge at `pad`: a prefix, suffix or separator
     * changing text, drawn the way a swapping digit is.
     */
    fun blurredText(text: String, role: GlyphRole, level: Int): Bitmap? {
      if (text.isEmpty() || lineHeight <= 0f) return null
      val radius = if (level <= 0 || numericBlur <= 0f) 0 else Math.round(lineHeight * numericBlur * level / NUMERIC_BLUR_LEVELS).coerceAtLeast(1)
      return BlurredGlyphCache.get("${key(role)}|t|$text|$radius|$blurPad") {
        val pad = blurPad
        val w = ceil(width(text, role)).toInt() + 2 * pad
        val h = ceil(lineHeight).toInt() + 2 * pad
        val mask = Bitmap.createBitmap(w.coerceAtLeast(1), h, Bitmap.Config.ALPHA_8)
        val canvas = Canvas(mask)
        val paint = TextPaint(paint(role)).apply { alpha = 255 }
        canvas.drawText(text, pad.toFloat(), pad + baseline(role, text, 0f), paint)
        if (radius > 0) boxBlurMask(mask, radius)
        val done = mask.copy(Bitmap.Config.ALPHA_8, false) ?: mask
        if (done !== mask) mask.recycle()
        done.prepareToDraw()
        done
      }
    }

    /** Padding around a blurred glyph's bitmap, enough for the blur's tail. */
    val blurPad: Int get() = ceil(lineHeight * numericBlur * 3f).toInt().coerceAtLeast(2)

    /**
     * A digit (or fraction) paint in another colour, for the change flash;
     * one per colour, a few per role looked up without boxing the colour.
     */
    private val tintedColors = IntArray(2 * TINT_SLOTS)
    private val tintedPaints = arrayOfNulls<TextPaint>(2 * TINT_SLOTS)
    private val tintedNext = IntArray(2)
    fun tinted(color: Int, role: GlyphRole): TextPaint {
      val r = if (role == GlyphRole.FRACTION) 1 else 0
      val base = r * TINT_SLOTS
      for (i in base until base + TINT_SLOTS) {
        val paint = tintedPaints[i] ?: break
        if (tintedColors[i] == color) return paint
      }
      val i = base + tintedNext[r]
      tintedNext[r] = (tintedNext[r] + 1) % TINT_SLOTS
      val paint = TextPaint(paint(role)).apply { this.color = color }
      tintedColors[i] = color
      tintedPaints[i] = paint
      return paint
    }

    private fun renderStrip(role: GlyphRole, blankZero: Boolean, modulus: Int): Bitmap {
      val cell = digitWidth(role)
      val slots = modulus + 2
      val w = ceil(cell).toInt()
      val h = ceil(lineHeight * slots).toInt()
      val drawn = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(drawn)
      val baseline = digitBaseline(role)
      val paint = paint(role)
      for (index in -1 until slots - 1) {
        if (index < 0 || (blankZero && index == 0)) continue
        val text = glyphs[index % modulus]
        canvas.drawText(text, (cell - width(text, role)) / 2f, (index + 1) * lineHeight + baseline, paint)
      }
      // Immutable: the renderer uploads it once and keeps the texture.
      val strip = drawn.copy(Bitmap.Config.ARGB_8888, false)
      if (strip !== drawn) drawn.recycle()
      return strip
    }
    private val capHeightCache = HashMap<GlyphRole, Float>()
    private val inkDescentCache = HashMap<String, Float>()

    /** A fraction digit's baseline in the line box, at its alignment. */
    private val fractionBaseline: Float
    /** The vertical centre of a fraction digit in the line box (a swapping glyph's). */
    private val fractionCenterY: Float
    /**
     * What a cached bitmap drawn in each role depends on: the font, its
     * colour, where it sits in the line box and the digit glyphs. Shared
     * strips and masks are keyed by it.
     */
    private val roleKeys: Array<String>

    init {
      for (d in 0..9) digitWidths[d] = width(glyphs[d], GlyphRole.DIGIT)
      digitWidth = digitWidths.max()
      for (d in 0..9) fractionDigitWidths[d] = width(glyphs[d], GlyphRole.FRACTION)
      fractionDigitWidth = fractionDigitWidths.max()
      fractionBaseline = baseline(GlyphRole.FRACTION, glyphs[0], 0f)
      val m = roleMetrics[GlyphRole.FRACTION.ordinal]
      fractionCenterY = fractionBaseline + (m.ascent + m.descent) / 2f
      roleKeys = Array(GlyphRole.entries.size) {
        val role = GlyphRole.entries[it]
        val p = paint(role)
        "${t.fontFamily}|${t.fontWeight}|${digit.textSize}|${p.textSize}|${p.color}|${p.typeface?.hashCode()}|${p.fontFeatureSettings}|" +
          "${role.name}|${alignment(role)}|${if (role == GlyphRole.PREFIX) prefixOffset else if (role == GlyphRole.SUFFIX) suffixOffset else 0f}|$glyphsKey"
      }
    }

    private fun key(role: GlyphRole): String = roleKeys[role.ordinal]

    fun paint(role: GlyphRole): TextPaint = when (role) {
      GlyphRole.DIGIT -> digit
      GlyphRole.PREFIX -> prefix
      GlyphRole.SUFFIX -> suffix
      GlyphRole.FRACTION -> fraction
    }

    /** The widest digit of [role]'s font (the digits' or the fraction's). */
    fun digitWidth(role: GlyphRole): Float = if (role == GlyphRole.FRACTION) fractionDigitWidth else digitWidth

    fun digitWidths(role: GlyphRole): FloatArray = if (role == GlyphRole.FRACTION) fractionDigitWidths else digitWidths

    /** A [role] digit's baseline, given the top of the digit line box at 0. */
    fun digitBaseline(role: GlyphRole): Float = if (role == GlyphRole.FRACTION) fractionBaseline else -digitMetrics.ascent

    /** The vertical centre of a [role] digit in the line box (a swapping glyph's). */
    fun digitCenterY(role: GlyphRole): Float = if (role == GlyphRole.FRACTION) fractionCenterY else lineHeight / 2f

    // One map per role: a joined "role|text" key allocated a string on every
    // lookup, and the layout looks widths up for every glyph on every frame.
    fun width(text: String, role: GlyphRole): Float =
      widthCache[role.ordinal].getOrPut(text) { paint(role).measureText(text) }

    private val shapedCache = Array(GlyphRole.entries.size) { java.util.concurrent.ConcurrentHashMap<String, ShapedText>() }

    /**
     * [text] of [role] shaped once, for [Canvas.drawGlyphs]: `drawText` runs
     * the text shaper on every call, and an affix or separator drawn every
     * frame for every number on screen cost ~45 us a call on a Galaxy A22,
     * about fifteen times a digit's. The glyphs and positions are the ones
     * `drawText` would produce; the paint's own shaping settings (size,
     * typeface, `tnum`) are fixed for this font set.
     */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.S)
    fun shaped(text: String, role: GlyphRole): ShapedText =
      shapedCache[role.ordinal].getOrPut(text) { ShapedText.of(text, paint(role)) }

    /** Baseline y for `role` drawing `text`, given the top of the digit line box. */
    fun baseline(role: GlyphRole, text: String, lineTop: Float): Float = when (role) {
      GlyphRole.DIGIT -> lineTop - digitMetrics.ascent
      GlyphRole.FRACTION -> alignedBaseline(role, text, lineTop)
      GlyphRole.PREFIX -> alignedBaseline(role, text, lineTop) + prefixOffset
      GlyphRole.SUFFIX -> alignedBaseline(role, text, lineTop) + suffixOffset
    }

    /** Letter spacing after a glyph of [role], in px. */
    fun spacing(role: GlyphRole): Float = when (role) {
      GlyphRole.DIGIT -> digitSpacing
      GlyphRole.PREFIX -> prefixLetterSpacing
      GlyphRole.SUFFIX -> suffixLetterSpacing
      GlyphRole.FRACTION -> fractionLetterSpacing
    }

    private fun alignment(role: GlyphRole): AffixAlign = when (role) {
      GlyphRole.PREFIX -> prefixAlign
      GlyphRole.SUFFIX -> suffixAlign
      GlyphRole.FRACTION -> fractionAlign
      GlyphRole.DIGIT -> AffixAlign.BASELINE
    }

    private fun alignedBaseline(role: GlyphRole, text: String, lineTop: Float): Float {
      val digitBaseline = lineTop - digitMetrics.ascent
      val m = roleMetrics[role.ordinal]
      return when (alignment(role)) {
        AffixAlign.BASELINE -> digitBaseline
        AffixAlign.CENTER -> lineTop + (lineHeight - (m.descent - m.ascent)) / 2f - m.ascent
        AffixAlign.TOP -> lineTop + (-digitMetrics.ascent - capHeight(GlyphRole.DIGIT)) + capHeight(role)
        // Pin the bottom of the ink, not of the line boxes: the digits' ink ends
        // on the baseline, so "USD" sits on it too instead of hanging down to
        // where a comma's tail reaches.
        AffixAlign.BOTTOM -> digitBaseline + inkDescent(allGlyphs, GlyphRole.DIGIT) - inkDescent(text, role)
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
  /**
   * Blurs an ALPHA_8 [mask] in place: three box passes of [radius], which is a
   * Gaussian to the eye with a standard deviation of about the radius.
   */
  private fun boxBlurMask(mask: Bitmap, radius: Int) {
    val w = mask.width
    val h = mask.height
    val stride = mask.rowBytes
    val bytes = java.nio.ByteBuffer.allocate(stride * h)
    mask.copyPixelsToBuffer(bytes)
    val alpha = FloatArray(w * h) { (bytes.get((it / w) * stride + it % w).toInt() and 0xff).toFloat() }
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
    for (i in alpha.indices) bytes.put((i / w) * stride + i % w, Math.round(alpha[i]).coerceIn(0, 255).toByte())
    bytes.rewind()
    mask.copyPixelsFromBuffer(bytes)
  }

  /** System font scale for `allowFontScaling`, capped by `maxFontSizeMultiplier`. */
  private fun systemFontMultiplier(t: Typography): Float {
    if (!t.allowFontScaling) return 1f
    val multiplier = context.resources.configuration.fontScale
    return if (t.maxFontSizeMultiplier > 0f) min(multiplier, t.maxFontSizeMultiplier) else multiplier
  }

  private fun makePaint(t: Typography, sizeDp: Float, color: Int): TextPaint {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
    paint.typeface = makeTypeface(t)
    paint.textSize = sizeDp * density
    paint.color = color
    // Tabular figures unless each digit is laid out at its own width.
    paint.fontFeatureSettings = if (t.tabularNums) "tnum" else "pnum"
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
    var focus: Double = 1.0,
    var grow: Double = 1.0,
    var blurOut: Double = 1.0,
    var progress: Double = 1.0,
    /** Places the wheel wraps after: 10, or fewer on a clock's wheel (`RollingEngine.wheelModulus`). */
    var modulus: Int = 10,
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
    updateMoving()
  }

  /** Fires [onRevealMilestone] for every milestone reached since [reachedBefore]. */
  private fun reportMilestones(reachedBefore: Int) {
    val reached = engine.revealMilestonesReached()
    val listener = onRevealMilestone ?: return
    for (index in reachedBefore until reached) listener(index, engine.revealMilestoneValue(index))
  }
  /** Filtered so a strip window in motion between two pixel rows blends rather than steps. */
  private val stripPaint = Paint(Paint.FILTER_BITMAP_FLAG)
  /** Reused by the resting-wheel draw, which runs for every resting digit on every frame. */
  private val stripSrc = Rect()
  private val stripDst = android.graphics.RectF()
  /** The blurred glyph masks of the numeric transition, filled with the digit colour. */
  private val blurPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
  /** The strip again, in the change flash's colour: its ink replaced by the tint, at the flash's opacity. */
  private val flashStripPaint = Paint(Paint.FILTER_BITMAP_FLAG)
  private var flashStripColor = 0
  /** The change flash's colour for this wheel this frame, or null when it is not flashing. */
  private fun flashColor(wheel: Wheel): Int? =
    if (wheel.flash <= 0.002) null else (if (wheel.flashUp) flash.upColor else flash.downColor)
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
    autoAnchor = null
    awaitingLayout = false
    laidLeft = Int.MIN_VALUE
    laidRight = Int.MIN_VALUE
    lastReportedHeight = -1f
    format = Format()
    typography = Typography()
    timing = Timing()
    shimmer = Shimmer()
    alignment = Alignment.AUTO
    revealMilestones = DoubleArray(0)
    cellWidths.clear()
    leavingText.fill(null)
    moving = false
    // onIntrinsicSizeChange, onRevealEnd, onRevealMilestone and the animation events are the hybrid's
    // wiring, not the element's props: they stay across recycling (the hybrid
    // clears its own callback props).
    invalidate()
  }

  /**
   * Shows [value] immediately with continuously positioned wheels (odometer
   * style). Cancels any running roll. Intended to be called every frame.
   */
  fun setValue(value: Double) {
    val sign = signBefore()
    engine.setValue(value)
    swapSignIfChanged(sign)
    reportIntrinsicSize()
    scheduleFrameIfNeeded()
    invalidate()
    updateMoving()
  }

  /** Rolls every wheel to [value] (snaps on first show, duration 0 or "remove animations"). */
  fun animateTo(value: Double) {
    applyReduceMotion()
    val sign = signBefore()
    engine.animateTo(value, now())
    swapSignIfChanged(sign)
    reportIntrinsicSize()
    scheduleFrameIfNeeded()
    invalidate()
    updateMoving()
  }

  /**
   * Shows the opening frame of a jackpot reveal for [value] ("$0.00" in the
   * target's layout), waiting for [reveal].
   */
  fun holdReveal(value: Double) {
    val sign = signBefore()
    engine.holdReveal(value)
    swapSignIfChanged(sign)
    reportIntrinsicSize()
    scheduleFrameIfNeeded()
    invalidate()
  }

  /** Counts up from 0 to [value] and lands with a pop (snaps when animations are off). */
  fun reveal(value: Double) {
    applyReduceMotion()
    val sign = signBefore()
    engine.reveal(value, now())
    swapSignIfChanged(sign)
    reportIntrinsicSize()
    scheduleFrameIfNeeded()
    invalidate()
    updateMoving()
    reportMilestones(0)
    // Snapped (animations off / duration 0): the reveal is over before it began.
    if (!engine.isRevealing()) onRevealEnd?.invoke()
  }

  /** Snaps while animations are removed, unless told not to (`respectReduceMotion`). */
  private fun applyReduceMotion() {
    engine.setReduceMotion(timing.respectReduceMotion && animationsDisabled())
  }

  /** The sign glyph on screen before a change, if one is. */
  private fun signBefore(): String? {
    if (!engine.hasShownValue() || engine.signFactor() <= 0.0) return null
    return if (engine.signPositive()) format.plusSign else format.minusSign
  }

  /**
   * A plus that turns into a minus (or back) swaps like any text: the old
   * one softens away as the new one comes into focus.
   */
  private fun swapSignIfChanged(before: String?) {
    if (before == null) return
    val after = if (engine.signPositive()) format.plusSign else format.minusSign
    if (after == before) return
    leavingText[TEXT_SIGN] = before
    engine.changeText(TEXT_SIGN, now())
  }

  /**
   * Fires [onAnimationStart] when a roll or a reveal sets off from rest and
   * [onAnimationEnd] when the figure is still again, once for a run of changes.
   */
  private fun updateMoving() {
    val now = engine.isRolling() || engine.isRevealing()
    if (now == moving) return
    moving = now
    if (now) onAnimationStart?.invoke() else onAnimationEnd?.invoke(engine.targetValue())
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

  /** Reused per frame so the JNI hop never allocates (room for far more wheels than the engine's 18), then the text slots. */
  private val frameBuffer = DoubleArray(4 + WHEEL_FIELDS * 32 + 4 * TEXT_SLOTS + 2)

  // The decimal columns laid out now (more than the format's while dropped
  // ones close) and the decimal separator's factor.
  private var displayFractionDigits = 0
  private var decimalFactor = 1.0

  // Each text slot's swap (prefix, suffix, grouping, decimal, sign): the text
  // leaving, and the engine's clocks for it.
  private val leavingText = arrayOfNulls<String>(TEXT_SLOTS)
  private val textGrow = DoubleArray(TEXT_SLOTS) { 1.0 }
  private val textFocus = DoubleArray(TEXT_SLOTS) { 1.0 }
  private val textBlurOut = DoubleArray(TEXT_SLOTS) { 1.0 }
  private val textActive = BooleanArray(TEXT_SLOTS)

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
      val base = 4 + i * WHEEL_FIELDS
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
      w.focus = f[base + 10]
      w.grow = f[base + 11]
      w.blurOut = f[base + 12]
      w.progress = f[base + 13]
      w.modulus = f[base + 14].toInt()
    }
    val text = 4 + count * WHEEL_FIELDS
    for (slot in 0 until TEXT_SLOTS) {
      textGrow[slot] = f[text + slot * 4]
      textFocus[slot] = f[text + slot * 4 + 1]
      textBlurOut[slot] = f[text + slot * 4 + 2]
      textActive[slot] = f[text + slot * 4 + 3] != 0.0
      if (!textActive[slot]) leavingText[slot] = null
    }
    displayFractionDigits = f[text + TEXT_SLOTS * 4].toInt()
    decimalFactor = f[text + TEXT_SLOTS * 4 + 1]
  }

  // endregion

  // region Typography

  private fun rebuildFonts() {
    fonts = FontSet(typography)
    cellWidths.clear()
    warmSwapMasks()
    fontScale = 1f
    if (engine.hasShownValue()) reportIntrinsicSize()
    invalidate()
  }

  /**
   * Renders the numeric transition's glyph masks, every digit at every blur
   * level, on a background thread before they are needed. Made on demand, a
   * change's first frames each paid for a few software blurs on the UI
   * thread and ran late; iOS warms its images the same way.
   */
  private fun warmSwapMasks() {
    if (timing.transition != Transition.NUMERIC) return
    val set = fonts
    val fraction = format.fractionDigits > 0
    WarmExecutor.execute {
      for (digit in 0..9) for (level in 0..NUMERIC_BLUR_LEVELS) set.blurred(GlyphRole.DIGIT, digit, level)
      if (fraction) for (digit in 0..9) for (level in 0..NUMERIC_BLUR_LEVELS) set.blurred(GlyphRole.FRACTION, digit, level)
    }
  }

  /** One background thread for warming glyph masks, shared by every view. */
  private object WarmExecutor : java.util.concurrent.Executor {
    private val pool = java.util.concurrent.Executors.newSingleThreadExecutor { r -> Thread(r, "NitroNumberWarm").apply { isDaemon = true; priority = Thread.MIN_PRIORITY } }
    override fun execute(command: Runnable) = pool.execute(command)
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
    /** A text slot swapping: its slot, the text leaving, and the side it keeps to (-1 left, 0 centre, 1 right). */
    var slot = -1
    var fromText: String? = null
    var anchor = 1
    /** Space after the cell (letter spacing, or an affix seam), scaled with it; not part of the glyph's box. */
    var gap = 0f
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
      for (i in 0 until size) total += items[i].width + items[i].gap
      return total
    }
  }

  /** Lays the run out into [out] (emptied first). */
  private fun buildElements(fonts: FontSet, wheels: List<Wheel>, signFactor: Double, out: ElementList, animated: Boolean = true) {
    out.clear()
    val fd = if (animated) displayFractionDigits else format.fractionDigits
    val decimal = if (animated) decimalFactor else 1.0

    fun addGlyph(text: String, role: GlyphRole, factor: Double, slot: Int = -1, anchor: Int = 1) {
      if (factor <= 0.0) return
      // A slot swapping its text: the width eases from the old text's to the new one's.
      val from = if (animated && slot >= 0 && textActive[slot]) leavingText[slot] else null
      if (from != null && from != text) {
        val g = textGrow[slot].coerceIn(0.0, 1.0)
        val fromWidth = fonts.width(from, role)
        val toWidth = if (text.isEmpty()) 0f else fonts.width(text, role)
        val e = out.next()
        e.wheelIndex = -1
        e.text = text
        e.role = role
        e.width = ((fromWidth + (toWidth - fromWidth) * g) * factor).toFloat()
        e.fullWidth = max(fromWidth, toWidth)
        e.factor = factor
        e.slot = slot
        e.fromText = from
        e.anchor = anchor
        return
      }
      if (text.isEmpty()) return
      val width = fonts.width(text, role)
      val e = out.next()
      e.wheelIndex = -1
      e.text = text
      e.role = role
      e.width = (width * factor).toFloat()
      e.fullWidth = width
      e.factor = factor
      e.slot = -1
      e.fromText = null
      e.anchor = 1
    }

    // Under a right-to-left layout the prefix belongs at the start edge - the
    // right - and the suffix at the end, while the digits stay a left-to-right
    // run: a number reads the same way in every script. So the run is laid out
    // block by block in mirror order, each block keeping its own order, and the
    // space an affix keeps against the digits stays against them: " USD" after
    // the number is "USD " before it.
    val rtl = isRtl
    if (affixBlocksDirty || affixRtl != rtl) updateAffixBlocks(rtl)
    val signGlyph = if (engine.signPositive()) format.plusSign else format.minusSign
    // A swapping affix keeps to the digits' side; a separator is centred.
    if (rtl) {
      addGlyph(suffixInk, GlyphRole.SUFFIX, 1.0, TEXT_SUFFIX, anchor = 1)
      addGlyph(suffixGap, GlyphRole.SUFFIX, 1.0)
    } else {
      // Sign first, then the currency prefix: "-$1,234.50".
      addGlyph(signGlyph, GlyphRole.DIGIT, signFactor, TEXT_SIGN, anchor = 1)
      addGlyph(prefixInk, GlyphRole.PREFIX, 1.0, TEXT_PREFIX, anchor = 1)
    }
    // Settled, and throughout a reveal (whose layout is the target's from the
    // first frame), a proportional digit takes its target digit's width.
    val targetWidths = fonts.proportional && (!animated || engine.isRevealing())
    for (power in wheels.indices.reversed()) {
      val wheel = wheels[power]
      if (wheel.width > 0.0) {
        val e = out.next()
        // The fraction digits draw in their own font and colour.
        val role = if (power < fd) GlyphRole.FRACTION else GlyphRole.DIGIT
        val advance = digitAdvance(wheel, power, role, fonts, targetWidths)
        e.wheelIndex = power
        e.text = null
        e.role = role
        e.width = (advance * wheel.width).toFloat()
        e.fullWidth = advance
        e.factor = wheel.width
        e.slot = -1
        e.fromText = null
      }
      if (power > fd && isGroupBoundary(power - fd, format.groupingSizes)) addGlyph(format.groupingSeparator, GlyphRole.DIGIT, wheel.width, TEXT_GROUPING, anchor = 0)
      if (fd > 0 && power == fd) addGlyph(format.decimalSeparator, GlyphRole.FRACTION, decimal, TEXT_DECIMAL, anchor = 0)
    }
    if (rtl) {
      addGlyph(prefixGap, GlyphRole.PREFIX, 1.0)
      addGlyph(prefixInk, GlyphRole.PREFIX, 1.0, TEXT_PREFIX, anchor = -1)
      addGlyph(signGlyph, GlyphRole.DIGIT, signFactor, TEXT_SIGN, anchor = -1)
    } else {
      addGlyph(suffixInk, GlyphRole.SUFFIX, 1.0, TEXT_SUFFIX, anchor = -1)
    }
    applySpacing(fonts, out)
  }

  /**
   * Whether a grouping separator follows the [k]th integer digit counted from
   * the decimal point: every three by default, or [sizes] (the first group,
   * then each later one: [3, 2] is 12,34,567). A size of 0 is none.
   */
  private fun isGroupBoundary(k: Int, sizes: List<Int>): Boolean {
    val primary = if (sizes.isEmpty()) 3 else sizes[0]
    if (primary <= 0 || k < primary) return false
    val secondary = if (sizes.size > 1) sizes[1] else primary
    if (secondary <= 0) return k == primary
    return (k - primary) % secondary == 0
  }

  /**
   * A wheel's cell width at full size: the widest digit's with tabular
   * figures; otherwise its digit's own advance, blended between the two digits
   * it is passing through (a roll between them, or a swap), or the target
   * digit's when [target] is set.
   */
  private fun digitAdvance(wheel: Wheel, power: Int, role: GlyphRole, fonts: FontSet, target: Boolean): Float {
    if (!fonts.proportional) return fonts.digitWidth(role)
    val widths = fonts.digitWidths(role)
    val digit = engine.targetDigit(power).coerceIn(0, 9)
    val goal = widths[digit]
    if (target) return goal
    // The width eases once, from where the column was to its target digit's,
    // on the wheel's own progress: following the digits it rolled past made
    // every column pulse as a narrow 1 went by.
    var cell = cellWidths[power]
    if (cell == null) {
      cell = CellWidth()
      cellWidths[power] = cell
      cell.progress = 1.0
      cell.digit = -1
      cell.role = role
    }
    if (cell.role != role) {
      // A column that became a fraction digit (or stopped being one) starts over in its new font.
      cell.from = 0f
      cell.shown = 0f
      cell.digit = -1
      cell.progress = 1.0
      cell.role = role
    }
    if (cell.digit != digit || wheel.progress < cell.progress) {
      // Interrupted mid-change, it carries on from what it showed; from rest,
      // from the digit the wheel is leaving.
      cell.from = if (cell.digit >= 0 && cell.progress < 1.0) cell.shown else restingWidth(wheel, widths, goal)
      cell.digit = digit
    }
    cell.progress = wheel.progress
    cell.shown = cell.from + (goal - cell.from) * wheel.progress.toFloat().coerceIn(0f, 1f)
    return cell.shown
  }

  /** The width of the digit a wheel shows at the start of a change (blank takes the target's). */
  private fun restingWidth(wheel: Wheel, widths: FloatArray, goal: Float): Float {
    val glyph = if (wheel.blend < 1.0) {
      wheel.fromGlyph.toInt()
    } else {
      val position = if (wheel.linear) wheel.position else wrap(wheel.position, wheel.modulus)
      Math.round(position).toInt() % wheel.modulus
    }
    return if (glyph >= 0) widths[glyph % 10] else goal
  }

  /** A proportional column's width through a change, by place value. */
  private class CellWidth(var from: Float = 0f, var shown: Float = 0f, var digit: Int = -1, var progress: Double = 1.0, var role: GlyphRole = GlyphRole.DIGIT)

  private val cellWidths = HashMap<Int, CellWidth>()

  /**
   * Letter spacing after every cell, and the affix seams: the space between
   * the prefix and the digits and between the digits and the suffix.
   */
  private fun applySpacing(fonts: FontSet, out: ElementList) {
    for (i in 0 until out.size) out[i].gap = 0f
    if (fonts.digitSpacing == 0f && fonts.prefixSeam == null && fonts.suffixSeam == null) return
    // A wheel's role is its font's: a fraction digit is spaced like the fraction.
    for (i in 0 until out.size) out[i].gap = fonts.spacing(out[i].role) * out[i].factor.toFloat()
    // The seam is the gap at the affix's edge that faces the digits (the far side in RTL).
    var firstPrefix = -1
    var lastPrefix = -1
    var firstSuffix = -1
    var lastSuffix = -1
    for (i in 0 until out.size) {
      when (out[i].role) {
        GlyphRole.PREFIX -> { if (firstPrefix < 0) firstPrefix = i; lastPrefix = i }
        GlyphRole.SUFFIX -> { if (firstSuffix < 0) firstSuffix = i; lastSuffix = i }
        GlyphRole.DIGIT, GlyphRole.FRACTION -> Unit
      }
    }
    val rtl = isRtl
    fonts.prefixSeam?.let { seam ->
      if (!rtl && lastPrefix >= 0) out[lastPrefix].gap = seam
      else if (rtl && firstPrefix > 0) out[firstPrefix - 1].gap = seam
    }
    fonts.suffixSeam?.let { seam ->
      if (!rtl && firstSuffix > 0) out[firstSuffix - 1].gap = seam
      else if (rtl && lastSuffix >= 0) out[lastSuffix].gap = seam
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

  /**
   * `AUTO` resolved: in a box that hugs the figure, the edge the box kept the
   * last time it changed width (see [learnAnchor]), else the start edge of
   * the layout direction. The rest are already absolute.
   */
  private val resolvedAlignment: Alignment
    get() {
      if (alignment != Alignment.AUTO) return alignment
      val anchor = autoAnchor
      if (anchor != null && hugsFigure()) return anchor
      return if (isRtl) Alignment.RIGHT else Alignment.LEFT
    }

  /**
   * A box that hugs the figure is as wide as the figure at rest, so its
   * alignment only shows while the figure grows or shrinks: the box takes the
   * new width at once and the digits open or close inside it. Which edge they
   * keep to is the edge the parent keeps the box to: a figure at the end of a
   * row (`justifyContent: 'space-between'`) keeps its right edge, and
   * start-aligned it jumped a digit to the left and then opened a gap after
   * its prefix. So `AUTO` follows the box: the edge that stayed put when its
   * width last changed, both for a centred box.
   */
  private var autoAnchor: Alignment? = null
  private var laidLeft = Int.MIN_VALUE
  private var laidRight = Int.MIN_VALUE

  /**
   * A size reported and not yet laid out by React: for a frame or two the box
   * still has the old width. Counted as hugging, or a shrinking figure fell
   * back to the start edge for those frames and flashed across the box.
   */
  private var awaitingLayout = false

  private fun hugsFigure(): Boolean =
    lastReportedWidth > 0f && (awaitingLayout || abs(width - lastReportedWidth * density) <= density)

  private fun learnAnchor(left: Int, right: Int) {
    val previousLeft = laidLeft
    val previousRight = laidRight
    laidLeft = left
    laidRight = right
    if (previousLeft == Int.MIN_VALUE || right - left == previousRight - previousLeft) return
    val tolerance = 1
    val dl = left - previousLeft
    val dr = right - previousRight
    autoAnchor = when {
      abs(dl) <= tolerance -> Alignment.LEFT
      abs(dr) <= tolerance -> Alignment.RIGHT
      abs(dl + dr) <= 2 * tolerance -> Alignment.CENTER
      else -> autoAnchor
    }
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    if (awaitingLayout && abs((right - left) - lastReportedWidth * density) <= density) awaitingLayout = false
    learnAnchor(left, right)
  }

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
    buildElements(fonts, settledWheels, if (engine.settledNegative()) 1.0 else 0.0, settledElements, animated = false)
    return settledElements.totalWidth()
  }

  /** Formats the target the way it is displayed, for TalkBack. */
  private fun accessibleText(): String {
    val fd = format.fractionDigits
    val sb = StringBuilder()
    // Any sign the settled figure carries, a plus included; Latin digits, whatever the glyphs.
    if (engine.settledNegative()) sb.append(if (engine.signPositive()) format.plusSign else format.minusSign)
    sb.append(format.prefix)
    for (power in engine.settledPowerCount() - 1 downTo 0) {
      sb.append(engine.targetDigit(power))
      if (power > fd && isGroupBoundary(power - fd, format.groupingSizes)) sb.append(format.groupingSeparator)
      if (fd > 0 && power == fd) sb.append(format.decimalSeparator)
    }
    sb.append(format.suffix)
    return sb.toString()
  }

  /** An `accessibilityLabel` the app set, which TalkBack reads instead of the figure. */
  private var explicitDescription: CharSequence? = null

  override fun setContentDescription(contentDescription: CharSequence?) {
    explicitDescription = contentDescription
    super.setContentDescription(contentDescription)
  }

  // TalkBack reads the settled figure when it asks for it, so a value update
  // (which can come every frame) formats nothing.
  override fun getContentDescription(): CharSequence? {
    explicitDescription?.let { if (it.isNotEmpty()) return it }
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
    // Only a box that hugged the old size will follow the new one.
    awaitingLayout = lastReportedWidth > 0f && abs(width - lastReportedWidth * density) <= density
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
        drawWheel(canvas, fonts, wheels[element.wheelIndex], element.role, x, element.width, element.fullWidth, originX, originY, scale)
      } else if (element.fromText != null) {
        drawTextSwap(canvas, fonts, element, x)
      } else if (text != null) {
        drawGlyph(canvas, fonts, text, element.role, x, element.width, element.fullWidth, element.factor)
      }
      x += element.width + element.gap
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

  private fun drawGlyph(canvas: Canvas, fonts: FontSet, text: String, role: GlyphRole, x: Float, width: Float, fullWidth: Float, factor: Double) {
    if (width <= 0f) return
    val paint = fonts.paint(role)
    // A full cell needs no clip: the clip only matters while it opens or
    // closes. Skipping it saves the render thread a save, a clip and a
    // restore per separator and affix on every frame.
    val full = width >= fullWidth
    if (!full) canvas.save()
    // An opening or closing cell (a separator, the sign) keeps its glyph whole
    // against the text it joins and fades with the cell; see [openingAlpha].
    if (!full) canvas.clipRect(x + width - fullWidth, 0f, x + width, fonts.lineHeight)
    // The paint is shared and its alpha is the ink colour's: scale it for this
    // draw and put it back. Left faded, the next frame's digits inherited it
    // (a separator easing in drew them invisible), and set to 255 a
    // translucent colour turned opaque.
    val ink = paint.alpha
    paint.alpha = (openingAlpha(factor) * ink).toInt().coerceIn(0, 255)
    val left = x + width - fullWidth
    val baseline = fonts.baseline(role, text, 0f)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      glyphPositions = fonts.shaped(text, role).draw(canvas, left, baseline, paint, glyphPositions)
    } else {
      canvas.drawText(text, left, baseline, paint)
    }
    paint.alpha = ink
    if (!full) canvas.restore()
  }

  /** Scratch for [ShapedText.draw]: positions offset to where a glyph run lands. */
  private var glyphPositions = FloatArray(16)

  /**
   * [originX], [originY] and [scale] are the content transform already on the
   * canvas, so the strip window can be landed on whole device pixels.
   */
  private fun drawWheel(canvas: Canvas, fonts: FontSet, wheel: Wheel, role: GlyphRole, x: Float, width: Float, advance: Float, originX: Float, originY: Float, scale: Float) {
    if (width <= 0f) return
    val lineHeight = fonts.lineHeight
    val column = fonts.digitWidth(role)
    val modulus = wheel.modulus
    // The digit column, the widest digit wide, centred on the digit's own cell
    // (with tabular figures the two are the same, right-aligned in the cell).
    val columnLeft = x + width - (advance + column) / 2f
    if (wheel.blend < 1.0 || wheel.focus < 1.0 || wheel.grow < 1.0) {
      drawSwap(canvas, fonts, wheel, role, columnLeft, originX, originY, scale)
      return
    }
    // A settled-width wheel is a window onto the shared strip (the strip has
    // no per-wheel alpha, so a wheel still growing or shrinking, and any
    // canvas without a GPU, which cannot draw a hardware bitmap, draws its
    // two glyphs the old way).
    if (wheel.width >= 1.0 && canvas.isHardwareAccelerated) {
      val strip = fonts.strip(role, wheel.blankZero, modulus)
      if (strip != null) {
        // An interior wheel wraps modulo its places (10, a clock's 6),
        // negatives included (rolling down through 0 shows 9); a linear wheel
        // never wraps and uses -1 for the blank slot. Either way the window
        // lands inside the strip.
        val position = if (wheel.linear) wheel.position.coerceIn(-1.0, modulus.toDouble()) else wrap(wheel.position, modulus)
        var tx = columnLeft
        var ty = (-(position + 1) * lineHeight).toFloat()
        if (scale == 1f && position == floor(position)) {
          // At rest, land the window on whole device pixels: composited at a
          // fractional offset (a centred number, a fractional digit width) the
          // layer is resampled and a small digit goes soft. In motion the
          // fractional offsets are the motion, and stay.
          tx = Math.round(originX + tx) - originX
          ty = Math.round(originY + ty) - originY
        }
        if (position == floor(position)) {
          // At rest the window shows exactly one slot of the strip: draw that
          // slot alone, one operation where the window took five (save, clip,
          // translate, the strip, restore). The same bitmap on the same
          // pixels; the clip only ever cut transparent rows. With ~50 numbers
          // on screen the render thread replays these for every resting digit
          // on every frame, and most digits of a busy screen are resting.
          val slot = (position + 1).toInt()
          val lh = lineHeight
          stripSrc.set(0, Math.round(slot * lh), strip.bitmap.width, Math.round((slot + 1) * lh))
          val top = ty + slot * lh
          stripDst.set(tx, top, tx + strip.bitmap.width, top + (stripSrc.bottom - stripSrc.top))
          canvas.drawBitmap(strip.bitmap, stripSrc, stripDst, stripPaint)
          flashColor(wheel)?.let { color ->
            if (flashStripColor != color) {
              flashStripPaint.colorFilter = PorterDuffColorFilter(color, PorterDuff.Mode.SRC_IN)
              flashStripColor = color
            }
            flashStripPaint.alpha = (wheel.flash * 255).toInt().coerceIn(0, 255)
            canvas.drawBitmap(strip.bitmap, stripSrc, stripDst, flashStripPaint)
          }
          return
        }
        canvas.save()
        canvas.clipRect(columnLeft, 0f, columnLeft + column, lineHeight)
        canvas.translate(tx, ty)
        if (strip.node != null) canvas.drawRenderNode(strip.node) else canvas.drawBitmap(strip.bitmap, 0f, 0f, stripPaint)
        // The change flash rides the roll: the strip once more, in the tint, at the same offset.
        flashColor(wheel)?.let { color ->
          if (flashStripColor != color) {
            flashStripPaint.colorFilter = PorterDuffColorFilter(color, PorterDuff.Mode.SRC_IN)
            flashStripColor = color
          }
          flashStripPaint.alpha = (wheel.flash * 255).toInt().coerceIn(0, 255)
          canvas.drawBitmap(strip.bitmap, 0f, 0f, flashStripPaint)
        }
        canvas.restore()
        return
      }
    }
    val baseline = fonts.digitBaseline(role)
    canvas.save()
    // The roll's window, the whole digit wide: a column still opening or
    // closing is not cut to its width (the glyph read as a sliver of its right
    // edge, a ")" of a 0 rolling past), it overhangs the cell's far side, faded.
    canvas.clipRect(columnLeft, 0f, columnLeft + column, lineHeight)
    val position = if (wheel.linear) wheel.position else wrap(wheel.position, modulus)
    val base = floor(position)
    val fraction = (position - base).toFloat()
    val index = base.toInt()
    fun glyphs(paint: TextPaint, alpha: Float) {
      // Scaled from the ink colour's alpha and put back (see [drawGlyph]).
      val ink = paint.alpha
      paint.alpha = (alpha * ink).toInt().coerceIn(0, 255)
      glyphAt(index, wheel, fonts)?.let { glyph ->
        canvas.drawText(glyph, columnLeft + (column - fonts.width(glyph, role)) / 2f, baseline - fraction * lineHeight, paint)
      }
      if (fraction > 0.0001f) {
        glyphAt(index + 1, wheel, fonts)?.let { glyph ->
          canvas.drawText(glyph, columnLeft + (column - fonts.width(glyph, role)) / 2f, baseline + (1f - fraction) * lineHeight, paint)
        }
      }
      paint.alpha = ink
    }
    val opening = openingAlpha(wheel.width).toFloat()
    glyphs(fonts.paint(role), opening)
    // The change flash rides the roll: the same glyphs again, in the tint.
    flashColor(wheel)?.let { color -> glyphs(fonts.tinted(color, role), wheel.flash.toFloat() * opening) }
    canvas.restore()
  }

  /**
   * The numeric transition: the leaving glyph and the arriving one, each
   * scaled about its centre, offset along the axis, faded, and cross-faded
   * with its blurred bitmap as it goes out of, or comes into, focus; the
   * geometry is `RollingEngine.hpp`'s. Not clipped to the cell: a blurred
   * glyph's haze reaches past it, and cut at the cell it read as a pale box
   * around the digit. With a change flash on, the pair is drawn again in
   * the tint at the flash's opacity: the ink mixed towards the tint.
   */
  private fun drawSwap(canvas: Canvas, fonts: FontSet, wheel: Wheel, role: GlyphRole, columnLeft: Float, originX: Float, originY: Float, scale: Float) {
    drawSwapPair(canvas, fonts, wheel, role, columnLeft, fonts.paint(role), 1f, originX, originY, scale)
    flashColor(wheel)?.let { color -> drawSwapPair(canvas, fonts, wheel, role, columnLeft, fonts.tinted(color, role), wheel.flash.toFloat(), originX, originY, scale) }
  }

  /**
   * [originX], [originY] and [scale] are the content transform on the canvas.
   * Each glyph's bitmap is landed on whole device pixels: a sharp bitmap
   * drawn between pixels is resampled, and as it crept along the spring's
   * tail it cycled crisp and soft once per pixel of travel, a shimmer that a
   * blurred copy hides and a lightly blurred one does not. Landed, the last
   * swap frame is pixel for pixel the strip that takes over from it.
   */
  private fun drawSwapPair(canvas: Canvas, fonts: FontSet, wheel: Wheel, role: GlyphRole, columnLeft: Float, paint: TextPaint, opacity: Float, originX: Float, originY: Float, scale: Float) {
    val lineHeight = fonts.lineHeight
    // The position clock overshoots 1 (a spring); only the offsets follow it there.
    val b = wheel.blend.toFloat()
    val gRaw = wheel.grow.toFloat().coerceIn(0f, 1f)
    // Within a percent of full size the glyph is drawn at full size: scaled by
    // 0.995 it is resampled all over, and the last percent is a pixel.
    val g = if (gRaw > 0.99f) 1f else gRaw
    val f = wheel.focus.toFloat().coerceIn(0f, 1f)
    val d = if (wheel.fromAbove) 1f else -1f
    val offset = lineHeight * NUMERIC_OFFSET
    val cell = fonts.digitWidth(role)
    val cx = columnLeft + cell / 2f
    // A fraction digit scales about its own centre, not the line box's.
    val cy = fonts.digitCenterY(role)
    val column = wheel.width.toFloat().coerceIn(0f, 1f) * opacity
    val from = wheel.fromGlyph.toInt()
    val to = wheel.toGlyph.toInt()
    // The bitmap's top-left sits at (centre - cell / 2 - pad, centre - centreY - pad); land that on a pixel.
    val cornerX = cell / 2f + fonts.blurPad
    val cornerY = cy + fonts.blurPad
    fun snapX(c: Float): Float = (Math.round(originX + (c - cornerX) * scale) - originX) / scale + cornerX
    fun snapY(c: Float): Float = (Math.round(originY + (c - cornerY) * scale) - originY) / scale + cornerY
    if (from >= 0) {
      drawSwapGlyph(canvas, fonts, paint, role, from % 10, snapX(cx), snapY(cy + d * offset * b), 1f - (1f - NUMERIC_SCALE) * g, (1f - g) * column, wheel.blurOut.toFloat().coerceIn(0f, 1f))
    }
    if (to >= 0) {
      drawSwapGlyph(canvas, fonts, paint, role, to % 10, snapX(cx), snapY(cy - d * offset * (1f - b)), NUMERIC_SCALE + (1f - NUMERIC_SCALE) * g, g * column, 1f - f)
    }
  }

  /**
   * One glyph of a swap: the two blur levels nearest [blur] (of
   * [NUMERIC_BLUR_LEVELS], level 0 the sharp text), cross-faded by where
   * between them it falls, so a glyph half out of focus is half-blurred
   * rather than a sharp glyph half-hidden in a fully blurred one, which read
   * as a digit inside a glow.
   */
  private fun drawSwapGlyph(canvas: Canvas, fonts: FontSet, paint: TextPaint, role: GlyphRole, digitIndex: Int, cx: Float, cy: Float, scale: Float, alpha: Float, blur: Float) {
    if (alpha <= 0.002f) return
    val text = fonts.glyphs[digitIndex]
    // The mask is the whole line box; its origin is this far above the glyph's centre.
    val centerY = fonts.digitCenterY(role)
    val x = blur.coerceIn(0f, 1f) * NUMERIC_BLUR_LEVELS
    val lo = min(NUMERIC_BLUR_LEVELS, floor(x).toInt())
    val hi = min(NUMERIC_BLUR_LEVELS, lo + 1)
    val w = if (lo == NUMERIC_BLUR_LEVELS) 0f else x - lo
    // The two levels composite "over", which is not additive: drawn at
    // (1 - w) and w they came out only 75 % opaque half way between levels,
    // and the digit pulsed paler and darker at every level crossing. The
    // upper one is drawn at its share, w, of the opacity, and the lower one
    // at whatever makes the pair composite to the whole of it.
    val hiAlpha = alpha * w
    val loAlpha = if (hiAlpha >= 0.999f) 0f else alpha * (1f - w) / (1f - hiAlpha)
    canvas.save()
    canvas.translate(cx, cy)
    canvas.scale(scale, scale)
    for ((level, levelAlpha) in arrayOf(lo to loAlpha, hi to hiAlpha)) {
      if (levelAlpha <= 0.002f) continue
      val mask = fonts.blurred(role, digitIndex, level)
      if (mask == null) {
        // No font metrics yet: the text itself.
        val ink = paint.alpha
        paint.alpha = (levelAlpha * ink).toInt().coerceIn(0, 255)
        canvas.drawText(text, -fonts.width(text, role) / 2f, fonts.digitBaseline(role) - centerY, paint)
        paint.alpha = ink
      } else {
        // An alpha mask draws in the paint's colour; the ink's own alpha scales with the level's.
        blurPaint.color = paint.color
        blurPaint.alpha = (levelAlpha * (paint.color ushr 24)).toInt().coerceIn(0, 255)
        canvas.drawBitmap(mask, -fonts.digitWidth(role) / 2f - fonts.blurPad, -centerY - fonts.blurPad, blurPaint)
      }
    }
    canvas.restore()
  }

  /**
   * A prefix, suffix or separator changing its text, drawn like a swapping
   * digit without the travel: the old text blurs and fades out as the new one
   * comes into focus, each kept to the side of the cell that faces the digits
   * (a separator centred). Not clipped: the blur's haze reaches past the cell.
   */
  private fun drawTextSwap(canvas: Canvas, fonts: FontSet, element: Element, x: Float) {
    val slot = element.slot
    val g = textGrow[slot].toFloat().coerceIn(0f, 1f)
    val opening = openingAlpha(element.factor).toFloat()
    fun left(text: String): Float {
      val w = fonts.width(text, element.role)
      return when (element.anchor) {
        -1 -> x
        0 -> x + (element.width - w) / 2f
        else -> x + element.width - w
      }
    }
    element.fromText?.let { from ->
      if (from.isNotEmpty()) drawBlurredText(canvas, fonts, from, element.role, left(from), (1f - g) * opening, textBlurOut[slot].toFloat())
    }
    element.text?.let { to ->
      if (to.isNotEmpty()) drawBlurredText(canvas, fonts, to, element.role, left(to), g * opening, 1f - textFocus[slot].toFloat())
    }
  }

  /** [text] at [left], faded to [alpha] and blurred by [blur] (0…1), the two nearest levels cross-faded as a digit's are. */
  private fun drawBlurredText(canvas: Canvas, fonts: FontSet, text: String, role: GlyphRole, left: Float, alpha: Float, blur: Float) {
    if (alpha <= 0.002f) return
    val levels = blur.coerceIn(0f, 1f) * NUMERIC_BLUR_LEVELS
    val lo = min(NUMERIC_BLUR_LEVELS, floor(levels).toInt())
    val hi = min(NUMERIC_BLUR_LEVELS, lo + 1)
    val w = if (lo == NUMERIC_BLUR_LEVELS) 0f else levels - lo
    val hiAlpha = alpha * w
    val loAlpha = if (hiAlpha >= 0.999f) 0f else alpha * (1f - w) / (1f - hiAlpha)
    val paint = fonts.paint(role)
    val pad = fonts.blurPad.toFloat()
    for ((level, levelAlpha) in arrayOf(lo to loAlpha, hi to hiAlpha)) {
      if (levelAlpha <= 0.002f) continue
      val mask = fonts.blurredText(text, role, level) ?: continue
      blurPaint.color = paint.color
      blurPaint.alpha = (levelAlpha * (paint.color ushr 24)).toInt().coerceIn(0, 255)
      canvas.drawBitmap(mask, left - pad, -pad, blurPaint)
    }
  }

  /**
   * Opacity of a cell [width] open (0…1). Squared, so while a glyph
   * overhangs a narrow cell the overlap stays faint.
   */
  private fun openingAlpha(width: Double): Double {
    val w = width.coerceIn(0.0, 1.0)
    return w * w
  }

  private fun glyphAt(index: Int, wheel: Wheel, fonts: FontSet): String? {
    if (wheel.linear && index < 0) return null
    if (wheel.blankZero && index == 0) return null
    val m = wheel.modulus
    return fonts.glyphs[((index % m) + m) % m]
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
    moving = false
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

  /** Interior wheels wrap modulo their places (10, a clock's 6); a roll can be any real, so fold it onto 0 ≤ p < [modulus]. */
  private fun wrap(position: Double, modulus: Int): Double {
    val m = modulus.toDouble()
    val r = position % m
    return if (r < 0) r + m else r
  }

  /** A digit strip: the software-rendered bitmap and, from Android 10, the layer that holds it. */
  class Strip(val bitmap: Bitmap, val node: RenderNode?)

  /** The blurred digit bitmaps of the numeric transition, shared like the strips and bounded the same way. */
  /**
   * The blurred glyph masks every rolling number shares, least recently used
   * dropped first once they pass [BUDGET] bytes. Bounded by size, not count:
   * a numeric screen in a few fonts and colours uses hundreds of masks (ten
   * digits at seven levels each), and a count of 256 dropped masks another
   * figure was about to ask for again. Alpha masks are small, so the budget
   * holds thousands.
   */
  private object BlurredGlyphCache {
    private const val BUDGET = 16L shl 20
    private val entries = LinkedHashMap<String, Bitmap>(64, 0.75f, true)
    private var bytes = 0L

    @Synchronized
    fun get(key: String, make: () -> Bitmap): Bitmap {
      entries[key]?.let { return it }
      val bitmap = make()
      entries[key] = bitmap
      bytes += bitmap.allocationByteCount
      val eldest = entries.entries.iterator()
      while (bytes > BUDGET && eldest.hasNext()) {
        val entry = eldest.next()
        if (entry.value === bitmap) break
        bytes -= entry.value.allocationByteCount
        eldest.remove()
      }
      return bitmap
    }
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
    /** The glyphs drawn for 0…9 unless `digitGlyphs` gives ten others. */
    private val DIGITS = Array(10) { it.toString() }
    /** Flash paints a font set keeps per role (a change flash has an up and a down colour). */
    private const val TINT_SLOTS = 4

    /** Which strip a wheel draws from, as one comparable number. */
    private fun stripVariant(role: GlyphRole, blankZero: Boolean, modulus: Int): Int =
      (if (blankZero) 1 else 0) or (modulus shl 1) or (if (role == GlyphRole.FRACTION) 1 shl 8 else 0)
    /** The core starts at the glyphs' left edge instead of parked off-screen. */
    private const val SHIMMER_SEED = 0.25f
    /** How far the top of the band leads the bottom, as a fraction of the height ("/" slant). */
    private const val SHIMMER_SLANT = 0.6f
  }
}

/**
 * A string shaped once ([android.graphics.text.TextRunShaper]) and drawn with
 * [Canvas.drawGlyphs]: runs of glyphs per font (a fallback font gets its own
 * run), positions relative to the run's origin on the baseline.
 */
@androidx.annotation.RequiresApi(Build.VERSION_CODES.S)
internal class ShapedText private constructor(
  private val fonts: Array<android.graphics.fonts.Font>,
  private val ids: Array<IntArray>,
  private val positions: Array<FloatArray>,
) {
  /** Draws at ([x], [baseline]); [scratch] is resized when a run is longer. */
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
    fun of(text: String, paint: Paint): ShapedText {
      val glyphs = android.graphics.text.TextRunShaper.shapeTextRun(text, 0, text.length, 0, text.length, 0f, 0f, false, paint)
      val runFonts = ArrayList<android.graphics.fonts.Font>()
      val runIds = ArrayList<IntArray>()
      val runPositions = ArrayList<FloatArray>()
      var start = 0
      val count = glyphs.glyphCount()
      while (start < count) {
        val font = glyphs.getFont(start)
        var end = start + 1
        while (end < count && glyphs.getFont(end) == font) end++
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
      return ShapedText(runFonts.toTypedArray(), runIds.toTypedArray(), runPositions.toTypedArray())
    }
  }
}
