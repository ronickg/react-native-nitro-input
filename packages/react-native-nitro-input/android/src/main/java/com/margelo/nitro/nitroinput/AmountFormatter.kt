package com.margelo.nitro.nitroinput

import androidx.annotation.Keep
import com.facebook.jni.HybridData
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Kotlin handle to the shared C++ [AmountFormatter] (see `cpp/AmountFormatter.hpp`).
 * Offsets count code points, not UTF-16 units.
 */
@Keep
@DoNotStrip
class AmountFormatter {
  @DoNotStrip
  @Keep
  private val mHybridData: HybridData = initHybrid()

  private external fun initHybrid(): HybridData

  external fun setFormat(fractionDigits: Int, maxIntegerDigits: Int, grouping: String, decimal: String)
  /** Replaces code points `[start, end)` of [current] with [replacement]; see [lastCaret] / [lastAccepted]. */
  external fun applyEdit(current: String, start: Int, end: Int, replacement: String): String
  /** Formats arbitrary text, truncating instead of rejecting; caret ([lastCaret]) at the end. */
  external fun normalize(text: String): String
  /** Caret (code points) of the last [applyEdit] / [normalize]. */
  external fun lastCaret(): Int
  /** False when the last [applyEdit] was rejected (its text is the unchanged input). */
  external fun lastAccepted(): Boolean
  /** NaN → "". */
  external fun format(value: Double): String
  /** NaN when there are no digits. */
  external fun value(text: String): Double
  /** ReflowEngine kind of a character in formatted text. */
  external fun kindOf(codePoint: Int): Int
}
