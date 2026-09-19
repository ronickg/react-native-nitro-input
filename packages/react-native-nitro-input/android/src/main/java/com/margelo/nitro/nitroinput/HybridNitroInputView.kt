package com.margelo.nitro.nitroinput

import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.views.RecyclableView

/**
 * Nitro glue between React props / hybrid methods and [NitroInputView].
 */
@Keep
@DoNotStrip
class HybridNitroInputView(context: ThemedReactContext) : HybridNitroInputViewSpec(), RecyclableView {
  private val inputView = NitroInputView(context)
  private val mainHandler = Handler(Looper.getMainLooper())

  override val view: View
    get() = inputView

  private var isBatching = false
  private var configDirty = true
  private var textDirty = true
  /** The `text` prop value last applied to the field (null = none yet). */
  private var lastAppliedText: String? = null
  /** Native edits so far; JS echoes it back through `mostRecentEventCount`. */
  private var eventCount = 0

  // Read by getText() / getValue() / isFocused(), possibly off the main thread.
  @Volatile private var cachedText = ""
  @Volatile private var cachedValue = Double.NaN
  @Volatile private var cachedFocused = false

  init {
    inputView.onTextChange = { text, value ->
      eventCount += 1
      cachedText = text
      cachedValue = value
      onChangeText?.invoke(text, eventCount.toDouble())
      if (mode == NitroInputMode.NUMBER) onChangeValue?.invoke(value)
    }
    inputView.onFocusChange = { focused ->
      cachedFocused = focused
      onFocusChange?.invoke(focused)
    }
    inputView.onSubmit = { text -> onSubmitEditing?.invoke(text) }
    inputView.onIntrinsicSizeChange = { width, height ->
      onSizeChange?.invoke(width.toDouble(), height.toDouble())
    }
  }

  // region Props

  override var text: String = ""
    set(v) { field = v; markTextDirty() }
  override var mostRecentEventCount: Double = 0.0
    set(v) { field = v; markTextDirty() }
  override var mode: NitroInputMode = NitroInputMode.TEXT
    set(v) { field = v; markConfigDirty() }
  override var fractionDigits: Double = 2.0
    set(v) { field = v; markConfigDirty() }
  override var maxIntegerDigits: Double = 15.0
    set(v) { field = v; markConfigDirty() }
  override var groupingSeparator: String = ","
    set(v) { field = v; markConfigDirty() }
  override var decimalSeparator: String = "."
    set(v) { field = v; markConfigDirty() }
  override var prefix: String = ""
    set(v) { field = v; markConfigDirty() }
  override var suffix: String = ""
    set(v) { field = v; markConfigDirty() }
  override var prefixFontSize: Double = Double.NaN
    set(v) { field = v; markConfigDirty() }
  override var suffixFontSize: Double = Double.NaN
    set(v) { field = v; markConfigDirty() }
  override var affixAlign: NitroInputAffixAlign = NitroInputAffixAlign.BASELINE
    set(v) { field = v; markConfigDirty() }
  override var prefixAlign: NitroInputAffixAlign = NitroInputAffixAlign.BASELINE
    set(v) { field = v; markConfigDirty() }
  override var suffixAlign: NitroInputAffixAlign = NitroInputAffixAlign.BASELINE
    set(v) { field = v; markConfigDirty() }
  override var placeholder: String = ""
    set(v) { field = v; markConfigDirty() }
  override var placeholderColor: Double = Double.NaN
    set(v) { field = v; markConfigDirty() }
  override var duration: Double = 400.0
    set(v) { field = v; markConfigDirty() }
  override var easing: NitroInputEasing = NitroInputEasing.EXPO
    set(v) { field = v; markConfigDirty() }
  override var bounce: Double = 0.15
    set(v) { field = v; markConfigDirty() }
  override var effect: NitroInputEffect = NitroInputEffect.AUTO
    set(v) { field = v; markConfigDirty() }
  override var fontSize: Double = 32.0
    set(v) { field = v; markConfigDirty() }
  override var fontWeight: Double = 400.0
    set(v) { field = v; markConfigDirty() }
  override var fontFamily: String = ""
    set(v) { field = v; markConfigDirty() }
  override var color: Double = Double.NaN
    set(v) { field = v; markConfigDirty() }
  override var textAlign: NitroInputTextAlign = NitroInputTextAlign.LEFT
    set(v) { field = v; markConfigDirty() }
  override var caretColor: Double = Double.NaN
    set(v) { field = v; markConfigDirty() }
  override var selectionColor: Double = Double.NaN
    set(v) { field = v; markConfigDirty() }
  override var caretHidden: Boolean = false
    set(v) { field = v; markConfigDirty() }
  override var adjustsFontSizeToFit: Boolean = false
    set(v) { field = v; markConfigDirty() }
  override var minimumFontScale: Double = 0.5
    set(v) { field = v; markConfigDirty() }
  override var allowFontScaling: Boolean = false
    set(v) { field = v; markConfigDirty() }
  override var maxFontSizeMultiplier: Double = 0.0
    set(v) { field = v; markConfigDirty() }
  override var keyboardType: NitroInputKeyboardType = NitroInputKeyboardType.DEFAULT
    set(v) { field = v; markConfigDirty() }
  override var returnKeyType: NitroInputReturnKeyType = NitroInputReturnKeyType.DEFAULT
    set(v) { field = v; markConfigDirty() }
  override var autoCapitalize: NitroInputAutoCapitalize = NitroInputAutoCapitalize.SENTENCES
    set(v) { field = v; markConfigDirty() }
  override var autoCorrect: Boolean = true
    set(v) { field = v; markConfigDirty() }
  override var editable: Boolean = true
    set(v) { field = v; markConfigDirty() }
  override var autoFocus: Boolean = false
    set(v) { field = v; markConfigDirty() }
  override var maxLength: Double = 0.0
    set(v) { field = v; markConfigDirty() }
  override var transformWorklet: Double = 0.0
    set(v) { field = v; markConfigDirty() }
  override var onChangeTextWorklet: Double = 0.0
    set(v) { field = v; markConfigDirty() }
  override var onChangeValueWorklet: Double = 0.0
    set(v) { field = v; markConfigDirty() }
  override var onChangeText: ((text: String, eventCount: Double) -> Unit)? = null
  override var onChangeValue: ((value: Double) -> Unit)? = null
  override var onFocusChange: ((focused: Boolean) -> Unit)? = null
  override var onSubmitEditing: ((text: String) -> Unit)? = null
  override var onSizeChange: ((width: Double, height: Double) -> Unit)? = null
    set(v) {
      field = v
      onMain { inputView.resendIntrinsicSize() }
    }

  // endregion

  // region Methods

  override fun focus() = onMain { inputView.focus() }

  override fun blur() = onMain { inputView.blur() }

  override fun clear() = onMain {
    flushConfigIfNeeded()
    inputView.clear()
  }

  override fun replaceText(text: String) = onMain {
    flushConfigIfNeeded()
    inputView.replaceText(text)
  }

  override fun setValue(value: Double) = onMain {
    flushConfigIfNeeded()
    inputView.setValue(value)
  }

  override fun currentText(): String = cachedText

  override fun getValue(): Double = cachedValue

  override fun isFocused(): Boolean = cachedFocused

  // endregion

  // region Lifecycle

  override fun beforeUpdate() {
    isBatching = true
  }

  override fun afterUpdate() {
    isBatching = false
    commit()
  }

  override fun onDropView() {
    onMain { inputView.stopAnimation() }
  }

  /**
   * Fabric is about to reuse this view for another element: forget every prop,
   * the text and the edit count. Nitro re-applies the new element's props next.
   */
  override fun prepareForRecycle() {
    isBatching = true
    text = ""
    mostRecentEventCount = 0.0
    mode = NitroInputMode.TEXT
    fractionDigits = 2.0
    maxIntegerDigits = 15.0
    groupingSeparator = ","
    decimalSeparator = "."
    prefix = ""
    suffix = ""
    prefixFontSize = Double.NaN
    suffixFontSize = Double.NaN
    affixAlign = NitroInputAffixAlign.BASELINE
    prefixAlign = NitroInputAffixAlign.BASELINE
    suffixAlign = NitroInputAffixAlign.BASELINE
    placeholder = ""
    placeholderColor = Double.NaN
    duration = 400.0
    easing = NitroInputEasing.EXPO
    bounce = 0.15
    effect = NitroInputEffect.AUTO
    fontSize = 32.0
    fontWeight = 400.0
    fontFamily = ""
    color = Double.NaN
    textAlign = NitroInputTextAlign.LEFT
    caretColor = Double.NaN
    selectionColor = Double.NaN
    caretHidden = false
    adjustsFontSizeToFit = false
    minimumFontScale = 0.5
    allowFontScaling = false
    maxFontSizeMultiplier = 0.0
    keyboardType = NitroInputKeyboardType.DEFAULT
    returnKeyType = NitroInputReturnKeyType.DEFAULT
    autoCapitalize = NitroInputAutoCapitalize.SENTENCES
    autoCorrect = true
    editable = true
    autoFocus = false
    maxLength = 0.0
    transformWorklet = 0.0
    onChangeTextWorklet = 0.0
    onChangeValueWorklet = 0.0
    onChangeText = null
    onChangeValue = null
    onFocusChange = null
    onSubmitEditing = null
    onSizeChange = null
    lastAppliedText = null
    eventCount = 0
    cachedText = ""
    cachedValue = Double.NaN
    cachedFocused = false
    configDirty = true
    textDirty = true
    isBatching = false
    onMain { inputView.resetForRecycle() }
  }

  // endregion

  // region Batching

  private fun markConfigDirty() {
    configDirty = true
    commitIfNeeded()
  }

  private fun markTextDirty() {
    textDirty = true
    commitIfNeeded()
  }

  private fun commitIfNeeded() {
    if (!isBatching) commit()
  }

  private fun commit() {
    onMain {
      inputView.batch {
        flushConfigIfNeeded()
        flushTextIfNeeded()
      }
    }
  }

  /**
   * The `text` / `mostRecentEventCount` handshake: a new `text` is applied only
   * once JS has seen every native edit (a stale count means the user typed
   * since, and the field already shows what they typed).
   */
  private fun flushTextIfNeeded() {
    if (!textDirty) return
    textDirty = false
    val value = text
    if (lastAppliedText == value) return
    if (mostRecentEventCount < eventCount) return
    lastAppliedText = value
    inputView.applyText(value)
    cachedText = inputView.text
    cachedValue = inputView.currentValue()
  }

  private fun flushConfigIfNeeded() {
    if (!configDirty) return
    configDirty = false

    val size = finite(fontSize, 32.0).toFloat()
    inputView.format = NitroInputView.Format(
      mode = if (mode == NitroInputMode.NUMBER) NitroInputView.Mode.NUMBER else NitroInputView.Mode.TEXT,
      fractionDigits = clampInt(fractionDigits, 0, 9, 2),
      maxIntegerDigits = clampInt(maxIntegerDigits, 1, 30, 15),
      groupingSeparator = groupingSeparator,
      decimalSeparator = decimalSeparator,
      prefix = prefix,
      suffix = suffix,
      placeholder = placeholder,
    )
    inputView.typography = NitroInputView.Typography(
      fontSize = size,
      prefixFontSize = finite(prefixFontSize, size.toDouble()).toFloat(),
      suffixFontSize = finite(suffixFontSize, size.toDouble()).toFloat(),
      fontWeight = clampInt(fontWeight, 100, 900, 400),
      fontFamily = fontFamily.ifEmpty { null },
      color = colorFromARGB(color),
      placeholderColor = colorFromARGB(placeholderColor),
      prefixAlign = mapAffixAlign(prefixAlign),
      suffixAlign = mapAffixAlign(suffixAlign),
      adjustsFontSizeToFit = adjustsFontSizeToFit,
      minimumFontScale = finite(minimumFontScale, 0.5).coerceIn(0.05, 1.0).toFloat(),
      allowFontScaling = allowFontScaling,
      maxFontSizeMultiplier = Math.max(0.0, finite(maxFontSizeMultiplier, 0.0)).toFloat(),
    )
    inputView.worklets = NitroInputView.Worklets(
      transform = clampInt(transformWorklet, 0, Int.MAX_VALUE, 0),
      onChangeText = clampInt(onChangeTextWorklet, 0, Int.MAX_VALUE, 0),
      onChangeValue = clampInt(onChangeValueWorklet, 0, Int.MAX_VALUE, 0),
    )
    inputView.timing = NitroInputView.Timing(
      durationMs = Math.max(0.0, finite(duration, 400.0)).toLong(),
      easing = when (easing) {
        NitroInputEasing.EASEOUT -> NitroInputView.Easing.EASE_OUT
        NitroInputEasing.EASEINOUT -> NitroInputView.Easing.EASE_IN_OUT
        NitroInputEasing.LINEAR -> NitroInputView.Easing.LINEAR
        NitroInputEasing.SPRING -> NitroInputView.Easing.SPRING
        NitroInputEasing.EXPO -> NitroInputView.Easing.EXPO
      },
      bounce = finite(bounce, 0.15).coerceIn(0.0, 1.0),
      effect = when (effect) {
        NitroInputEffect.SLIDE -> NitroInputView.Effect.SLIDE
        NitroInputEffect.FADE -> NitroInputView.Effect.FADE
        NitroInputEffect.AUTO -> NitroInputView.Effect.AUTO
      },
    )
    inputView.keyboard = NitroInputView.Keyboard(
      keyboardType = when (keyboardType) {
        NitroInputKeyboardType.DEFAULT -> NitroInputView.KeyboardType.DEFAULT
        NitroInputKeyboardType.NUMBER_PAD -> NitroInputView.KeyboardType.NUMBER_PAD
        NitroInputKeyboardType.DECIMAL_PAD -> NitroInputView.KeyboardType.DECIMAL_PAD
        NitroInputKeyboardType.NUMERIC -> NitroInputView.KeyboardType.NUMERIC
        NitroInputKeyboardType.EMAIL_ADDRESS -> NitroInputView.KeyboardType.EMAIL_ADDRESS
        NitroInputKeyboardType.PHONE_PAD -> NitroInputView.KeyboardType.PHONE_PAD
        NitroInputKeyboardType.URL -> NitroInputView.KeyboardType.URL
        NitroInputKeyboardType.ASCII_CAPABLE -> NitroInputView.KeyboardType.ASCII_CAPABLE
        NitroInputKeyboardType.NUMBERS_AND_PUNCTUATION -> NitroInputView.KeyboardType.NUMBERS_AND_PUNCTUATION
      },
      returnKeyType = when (returnKeyType) {
        NitroInputReturnKeyType.DEFAULT -> NitroInputView.ReturnKeyType.DEFAULT
        NitroInputReturnKeyType.DONE -> NitroInputView.ReturnKeyType.DONE
        NitroInputReturnKeyType.GO -> NitroInputView.ReturnKeyType.GO
        NitroInputReturnKeyType.NEXT -> NitroInputView.ReturnKeyType.NEXT
        NitroInputReturnKeyType.SEARCH -> NitroInputView.ReturnKeyType.SEARCH
        NitroInputReturnKeyType.SEND -> NitroInputView.ReturnKeyType.SEND
      },
      autoCapitalize = when (autoCapitalize) {
        NitroInputAutoCapitalize.NONE -> NitroInputView.AutoCapitalize.NONE
        NitroInputAutoCapitalize.SENTENCES -> NitroInputView.AutoCapitalize.SENTENCES
        NitroInputAutoCapitalize.WORDS -> NitroInputView.AutoCapitalize.WORDS
        NitroInputAutoCapitalize.CHARACTERS -> NitroInputView.AutoCapitalize.CHARACTERS
      },
      autoCorrect = autoCorrect,
      editable = editable,
      autoFocus = autoFocus,
      maxLength = clampInt(maxLength, 0, Int.MAX_VALUE, 0),
    )
    inputView.caret = NitroInputView.Caret(
      color = colorFromARGB(caretColor),
      selectionColor = colorFromARGB(selectionColor),
      hidden = caretHidden,
    )
    inputView.alignment = when (textAlign) {
      NitroInputTextAlign.CENTER -> NitroInputView.Alignment.CENTER
      NitroInputTextAlign.RIGHT -> NitroInputView.Alignment.RIGHT
      NitroInputTextAlign.LEFT -> NitroInputView.Alignment.LEFT
    }
    // A format change may have re-normalised the field's text.
    cachedText = inputView.text
    cachedValue = inputView.currentValue()
  }

  // endregion

  private fun mapAffixAlign(align: NitroInputAffixAlign): NitroInputView.AffixAlign = when (align) {
    NitroInputAffixAlign.CENTER -> NitroInputView.AffixAlign.CENTER
    NitroInputAffixAlign.TOP -> NitroInputView.AffixAlign.TOP
    NitroInputAffixAlign.BOTTOM -> NitroInputView.AffixAlign.BOTTOM
    NitroInputAffixAlign.BASELINE -> NitroInputView.AffixAlign.BASELINE
  }

  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
  }

  private fun finite(value: Double, fallback: Double): Double = if (value.isFinite()) value else fallback

  private fun clampInt(value: Double, lower: Int, upper: Int, fallback: Int): Int {
    if (!value.isFinite()) return fallback
    return Math.rint(value).coerceIn(lower.toDouble(), upper.toDouble()).toInt()
  }

  private fun colorFromARGB(value: Double): Int? {
    if (!value.isFinite()) return null
    val bits = value.toLong().toInt()
    return Color.argb((bits ushr 24) and 0xff, (bits ushr 16) and 0xff, (bits ushr 8) and 0xff, bits and 0xff)
  }
}
