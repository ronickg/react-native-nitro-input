package com.margelo.nitro.nitroinput

import android.content.res.AssetManager
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.os.Build
import android.text.TextPaint
import com.facebook.react.common.assets.ReactFontManager
import com.margelo.nitro.nitroinput.NitroInputView.AffixAlign
import com.margelo.nitro.nitroinput.NitroInputView.Typography
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

internal enum class InputRole { PREFIX, BODY, SUFFIX }

private const val ALL_DIGITS = "0123456789"

/**
 * A field's body / prefix / suffix paints with per-character advance caches.
 * The view draws with it and [InputSizing] measures with it, so what a field
 * is measured at before its view exists is what the view then reports.
 *
 * Not thread-safe: one instance per thread. The view's lives on the main
 * thread; a measure on the JS thread builds its own.
 */
internal class InputFonts(
  t: Typography,
  private val density: Float,
  /** The system's font scale (`Configuration.fontScale`), applied under `allowFontScaling`. */
  fontScale: Float,
  private val assets: AssetManager?,
  /** The text colour when the typography sets none. */
  private val defaultColor: Int,
) {
  private val scale = systemFontMultiplier(t, fontScale)
  val body = makePaint(t, t.fontSize * scale)
  val prefix = makePaint(t, t.prefixFontSize * scale)
  val suffix = makePaint(t, t.suffixFontSize * scale)
  private val prefixAlign = t.prefixAlign
  private val suffixAlign = t.suffixAlign
  /** Letter spacing after a body / prefix / suffix glyph, the seams (null: the letter spacing) and the affix offsets, in px. */
  val bodySpacing = t.letterSpacing * scale * density
  val prefixLetterSpacing = bodySpacing * (t.prefixFontSize / t.fontSize)
  val suffixLetterSpacing = bodySpacing * (t.suffixFontSize / t.fontSize)
  val prefixSeam = t.prefixSpacing?.let { it * scale * density }
  val suffixSeam = t.suffixSpacing?.let { it * scale * density }
  val prefixOffset = t.prefixOffset * scale * density
  val suffixOffset = t.suffixOffset * scale * density
  private val bodyMetrics: Paint.FontMetrics = body.fontMetrics
  /** The font's own line box, before any `lineHeight` override. */
  val fontLineHeight: Float = ceil(bodyMetrics.descent - bodyMetrics.ascent)
  /** Height of the line box in px: `lineHeight` when given, else the font's. */
  val lineHeight: Float = if (t.lineHeightPx > 0f) t.lineHeightPx else fontLineHeight
  /**
   * How far to push the glyphs down inside the line box. The platform stacks
   * the extra leading above the line, so without this the run rides high;
   * with a line height *tighter* than the font it rides low, and the same
   * halving corrects both. React Native skips the tighter case.
   */
  val baselineNudge: Float = (lineHeight - fontLineHeight) / 2f
  private val widthCaches = Array(3) { HashMap<Int, Float>() }
  private val capHeightCache = HashMap<InputRole, Float>()
  private val charCache = HashMap<Int, String>()
  // By role, then text: a key built from both was a string allocated for
  // every affix glyph on every frame of a reflow.
  private val inkDescentCaches = Array(3) { HashMap<String, Float>() }
  // Each role's metrics, read once: `Paint.fontMetrics` allocates, and the
  // affixes' baselines are asked for on every frame of a reflow.
  private val metrics = arrayOf(prefix.fontMetrics, bodyMetrics, suffix.fontMetrics)
  private val shapedCaches = Array(3) { HashMap<Int, ShapedText>() }

  /**
   * One character of [role] shaped once, for [Canvas.drawGlyphs]: `drawText`
   * runs the text shaper on every call, and a reflow draws every glyph on
   * every frame of its animation (see NitroNumberView's `shaped`).
   */
  @androidx.annotation.RequiresApi(Build.VERSION_CODES.S)
  fun shaped(codePoint: Int, role: InputRole): ShapedText =
    shapedCaches[role.ordinal].getOrPut(codePoint) { ShapedText.of(charString(codePoint), paint(role)) }

  fun paint(role: InputRole): TextPaint = when (role) {
    InputRole.BODY -> body
    InputRole.PREFIX -> prefix
    InputRole.SUFFIX -> suffix
  }

  /** Advance of one character, in px. */
  fun width(codePoint: Int, role: InputRole): Float =
    widthCaches[role.ordinal].getOrPut(codePoint) { paint(role).measureText(charString(codePoint)) }

  /** Sum of the per-character advances of [text] (what the engine lays out). */
  fun width(text: String, role: InputRole): Float {
    var total = 0f
    var i = 0
    while (i < text.length) {
      val cp = text.codePointAt(i)
      total += width(cp, role)
      i += Character.charCount(cp)
    }
    return total
  }

  /** Letter spacing after a glyph of [role], in px. */
  fun spacing(role: InputRole): Float = when (role) {
    InputRole.BODY -> bodySpacing
    InputRole.PREFIX -> prefixLetterSpacing
    InputRole.SUFFIX -> suffixLetterSpacing
  }

  /** The room an affix takes beside the text: its glyphs, their spacing and the seam, in px. */
  fun affixRoom(affix: String, role: InputRole): Float {
    if (affix.isEmpty()) return 0f
    val count = affix.codePointCount(0, affix.length)
    val glyphs = width(affix, role)
    if (role == InputRole.PREFIX) return glyphs + prefixLetterSpacing * (count - 1) + (prefixSeam ?: prefixLetterSpacing)
    // The edit text's own letter spacing already follows its last glyph.
    return glyphs + suffixLetterSpacing * count + ((suffixSeam ?: bodySpacing) - bodySpacing)
  }

  /** Baseline y for `role` drawing `text`, given the top of the body line box. */
  fun baseline(role: InputRole, text: String, lineTop: Float): Float {
    val aligned = alignedBaseline(role, text, lineTop)
    return when (role) {
      InputRole.BODY -> aligned
      InputRole.PREFIX -> aligned + prefixOffset
      InputRole.SUFFIX -> aligned + suffixOffset
    }
  }

  private fun alignedBaseline(role: InputRole, text: String, lineTop: Float): Float {
    // `baselineNudge` re-centres the run when `lineHeight` differs from the
    // font's: the extra goes above the line, so the body sits that far lower.
    // Everything pinned to the body follows it; `CENTER` does not, because it
    // centres in the line box itself, which is already the new height.
    val bodyBaseline = lineTop + baselineNudge - bodyMetrics.ascent
    if (role == InputRole.BODY) return bodyBaseline
    val m = metrics[role.ordinal]
    return when (if (role == InputRole.PREFIX) prefixAlign else suffixAlign) {
      AffixAlign.BASELINE -> bodyBaseline
      AffixAlign.CENTER -> lineTop + (lineHeight - (m.descent - m.ascent)) / 2f - m.ascent
      AffixAlign.TOP -> bodyBaseline - capHeight(InputRole.BODY) + capHeight(role)
      // Pin the bottom of the ink, not of the line boxes: the digits' ink ends
      // on the baseline, so "USD" sits on it too instead of hanging down to
      // where a comma's tail reaches.
      AffixAlign.BOTTOM -> bodyBaseline + inkDescent(ALL_DIGITS, InputRole.BODY) - inkDescent(text, role)
    }
  }

  /** How far `text`'s ink hangs below the baseline (0 for digits and capitals). */
  private fun inkDescent(text: String, role: InputRole): Float = inkDescentCaches[role.ordinal].getOrPut(text) {
    val bounds = Rect()
    paint(role).getTextBounds(text, 0, text.length, bounds)
    max(0, bounds.bottom).toFloat()
  }

  private fun capHeight(role: InputRole): Float = capHeightCache.getOrPut(role) {
    val bounds = Rect()
    paint(role).getTextBounds("0", 0, 1, bounds)
    -bounds.top.toFloat()
  }

  private fun charString(codePoint: Int): String = charCache.getOrPut(codePoint) { String(Character.toChars(codePoint)) }

  /** System font scale for `allowFontScaling`, capped by `maxFontSizeMultiplier`. */
  private fun systemFontMultiplier(t: Typography, multiplier: Float): Float {
    if (!t.allowFontScaling) return 1f
    return if (t.maxFontSizeMultiplier > 0f) min(multiplier, t.maxFontSizeMultiplier) else multiplier
  }

  private fun makePaint(t: Typography, sizeDp: Float): TextPaint {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
    paint.typeface = makeTypeface(t)
    paint.textSize = sizeDp * density
    paint.color = t.color ?: defaultColor
    // Tabular figures in every mode, as on iOS: the engine slides digit runs
    // in text mode too, and proportional digits would jitter as they change.
    paint.fontFeatureSettings = "tnum"
    return paint
  }

  private fun makeTypeface(t: Typography): Typeface {
    val family = t.fontFamily
    return try {
      if (!family.isNullOrEmpty()) {
        ReactFontManager.getInstance().getTypeface(family, Typeface.NORMAL, t.fontWeight, assets)
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
}
