package com.margelo.nitro.nitrorollingnumber

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.text.TextPaint
import android.util.TypedValue
import android.view.View
import android.view.animation.LinearInterpolator
import com.facebook.react.common.assets.ReactFontManager
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * A View that renders a number as vertically rolling digit columns.
 *
 * Every digit is a "column" with a continuous position on a 0–9 strip. The view
 * can either be *driven* ([setValue]: positions are derived directly from a
 * continuous value, odometer style, so a UI-thread animation driver can push a
 * new value every frame) or *rolled* ([animateTo]: every column animates
 * independently from its current glyph to the target glyph).
 *
 * Mirrors `RollingNumberView.swift` on iOS.
 */
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
  )

  enum class Easing { LINEAR, EASE_IN, EASE_OUT, EASE_IN_OUT, SPRING }

  enum class Direction { AUTO, UP, DOWN }

  data class Timing(
    val durationMs: Long = 500,
    val easing: Easing = Easing.EASE_IN_OUT,
    val bounce: Double = 0.15,
    /** Delay between the start of each column's roll, least significant first. */
    val staggerMs: Long = 0,
    val direction: Direction = Direction.AUTO,
  )

  data class Shimmer(
    /** Color of the glint's core; null uses a light neutral (dark neutral in dark mode). */
    val color: Int? = null,
    /** Duration of one sweep across the number. */
    val durationMs: Long = 950,
  )

  enum class Alignment { LEFT, CENTER, RIGHT }

  var format: Format = Format()
    set(value) {
      if (field == value) return
      field = value
      formatDidChange()
    }

  var typography: Typography = Typography()
    set(value) {
      if (field == value) return
      field = value
      rebuildFonts()
    }

  var timing: Timing = Timing()

  var shimmer: Shimmer = Shimmer()
    set(value) {
      if (field == value) return
      field = value
      if (loading) restartShimmerAnimator()
      invalidate()
    }

  /** Skeleton mode: glyphs are dimmed and a highlight sweeps across them. Toggling cross-fades. */
  var loading: Boolean = false
    set(value) {
      if (field == value) return
      field = value
      startLoadingFade(if (value) 1f else 0f)
      if (value) restartShimmerAnimator()
      invalidate()
    }

  var alignment: Alignment = Alignment.LEFT
    set(value) {
      field = value
      invalidate()
    }

  /** Called with the settled (target) intrinsic size, in dp, whenever it changes. */
  var onIntrinsicSizeChange: ((widthDp: Float, heightDp: Float) -> Unit)? = null

  /** The value currently shown or being rolled towards. */
  var targetValue: Double = 0.0
    private set

  // endregion

  // region Column model

  private data class Column(
    /** Glyph index on the strip. Interior columns wrap modulo 10; linear columns use -1 for "blank". */
    var position: Double,
    /** Horizontal extent, 0…1. */
    var width: Double,
    /** true → the strip is [blank, 0 … 9] (appearing/disappearing columns). */
    var linear: Boolean,
    /** true → glyph 0 is drawn blank (the emerging odometer column). */
    var blankZero: Boolean,
  )

  private class ColumnTransition(val from: Column, val to: Column)

  private class Transition(
    val startMs: Long,
    val durationMs: Long,
    /** Per-column start delay in ms (least significant first). */
    val delaysMs: LongArray,
    val columns: List<ColumnTransition>,
    val signFrom: Double,
    val signTo: Double,
    val finalColumns: List<Column>,
  )

  private class Target(val magnitude: Long, val negative: Boolean, val powerCount: Int) {
    fun digit(power: Int): Int {
      if (power >= POW10.size) return 0
      return ((magnitude / POW10[power]) % 10L).toInt()
    }
  }

  // endregion

  // region Fonts

  private enum class GlyphRole { DIGIT, PREFIX, SUFFIX }

  /** Digit / prefix / suffix paints at one scale, with per-glyph width caches. */
  private inner class FontSet(t: Typography, scale: Float) {
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
    private val capHeightCache = HashMap<GlyphRole, Float>()

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

    /** Baseline y for `role`, given the top of the digit line box. */
    fun baseline(role: GlyphRole, lineTop: Float): Float {
      val digitBaseline = lineTop - digitMetrics.ascent
      if (role == GlyphRole.DIGIT) return digitBaseline
      val p = paint(role)
      val m = p.fontMetrics
      return when (if (role == GlyphRole.PREFIX) prefixAlign else suffixAlign) {
        AffixAlign.BASELINE -> digitBaseline
        AffixAlign.CENTER -> lineTop + (lineHeight - (m.descent - m.ascent)) / 2f - m.ascent
        AffixAlign.TOP -> lineTop + (-digitMetrics.ascent - capHeight(GlyphRole.DIGIT)) + capHeight(role)
        AffixAlign.BOTTOM -> lineTop + lineHeight - m.descent
      }
    }

    private fun capHeight(role: GlyphRole): Float = capHeightCache.getOrPut(role) {
      val bounds = Rect()
      paint(role).getTextBounds("0", 0, 1, bounds)
      -bounds.top.toFloat()
    }
  }

  private fun makePaint(t: Typography, sizeDp: Float): TextPaint {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
    paint.typeface = makeTypeface(t)
    paint.textSize = sizeDp * density
    paint.color = t.color ?: defaultTextColor()
    paint.fontFeatureSettings = "tnum"
    return paint
  }

  // endregion

  // region State

  private var columns: MutableList<Column> = mutableListOf()
  private var signFactor = 0.0
  private var hasShownValue = false
  private var transition: Transition? = null
  private var animator: ValueAnimator? = null
  private var settledPowerCount = 1
  private var settledNegative = false
  private var lastReportedWidth = -1f
  private var lastReportedHeight = -1f
  /** 0 = normal, 1 = fully in skeleton mode. */
  private var loadingProgress = 0f
  private var loadingAnimator: ValueAnimator? = null
  private var shimmerAnimator: ValueAnimator? = null
  private var shimmerPhase = 0f
  private val shimmerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_ATOP)
  }

  private val density = context.resources.displayMetrics.density
  /** Fonts at the configured size. Shrink-to-fit is a continuous canvas scale applied at draw time. */
  private var fonts: FontSet = FontSet(Typography(), 1f)
  private var fontScale = 1f

  // endregion

  // region Public API

  fun stopAnimation() {
    transition = null
    animator?.cancel()
    animator = null
  }

  /**
   * Shows [value] immediately with continuously positioned digits (odometer
   * style). Cancels any running roll. Intended to be called every frame.
   */
  fun setValue(value: Double) {
    stopAnimation()
    targetValue = value
    hasShownValue = true

    val fd = format.fractionDigits
    var scaled = abs(value) * POW10[fd].toDouble()
    if (!scaled.isFinite()) scaled = 0.0
    scaled = min(scaled, 1e15)
    val whole = floor(scaled)
    val integerPart = whole.toLong() / POW10[fd]
    val needed = min(MAX_POWER_COUNT, max(format.minimumIntegerDigits, digitCount(integerPart)) + fd)

    val next = ArrayList<Column>(needed + 1)
    for (power in 0..needed) {
      val p10 = POW10[power].toDouble()
      val digit = floor(scaled / p10) % 10.0
      val carry = if (power == 0) {
        scaled - whole
      } else {
        // A wheel only turns while every lower wheel is on its way from 9 to 0.
        min(1.0, max(0.0, (scaled % p10) - (p10 - 1)))
      }
      if (power == needed) {
        // The next higher column emerges (blank → 1) while the carry is in progress.
        if (carry <= 0.0) break
        next.add(Column(position = carry, width = carry, linear = false, blankZero = true))
      } else {
        next.add(Column(position = digit + carry, width = 1.0, linear = false, blankZero = false))
      }
    }
    columns = next
    signFactor = if (value < 0) min(1.0, scaled) else 0.0
    reportIntrinsicSize(next.size, value < 0)
    invalidate()
  }

  /** Rolls every digit to [value]. Snaps when the duration is 0 or nothing has been shown yet. */
  fun animateTo(value: Double) {
    val previous = targetValue
    targetValue = value
    val target = makeTarget(value)
    if (!hasShownValue || timing.durationMs <= 0L) {
      snap(target)
      return
    }

    val increasing = when (timing.direction) {
      Direction.AUTO -> value >= previous
      Direction.UP -> true
      Direction.DOWN -> false
    }
    val mandatory = format.minimumIntegerDigits + format.fractionDigits
    val count = max(columns.size, target.powerCount)
    val transitions = ArrayList<ColumnTransition>(count)
    val finals = ArrayList<Column>(target.powerCount)

    for (power in 0 until count) {
      val current = if (power < columns.size) columns[power]
      else Column(position = -1.0, width = 0.0, linear = true, blankZero = false)
      val from = current.copy()
      val to: Column
      if (power < target.powerCount) {
        val digit = target.digit(power).toDouble()
        val isEdge = power >= mandatory &&
          (power >= columns.size || current.width < 1.0 || current.linear || current.blankZero)
        if (isEdge) {
          if (!current.linear) from.position = wrap(current.position)
          from.linear = true
          to = Column(position = digit, width = 1.0, linear = true, blankZero = current.blankZero)
        } else {
          val base = wrap(current.position)
          from.position = base
          from.linear = false
          val delta = if (increasing) wrap(digit - base) else -wrap(base - digit)
          to = Column(position = base + delta, width = 1.0, linear = false, blankZero = false)
        }
        finals.add(Column(position = digit, width = 1.0, linear = false, blankZero = false))
      } else {
        if (!current.linear) from.position = wrap(current.position)
        from.linear = true
        to = Column(position = -1.0, width = 0.0, linear = true, blankZero = current.blankZero)
      }
      transitions.add(ColumnTransition(from, to))
    }

    // Stagger: column i normally starts `stagger * i` late. When re-targeting
    // mid-roll, a column that hasn't started yet keeps its original start time
    // instead of being pushed back again, so rapid updates can't starve it.
    val now = android.os.SystemClock.uptimeMillis()
    val stagger = max(0L, timing.staggerMs)
    val active = transition
    val delays = LongArray(count) { power ->
      var delay = stagger * power
      if (active != null && power < active.delaysMs.size) {
        val pending = max(0L, (active.startMs + active.delaysMs[power]) - now)
        delay = min(delay, pending)
      }
      delay
    }

    val next = Transition(
      startMs = now,
      durationMs = timing.durationMs,
      delaysMs = delays,
      columns = transitions,
      signFrom = signFactor,
      signTo = if (target.negative) 1.0 else 0.0,
      finalColumns = finals,
    )
    stopAnimation()
    transition = next
    apply(next, 0.0)
    reportIntrinsicSize(target.powerCount, target.negative)
    startAnimator(next)
    invalidate()
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

  // endregion

  // region Targets

  private fun makeTarget(value: Double): Target {
    val fd = format.fractionDigits
    var scaled = Math.rint(abs(value) * POW10[fd].toDouble())
    if (!scaled.isFinite()) scaled = 0.0
    val magnitude = min(scaled, 1e17).toLong()
    val integerPart = magnitude / POW10[fd]
    val intDigits = max(format.minimumIntegerDigits, digitCount(integerPart))
    return Target(
      magnitude = magnitude,
      negative = value < 0 && magnitude > 0L,
      powerCount = min(MAX_POWER_COUNT, intDigits + fd),
    )
  }

  private fun snap(target: Target) {
    stopAnimation()
    columns = MutableList(target.powerCount) { power ->
      Column(position = target.digit(power).toDouble(), width = 1.0, linear = false, blankZero = false)
    }
    signFactor = if (target.negative) 1.0 else 0.0
    hasShownValue = true
    reportIntrinsicSize(target.powerCount, target.negative)
    invalidate()
  }

  private fun formatDidChange() {
    if (hasShownValue) snap(makeTarget(targetValue))
  }

  // endregion

  // region Animation

  private fun apply(tr: Transition, elapsedMs: Double) {
    if (columns.size != tr.columns.size) {
      columns = tr.columns.map { it.from.copy() }.toMutableList()
    }
    val duration = tr.durationMs.toDouble()
    tr.columns.forEachIndexed { i, ct ->
      val delay = if (i < tr.delaysMs.size) tr.delaysMs[i] else 0L
      val raw = if (duration > 0) min(1.0, max(0.0, (elapsedMs - delay) / duration)) else 1.0
      val t = ease(raw)
      val column = columns[i]
      column.position = ct.from.position + (ct.to.position - ct.from.position) * t
      column.width = min(1.0, max(0.0, ct.from.width + (ct.to.width - ct.from.width) * t))
      column.linear = ct.from.linear
      column.blankZero = ct.from.blankZero
    }
    val signRaw = if (duration > 0) min(1.0, max(0.0, elapsedMs / duration)) else 1.0
    signFactor = min(1.0, max(0.0, tr.signFrom + (tr.signTo - tr.signFrom) * ease(signRaw)))
  }

  private fun finish(tr: Transition) {
    columns = tr.finalColumns.map { it.copy() }.toMutableList()
    signFactor = tr.signTo
    transition = null
  }

  private fun startAnimator(tr: Transition) {
    val total = tr.durationMs + (tr.delaysMs.maxOrNull() ?: 0L)
    val a = ValueAnimator.ofFloat(0f, 1f)
    a.interpolator = LinearInterpolator()
    a.duration = total
    a.addUpdateListener { animation ->
      val active = transition ?: return@addUpdateListener
      if (active !== tr) return@addUpdateListener
      val raw = animation.animatedFraction.toDouble()
      if (raw >= 1.0) finish(active) else apply(active, raw * total)
      invalidate()
    }
    a.addListener(object : AnimatorListenerAdapter() {
      override fun onAnimationEnd(animation: Animator) {
        val active = transition
        if (active != null && active === tr) {
          finish(active)
          invalidate()
        }
        if (animator === animation) animator = null
      }
    })
    animator = a
    a.start()
  }

  private fun startLoadingFade(target: Float) {
    loadingAnimator?.cancel()
    val a = ValueAnimator.ofFloat(loadingProgress, target)
    a.duration = LOADING_FADE_MS
    a.interpolator = LinearInterpolator()
    a.addUpdateListener { animation ->
      loadingProgress = animation.animatedValue as Float
      invalidate()
    }
    a.addListener(object : AnimatorListenerAdapter() {
      override fun onAnimationEnd(animation: Animator) {
        if (loadingAnimator === animation) loadingAnimator = null
        if (loadingProgress <= 0f && !loading) {
          shimmerAnimator?.cancel()
          shimmerAnimator = null
        }
      }
    })
    loadingAnimator = a
    a.start()
  }

  private fun restartShimmerAnimator() {
    shimmerAnimator?.cancel()
    val a = ValueAnimator.ofFloat(0f, 1f)
    a.duration = max(200L, shimmer.durationMs)
    a.interpolator = LinearInterpolator()
    a.repeatCount = ValueAnimator.INFINITE
    a.repeatMode = ValueAnimator.RESTART
    a.addUpdateListener { animation ->
      shimmerPhase = animation.animatedFraction
      invalidate()
    }
    shimmerAnimator = a
    a.start()
  }

  private fun ease(t: Double): Double = when (timing.easing) {
    Easing.LINEAR -> t
    Easing.EASE_IN -> t * t * t
    Easing.EASE_OUT -> 1 - Math.pow(1 - t, 3.0)
    Easing.EASE_IN_OUT -> if (t < 0.5) 4 * t * t * t else 1 - Math.pow(-2 * t + 2, 3.0) / 2
    Easing.SPRING -> spring(t, timing.bounce)
  }

  // endregion

  // region Typography

  private fun rebuildFonts() {
    fonts = FontSet(typography, 1f)
    fontScale = 1f
    if (hasShownValue) reportIntrinsicSize(settledPowerCount, settledNegative)
    invalidate()
  }

  /**
   * Shrink-to-fit scale for the current width and the content as it is drawn
   * *right now* (including half-appeared columns): the amount shrinks and grows
   * continuously in step with the roll and never overflows.
   */
  private fun updateFontScale(contentWidth: Float) {
    var scale = 1f
    if (typography.adjustsFontSizeToFit && width > 0 && contentWidth > width) {
      scale = max(min(1f, typography.minimumFontScale), width / contentWidth)
    }
    fontScale = scale
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

  // region Layout

  private class Element(
    val columnIndex: Int, // -1 for glyph elements
    val text: String?,
    val role: GlyphRole,
    val width: Float,
    val fullWidth: Float,
    val factor: Double,
  )

  private fun buildElements(fonts: FontSet, columns: List<Column>, signFactor: Double): List<Element> {
    val elements = ArrayList<Element>(columns.size * 2 + 4)
    val fd = format.fractionDigits

    fun addGlyph(text: String, role: GlyphRole, factor: Double) {
      if (text.isEmpty() || factor <= 0.0) return
      val width = fonts.width(text, role)
      elements.add(Element(-1, text, role, (width * factor).toFloat(), width, factor))
    }

    addGlyph(format.prefix, GlyphRole.PREFIX, 1.0)
    addGlyph("-", GlyphRole.DIGIT, signFactor)
    for (power in columns.indices.reversed()) {
      val column = columns[power]
      if (column.width > 0.0) {
        elements.add(Element(power, null, GlyphRole.DIGIT, (fonts.digitWidth * column.width).toFloat(), fonts.digitWidth, column.width))
      }
      if (power > fd && (power - fd) % 3 == 0) addGlyph(format.groupingSeparator, GlyphRole.DIGIT, column.width)
      if (fd > 0 && power == fd) addGlyph(format.decimalSeparator, GlyphRole.DIGIT, 1.0)
    }
    addGlyph(format.suffix, GlyphRole.SUFFIX, 1.0)
    return elements
  }

  private fun settledWidth(fonts: FontSet, powerCount: Int, negative: Boolean): Float {
    val settled = List(powerCount) { Column(0.0, 1.0, linear = false, blankZero = false) }
    var width = 0f
    for (element in buildElements(fonts, settled, if (negative) 1.0 else 0.0)) width += element.width
    return width
  }

  private fun reportIntrinsicSize(powerCount: Int, negative: Boolean) {
    settledPowerCount = powerCount
    settledNegative = negative
    val widthDp = ceil(settledWidth(fonts, powerCount, negative) / density)
    // The reported size is always the full-size one: with shrink-to-fit the view
    // keeps its height and the scaled number is centred inside it when drawing.
    val heightDp = ceil(fonts.lineHeight / density)
    if (abs(widthDp - lastReportedWidth) > 0.01f || abs(heightDp - lastReportedHeight) > 0.01f) {
      lastReportedWidth = widthDp
      lastReportedHeight = heightDp
      onIntrinsicSizeChange?.invoke(widthDp, heightDp)
    }
  }

  // endregion

  // region Drawing

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (!hasShownValue) return
    val fonts = this.fonts
    val elements = buildElements(fonts, columns, signFactor)
    var total = 0f
    for (element in elements) total += element.width
    updateFontScale(total)
    val scale = fontScale

    // Position the (scaled) content, then draw everything in unscaled font space.
    val originX = when (alignment) {
      Alignment.LEFT -> 0f
      Alignment.CENTER -> (width - total * scale) / 2f
      Alignment.RIGHT -> width - total * scale
    }
    val originY = (height - fonts.lineHeight * scale) / 2f
    val outer = canvas.save()
    canvas.translate(originX, originY)
    canvas.scale(scale, scale)

    val dim = loadingProgress.coerceIn(0f, 1f)
    // The ink keeps its full color; the glint is a band recoloring the glyphs.
    val baseAlpha = 1.0
    // Everything drawn in this layer is what the sweep gets composited onto.
    val layer = if (dim > 0f) canvas.saveLayer(-1f, -1f, total + 1f, fonts.lineHeight + 1f, null) else -1
    var x = 0f
    for (element in elements) {
      if (element.columnIndex >= 0) {
        drawColumn(canvas, fonts, columns[element.columnIndex], x, element.width, 0f, baseAlpha)
      } else if (element.text != null) {
        drawGlyph(canvas, fonts, element.text, element.role, x, element.width, element.fullWidth, 0f, element.factor * baseAlpha)
      }
      x += element.width
    }
    if (dim > 0f) {
      drawShimmer(canvas, fonts, 0f, total, dim)
      canvas.restoreToCount(layer)
    }
    canvas.restoreToCount(outer)
  }

  /**
   * A "shine" glint: a text-wide, slanted band that recolors the ink from the text
   * color to the highlight and back ([base, highlight, base] at 10/50/90 %),
   * composited SRC_ATOP so only the glyphs light up.
   */
  private fun drawShimmer(canvas: Canvas, fonts: FontSet, contentLeft: Float, contentWidth: Float, dim: Float) {
    if (contentWidth <= 0f) return
    val base = fonts.digit.color
    val highlight = shimmer.color ?: defaultShimmerColor()
    val progress = SHIMMER_SEED + (1f - SHIMMER_SEED) * shimmerPhase
    // Core at contentLeft + width * (2p - 0.5): enters at the left edge, exits past the right.
    val startX = contentLeft + contentWidth * (2f * progress - 1f)
    shimmerPaint.shader = LinearGradient(
      startX, 0f, startX + contentWidth, SHIMMER_SLANT * contentWidth,
      intArrayOf(base, highlight, base), floatArrayOf(0.1f, 0.5f, 0.9f), Shader.TileMode.CLAMP,
    )
    shimmerPaint.alpha = (dim * 255f).toInt().coerceIn(0, 255)
    canvas.drawRect(-1f, -1f, contentWidth + 1f, fonts.lineHeight + 1f, shimmerPaint)
  }

  /** Default glint color: a near-background neutral so the ink "lights up". */
  private fun defaultShimmerColor(): Int {
    val night = (context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
      android.content.res.Configuration.UI_MODE_NIGHT_YES
    return if (night) 0xFF2B2E37.toInt() else 0xFFD6D9E1.toInt()
  }

  private fun drawGlyph(canvas: Canvas, fonts: FontSet, text: String, role: GlyphRole, x: Float, width: Float, fullWidth: Float, lineTop: Float, alpha: Double) {
    if (width <= 0f) return
    val paint = fonts.paint(role)
    canvas.save()
    canvas.clipRect(x, lineTop, x + width, lineTop + fonts.lineHeight)
    paint.alpha = (alpha * 255).toInt().coerceIn(0, 255)
    canvas.drawText(text, x + width - fullWidth, fonts.baseline(role, lineTop), paint)
    canvas.restore()
  }

  private fun drawColumn(canvas: Canvas, fonts: FontSet, column: Column, x: Float, width: Float, lineTop: Float, baseAlpha: Double) {
    if (width <= 0f) return
    val paint = fonts.digit
    val lineHeight = fonts.lineHeight
    val baseline = fonts.baseline(GlyphRole.DIGIT, lineTop)
    canvas.save()
    canvas.clipRect(x, lineTop, x + width, lineTop + lineHeight)
    paint.alpha = (column.width * baseAlpha * 255).toInt().coerceIn(0, 255)
    val base = floor(column.position)
    val fraction = (column.position - base).toFloat()
    val index = base.toInt()
    val columnLeft = x + width - fonts.digitWidth
    glyphAt(index, column)?.let { glyph ->
      canvas.drawText(glyph, columnLeft + (fonts.digitWidth - fonts.width(glyph, GlyphRole.DIGIT)) / 2f, baseline - fraction * lineHeight, paint)
    }
    if (fraction > 0.0001f) {
      glyphAt(index + 1, column)?.let { glyph ->
        canvas.drawText(glyph, columnLeft + (fonts.digitWidth - fonts.width(glyph, GlyphRole.DIGIT)) / 2f, baseline + (1f - fraction) * lineHeight, paint)
      }
    }
    canvas.restore()
  }

  private fun glyphAt(index: Int, column: Column): String? {
    if (column.linear && index < 0) return null
    if (column.blankZero && index == 0) return null
    val digit = ((index % 10) + 10) % 10
    return DIGITS[digit]
  }

  // endregion

  companion object {
    private const val MAX_POWER_COUNT = 18
    private const val LOADING_FADE_MS = 250L
    /** The core starts at the glyphs' left edge instead of parked off-screen. */
    private const val SHIMMER_SEED = 0.25f
    /** How far the top of the band leads the bottom, as a fraction of the height ("/" slant). */
    private const val SHIMMER_SLANT = 0.6f
    private val DIGITS = Array(10) { it.toString() }
    private val POW10: LongArray = LongArray(19).also { table ->
      table[0] = 1L
      for (i in 1 until table.size) table[i] = table[i - 1] * 10L
    }

    private fun digitCount(n: Long): Int {
      var v = n
      var count = 1
      while (v >= 10L) {
        v /= 10L
        count += 1
      }
      return count
    }

    private fun wrap(x: Double): Double {
      val r = x % 10.0
      return if (r < 0) r + 10.0 else r
    }

    /**
     * Step response of a damped spring, normalised so it has settled at t == 1.
     * `bounce` maps to the damping ratio like SwiftUI's `.spring(duration:bounce:)`.
     */
    private fun spring(t: Double, bounce: Double): Double {
      val zeta = min(1.0, max(0.05, 1.0 - min(1.0, max(0.0, bounce))))
      val omega = 3.0 * Math.PI
      val k = zeta * omega
      if (zeta >= 0.999) return 1 - (1 + k * t) * exp(-k * t)
      val wd = omega * sqrt(1 - zeta * zeta)
      return 1 - exp(-k * t) * (cos(wd * t) + (k / wd) * sin(wd * t))
    }
  }
}
