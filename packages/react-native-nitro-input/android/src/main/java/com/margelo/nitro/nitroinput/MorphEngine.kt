package com.margelo.nitro.nitroinput

import androidx.annotation.Keep
import com.facebook.jni.HybridData
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Kotlin handle to the shared C++ [MorphEngine] (see `cpp/MorphEngine.hpp`).
 * Times are in seconds, widths in whatever unit the caller lays out in (px here).
 * Roles: 0 prefix, 1 body, 2 suffix. Kinds: 0 text, 1 digit, 2 grouping, 3 decimal.
 */
@Keep
@DoNotStrip
class MorphEngine {
  @DoNotStrip
  @Keep
  private val mHybridData: HybridData = initHybrid()

  private external fun initHybrid(): HybridData

  /** Easing: 0 expo, 1 easeOut, 2 easeInOut, 3 linear, 4 spring. */
  external fun setTiming(durationSeconds: Double, easing: Int, bounce: Double)
  /** Effect: 0 auto, 1 slide, 2 fade. */
  external fun setEffect(effect: Int)
  external fun setReduceMotion(reduceMotion: Boolean)
  external fun beginText()
  external fun addGlyph(character: Int, role: Int, kind: Int, width: Double, placeholder: Boolean)
  /** `caret`: body index the edit ended at, or -1 for a programmatic replacement. */
  external fun commitText(caret: Int, now: Double)
  external fun tick(now: Double): Boolean
  external fun needsFrames(): Boolean
  external fun isAnimating(): Boolean
  external fun glyphCount(): Int
  external fun contentWidth(): Double
  external fun targetWidth(): Double
  external fun bodyCount(): Int
  external fun caretX(index: Int): Double
  external fun reset()
  /**
   * Fills [out] with `[count, contentWidth, targetWidth, then per glyph: id,
   * character, role, kind, width, placeholder, x, y, opacity, scale, exiting]`
   * and returns the number of doubles written, or -1 if [out] is too small.
   */
  external fun frameInto(out: DoubleArray): Int
}
