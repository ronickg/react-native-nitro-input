package com.margelo.nitro.nitromorphinput

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Runs worklets registered from JS synchronously on the UI thread (see
 * `cpp/worklets/MorphWorkletsBridge.hpp`). Every call is a no-op when
 * react-native-worklets is not installed or JS has not installed the runtime.
 */
@Keep
@DoNotStrip
object MorphWorklets {
  @JvmStatic external fun isReady(): Boolean

  /** The transformed text, or null when the worklet did not apply; the selection is in [lastSelectionStart] / [lastSelectionEnd]. */
  @JvmStatic external fun runTransform(
    id: Int,
    text: String,
    previousText: String,
    selectionStart: Int,
    selectionEnd: Int,
    previousSelectionStart: Int,
    previousSelectionEnd: Int,
  ): String?

  @JvmStatic external fun lastSelectionStart(): Int
  @JvmStatic external fun lastSelectionEnd(): Int
  @JvmStatic external fun runChangeText(id: Int, text: String)
  @JvmStatic external fun runChangeValue(id: Int, value: Double)
}
