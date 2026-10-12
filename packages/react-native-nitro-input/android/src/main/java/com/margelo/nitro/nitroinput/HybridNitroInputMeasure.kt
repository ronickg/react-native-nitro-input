package com.margelo.nitro.nitroinput

import android.content.res.Resources
import android.graphics.Color
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules

/**
 * Measures a single-line field on the JS thread, before its view exists, with
 * [InputFonts], [InputText] and [InputGlyphs] - the code the view sizes itself
 * with - so it lays out at its real size in the commit that mounts it.
 * `Paint`, `ReactFontManager` and the C++ engines are safe off the main
 * thread, as React Native's own text measurement relies on.
 *
 * Mirrors `HybridNitroInputMeasure` on iOS.
 */
@Keep
@DoNotStrip
class HybridNitroInputMeasure : HybridNitroInputMeasureSpec() {
  // Reused across calls and reconfigured by each: measures come one at a
  // time from the JS thread, and the lock keeps a second runtime out.
  private val formatter = AmountFormatter()
  private val maskEngine = MaskEngine()

  @Synchronized
  override fun measure(sizing: NitroInputSizing): NitroInputSize {
    val context = NitroModules.applicationContext
    val resources = context?.resources ?: Resources.getSystem()
    val density = resources.displayMetrics.density
    val props = SizingProps(sizing)
    val format = formatOf(props)
    val fonts = InputFonts(sizingTypographyOf(props, density), density, resources.configuration.fontScale, context?.assets, Color.BLACK)
    InputText.configure(formatter, maskEngine, null, format)
    val text = InputText.conform(sizing.text, format, formatter, maskEngine, clampedInt(sizing.maxLength, 0, Int.MAX_VALUE, 0))
    val frame = sizingFrameOf(props)
    // Unfocused, as a field mounts: a label resting inside it hides the placeholder.
    val labelFloats = frame.labelBehavior == NitroInputView.LabelBehavior.ALWAYS || text.isNotEmpty()
    val hint = if (frame.hasLabel && !labelFloats) "" else InputText.basePlaceholder(format, maskEngine)
    val tail = InputText.ghostTail(text, format, maskEngine, sizing.secureTextEntry)
    val width = if (sizing.plain) {
      InputSizing.plainWidthPx(fonts, format, InputSizing.plainBody(text, hint, tail, sizing.secureTextEntry))
    } else {
      InputSizing.reflowWidthPx(fonts, format, text, hint, tail, sizing.secureTextEntry)
    }
    return InputSizing.reported(
      InputFrame.widthPx(width, frame, fonts, density),
      InputFrame.singleLineHeightPx(fonts.lineHeight, frame, fonts, density),
      density,
    )
  }
}
