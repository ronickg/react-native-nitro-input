package com.margelo.nitro.nitroinput

import androidx.annotation.Keep
import com.facebook.jni.HybridData
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Kotlin handle to the shared C++ [MaskEngine] (see `cpp/MaskEngine.hpp`).
 * Offsets count code points, not UTF-16 units.
 *
 * [applyEdit] and [apply] return the masked text; the rest of the result is
 * read back with the `last*` accessors, so only strings and scalars cross JNI.
 */
@Keep
@DoNotStrip
class MaskEngine {
  @DoNotStrip
  @Keep
  private val mHybridData: HybridData = initHybrid()

  private external fun initHybrid(): HybridData

  /** Stages notations for the next [setFormat]. */
  external fun clearNotations()
  external fun addNotation(character: String, characterSet: String, isOptional: Boolean)
  /** False when the pattern is malformed; the engine then passes text through. */
  external fun setFormat(format: String): Boolean
  external fun isActive(): Boolean

  /** Replaces code points `[start, end)` of [current] with [replacement]. */
  external fun applyEdit(
    current: String,
    start: Int,
    end: Int,
    replacement: String,
    autocomplete: Boolean,
    autoSkip: Boolean,
  ): String

  /** Masks [text] whole. Not `apply`, which is a Kotlin scope function. */
  external fun applyAll(text: String, caret: Int, caretForward: Boolean, autocomplete: Boolean, autoSkip: Boolean): String

  /** Caret (code points) of the last [applyEdit] / [applyAll]. */
  external fun lastCaret(): Int
  /** The characters the user contributed, without free literals. */
  external fun lastExtracted(): String
  /** What is still missing from the pattern. */
  external fun lastTailPlaceholder(): String
  /** Whether every mandatory slot is filled. */
  external fun lastComplete(): Boolean
  /** The whole mask with nothing typed into it. */
  external fun placeholder(): String
}
