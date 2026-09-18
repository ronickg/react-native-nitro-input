package com.margelo.nitro.nitromorphinput

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.os.Build
import android.os.SystemClock
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.Selection
import android.text.TextPaint
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Choreographer
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import androidx.appcompat.widget.AppCompatEditText
import com.facebook.react.common.assets.ReactFontManager
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The morphing input. A hidden [AppCompatEditText] filling the bounds owns the
 * keyboard, editing, selection, paste and accessibility; an overlay on top
 * draws the glyphs the shared C++ `MorphEngine` reports (through the
 * [MorphEngine] JNI handle) plus our own caret. In number mode every edit is
 * run through the shared `AmountFormatter` before it is committed, so the
 * field never shows an unformatted frame.
 *
 * Mirrors `MorphInputView.swift` on iOS.
 */
class MorphInputView(context: Context) : FrameLayout(context) {

  // region Configuration

  enum class Mode { TEXT, NUMBER }
  enum class AffixAlign { BASELINE, CENTER, TOP, BOTTOM }
  enum class Alignment { LEFT, CENTER, RIGHT }
  enum class Easing(val raw: Int) { EXPO(0), EASE_OUT(1), EASE_IN_OUT(2), LINEAR(3), SPRING(4) }
  enum class Effect(val raw: Int) { AUTO(0), SLIDE(1), FADE(2) }
  enum class KeyboardType { DEFAULT, NUMBER_PAD, DECIMAL_PAD, NUMERIC, EMAIL_ADDRESS, PHONE_PAD, URL, ASCII_CAPABLE, NUMBERS_AND_PUNCTUATION }
  enum class ReturnKeyType { DEFAULT, DONE, GO, NEXT, SEARCH, SEND }
  enum class AutoCapitalize { NONE, SENTENCES, WORDS, CHARACTERS }

  data class Format(
    val mode: Mode = Mode.TEXT,
    val fractionDigits: Int = 2,
    val maxIntegerDigits: Int = 15,
    val groupingSeparator: String = ",",
    val decimalSeparator: String = ".",
    val prefix: String = "",
    val suffix: String = "",
    val placeholder: String = "",
  )

  data class Typography(
    val fontSize: Float = 32f,
    val prefixFontSize: Float = 32f,
    val suffixFontSize: Float = 32f,
    val fontWeight: Int = 400,
    val fontFamily: String? = null,
    val color: Int? = null,
    val placeholderColor: Int? = null,
    val prefixAlign: AffixAlign = AffixAlign.BASELINE,
    val suffixAlign: AffixAlign = AffixAlign.BASELINE,
    val adjustsFontSizeToFit: Boolean = false,
    val minimumFontScale: Float = 0.5f,
    val allowFontScaling: Boolean = false,
    val maxFontSizeMultiplier: Float = 0f,
  )

  data class Timing(
    val durationMs: Long = 400,
    val easing: Easing = Easing.EXPO,
    val bounce: Double = 0.15,
    val effect: Effect = Effect.AUTO,
  )

  data class Keyboard(
    val keyboardType: KeyboardType = KeyboardType.DEFAULT,
    val returnKeyType: ReturnKeyType = ReturnKeyType.DEFAULT,
    val autoCapitalize: AutoCapitalize = AutoCapitalize.SENTENCES,
    val autoCorrect: Boolean = true,
    val editable: Boolean = true,
    val autoFocus: Boolean = false,
    /** Text mode: most characters accepted; 0 = unlimited. */
    val maxLength: Int = 0,
  )

  data class Caret(
    val color: Int? = null,
    val selectionColor: Int? = null,
    val hidden: Boolean = false,
  )

  var format: Format = Format()
    set(value) {
      if (field == value) return
      val old = field
      field = value
      formatter.setFormat(value.fractionDigits, value.maxIntegerDigits, value.groupingSeparator, value.decimalSeparator)
      if (old.mode != value.mode) {
        rebuildFonts()
        applyKeyboard()
      }
      applyEditTextLayout()
      editText.hint = value.placeholder
      if (value.mode == Mode.NUMBER) {
        // The field's own format changed: what it holds must follow it.
        val next = formatter.normalize(text)
        if (next != text) {
          setProgrammatic(next, notify = true)
          return
        }
      }
      requestFeed(-1)
    }

  var typography: Typography = Typography()
    set(value) {
      if (field == value) return
      field = value
      rebuildFonts()
      requestFeed(-1)
    }

  var timing: Timing = Timing()
    set(value) {
      field = value
      engine.setTiming(value.durationMs / 1000.0, value.easing.raw, value.bounce)
      engine.setEffect(value.effect.raw)
    }

  var keyboard: Keyboard = Keyboard()
    set(value) {
      if (field == value) return
      field = value
      applyKeyboard()
      maybeAutoFocus()
    }

  var caret: Caret = Caret()
    set(value) {
      if (field == value) return
      field = value
      editText.highlightColor = value.selectionColor ?: defaultHighlightColor
      restartBlink()
    }

  var alignment: Alignment = Alignment.LEFT
    set(value) {
      if (field == value) return
      field = value
      applyEditTextLayout()
      overlay.invalidate()
    }

  /** Called after every native-originated change (user edit, clear, setText, setValue) with the text and its value (NaN in text mode / empty). */
  var onTextChange: ((text: String, value: Double) -> Unit)? = null
  var onFocusChange: ((focused: Boolean) -> Unit)? = null
  var onSubmit: ((text: String) -> Unit)? = null
  /** Called with the settled intrinsic size, in dp, whenever it changes. */
  var onIntrinsicSizeChange: ((widthDp: Float, heightDp: Float) -> Unit)? = null

  /** The field's current (formatted) text. */
  var text: String = ""
    private set

  /** The numeric value of [text] in number mode; NaN otherwise or when empty. */
  fun currentValue(): Double = if (format.mode == Mode.NUMBER) formatter.value(text) else Double.NaN

  val hasInputFocus: Boolean
    get() = editText.hasFocus()

  // endregion

  // region Views

  /** Owns keyboard, editing, selection and accessibility; draws nothing but the selection highlight. */
  private inner class HiddenEditText(context: Context) : AppCompatEditText(context) {
    var ready = false

    override fun getOffsetForPosition(x: Float, y: Float): Int {
      if (!ready) return super.getOffsetForPosition(x, y)
      return offsetForTap(x)
    }

    override fun onSelectionChanged(selStart: Int, selEnd: Int) {
      super.onSelectionChanged(selStart, selEnd)
      if (ready) restartBlink()
    }

    override fun clearFocus() {
      // Like React Native's ReactEditText: keep the system from handing focus straight back.
      val wasFocusable = isFocusableInTouchMode
      isFocusableInTouchMode = false
      super.clearFocus()
      isFocusableInTouchMode = wasFocusable
    }
  }

  private val editText = HiddenEditText(context)
  private val overlay = object : View(context) {
    override fun onDraw(canvas: Canvas) {
      super.onDraw(canvas)
      drawContent(canvas, this)
    }
  }

  // endregion

  // region State

  private class Glyph {
    var id = 0L
    var character = 0
    var role = 1
    var kind = 0
    var width = 0f
    var placeholder = false
    var x = 0f
    var y = 0f
    var opacity = 1f
    var scale = 1f
    var exiting = false
  }

  private val engine = MorphEngine()
  private val formatter = AmountFormatter()
  private val density = context.resources.displayMetrics.density
  private var fonts: FontSet = FontSet(Typography())
  private val glyphs = ArrayList<Glyph>()
  /** Reused per frame so the JNI hop never allocates; grown on demand. */
  private var frameBuffer = DoubleArray(3 + 11 * 64)
  private var contentWidth = 0f
  private var lastReportedWidth = -1f
  private var lastReportedHeight = -1f
  /** A narrower settled size waiting for the running morph to finish before it is reported. */
  private var pendingSizeReport = false
  private var frameScheduled = false
  private var applying = false
  private var batchDepth = 0
  private var feedPending = false
  private var feedCaret = -1
  /** False until the engine was fed after construction / recycling: the first batch always feeds. */
  private var fed = false
  private var autoFocused = false
  private var blinkOn = true
  private val defaultHighlightColor: Int
  private val caretPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val charCache = HashMap<Int, String>()

  private val frameCallback = Choreographer.FrameCallback { frameTimeNanos ->
    frameScheduled = false
    engine.tick(frameTimeNanos / 1e9)
    if (pendingSizeReport && !engine.isAnimating()) reportIntrinsicSize()
    overlay.invalidate()
    scheduleFrameIfNeeded()
  }

  private val blink = object : Runnable {
    override fun run() {
      blinkOn = !blinkOn
      overlay.invalidate()
      if (shouldShowCaret()) postDelayed(this, BLINK_MS)
    }
  }

  init {
    val matchParent = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    editText.setTextColor(Color.TRANSPARENT)
    editText.setHintTextColor(Color.TRANSPARENT)
    editText.background = null
    editText.isCursorVisible = false
    editText.includeFontPadding = false
    editText.setSingleLine()
    defaultHighlightColor = editText.highlightColor
    editText.addTextChangedListener(Watcher())
    editText.setOnFocusChangeListener { _, focused ->
      restartBlink()
      onFocusChange?.invoke(focused)
    }
    editText.setOnEditorActionListener { _, actionId, event ->
      val isEnter = event != null && event.keyCode == KeyEvent.KEYCODE_ENTER
      if (isEnter && event.action != KeyEvent.ACTION_DOWN) return@setOnEditorActionListener true
      if (actionId == EditorInfo.IME_ACTION_NONE && !isEnter) return@setOnEditorActionListener false
      onSubmit?.invoke(text)
      blur()
      true
    }
    addView(editText, matchParent)

    overlay.isClickable = false
    overlay.isFocusable = false
    overlay.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    overlay.setWillNotDraw(false)
    addView(overlay, matchParent)

    applyKeyboard()
    applyEditTextLayout()
    editText.ready = true
    engine.setTiming(timing.durationMs / 1000.0, timing.easing.raw, timing.bounce)
    engine.setEffect(timing.effect.raw)
  }

  // endregion

  // region Fonts

  private enum class Role { PREFIX, BODY, SUFFIX }

  /** Body / prefix / suffix paints with per-character advance caches. */
  private inner class FontSet(t: Typography) {
    private val scale = systemFontMultiplier(t)
    val body = makePaint(t, t.fontSize * scale)
    val prefix = makePaint(t, t.prefixFontSize * scale)
    val suffix = makePaint(t, t.suffixFontSize * scale)
    private val prefixAlign = t.prefixAlign
    private val suffixAlign = t.suffixAlign
    private val bodyMetrics: Paint.FontMetrics = body.fontMetrics
    /** Height of the line box (the body paint's line height), in px. */
    val lineHeight: Float = ceil(bodyMetrics.descent - bodyMetrics.ascent)
    private val widthCaches = Array(3) { HashMap<Int, Float>() }
    private val capHeightCache = HashMap<Role, Float>()
    private val inkDescentCache = HashMap<String, Float>()

    fun paint(role: Role): TextPaint = when (role) {
      Role.BODY -> body
      Role.PREFIX -> prefix
      Role.SUFFIX -> suffix
    }

    /** Advance of one character, in px. */
    fun width(codePoint: Int, role: Role): Float =
      widthCaches[role.ordinal].getOrPut(codePoint) { paint(role).measureText(charString(codePoint)) }

    /** Sum of the per-character advances of [text] (what the engine lays out). */
    fun width(text: String, role: Role): Float {
      var total = 0f
      var i = 0
      while (i < text.length) {
        val cp = text.codePointAt(i)
        total += width(cp, role)
        i += Character.charCount(cp)
      }
      return total
    }

    /** Baseline y for `role` drawing `text`, given the top of the body line box. */
    fun baseline(role: Role, text: String, lineTop: Float): Float {
      val bodyBaseline = lineTop - bodyMetrics.ascent
      if (role == Role.BODY) return bodyBaseline
      val p = paint(role)
      val m = p.fontMetrics
      return when (if (role == Role.PREFIX) prefixAlign else suffixAlign) {
        AffixAlign.BASELINE -> bodyBaseline
        AffixAlign.CENTER -> lineTop + (lineHeight - (m.descent - m.ascent)) / 2f - m.ascent
        AffixAlign.TOP -> lineTop + (-bodyMetrics.ascent - capHeight(Role.BODY)) + capHeight(role)
        // Pin the bottom of the ink, not of the line boxes: the digits' ink ends
        // on the baseline, so "USD" sits on it too instead of hanging down to
        // where a comma's tail reaches.
        AffixAlign.BOTTOM -> bodyBaseline + inkDescent(ALL_DIGITS, Role.BODY) - inkDescent(text, role)
      }
    }

    /** How far `text`'s ink hangs below the baseline (0 for digits and capitals). */
    private fun inkDescent(text: String, role: Role): Float = inkDescentCache.getOrPut(role.name + "|" + text) {
      val bounds = Rect()
      paint(role).getTextBounds(text, 0, text.length, bounds)
      max(0, bounds.bottom).toFloat()
    }

    private fun capHeight(role: Role): Float = capHeightCache.getOrPut(role) {
      val bounds = Rect()
      paint(role).getTextBounds("0", 0, 1, bounds)
      -bounds.top.toFloat()
    }
  }

  /** System font scale for `allowFontScaling`, capped by `maxFontSizeMultiplier`. */
  private fun systemFontMultiplier(t: Typography): Float {
    if (!t.allowFontScaling) return 1f
    val multiplier = context.resources.configuration.fontScale
    return if (t.maxFontSizeMultiplier > 0f) min(multiplier, t.maxFontSizeMultiplier) else multiplier
  }

  private fun makePaint(t: Typography, sizeDp: Float): TextPaint {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
    paint.typeface = makeTypeface(t)
    paint.textSize = sizeDp * density
    paint.color = t.color ?: defaultTextColor()
    if (format.mode == Mode.NUMBER) paint.fontFeatureSettings = "tnum"
    return paint
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

  private fun resolveThemeColor(attr: Int, fallback: Int): Int {
    val value = TypedValue()
    return if (context.theme.resolveAttribute(attr, value, true)) {
      if (value.resourceId != 0) {
        try {
          context.resources.getColorStateList(value.resourceId, context.theme).defaultColor
        } catch (e: Throwable) {
          fallback
        }
      } else {
        value.data
      }
    } else {
      fallback
    }
  }

  private fun defaultTextColor(): Int = resolveThemeColor(android.R.attr.textColorPrimary, Color.BLACK)
  private fun defaultPlaceholderColor(): Int = resolveThemeColor(android.R.attr.textColorHint, 0xFF9E9E9E.toInt())
  private fun defaultCaretColor(): Int = resolveThemeColor(android.R.attr.colorAccent, 0xFF2196F3.toInt())

  private fun charString(codePoint: Int): String = charCache.getOrPut(codePoint) { String(Character.toChars(codePoint)) }

  private fun rebuildFonts() {
    fonts = FontSet(typography)
    applyEditTextLayout()
    reportIntrinsicSize()
    overlay.invalidate()
  }

  /** Mirrors our typeface, size, alignment and affix room on the hidden edit text so its selection highlight lines up. */
  private fun applyEditTextLayout() {
    val f = fonts
    editText.typeface = f.body.typeface
    editText.setTextSize(TypedValue.COMPLEX_UNIT_PX, f.body.textSize)
    editText.setPadding(f.width(format.prefix, Role.PREFIX).roundToInt(), 0, f.width(format.suffix, Role.SUFFIX).roundToInt(), 0)
    editText.gravity = Gravity.CENTER_VERTICAL or when (alignment) {
      Alignment.LEFT -> Gravity.START
      Alignment.CENTER -> Gravity.CENTER_HORIZONTAL
      Alignment.RIGHT -> Gravity.END
    }
  }

  // endregion

  // region Keyboard

  private fun applyKeyboard() {
    val k = keyboard
    val numberMode = format.mode == Mode.NUMBER
    var textType = InputType.TYPE_CLASS_TEXT
    // Number / phone classes are applied as the *raw* input type: `setInputType`
    // would install a DigitsKeyListener that filters every programmatic set too,
    // and "1,234" has to survive it.
    var rawType: Int? = null
    when (k.keyboardType) {
      KeyboardType.DEFAULT, KeyboardType.ASCII_CAPABLE -> {}
      KeyboardType.NUMBER_PAD -> rawType = InputType.TYPE_CLASS_NUMBER
      KeyboardType.DECIMAL_PAD, KeyboardType.NUMERIC -> rawType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
      KeyboardType.NUMBERS_AND_PUNCTUATION ->
        rawType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED
      KeyboardType.EMAIL_ADDRESS -> textType = textType or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
      KeyboardType.PHONE_PAD -> rawType = InputType.TYPE_CLASS_PHONE
      KeyboardType.URL -> textType = textType or InputType.TYPE_TEXT_VARIATION_URI
    }
    if (!numberMode && rawType == null) {
      textType = textType or when (k.autoCapitalize) {
        AutoCapitalize.NONE -> 0
        AutoCapitalize.SENTENCES -> InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        AutoCapitalize.WORDS -> InputType.TYPE_TEXT_FLAG_CAP_WORDS
        AutoCapitalize.CHARACTERS -> InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
      }
      textType = textType or if (k.autoCorrect) InputType.TYPE_TEXT_FLAG_AUTO_CORRECT else InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
    }
    editText.inputType = textType
    if (rawType != null) editText.setRawInputType(rawType)
    editText.setSingleLine()
    editText.imeOptions = EditorInfo.IME_FLAG_NO_EXTRACT_UI or when (k.returnKeyType) {
      ReturnKeyType.DEFAULT -> EditorInfo.IME_ACTION_UNSPECIFIED
      ReturnKeyType.DONE -> EditorInfo.IME_ACTION_DONE
      ReturnKeyType.GO -> EditorInfo.IME_ACTION_GO
      ReturnKeyType.NEXT -> EditorInfo.IME_ACTION_NEXT
      ReturnKeyType.SEARCH -> EditorInfo.IME_ACTION_SEARCH
      ReturnKeyType.SEND -> EditorInfo.IME_ACTION_SEND
    }
    editText.filters = if (!numberMode && k.maxLength > 0) arrayOf<InputFilter>(InputFilter.LengthFilter(k.maxLength)) else emptyArray<InputFilter>()
    editText.isEnabled = k.editable
    editText.isFocusable = k.editable
    editText.isFocusableInTouchMode = k.editable
    if (!k.editable && editText.hasFocus()) blur()
    if (editText.hasFocus()) inputMethodManager()?.restartInput(editText)
  }

  private fun inputMethodManager(): InputMethodManager? =
    context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager

  private fun maybeAutoFocus() {
    if (!keyboard.autoFocus || autoFocused || !isAttachedToWindow) return
    autoFocused = true
    post { focus() }
  }

  // endregion

  // region Public API

  fun focus() {
    if (!keyboard.editable) return
    editText.isFocusableInTouchMode = true
    if (!editText.hasFocus()) editText.requestFocus()
    inputMethodManager()?.showSoftInput(editText, InputMethodManager.SHOW_IMPLICIT)
  }

  fun blur() {
    if (editText.hasFocus()) editText.clearFocus()
    inputMethodManager()?.hideSoftInputFromWindow(editText.windowToken, 0)
  }

  /** Empties the field, morphing the characters away. */
  fun clear() = setProgrammatic("", notify = true)

  /** Replaces the text (formatted in number mode), caret at the end. */
  fun replaceText(value: String) = setProgrammatic(conform(value), notify = true)

  /** Number mode: shows [value] formatted; NaN empties the field. */
  fun setValue(value: Double) = setProgrammatic(formatter.format(value), notify = true)

  /** Applies the `text` prop: like [replaceText], but silently (JS already knows). */
  fun applyText(value: String) = setProgrammatic(conform(value), notify = false)

  /** Runs [block] with engine feeds coalesced into one commit at the end. */
  fun batch(block: () -> Unit) {
    batchDepth++
    try {
      block()
    } finally {
      batchDepth--
      if (batchDepth == 0 && (feedPending || !fed)) {
        feedPending = false
        val caret = feedCaret
        feedCaret = -1
        feedEngine(caret)
      }
    }
  }

  /** Re-sends the last reported intrinsic size (e.g. after a listener was attached). */
  fun resendIntrinsicSize() {
    if (lastReportedWidth < 0f) return
    onIntrinsicSizeChange?.invoke(lastReportedWidth, lastReportedHeight)
  }

  fun stopAnimation() {
    if (frameScheduled) {
      Choreographer.getInstance().removeFrameCallback(frameCallback)
      frameScheduled = false
    }
  }

  /**
   * Returns the view to its pristine state so Fabric can reuse it for a new
   * element (RecyclableView). Props are re-applied by Nitro afterwards.
   */
  fun resetForRecycle() {
    stopAnimation()
    removeCallbacks(blink)
    blur()
    applying = true
    editText.setText("")
    applying = false
    text = ""
    engine.reset()
    glyphs.clear()
    contentWidth = 0f
    lastReportedWidth = -1f
    lastReportedHeight = -1f
    pendingSizeReport = false
    feedPending = false
    feedCaret = -1
    fed = false
    autoFocused = false
    batch {
      format = Format()
      typography = Typography()
      timing = Timing()
      keyboard = Keyboard()
      caret = Caret()
      alignment = Alignment.LEFT
    }
    // onTextChange, onFocusChange, onSubmit and onIntrinsicSizeChange are the
    // hybrid's wiring, not the element's props: they stay across recycling
    // (the hybrid clears its own callback props).
    overlay.invalidate()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    scheduleFrameIfNeeded()
    restartBlink()
    maybeAutoFocus()
  }

  override fun onDetachedFromWindow() {
    stopAnimation()
    removeCallbacks(blink)
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    overlay.invalidate()
  }

  // endregion

  // region Text flow

  /** Text mode truncates to `maxLength`; number mode formats. */
  private fun conform(value: String): String {
    if (format.mode == Mode.NUMBER) return formatter.normalize(value)
    val limit = keyboard.maxLength
    if (limit <= 0) return value
    val end = utf16Index(value, limit)
    return value.substring(0, end)
  }

  private fun setProgrammatic(next: String, notify: Boolean) {
    if (next == text && next == editText.text.toString()) return
    applying = true
    editText.setText(next)
    editText.text?.let { Selection.setSelection(it, it.length) }
    applying = false
    val changed = next != text
    text = next
    requestFeed(-1)
    if (notify && changed) onTextChange?.invoke(text, currentValue())
  }

  /** Every change to the edit text (typing, backspace, paste, IME) lands here and goes through the engine. */
  private inner class Watcher : TextWatcher {
    private var previous = ""
    private var start = 0
    private var count = 0
    private var replacement = ""

    override fun beforeTextChanged(s: CharSequence, start: Int, count: Int, after: Int) {
      if (applying) return
      previous = s.toString()
      this.start = start
      this.count = count
    }

    override fun onTextChanged(s: CharSequence, start: Int, before: Int, count: Int) {
      if (applying) return
      replacement = s.subSequence(start, min(s.length, start + count)).toString()
    }

    override fun afterTextChanged(s: Editable) {
      if (applying) return
      handleUserEdit(s, previous, start, count, replacement)
    }
  }

  private fun handleUserEdit(editable: Editable, previous: String, start: Int, count: Int, replacement: String) {
    val caretCodePoints: Int
    if (format.mode == Mode.NUMBER) {
      val cpStart = codePointIndex(previous, start)
      val cpEnd = codePointIndex(previous, start + count)
      val next = formatter.applyEdit(previous, cpStart, cpEnd, replacement)
      val caret = formatter.lastCaret()
      if (!formatter.lastAccepted()) {
        // Too many digits: the keystroke never shows.
        setEditable(editable, previous, caret)
        return
      }
      if (next != editable.toString()) {
        setEditable(editable, next, caret)
      } else {
        val sel = utf16Index(next, caret)
        if (editText.selectionStart != sel || editText.selectionEnd != sel) {
          applying = true
          Selection.setSelection(editable, sel)
          applying = false
        }
      }
      caretCodePoints = caret
    } else {
      caretCodePoints = codePointIndex(editable.toString(), start + replacement.length)
    }
    val updated = editable.toString()
    if (updated == text) return
    text = updated
    requestFeed(caretCodePoints)
    onTextChange?.invoke(text, currentValue())
  }

  private fun setEditable(editable: Editable, value: String, caretCodePoints: Int) {
    applying = true
    editable.replace(0, editable.length, value)
    Selection.setSelection(editable, utf16Index(value, caretCodePoints))
    applying = false
  }

  /** Feeds now, or once at the end of the enclosing [batch] (-1 wins over a caret). */
  private fun requestFeed(caret: Int) {
    if (batchDepth > 0) {
      feedCaret = if (feedPending && feedCaret == -1) -1 else caret
      feedPending = true
    } else {
      feedEngine(caret)
    }
  }

  /** Hands the engine the prefix, body (or placeholder) and suffix as glyphs and commits. */
  private fun feedEngine(caret: Int) {
    val f = fonts
    engine.setReduceMotion(animationsDisabled())
    engine.beginText()
    addRun(format.prefix, Role.PREFIX, f, placeholder = false)
    val showPlaceholder = text.isEmpty() && format.placeholder.isNotEmpty()
    addRun(if (showPlaceholder) format.placeholder else text, Role.BODY, f, placeholder = showPlaceholder)
    addRun(format.suffix, Role.SUFFIX, f, placeholder = false)
    engine.commitText(caret, now())
    fed = true
    reportIntrinsicSize()
    scheduleFrameIfNeeded()
    overlay.invalidate()
  }

  private fun addRun(s: String, role: Role, f: FontSet, placeholder: Boolean) {
    val numberKinds = role == Role.BODY && format.mode == Mode.NUMBER
    var i = 0
    while (i < s.length) {
      val cp = s.codePointAt(i)
      val kind = if (numberKinds) formatter.kindOf(cp) else 0
      engine.addGlyph(cp, role.ordinal, kind, f.width(cp, role).toDouble(), placeholder)
      i += Character.charCount(cp)
    }
  }

  /** Nearest glyph boundary to a tap, as a UTF-16 offset into the edit text. */
  private fun offsetForTap(x: Float): Int {
    val layout = contentLayout(overlay.width, overlay.height, contentWidth)
    val contentX = (x - layout.originX) / layout.fit
    val bodyCount = engine.bodyCount()
    val current = editText.text?.toString() ?: ""
    val limit = min(bodyCount, current.codePointCount(0, current.length))
    var best = 0
    var bestDistance = Float.MAX_VALUE
    for (index in 0..limit) {
      val distance = abs(engine.caretX(index).toFloat() - contentX)
      if (distance < bestDistance) {
        bestDistance = distance
        best = index
      }
    }
    return utf16Index(current, best)
  }

  private fun codePointIndex(s: String, utf16: Int): Int = s.codePointCount(0, utf16.coerceIn(0, s.length))

  private fun utf16Index(s: String, codePoints: Int): Int {
    val total = s.codePointCount(0, s.length)
    return s.offsetByCodePoints(0, codePoints.coerceIn(0, total))
  }

  // endregion

  // region Frame loop

  private fun now(): Double = SystemClock.uptimeMillis() / 1000.0

  private fun scheduleFrameIfNeeded() {
    if (!frameScheduled && engine.needsFrames()) {
      frameScheduled = true
      Choreographer.getInstance().postFrameCallback(frameCallback)
    }
  }

  /** True when the user removed animations (Android's animator scale is 0), the equivalent of Reduce Motion. */
  private fun animationsDisabled(): Boolean {
    val scale = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ValueAnimator.getDurationScale()
    } else {
      android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    }
    return scale <= 0f
  }

  /** Pulls the engine's render state into reusable [Glyph] objects (no per-frame allocation once warm). */
  private fun syncFromEngine() {
    var written = engine.frameInto(frameBuffer)
    if (written < 0) {
      frameBuffer = DoubleArray(3 + 11 * (engine.glyphCount() + 32))
      written = engine.frameInto(frameBuffer)
      if (written < 0) return
    }
    val f = frameBuffer
    val count = f[0].toInt()
    contentWidth = f[1].toFloat()
    while (glyphs.size < count) glyphs.add(Glyph())
    while (glyphs.size > count) glyphs.removeAt(glyphs.size - 1)
    for (i in 0 until count) {
      val base = 3 + i * 11
      val g = glyphs[i]
      g.id = f[base].toLong()
      g.character = f[base + 1].toInt()
      g.role = f[base + 2].toInt()
      g.kind = f[base + 3].toInt()
      g.width = f[base + 4].toFloat()
      g.placeholder = f[base + 5] != 0.0
      g.x = f[base + 6].toFloat()
      g.y = f[base + 7].toFloat()
      g.opacity = f[base + 8].toFloat()
      g.scale = f[base + 9].toFloat()
      g.exiting = f[base + 10] != 0.0
    }
  }

  // endregion

  // region Intrinsic size

  private fun reportIntrinsicSize() {
    // The reported size is always the full-size one: with shrink-to-fit the view
    // keeps its height and the scaled text is centred inside it when drawing.
    val widthDp = ceil(engine.targetWidth().toFloat() / density + 2f)
    val heightDp = ceil(fonts.lineHeight / density)
    if (abs(widthDp - lastReportedWidth) <= 0.01f && abs(heightDp - lastReportedHeight) <= 0.01f) {
      pendingSizeReport = false
      return
    }
    // Growing: report right away so React widens the box before the new glyph
    // has arrived. Shrinking mid-morph: keep the wider box until the morph has
    // finished, otherwise adjustsFontSizeToFit would squeeze the leaving glyphs.
    if (lastReportedWidth > 0f && widthDp < lastReportedWidth && engine.isAnimating()) {
      pendingSizeReport = true
      return
    }
    pendingSizeReport = false
    lastReportedWidth = widthDp
    lastReportedHeight = heightDp
    onIntrinsicSizeChange?.invoke(widthDp, heightDp)
  }

  // endregion

  // region Drawing

  private class ContentLayout(var originX: Float = 0f, var originY: Float = 0f, var fit: Float = 1f)

  private val layoutScratch = ContentLayout()

  /** Where the (possibly shrunk) content box sits inside a `width` x `height` view. */
  private fun contentLayout(width: Int, height: Int, contentWidth: Float): ContentLayout {
    val t = typography
    var fit = 1f
    if (t.adjustsFontSizeToFit && width > 0 && contentWidth > width) {
      fit = max(min(1f, t.minimumFontScale), width / contentWidth)
    }
    val out = layoutScratch
    out.fit = fit
    out.originX = when (alignment) {
      Alignment.LEFT -> 0f
      Alignment.CENTER -> (width - contentWidth * fit) / 2f
      Alignment.RIGHT -> width - contentWidth * fit
    }
    out.originY = (height - fonts.lineHeight * fit) / 2f
    return out
  }

  private fun drawContent(canvas: Canvas, view: View) {
    syncFromEngine()
    val f = fonts
    val layout = contentLayout(view.width, view.height, contentWidth)
    val lineHeight = f.lineHeight
    val textColor = typography.color ?: defaultTextColor()
    val placeholderColor = typography.placeholderColor ?: defaultPlaceholderColor()
    val effect = timing.effect

    val outer = canvas.save()
    canvas.translate(layout.originX, layout.originY)
    canvas.scale(layout.fit, layout.fit)

    for (g in glyphs) {
      val alpha = (g.opacity * 255f).roundToInt().coerceIn(0, 255)
      if (alpha == 0) continue
      val role = ROLES[g.role.coerceIn(0, 2)]
      val paint = f.paint(role)
      paint.color = if (g.placeholder) placeholderColor else textColor
      paint.alpha = alpha
      val str = charString(g.character)
      val slides = effect == Effect.SLIDE || (effect == Effect.AUTO && g.kind != 0)
      canvas.save()
      // Sliding glyphs pass through the line box: clip so they appear from its edges.
      if (slides) canvas.clipRect(-1e5f, 0f, 1e5f, lineHeight)
      if (g.scale != 1f) canvas.scale(g.scale, g.scale, g.x + g.width / 2f, lineHeight / 2f)
      canvas.drawText(str, g.x, f.baseline(role, str, 0f) + g.y * lineHeight, paint)
      canvas.restore()
    }

    if (shouldShowCaret() && blinkOn) {
      val index = codePointIndex(text, editText.selectionStart).coerceIn(0, engine.bodyCount())
      val x = engine.caretX(index).toFloat()
      val w = CARET_WIDTH_DP * density
      val h = lineHeight * (1f - CARET_INSET)
      val top = (lineHeight - h) / 2f
      caretPaint.color = caret.color ?: defaultCaretColor()
      canvas.drawRoundRect(x, top, x + w, top + h, w / 2f, w / 2f, caretPaint)
    }
    canvas.restoreToCount(outer)
  }

  private fun shouldShowCaret(): Boolean =
    isAttachedToWindow && editText.hasFocus() && !caret.hidden && editText.selectionStart == editText.selectionEnd

  private fun restartBlink() {
    removeCallbacks(blink)
    blinkOn = true
    overlay.invalidate()
    if (shouldShowCaret()) postDelayed(blink, BLINK_MS)
  }

  // endregion

  companion object {
    private const val ALL_DIGITS = "0123456789"
    private const val BLINK_MS = 500L
    private const val CARET_WIDTH_DP = 2f
    /** Fraction of the line height the caret leaves free (split between top and bottom). */
    private const val CARET_INSET = 0.1f
    private val ROLES = Role.values()
  }
}
