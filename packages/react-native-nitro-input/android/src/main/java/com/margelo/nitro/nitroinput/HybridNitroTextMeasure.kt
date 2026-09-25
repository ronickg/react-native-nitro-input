package com.margelo.nitro.nitroinput

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Measures a NitroText line on the JS thread, the way [NitroTextView] lays it
 * out ([NitroTextFonts]): every code point's advance plus the letter spacing,
 * in dp.
 *
 * Mirrors `HybridNitroTextMeasure` in `HybridNitroTextView.swift` on iOS.
 */
@Keep
@DoNotStrip
class HybridNitroTextMeasure : HybridNitroTextMeasureSpec() {
  override fun measure(text: String, fontSize: Double, fontWeight: Double, fontFamily: String, letterSpacing: Double): Double {
    val entry = NitroTextFonts.entry(fontSize, fontWeight, fontFamily)
    val density = NitroTextFonts.density
    val spacingPx = (if (letterSpacing.isFinite()) letterSpacing else 0.0).toFloat() * density
    return (NitroTextFonts.width(text, entry, spacingPx) / density).toDouble()
  }

  override fun lineHeight(fontSize: Double, fontWeight: Double, fontFamily: String): Double =
    (NitroTextFonts.entry(fontSize, fontWeight, fontFamily).lineHeight / NitroTextFonts.density).toDouble()
}
