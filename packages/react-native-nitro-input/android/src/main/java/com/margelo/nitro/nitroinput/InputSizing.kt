package com.margelo.nitro.nitroinput

import android.graphics.Paint
import android.text.TextPaint
import com.margelo.nitro.nitroinput.NitroInputView.Format
import com.margelo.nitro.nitroinput.NitroInputView.Frame
import com.margelo.nitro.nitroinput.NitroInputView.Mode
import com.margelo.nitro.nitroinput.NitroInputView.Typography
import kotlin.math.ceil
import kotlin.math.max

/**
 * The props a field's size follows, under the names both [HybridNitroInputView]
 * and [NitroInputSizing] give them, so one mapping serves the view and the
 * measure that runs before it exists.
 */
internal interface InputSizingProps {
  val mode: NitroInputMode
  val mask: String
  val maskNotations: Array<NitroInputNotation>
  val maskAutocomplete: Boolean
  val maskAutoSkip: Boolean
  val maskAffinityFormats: Array<String>
  val maskAffinityStrategy: NitroInputMaskAffinity
  val maskTextCase: NitroInputTextCase
  val maskCharacterMap: Array<NitroInputCharacterMapping>
  val maskSlotPlaceholder: String
  val keepPlaceholder: Boolean
  val fractionDigits: Double
  val maxIntegerDigits: Double
  val groupingSeparator: String
  val decimalSeparator: String
  val prefix: String
  val suffix: String
  val signPlacement: NitroInputSignPlacement
  val placeholder: String
  val textSize: Double
  val textLineHeight: Double
  val prefixFontSize: Double
  val suffixFontSize: Double
  val textWeight: Double
  val textFamily: String
  val textLetterSpacing: Double
  val prefixSpacing: Double
  val suffixSpacing: Double
  val allowFontScaling: Boolean
  val maxFontSizeMultiplier: Double
  val variant: NitroInputVariant
  val label: String
  val labelBehavior: NitroInputLabelBehavior
  val labelFontSize: Double
  val cornerRadius: Double
}

internal fun finiteOr(value: Double, fallback: Double): Double = if (value.isFinite()) value else fallback

internal fun clampedInt(value: Double, lower: Int, upper: Int, fallback: Int): Int {
  if (!value.isFinite()) return fallback
  return Math.rint(value).coerceIn(lower.toDouble(), upper.toDouble()).toInt()
}

internal fun formatOf(p: InputSizingProps) = Format(
  mode = when (p.mode) {
    NitroInputMode.NUMBER -> Mode.NUMBER
    NitroInputMode.MASK -> Mode.MASK
    else -> Mode.TEXT
  },
  mask = p.mask,
  maskNotations = p.maskNotations.map { NitroInputView.MaskNotation(it.character, it.characterSet, it.isOptional) },
  maskAutocomplete = p.maskAutocomplete,
  maskAutoSkip = p.maskAutoSkip,
  maskAffinityFormats = p.maskAffinityFormats.toList(),
  maskAffinityStrategy = p.maskAffinityStrategy.value,
  maskTextCase = p.maskTextCase.value,
  maskCharacterMap = p.maskCharacterMap.map { NitroInputView.MaskMapping(it.from, it.to) },
  maskSlotPlaceholder = p.maskSlotPlaceholder,
  keepPlaceholder = p.keepPlaceholder,
  fractionDigits = clampedInt(p.fractionDigits, 0, 9, 2),
  maxIntegerDigits = clampedInt(p.maxIntegerDigits, 1, 30, 15),
  groupingSeparator = p.groupingSeparator,
  decimalSeparator = p.decimalSeparator,
  prefix = p.prefix,
  suffix = p.suffix,
  signBeforeAffix = p.signPlacement != NitroInputSignPlacement.AFTERAFFIX,
  placeholder = p.placeholder,
)

/** The typography's sizing half; the view adds the colours, alignment and offsets. */
internal fun sizingTypographyOf(p: InputSizingProps, density: Float): Typography {
  val size = finiteOr(p.textSize, 32.0).toFloat()
  return Typography(
    fontSize = size,
    lineHeightPx = (max(0.0, finiteOr(p.textLineHeight, 0.0)) * density).toFloat(),
    prefixFontSize = finiteOr(p.prefixFontSize, size.toDouble()).toFloat(),
    suffixFontSize = finiteOr(p.suffixFontSize, size.toDouble()).toFloat(),
    fontWeight = clampedInt(p.textWeight, 100, 900, 400),
    fontFamily = p.textFamily.ifEmpty { null },
    letterSpacing = if (p.textLetterSpacing.isFinite()) p.textLetterSpacing.toFloat() else 0f,
    prefixSpacing = p.prefixSpacing.takeIf { it.isFinite() }?.toFloat(),
    suffixSpacing = p.suffixSpacing.takeIf { it.isFinite() }?.toFloat(),
    allowFontScaling = p.allowFontScaling,
    maxFontSizeMultiplier = max(0.0, finiteOr(p.maxFontSizeMultiplier, 0.0)).toFloat(),
  )
}

/** The frame's sizing half; the view adds the colours and the stroke width. */
internal fun sizingFrameOf(p: InputSizingProps) = Frame(
  variant = when (p.variant) {
    NitroInputVariant.OUTLINED -> NitroInputView.Variant.OUTLINED
    NitroInputVariant.FILLED -> NitroInputView.Variant.FILLED
    NitroInputVariant.NONE -> NitroInputView.Variant.NONE
  },
  label = p.label,
  labelBehavior = when (p.labelBehavior) {
    NitroInputLabelBehavior.ALWAYS -> NitroInputView.LabelBehavior.ALWAYS
    NitroInputLabelBehavior.FLOAT -> NitroInputView.LabelBehavior.FLOAT
  },
  labelFontSize = max(0.0, finiteOr(p.labelFontSize, 0.0)).toFloat(),
  cornerRadius = max(0.0, finiteOr(p.cornerRadius, 8.0)).toFloat(),
)

/**
 * The room an outlined or filled frame keeps around its text and for its
 * label, in px. The view lays itself out with these; [InputSizing] adds them
 * to the size it reports. Mirrors `InputFrameMetrics` in InputSizing.swift.
 */
internal object InputFrame {
  /** How far the label starts from the frame's edge, at a minimum. */
  const val LABEL_INSET_DP = 16f
  /** Past the corner's curve, so the notch never opens onto the arc. */
  const val LABEL_CORNER_GAP_DP = 8f
  /**
   * The room a framed field keeps above and below its text. Flat, unlike the
   * side inset: that one grows with `cornerRadius` because the *label* has to
   * clear the corner curve, which is a horizontal problem.
   */
  const val FRAME_PADDING_DP = 16f
  const val FLOATED_LABEL_RATIO = 0.75f
  const val MIN_FLOATED_LABEL_DP = 9f
  /** A filled field's floated label line, as a multiple of its size (a fudge, not a Material metric). */
  const val FILLED_LABEL_LINE = 1.4f

  /** How far in the label - and so the text under it - starts. */
  fun labelInsetPx(frame: Frame, density: Float): Float =
    max(LABEL_INSET_DP * density, frame.cornerRadius * density + LABEL_CORNER_GAP_DP * density)

  fun sideInsetPx(frame: Frame, density: Float): Float = if (frame.draws) labelInsetPx(frame, density) else 0f

  fun floatedLabelSizePx(frame: Frame, restingSizePx: Float, density: Float): Float =
    if (frame.labelFontSize > 0f) frame.labelFontSize * density
    else max(MIN_FLOATED_LABEL_DP * density, restingSizePx * FLOATED_LABEL_RATIO)

  /**
   * Room at the top for the floated label - which only the filled variant
   * needs. Its label floats inside the box, on its own line above the text. An
   * outlined field's label sits *on* the stroke, outside the content box: it
   * intrudes into the top of the frame but never onto the text's line.
   */
  fun topInsetPx(frame: Frame, restingSizePx: Float, density: Float): Float =
    if (!frame.hasLabel || frame.variant != NitroInputView.Variant.FILLED) 0f
    else floatedLabelSizePx(frame, restingSizePx, density) * FILLED_LABEL_LINE

  /** The label at rest, in the body face and size: the widest it gets. */
  fun restingLabelWidthPx(frame: Frame, fonts: InputFonts): Float {
    if (!frame.hasLabel) return 0f
    val body = fonts.paint(InputRole.BODY)
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    paint.typeface = body.typeface
    paint.textSize = body.textSize
    return paint.measureText(frame.label)
  }

  /** A framed field's width: its content, or its label if wider, between the side insets. */
  fun widthPx(contentPx: Float, frame: Frame, fonts: InputFonts, density: Float): Float {
    if (!frame.draws) return contentPx
    return 2f * sideInsetPx(frame, density) + max(contentPx, restingLabelWidthPx(frame, fonts))
  }

  /**
   * A framed single line's height: the line with the frame's padding above and
   * below it, and a filled field's label line. The line is centred in it, as it
   * is in any height the caller gives. (A wrapping field adds its own.)
   */
  fun singleLineHeightPx(linePx: Float, frame: Frame, fonts: InputFonts, density: Float): Float {
    if (!frame.draws) return linePx
    return linePx + topInsetPx(frame, fonts.paint(InputRole.BODY).textSize, density) + 2f * FRAME_PADDING_DP * density
  }
}

/**
 * What a field shows for its format: the text conformed to it, the placeholder
 * and `keepPlaceholder`'s tail. Pure functions of the format and the shared C++
 * engines, which the view holds for its life and a measure configures afresh.
 */
internal object InputText {
  /** Points [formatter] and [maskEngine] at [value]; [old] skips a mask that did not change. */
  fun configure(formatter: AmountFormatter, maskEngine: MaskEngine, old: Format?, value: Format) {
    formatter.setFormat(value.fractionDigits, value.maxIntegerDigits, value.groupingSeparator, value.decimalSeparator)
    val maskChanged = old == null || old.mask != value.mask || old.maskNotations != value.maskNotations ||
      old.maskAffinityFormats != value.maskAffinityFormats || old.maskAffinityStrategy != value.maskAffinityStrategy ||
      old.maskTextCase != value.maskTextCase || old.maskCharacterMap != value.maskCharacterMap ||
      old.maskSlotPlaceholder != value.maskSlotPlaceholder
    if (value.mode == Mode.MASK && (old == null || old.mode != Mode.MASK || maskChanged)) {
      maskEngine.clearNotations()
      value.maskNotations.forEach { maskEngine.addNotation(it.character, it.characterSet, it.isOptional) }
      maskEngine.clearAffinityFormats()
      value.maskAffinityFormats.forEach { maskEngine.addAffinityFormat(it) }
      maskEngine.setAffinityStrategy(value.maskAffinityStrategy)
      maskEngine.setTextCase(value.maskTextCase)
      maskEngine.clearCharacterMap()
      value.maskCharacterMap.forEach { maskEngine.addCharacterMapping(it.from, it.to) }
      maskEngine.setSlotPlaceholder(value.maskSlotPlaceholder)
      // A bad pattern leaves the engine inactive; the field then behaves as
      // plain text rather than refusing every keystroke.
      maskEngine.setFormat(value.mask)
    }
  }

  /** [value] as the format holds it: formatted, masked, or cut to `maxLength` code points. */
  fun conform(value: String, format: Format, formatter: AmountFormatter, maskEngine: MaskEngine, maxLength: Int): String {
    if (format.mode == Mode.NUMBER) return formatter.normalize(value)
    if (format.mode == Mode.MASK) {
      return maskEngine.applyAll(value, value.codePointCount(0, value.length), true, format.maskAutocomplete, false)
    }
    if (maxLength <= 0) return value
    val total = value.codePointCount(0, value.length)
    return value.substring(0, value.offsetByCodePoints(0, maxLength.coerceIn(0, total)))
  }

  /**
   * `keepPlaceholder` without a `placeholder` shows the mask itself, empty
   * slots as `maskSlotPlaceholder`: "+1 (___) ___-____".
   */
  fun basePlaceholder(format: Format, maskEngine: MaskEngine): String {
    if (format.placeholder.isEmpty() && format.mode == Mode.MASK && format.keepPlaceholder && maskEngine.isActive()) {
      maskEngine.applyAll("", 0, true, false, false)
      return maskEngine.lastTailPlaceholder()
    }
    return format.placeholder
  }

  /**
   * `keepPlaceholder`: what is still to come after the typed text, drawn in the
   * placeholder colour. The caller's placeholder from where the text ends -
   * "1234 5" leaves "678 9012" of "1234 5678 9012" - or, without one, the rest
   * of the mask. The placeholder is written for `mask`, so when one of
   * `maskAffinityFormats` has taken over (a 4-6-5 Amex under a 4-4-4-4
   * placeholder) its characters no longer line up, and that format's own tail
   * is shown instead. A complete text has nothing to come.
   */
  fun ghostTail(text: String, format: Format, maskEngine: MaskEngine, secure: Boolean): String {
    if (format.mode != Mode.MASK || !format.keepPlaceholder || text.isEmpty() || secure || !maskEngine.isActive()) {
      return ""
    }
    val typed = text.codePointCount(0, text.length)
    maskEngine.applyAll(text, typed, true, false, false)
    if (maskEngine.lastComplete()) return ""
    val placeholder = format.placeholder
    if (placeholder.isNotEmpty() && maskEngine.lastFormatIndex() == 0) {
      val total = placeholder.codePointCount(0, placeholder.length)
      return if (typed < total) placeholder.substring(placeholder.offsetByCodePoints(0, typed)) else ""
    }
    return maskEngine.lastTailPlaceholder()
  }

  /** `secureTextEntry` draws a bullet for every code point. */
  fun bullets(text: String): String = "•".repeat(text.codePointCount(0, text.length))

  /** A leading minus, in either the keyboard's spelling or the typographic one. */
  fun isSign(c: Char): Boolean = c == '-' || c == '−'
}

/** Receives one glyph of [InputGlyphs.walk]: its code point, role, whether it is placeholder, and its advance in px. */
internal fun interface GlyphSink {
  fun glyph(codePoint: Int, role: InputRole, placeholder: Boolean, advance: Float)
}

/**
 * The glyphs a reflowing field lays out, in order, with the advance each takes:
 * the prefix, the text (or the placeholder), `keepPlaceholder`'s tail and the
 * suffix. The view hands them to the engine; [InputSizing] adds them up, which
 * is the engine's width at rest.
 */
internal object InputGlyphs {
  /**
   * [shown] is the text or, when [showPlaceholder], the placeholder; [tail]
   * is ignored then. Advances carry the letter spacing; the last prefix glyph
   * and the last body glyph before a suffix carry the seams instead.
   */
  fun walk(f: InputFonts, format: Format, shown: String, showPlaceholder: Boolean, tail: String, sink: GlyphSink) {
    // A negative amount reads "-$1,234.56", not "$-1,234.56": the sign belongs
    // to the amount, not to the digits after the symbol. It stays a *body*
    // glyph - it is part of the text, and the caret counts body glyphs in the
    // order they are added - and is only laid out ahead of the prefix.
    val signed = format.signBeforeAffix && !showPlaceholder && format.prefix.isNotEmpty() &&
      shown.isNotEmpty() && InputText.isSign(shown[0])
    if (signed) run(shown.substring(0, 1), InputRole.BODY, f, false, null, sink)
    run(format.prefix, InputRole.PREFIX, f, false, f.prefixSeam, sink)
    val kept = if (showPlaceholder) "" else tail
    run(if (signed) shown.substring(1) else shown, InputRole.BODY, f, showPlaceholder,
        if (format.suffix.isNotEmpty() && kept.isEmpty()) f.suffixSeam else null, sink)
    // `keepPlaceholder`: the rest of the mask trails the text as placeholder
    // glyphs. They come after every typed glyph, so the caret - which counts
    // body glyphs in order - never lands among them.
    run(kept, InputRole.BODY, f, true, if (format.suffix.isNotEmpty()) f.suffixSeam else null, sink)
    run(format.suffix, InputRole.SUFFIX, f, false, null, sink)
  }

  private fun run(s: String, role: InputRole, f: InputFonts, placeholder: Boolean, lastSpacing: Float?, sink: GlyphSink) {
    val spacing = f.spacing(role)
    var i = 0
    while (i < s.length) {
      val cp = s.codePointAt(i)
      val next = i + Character.charCount(cp)
      val after = if (next >= s.length && lastSpacing != null) lastSpacing else spacing
      sink.glyph(cp, role, placeholder, f.width(cp, role) + after)
      i = next
    }
  }
}

/** The size a single-line field reports through `onSizeChange`, worked out the same way before and after it mounts. */
internal object InputSizing {
  /**
   * A plain field's content width in px: the text (or the placeholder) and the
   * affixes measured with the paints the field draws them in. Its own letter
   * spacing follows every glyph; the affixes take their room with their seams.
   */
  fun plainWidthPx(f: InputFonts, format: Format, body: String): Float =
    f.affixRoom(format.prefix, InputRole.PREFIX) +
      f.paint(InputRole.BODY).measureText(body) + f.bodySpacing * body.codePointCount(0, body.length) +
      f.affixRoom(format.suffix, InputRole.SUFFIX)

  /** What a plain field measures: the placeholder when empty, bullets when secure, else the text and its tail. */
  fun plainBody(text: String, hint: String, tail: String, secure: Boolean): String = when {
    text.isEmpty() -> hint
    secure -> InputText.bullets(text)
    else -> text + tail
  }

  /** A reflowing field's width in px at rest: the engine's target, the sum of its glyphs' advances. */
  fun reflowWidthPx(f: InputFonts, format: Format, text: String, hint: String, tail: String, secure: Boolean): Float {
    val body = if (secure) InputText.bullets(text) else text
    val showPlaceholder = text.isEmpty() && hint.isNotEmpty()
    var width = 0.0
    // The engine clamps every advance at 0 (a negative letter spacing).
    InputGlyphs.walk(f, format, if (showPlaceholder) hint else body, showPlaceholder, tail) { _, _, _, advance ->
      width += max(0.0, advance.toDouble())
    }
    return width.toFloat()
  }

  /** Content width and line height in px to the reported size in dp. */
  fun reported(widthPx: Float, heightPx: Float, density: Float): NitroInputSize =
    NitroInputSize(ceil(widthPx / density + 2f).toDouble(), ceil(heightPx / density).toDouble())
}

/**
 * [NitroInputSizing] read through [InputSizingProps], so [formatOf] and
 * [sizingTypographyOf] serve the measure as they do the view.
 */
internal class SizingProps(s: NitroInputSizing) : InputSizingProps {
  override val mode = s.mode
  override val mask = s.mask
  override val maskNotations = s.maskNotations
  override val maskAutocomplete = s.maskAutocomplete
  override val maskAutoSkip = s.maskAutoSkip
  override val maskAffinityFormats = s.maskAffinityFormats
  override val maskAffinityStrategy = s.maskAffinityStrategy
  override val maskTextCase = s.maskTextCase
  override val maskCharacterMap = s.maskCharacterMap
  override val maskSlotPlaceholder = s.maskSlotPlaceholder
  override val keepPlaceholder = s.keepPlaceholder
  override val fractionDigits = s.fractionDigits
  override val maxIntegerDigits = s.maxIntegerDigits
  override val groupingSeparator = s.groupingSeparator
  override val decimalSeparator = s.decimalSeparator
  override val prefix = s.prefix
  override val suffix = s.suffix
  override val signPlacement = s.signPlacement
  override val placeholder = s.placeholder
  override val textSize = s.textSize
  override val textLineHeight = s.textLineHeight
  override val prefixFontSize = s.prefixFontSize
  override val suffixFontSize = s.suffixFontSize
  override val textWeight = s.textWeight
  override val textFamily = s.textFamily
  override val textLetterSpacing = s.textLetterSpacing
  override val prefixSpacing = s.prefixSpacing
  override val suffixSpacing = s.suffixSpacing
  override val allowFontScaling = s.allowFontScaling
  override val maxFontSizeMultiplier = s.maxFontSizeMultiplier
  override val variant = s.variant
  override val label = s.label
  override val labelBehavior = s.labelBehavior
  override val labelFontSize = s.labelFontSize
  override val cornerRadius = s.cornerRadius
}
