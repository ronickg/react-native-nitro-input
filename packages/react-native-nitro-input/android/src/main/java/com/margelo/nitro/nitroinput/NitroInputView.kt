package com.margelo.nitro.nitroinput

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
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
import android.view.animation.PathInterpolator
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.appcompat.widget.AppCompatEditText
import androidx.core.widget.TextViewCompat
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
 * Mirrors `NitroInputView.swift` on iOS.
 */
class NitroInputView(context: Context) : FrameLayout(context) {

  // region Configuration

  enum class Mode { TEXT, NUMBER, MASK }
  enum class AffixAlign { BASELINE, CENTER, TOP, BOTTOM }
  enum class Alignment { LEFT, CENTER, RIGHT }
  enum class TextAlignVertical { AUTO, TOP, CENTER, BOTTOM }
  enum class Easing(val raw: Int) { EXPO(0), EASE_OUT(1), EASE_IN_OUT(2), LINEAR(3), SPRING(4) }
  enum class Effect(val raw: Int) { AUTO(0), SLIDE(1), FADE(2) }
  enum class KeyboardType { DEFAULT, NUMBER_PAD, DECIMAL_PAD, NUMERIC, EMAIL_ADDRESS, PHONE_PAD, URL, ASCII_CAPABLE, NUMBERS_AND_PUNCTUATION }
  enum class ReturnKeyType { DEFAULT, DONE, GO, NEXT, SEARCH, SEND }
  enum class AutoCapitalize { NONE, SENTENCES, WORDS, CHARACTERS }
  enum class Variant { NONE, OUTLINED, FILLED }
  enum class LabelBehavior { FLOAT, ALWAYS }

  /** A caller-defined slot character for [Format.mask]. */
  data class MaskNotation(val character: String, val characterSet: String, val isOptional: Boolean)

  /**
   * The frame the view draws for itself: the outline (or fill) and the floating
   * label. Separate from [Format] because it changes independently. Lengths are
   * dp, like the rest of the props; the view scales them by density.
   *
   * Mirrors `Frame` in `NitroInputView.swift`.
   */
  data class Frame(
    val variant: Variant = Variant.NONE,
    val label: String = "",
    val labelBehavior: LabelBehavior = LabelBehavior.FLOAT,
    val labelColor: Int? = null,
    val labelFocusedColor: Int? = null,
    val labelFontSize: Float = 0f,
    val strokeColor: Int? = null,
    val focusedStrokeColor: Int? = null,
    val strokeWidth: Float = 1f,
    val cornerRadius: Float = 8f,
    val fillColor: Int? = null,
  ) {
    val draws: Boolean get() = variant != Variant.NONE
    val hasLabel: Boolean get() = draws && label.isNotEmpty()
  }

  data class Format(
    val mode: Mode = Mode.TEXT,
    /** Mask mode: the pattern, e.g. "+1 ([000]) [000]-[0000]". */
    val mask: String = "",
    val maskNotations: List<MaskNotation> = emptyList(),
    val maskAutocomplete: Boolean = true,
    val maskAutoSkip: Boolean = false,
    val fractionDigits: Int = 2,
    val maxIntegerDigits: Int = 15,
    val groupingSeparator: String = ",",
    val decimalSeparator: String = ".",
    val prefix: String = "",
    val suffix: String = "",
    /** Where a negative amount's sign sits relative to `prefix`. */
    val signBeforeAffix: Boolean = true,
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
    /** Line box height in px; `0` uses the font's own. */
    val lineHeightPx: Float = 0f
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
    /** `submitBehavior`: whether the IME action also dismisses the keyboard. */
    val blurOnSubmit: Boolean = true,
    val secureTextEntry: Boolean = false,
    /** Android autofill hint, or null for no autofill. */
    val autofillHint: String? = null,
    val showSoftInputOnFocus: Boolean = true,
    val selectTextOnFocus: Boolean = false,
    val clearTextOnFocus: Boolean = false,
    val contextMenuHidden: Boolean = false,
    val spellCheck: Boolean = true,
    /**
     * `testID` and `accessibilityLabel`, forwarded from JS so the hidden
     * EditText — the element TalkBack and e2e tools see — carries them.
     */
    val testID: String? = null,
    val accessibilityLabel: String? = null,
    /** `NitroInput`: the EditText draws its own text and the overlay is off. */
    val plain: Boolean = false,
    /**
     * Wrapping field. Always plain and always text - the JS side drops `morph`
     * and any non-text mode before it gets here - so nothing below has to
     * reconcile a wrapped run with the glyph engine.
     */
    val multiline: Boolean = false,
    /** `multiline`: lines before it scrolls; `0` grows with the content. */
    val numberOfLines: Int = 0,
    val textAlignVertical: TextAlignVertical = TextAlignVertical.AUTO,
    val scrollEnabled: Boolean = true,
  )

  data class Caret(
    val color: Int? = null,
    val selectionColor: Int? = null,
    val hidden: Boolean = false,
  )

  /** Ids of worklets registered from JS (0 = none), run synchronously on the UI thread while an edit is handled. */
  data class Worklets(
    val transform: Int = 0,
    val onChangeText: Int = 0,
    val onChangeValue: Int = 0,
    val onFocusChange: Int = 0,
    val onSelectionChange: Int = 0,
    val onSubmitEditing: Int = 0,
    val onEndEditing: Int = 0,
    val onKeyPress: Int = 0,
  )

  var worklets: Worklets = Worklets()

  var format: Format = Format()
    set(value) {
      if (field == value) return
      val old = field
      field = value
      formatter.setFormat(value.fractionDigits, value.maxIntegerDigits, value.groupingSeparator, value.decimalSeparator)
      if (value.mode == Mode.MASK &&
        (old.mode != Mode.MASK || old.mask != value.mask || old.maskNotations != value.maskNotations)
      ) {
        maskEngine.clearNotations()
        value.maskNotations.forEach { maskEngine.addNotation(it.character, it.characterSet, it.isOptional) }
        // A bad pattern leaves the engine inactive; the field then behaves as
        // plain text rather than refusing every keystroke.
        maskEngine.setFormat(value.mask)
      }
      if (old.mode != value.mode) {
        rebuildFonts()
        applyKeyboard()
      }
      applyEditTextLayout()
      applyHint()
      if (value.mode == Mode.NUMBER || value.mode == Mode.MASK) {
        // The field's own format changed: what it holds must follow it.
        val next = conform(text)
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
      val wasMultiline = field.multiline
      val wasLines = field.numberOfLines
      field = value
      applyKeyboard()
      // How tall the field wants to be depends on `multiline` and
      // `numberOfLines`, and this prop lands *after* `typography` — whose
      // `rebuildFonts` is the usual reporter. Without this a wrapping field
      // reported a single line and stayed one line tall.
      if (value.multiline != wasMultiline || value.numberOfLines != wasLines) {
        // The padding is `multiline`'s too — a wrapping field pays for both
        // edges — and it is read back below, so it has to be applied first.
        if (value.multiline != wasMultiline) applyEditTextLayout()
        reportIntrinsicSize()
      }
      maybeAutoFocus()
    }

  var caret: Caret = Caret()
    set(value) {
      if (field == value) return
      field = value
      editText.highlightColor = value.selectionColor ?: defaultHighlightColor
      applyNativeCursor()
      restartBlink()
    }

  var alignment: Alignment = Alignment.LEFT
    set(value) {
      if (field == value) return
      field = value
      applyEditTextLayout()
      overlay.invalidate()
    }

  /** The outline / fill and floating label this view draws for itself. */
  var inputFrame: Frame = Frame()
    set(value) {
      if (field == value) return
      val wasDrawing = field.draws
      field = value
      // A FrameLayout draws nothing by default; the frame goes in our own
      // onDraw, which runs before the children, so the text stays on top.
      setWillNotDraw(!value.draws)
      rebuildLabelPaint()
      applyEditTextLayout()
      // The label is also the field's accessible name when nothing else gives
      // it one, so a change to it has to reach TalkBack.
      syncAccessibilityFromHost()
      // A label resting inside the field hides the placeholder, and gaining or
      // losing one changes that. `syncLabelProgress` only reports a *change*,
      // and on mount there is none - the label starts resting - so the hint has
      // to be refreshed here or the two draw on top of each other.
      applyHint()
      if (!wasDrawing || !value.draws) {
        labelAnimator?.cancel()
        notchAnimator?.cancel()
        focusAnimator?.cancel()
      }
      syncLabelProgress(animated = false)
      syncFocusProgress(animated = false)
      // A frame changes the padding (`applyEditTextLayout` above), and a
      // wrapping field's height is that padding plus its lines. This prop lands
      // after `keyboard`, so without this the box keeps the height it reported
      // before it had a frame to make room for. `reportIntrinsicSize` compares
      // against the last report, so calling it when nothing moved costs nothing.
      reportIntrinsicSize()
      invalidate()
      overlay.invalidate()
    }

  /** Called after every native-originated change (user edit, clear, setText, setValue) with the text and its value (NaN in text mode / empty). */
  var onTextChange: ((text: String, value: Double) -> Unit)? = null
  /** Mask mode: formatted, extracted, tail placeholder, complete. */
  var onMaskChange: ((formatted: String, extracted: String, tailPlaceholder: String, complete: Boolean) -> Unit)? = null
  var onFocusChange: ((focused: Boolean) -> Unit)? = null
  var onSubmit: ((text: String) -> Unit)? = null
  var onEndEditing: ((text: String) -> Unit)? = null
  var onSelectionChange: ((start: Int, end: Int) -> Unit)? = null
  var onKeyPress: ((key: String) -> Unit)? = null
  /** Last selection handed to `onSelectionChange`, so it only fires on a move. */
  private var lastReportedSelection: Pair<Int, Int>? = 0 to 0
  /** Called with the settled intrinsic size, in dp, whenever it changes. */
  var onIntrinsicSizeChange: ((widthDp: Float, heightDp: Float) -> Unit)? = null

  /** The field's current (formatted) text. */
  var text: String = ""
    private set(value) {
      val wasEmpty = field.isEmpty()
      field = value
      // A label that floats on content follows the field going empty or not.
      if (wasEmpty != value.isEmpty()) syncLabelProgress(animated = true)
    }

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
      if (!ready) return
      restartBlink()
      reportSelection(selStart, selEnd)
    }

    override fun clearFocus() {
      // Like React Native's ReactEditText: keep the system from handing focus straight back.
      val wasFocusable = isFocusableInTouchMode
      isFocusableInTouchMode = false
      super.clearFocus()
      isFocusableInTouchMode = wasFocusable
    }
  }

  /// `contextMenuHidden`: an action-mode callback that never creates a menu.
  private object NoSelectionActionMode : android.view.ActionMode.Callback {
    override fun onCreateActionMode(mode: android.view.ActionMode?, menu: android.view.Menu?) = false
    override fun onPrepareActionMode(mode: android.view.ActionMode?, menu: android.view.Menu?) = false
    override fun onActionItemClicked(mode: android.view.ActionMode?, item: android.view.MenuItem?) = false
    override fun onDestroyActionMode(mode: android.view.ActionMode?) {}
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
  private val maskEngine = MaskEngine()
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
  private val framePaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val labelPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
  private val framePath = Path()
  private val arcOval = RectF()
  private val outlineGeometry = OutlineGeometry()
  /** Reused per draw so tracing the frame never allocates; grown on demand. */
  private var outlineBuffer = DoubleArray(OutlineGeometry.STRIDE * 16)
  private val labelRect = DoubleArray(4)
  /** 0 = label resting inside the field, 1 = floated onto the outline. */
  private var labelProgress = 0f
  private var labelAnimator: ValueAnimator? = null
  /**
   * The notch, on its own clock: it lags the label opening and leads it
   * closing, so the hole is never open under a label that is not there yet.
   */
  private var notchProgress = 0f
  private var notchAnimator: ValueAnimator? = null
  /** 0 = blurred, 1 = focused. Blends the stroke rather than snapping it. */
  private var focusProgress = 0f
  private var focusAnimator: ValueAnimator? = null
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
    // `applyPlain()` makes these real again when the overlay is off.
    editText.background = null
    editText.isCursorVisible = false
    editText.includeFontPadding = false
    editText.setSingleLine()
    defaultHighlightColor = editText.highlightColor
    editText.addTextChangedListener(Watcher())
    editText.setOnFocusChangeListener { _, focused ->
      restartBlink()
      syncLabelProgress(animated = true)
      syncFocusProgress(animated = true)
      if (focused) {
        if (keyboard.clearTextOnFocus) {
          clear()
        } else if (keyboard.selectTextOnFocus) {
          editText.post { if (editText.hasFocus()) editText.selectAll() }
        }
      }
      // A worklet handler runs on the UI thread, before the JS one hears anything.
      if (worklets.onFocusChange != 0) {
        NitroInputWorklets.runFocusChange(worklets.onFocusChange, focused, text)
      }
      if (!focused && worklets.onEndEditing != 0) {
        NitroInputWorklets.runEndEditing(worklets.onEndEditing, text)
      }
      onFocusChange?.invoke(focused)
      if (!focused) onEndEditing?.invoke(text)
    }
    editText.setOnEditorActionListener { _, actionId, event ->
      val isEnter = event != null && event.keyCode == KeyEvent.KEYCODE_ENTER
      if (isEnter && event.action != KeyEvent.ACTION_DOWN) return@setOnEditorActionListener true
      if (actionId == EditorInfo.IME_ACTION_NONE && !isEnter) return@setOnEditorActionListener false
      if (worklets.onKeyPress != 0) NitroInputWorklets.runKeyPress(worklets.onKeyPress, "Enter")
      if (worklets.onSubmitEditing != 0) {
        NitroInputWorklets.runSubmitEditing(worklets.onSubmitEditing, text)
      }
      onKeyPress?.invoke("Enter")
      onSubmit?.invoke(text)
      // `submitBehavior: 'submit'` keeps focus so a form can move on itself.
      if (keyboard.blurOnSubmit) blur()
      true
    }
    addView(editText, matchParent)

    overlay.isClickable = false
    overlay.isFocusable = false
    overlay.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    overlay.setWillNotDraw(false)
    addView(overlay, matchParent)
    // The overlay draws a hair outside its bounds while glyphs slide through the line box.
    clipChildren = false
    clipToPadding = false

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
      // `baselineNudge` re-centres the run when `lineHeight` differs from the
      // font's: the extra goes above the line, so the body sits that far lower.
      // Everything pinned to the body follows it; `CENTER` does not, because it
      // centres in the line box itself, which is already the new height.
      val bodyBaseline = lineTop + baselineNudge - bodyMetrics.ascent
      if (role == Role.BODY) return bodyBaseline
      val p = paint(role)
      val m = p.fontMetrics
      return when (if (role == Role.PREFIX) prefixAlign else suffixAlign) {
        AffixAlign.BASELINE -> bodyBaseline
        AffixAlign.CENTER -> lineTop + (lineHeight - (m.descent - m.ascent)) / 2f - m.ascent
        AffixAlign.TOP -> bodyBaseline - capHeight(Role.BODY) + capHeight(role)
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
  /**
   * A React Native activity usually runs a bare `AppCompat` theme with no text
   * appearance, so `android.R.attr.textColorHint` comes back as the *primary*
   * text colour — which draws the placeholder solid black instead of the muted
   * grey every other input on the platform shows. Derive it from the text
   * colour instead, the way iOS's `.placeholderText` is derived from `.label`:
   * theme-independent, and it still reads correctly on a dark background.
   */
  private fun defaultPlaceholderColor(): Int {
    val text = typography.color ?: defaultTextColor()
    return Color.argb(
      (Color.alpha(text) * PLACEHOLDER_ALPHA).toInt(),
      Color.red(text),
      Color.green(text),
      Color.blue(text),
    )
  }
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
    // Not `setTextSize` directly: the platform ignores it while auto-sizing is
    // on, which would leave the auto-size bounds stale after a font change.
    applyAutoSize()
    // TextViewCompat distributes the leading properly (and back-ports
    // `setLineHeight` below API 28), so the plain path needs no nudge of its
    // own - unlike the overlay, which positions its own glyphs.
    if (typography.lineHeightPx > 0f) {
      TextViewCompat.setLineHeight(editText, typography.lineHeightPx.roundToInt())
    }
    // An outlined or filled frame reserves room at the sides for its stroke and
    // at the top for the floated label. A single line is centred in whatever
    // height the caller gives it, so only the top is padded there - that moves
    // the centred text down rather than leaving it put. A wrapping field
    // reports its own height and starts at the top, so nothing else is going to
    // put space between its first line and the stroke: it pays for both edges.
    val side = frameSideInsetPx.roundToInt()
    val framePadding = if (inputFrame.draws && keyboard.multiline) {
      (FRAME_PADDING_DP * density).roundToInt()
    } else {
      0
    }
    // An outlined field's floated label straddles the top stroke, so half of it
    // hangs back into the box. A single line is centred well below it; a
    // wrapping field's first line starts at the top, right where the label is,
    // so it has to be paid for - as it is on iOS, or the same props would give
    // the two platforms different heights.
    val labelOverhang = if (inputFrame.draws && keyboard.multiline &&
      inputFrame.hasLabel && inputFrame.variant != Variant.FILLED
    ) {
      (floatedLabelSizePx / 2f).roundToInt()
    } else {
      0
    }
    editText.setPadding(
      side + f.width(format.prefix, Role.PREFIX).roundToInt(),
      frameTopInsetPx.roundToInt() + framePadding + labelOverhang,
      side + f.width(format.suffix, Role.SUFFIX).roundToInt(),
      framePadding,
    )
    applyAffixes()
    val vertical = if (!keyboard.multiline) Gravity.CENTER_VERTICAL else when (keyboard.textAlignVertical) {
      TextAlignVertical.CENTER -> Gravity.CENTER_VERTICAL
      TextAlignVertical.BOTTOM -> Gravity.BOTTOM
      else -> Gravity.TOP
    }
    editText.gravity = vertical or when (alignment) {
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
      if (!k.spellCheck) textType = textType or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
    }
    // A password variation is what keeps the IME from suggesting, learning or
    // showing the text; the overlay does the masking itself (see `feedEngine`).
    if (k.secureTextEntry) {
      textType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
      rawType = null
    }
    if (k.multiline) {
      // TYPE_TEXT_FLAG_MULTI_LINE is what makes the IME offer a return key that
      // inserts a newline rather than submitting.
      textType = textType or InputType.TYPE_TEXT_FLAG_MULTI_LINE
    }
    editText.inputType = textType
    if (rawType != null) editText.setRawInputType(rawType)
    if (k.multiline) {
      editText.setSingleLine(false)
      editText.setHorizontallyScrolling(false)
      editText.maxLines = if (k.numberOfLines > 0) k.numberOfLines else Int.MAX_VALUE
      if (k.numberOfLines > 0) editText.minLines = k.numberOfLines
      editText.isVerticalScrollBarEnabled = k.scrollEnabled
      editText.movementMethod = android.text.method.ArrowKeyMovementMethod.getInstance()
    } else {
      editText.setSingleLine()
      editText.maxLines = 1
      editText.minLines = 1
    }
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
    applyPlain()
    syncAccessibilityFromHost()
    editText.showSoftInputOnFocus = k.showSoftInputOnFocus
    editText.setTextIsSelectable(false)
    editText.isLongClickable = !k.contextMenuHidden
    editText.customSelectionActionModeCallback = if (k.contextMenuHidden) NoSelectionActionMode else null
    if (k.autofillHint != null) {
      editText.setAutofillHints(k.autofillHint)
      editText.importantForAutofill = IMPORTANT_FOR_AUTOFILL_YES
    } else {
      editText.setAutofillHints(null)
      editText.importantForAutofill = IMPORTANT_FOR_AUTOFILL_NO
    }
    if (!k.editable && editText.hasFocus()) blur()
    if (editText.hasFocus()) inputMethodManager()?.restartInput(editText)
  }

  /**
   * React Native applies `testID` and `accessibilityLabel` to the *host* view
   * that contains this one, but the EditText is the element e2e tools and
   * TalkBack interact with, so they are copied down.
   */
  private fun syncAccessibilityFromHost() {
    // The props carry the identity explicitly; the host view's own tag is the
    // fallback for a caller that set it natively.
    val testId = keyboard.testID ?: (parent as? android.view.View)?.tag as? String
    if (editText.tag != testId) editText.tag = testId
    // React Native also keys the testID under its own id, which is what e2e
    // tooling reads; mirror both.
    runCatching { editText.setTag(com.facebook.react.R.id.react_test_id, testId) }
    // A floating label is the field's visible name, but it is drawn on the
    // canvas - TalkBack cannot see it. Without this a field whose only name is
    // its `label` is announced as an unnamed edit box. An explicit
    // `accessibilityLabel` still wins.
    val label: CharSequence? = keyboard.accessibilityLabel
      ?: (parent as? android.view.View)?.contentDescription
      ?: inputFrame.label.ifEmpty { null }
    if (editText.contentDescription != label) editText.contentDescription = label
  }

  /**
   * `adjustsFontSizeToFit` in plain mode. The overlay implements it by scaling
   * the glyphs it draws, which is no help once the EditText is drawing itself,
   * so the platform's own auto-sizing has to take over - iOS uses
   * `adjustsFontSizeToFitWidth` for the same reason. Without this the prop was
   * a silent no-op on Android for every `NitroInput`.
   */
  private var prefixView: TextView? = null
  private var suffixView: TextView? = null

  /**
   * Prefix and suffix in plain mode. The overlay draws them as glyphs while it
   * is up, which is no help once the EditText draws itself - iOS uses real
   * `leftView` / `rightView` accessories for the same reason. Without these the
   * EditText's padding reserved the space (see `applyEditTextLayout`) and
   * nothing filled it, so a currency symbol was simply a gap.
   */
  private fun applyAffixes() {
    prefixView = affixView(prefixView, format.prefix, Role.PREFIX, Gravity.START)
    suffixView = affixView(suffixView, format.suffix, Role.SUFFIX, Gravity.END)
  }

  private fun affixView(existing: TextView?, affix: String, role: Role, edge: Int): TextView? {
    if (!keyboard.plain || affix.isEmpty()) {
      existing?.let { removeView(it) }
      return null
    }
    val paint = fonts.paint(role)
    val view = existing ?: TextView(context).also {
      it.isClickable = false
      it.isFocusable = false
      it.includeFontPadding = false
      it.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
      addView(it, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.MATCH_PARENT))
    }
    val side = frameSideInsetPx.roundToInt()
    (view.layoutParams as LayoutParams).gravity = edge or Gravity.CENTER_VERTICAL
    view.setPadding(if (edge == Gravity.START) side else 0, frameTopInsetPx.roundToInt(),
                    if (edge == Gravity.END) side else 0, 0)
    view.gravity = Gravity.CENTER_VERTICAL
    view.typeface = paint.typeface
    view.setTextSize(TypedValue.COMPLEX_UNIT_PX, paint.textSize)
    view.setTextColor(typography.color ?: defaultTextColor())
    if (view.text?.toString() != affix) view.text = affix
    return view
  }

  private fun applyAutoSize() {
    val t = typography
    // Only in plain mode: with the overlay up it scales the glyphs itself (see
    // `contentLayout`), and the two would fight.
    if (!keyboard.plain || !t.adjustsFontSizeToFit) {
      TextViewCompat.setAutoSizeTextTypeWithDefaults(editText, TextViewCompat.AUTO_SIZE_TEXT_TYPE_NONE)
      editText.setTextSize(TypedValue.COMPLEX_UNIT_PX, fonts.body.textSize)
      return
    }
    val max = fonts.body.textSize.roundToInt().coerceAtLeast(2)
    val min = (fonts.body.textSize * t.minimumFontScale).roundToInt().coerceIn(1, max - 1)
    TextViewCompat.setAutoSizeTextTypeUniformWithConfiguration(
      editText, min, max, 1, TypedValue.COMPLEX_UNIT_PX,
    )
  }

  /** Switches between "hidden EditText + overlay" and "the EditText draws itself". */
  private fun applyPlain() {
    if (keyboard.plain) {
      overlay.visibility = GONE
      stopAnimation()
      engine.reset()
      editText.setTextColor(typography.color ?: defaultTextColor())
      editText.setHintTextColor(typography.placeholderColor ?: defaultPlaceholderColor())
      applyNativeCursor()
      applyAutoSize()
      applyAffixes()
      editText.textAlignment = when (alignment) {
        Alignment.CENTER -> TEXT_ALIGNMENT_CENTER
        Alignment.RIGHT -> TEXT_ALIGNMENT_VIEW_END
        Alignment.LEFT -> TEXT_ALIGNMENT_VIEW_START
      }
    } else {
      overlay.visibility = VISIBLE
      editText.setTextColor(Color.TRANSPARENT)
      editText.setHintTextColor(Color.TRANSPARENT)
      applyNativeCursor()
      applyAutoSize()
      applyAffixes()
      editText.textAlignment = TEXT_ALIGNMENT_VIEW_START
    }
  }

  /**
   * The overlay draws its own caret, so the `EditText`'s is switched off for it.
   * In `plain` mode there is no overlay and the system caret is the caret —
   * tinted with `cursorColor` where the platform allows it.
   */
  private fun applyNativeCursor() {
    val visible = keyboard.plain && !caret.hidden
    if (editText.isCursorVisible != visible) editText.isCursorVisible = visible
    if (!visible) return
    val color = caret.color ?: return
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
      editText.textCursorDrawable?.let {
        it.setTint(color)
        editText.textCursorDrawable = it
      }
    }
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

  /// Moves the caret/selection to `start`..`end`, in code points.
  fun setSelection(start: Int, end: Int) {
    val count = text.codePointCount(0, text.length)
    val lower = start.coerceIn(0, count)
    val upper = end.coerceIn(lower, count)
    val from = text.offsetByCodePoints(0, lower)
    val to = text.offsetByCodePoints(0, upper)
    if (editText.selectionStart == from && editText.selectionEnd == to) return
    editText.setSelection(from, to)
  }

  /// Reports the caret/selection in code points, and only when it moved.
  private fun reportSelection(selStart: Int, selEnd: Int) {
    // A worklet handler counts as a listener too - returning on the JS one
    // alone would make a field with only a worklet report nothing.
    val handler = onSelectionChange
    if (handler == null && worklets.onSelectionChange == 0) return
    if (selStart < 0 || selEnd < 0) return
    val current = text
    val start = current.codePointCount(0, selStart.coerceIn(0, current.length))
    val end = current.codePointCount(0, selEnd.coerceIn(0, current.length))
    if (lastReportedSelection?.first == start && lastReportedSelection?.second == end) return
    lastReportedSelection = start to end
    if (worklets.onSelectionChange != 0) {
      NitroInputWorklets.runSelectionChange(worklets.onSelectionChange, start, end)
    }
    handler?.invoke(start, end)
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
    labelAnimator?.cancel()
    labelAnimator = null
    notchAnimator?.cancel()
    notchAnimator = null
    focusAnimator?.cancel()
    focusAnimator = null
  }

  /**
   * Returns the view to its pristine state so Fabric can reuse it for a new
   * element (RecyclableView). Props are re-applied by Nitro afterwards.
   */
  fun resetForRecycle() {
    worklets = Worklets()
    inputFrame = Frame()
    labelProgress = 0f
    notchProgress = 0f
    focusProgress = 0f
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
    syncAccessibilityFromHost()
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
    // Props land after the view is attached, so the host's testID is only
    // reliable once it has been measured.
    syncAccessibilityFromHost()
  }

  // endregion

  // region Text flow

  /** Text mode truncates to `maxLength`; number mode formats. */
  private fun conform(value: String): String {
    if (format.mode == Mode.NUMBER) return formatter.normalize(value)
    if (format.mode == Mode.MASK) {
      return maskEngine.applyAll(value, value.codePointCount(0, value.length), true, format.maskAutocomplete, false)
    }
    val limit = keyboard.maxLength
    if (limit <= 0) return value
    val end = utf16Index(value, limit)
    return value.substring(0, end)
  }

  private fun setProgrammatic(value: String, notify: Boolean) {
    var next = value
    if (worklets.transform != 0) {
      val count = next.codePointCount(0, next.length)
      val transformed = NitroInputWorklets.runTransform(
        worklets.transform, next, text, count, count,
        codePointIndex(text, editText.selectionStart), codePointIndex(text, editText.selectionEnd),
      )
      if (transformed != null) next = transformed
    }
    if (next == text && next == editText.text.toString()) return
    applying = true
    editText.setText(next)
    editText.text?.let { Selection.setSelection(it, it.length) }
    applying = false
    val changed = next != text
    text = next
    requestFeed(-1)
    if (notify && changed) notifyChange()
  }

  /** Worklet callbacks first (synchronously, on this thread), then the JS ones. */
  private fun notifyChange() {
    if (worklets.onChangeText != 0) NitroInputWorklets.runChangeText(worklets.onChangeText, text)
    if (worklets.onChangeValue != 0 && format.mode == Mode.NUMBER) NitroInputWorklets.runChangeValue(worklets.onChangeValue, currentValue())
    if (format.mode == Mode.MASK) {
      // Derived from the settled text so every route reports the same thing:
      // a keystroke, a programmatic set, a prop change or a transform worklet.
      maskEngine.applyAll(text, text.codePointCount(0, text.length), true, format.maskAutocomplete, false)
      onMaskChange?.invoke(text, maskEngine.lastExtracted(), maskEngine.lastTailPlaceholder(), maskEngine.lastComplete())
    }
    onTextChange?.invoke(text, currentValue())
  }

  /** Every change to the edit text (typing, backspace, paste, IME) lands here and goes through the engine. */
  private inner class Watcher : TextWatcher {
    private var previous = ""
    private var start = 0
    private var count = 0
    private var replacement = ""
    private var previousSelectionStart = 0
    private var previousSelectionEnd = 0

    override fun beforeTextChanged(s: CharSequence, start: Int, count: Int, after: Int) {
      if (applying) return
      previous = s.toString()
      this.start = start
      this.count = count
      previousSelectionStart = codePointIndex(previous, editText.selectionStart)
      previousSelectionEnd = codePointIndex(previous, editText.selectionEnd)
    }

    override fun onTextChanged(s: CharSequence, start: Int, before: Int, count: Int) {
      if (applying) return
      replacement = s.subSequence(start, min(s.length, start + count)).toString()
      // Like React Native's `onKeyPress`: the inserted text, or 'Backspace'.
      // Only for real key events — the watcher also runs for the initial set.
      if (editText.hasFocus()) {
        val key = if (replacement.isEmpty()) "Backspace" else replacement
        if (worklets.onKeyPress != 0) NitroInputWorklets.runKeyPress(worklets.onKeyPress, key)
        onKeyPress?.invoke(key)
      }
    }

    override fun afterTextChanged(s: Editable) {
      if (applying) return
      handleUserEdit(s, previous, start, count, replacement, previousSelectionStart, previousSelectionEnd)
    }
  }

  private fun handleUserEdit(
    editable: Editable,
    previous: String,
    start: Int,
    count: Int,
    replacement: String,
    previousSelectionStart: Int,
    previousSelectionEnd: Int,
  ) {
    var caretCodePoints: Int
    if (format.mode == Mode.MASK) {
      val cpStart = codePointIndex(previous, start)
      val cpEnd = codePointIndex(previous, start + count)
      val next = maskEngine.applyEdit(
        previous, cpStart, cpEnd, replacement, format.maskAutocomplete, format.maskAutoSkip,
      )
      val caret = maskEngine.lastCaret()
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
    } else if (format.mode == Mode.NUMBER) {
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
    if (worklets.transform != 0) {
      val current = editable.toString()
      val transformed = NitroInputWorklets.runTransform(
        worklets.transform, current, previous, caretCodePoints, caretCodePoints, previousSelectionStart, previousSelectionEnd,
      )
      if (transformed != null) {
        val length = transformed.codePointCount(0, transformed.length)
        val selStart = NitroInputWorklets.lastSelectionStart().let { if (it < 0) length else min(it, length) }
        val selEnd = NitroInputWorklets.lastSelectionEnd().coerceIn(selStart, length)
        setEditable(editable, transformed, selStart, selEnd)
        caretCodePoints = selStart
      }
    }
    val updated = editable.toString()
    if (updated == text) return
    text = updated
    requestFeed(caretCodePoints)
    // A wrapping field's height follows its text; the glyph engine is off, so
    // nothing else would ask.
    if (keyboard.multiline) post { reportIntrinsicSize() }
    notifyChange()
  }

  /** Replaces only the span that differs (a comma that appeared, a mask's punctuation), not the whole editable. */
  private fun setEditable(editable: Editable, value: String, caretCodePoints: Int, selectionEndCodePoints: Int = caretCodePoints) {
    applying = true
    val current = editable.toString()
    var prefix = 0
    while (prefix < current.length && prefix < value.length && current[prefix] == value[prefix]) prefix++
    var suffix = 0
    while (suffix < current.length - prefix && suffix < value.length - prefix &&
      current[current.length - 1 - suffix] == value[value.length - 1 - suffix]) suffix++
    if (prefix + suffix < current.length || prefix + suffix < value.length) {
      editable.replace(prefix, current.length - suffix, value, prefix, value.length - suffix)
    }
    Selection.setSelection(editable, utf16Index(value, caretCodePoints), utf16Index(value, selectionEndCodePoints))
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
    if (keyboard.plain) return
    val f = fonts
    engine.setReduceMotion(animationsDisabled())
    engine.beginText()
    val hint = effectivePlaceholder
    val showPlaceholder = text.isEmpty() && hint.isNotEmpty()
    // `secureTextEntry` masks what the overlay draws: the EditText keeps the
    // real text (the IME and autofill need it), every drawn glyph is a bullet.
    val body = if (keyboard.secureTextEntry) "\u2022".repeat(text.codePointCount(0, text.length)) else text
    val shown = if (showPlaceholder) hint else body

    // A negative amount reads "-$1,234.56", not "$-1,234.56": the sign belongs
    // to the amount, not to the digits after the symbol. It stays a *body*
    // glyph - it is part of the text, and the caret counts body glyphs in the
    // order they are added - and is only laid out ahead of the prefix.
    val signed = format.signBeforeAffix && !showPlaceholder && format.prefix.isNotEmpty() &&
      shown.isNotEmpty() && isSign(shown[0])
    if (signed) addRun(shown.substring(0, 1), Role.BODY, f, placeholder = false)
    addRun(format.prefix, Role.PREFIX, f, placeholder = false)
    addRun(if (signed) shown.substring(1) else shown, Role.BODY, f, placeholder = showPlaceholder)
    addRun(format.suffix, Role.SUFFIX, f, placeholder = false)
    engine.commitText(caret, now())
    fed = true
    reportIntrinsicSize()
    scheduleFrameIfNeeded()
    overlay.invalidate()
  }

  /** A leading minus, in either the keyboard's spelling or the typographic one. */
  private fun isSign(c: Char): Boolean = c == '-' || c == '\u2212'

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

  /**
   * One line, or - wrapping - as tall as the text actually is. `maxLines` caps
   * it, so a field with `numberOfLines` stops growing and scrolls instead;
   * without one it keeps growing and React follows through `onSizeChange`.
   */
  /** The height one line occupies: an explicit `lineHeight`, or the font's own. */
  private val lineBoxPx: Float
    get() = if (typography.lineHeightPx > 0f) typography.lineHeightPx else fonts.lineHeight

  private fun intrinsicHeightPx(): Float {
    if (!keyboard.multiline) return fonts.lineHeight
    // The frame's padding counts on both paths. Leaving it off this one was
    // enough to lose it entirely: at mount there is no layout yet, so this
    // branch answered, and by the time the frame arrived and set the padding
    // the answer had not changed - so the report deduplicated itself away and
    // the box kept a height with no room for its own stroke.
    val padding = (editText.paddingTop + editText.paddingBottom).toFloat()
    val layout = editText.layout ?: return fonts.lineHeight * maxOf(1, keyboard.numberOfLines) + padding
    val lines = if (keyboard.numberOfLines > 0) {
      layout.lineCount.coerceAtMost(keyboard.numberOfLines).coerceAtLeast(keyboard.numberOfLines)
    } else {
      layout.lineCount.coerceAtLeast(1)
    }
    // With an explicit line height, compute the box rather than trusting
    // `layout.height`: StaticLayout does not add the extra leading after the
    // final line, so three lines at 34 measured 97.7dp instead of 102. Asking
    // for `numberOfLines` x `lineHeight` and getting it is the contract worth
    // having, and it keeps the two platforms agreeing.
    val text = when {
      typography.lineHeightPx > 0f -> fonts.lineHeight * lines
      lines == layout.lineCount -> layout.height.toFloat()
      else -> fonts.lineHeight * lines
    }
    return text + padding
  }

  private fun reportIntrinsicSize() {
    // The reported size is always the full-size one: with shrink-to-fit the view
    // keeps its height and the scaled text is centred inside it when drawing.
    val widthDp = ceil(engine.targetWidth().toFloat() / density + 2f)
    val heightDp = ceil(intrinsicHeightPx() / density)
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

  /** Horizontal offset (px) when the content is wider than the view; follows the caret like an EditText scrolls. */
  private var scrollX = 0f

  /**
   * Where the (possibly shrunk) content box sits inside a `width` x `height` view.
   * With [trackCaret] the scroll offset is updated to keep the caret in view
   * (drawing); without it the current offset is only read (hit testing).
   */
  private fun contentLayout(width: Int, height: Int, contentWidth: Float, trackCaret: Boolean = false): ContentLayout {
    val t = typography
    var fit = 1f
    if (t.adjustsFontSizeToFit && width > 0 && contentWidth > width) {
      fit = max(min(1f, t.minimumFontScale), width / contentWidth)
    }
    val out = layoutScratch
    out.fit = fit
    val shown = contentWidth * fit
    if (width > 0 && shown > width + 0.5f) {
      // Wider than the view (no shrink-to-fit, or its floor reached): scroll so
      // the caret stays visible while editing; at rest show the start (the end
      // for right-aligned content).
      val maxScroll = shown - width
      if (trackCaret) {
        if (editText.hasFocus()) {
          val margin = 2f * density
          val index = codePointIndex(text, editText.selectionStart).coerceIn(0, engine.bodyCount())
          val caretOnScreen = engine.caretX(index).toFloat() * fit - scrollX
          if (caretOnScreen > width - margin) scrollX += caretOnScreen - (width - margin)
          else if (caretOnScreen < margin) scrollX -= margin - caretOnScreen
        } else {
          scrollX = if (alignment == Alignment.RIGHT) maxScroll else 0f
        }
      }
      scrollX = scrollX.coerceIn(0f, maxScroll)
      out.originX = -scrollX
    } else {
      scrollX = 0f
      out.originX = when (alignment) {
        Alignment.LEFT -> 0f
        Alignment.CENTER -> (width - shown) / 2f
        Alignment.RIGHT -> width - shown
      }
    }
    out.originY = (height - fonts.lineHeight * fit) / 2f
    return out
  }

  private fun drawContent(canvas: Canvas, view: View) {
    syncFromEngine()
    val f = fonts
    val side = frameSideInsetPx
    val top = frameTopInsetPx
    val boxWidth = max(0, (view.width - side * 2f).roundToInt())
    val boxHeight = max(0, (view.height - top).roundToInt())
    val layout = contentLayout(boxWidth, boxHeight, contentWidth, trackCaret = true)
    val lineHeight = f.lineHeight
    val textColor = typography.color ?: defaultTextColor()
    val placeholderColor = typography.placeholderColor ?: defaultPlaceholderColor()
    val effect = timing.effect

    val outer = canvas.save()
    // Content wider than the view is scrolled and clipped to the view's edges
    // (like an EditText); otherwise glyphs may overhang while they move.
    if (layout.originX < 0f || contentWidth * layout.fit > boxWidth + 0.5f) {
      canvas.clipRect(side, -1e5f, side + boxWidth, 1e5f)
    }
    canvas.translate(side + layout.originX, top + layout.originY)
    canvas.scale(layout.fit, layout.fit)

    for (g in glyphs) {
      if (g.opacity <= 0f) continue
      val role = ROLES[g.role.coerceIn(0, 2)]
      val paint = f.paint(role)
      val base = if (g.placeholder) placeholderColor else textColor
      paint.color = base
      // The hint colour carries its own alpha — the platform's is translucent
      // black, not grey. Multiply the morph's opacity into it rather than
      // replacing it, or the placeholder is drawn solid.
      val alpha = (Color.alpha(base) * g.opacity).roundToInt().coerceIn(0, 255)
      if (alpha == 0) continue
      paint.alpha = alpha
      val str = charString(g.character)
      val slides = effect == Effect.SLIDE || (effect == Effect.AUTO && g.kind != 0)
      canvas.save()
      // Sliding glyphs pass through the line box: clip so they appear from its
      // edges, with a 0.15 em margin so a comma's tail is never cut at rest.
      if (slides) {
        val band = min(lineHeight / 3f, 0.15f * f.paint(Role.BODY).textSize)
        canvas.clipRect(-1e5f, -band, 1e5f, lineHeight + band)
      }
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

  // endregion

  // region Outlined / filled frame

  /**
   * How far in the label - and so the text under it - starts. Far enough past
   * the corner that the notch never opens onto the arc itself.
   */
  private val labelInsetPx: Float
    get() = max(LABEL_INSET_DP * density, inputFrame.cornerRadius * density + LABEL_CORNER_GAP_DP * density)

  private val frameSideInsetPx: Float
    get() = if (inputFrame.draws) labelInsetPx else 0f

  /**
   * Room at the top for the floated label - which only the filled variant
   * needs. Its label floats inside the box, on its own line above the text. An
   * outlined field's label sits *on* the stroke, outside the content box: it
   * intrudes into the top of the frame but never onto the text's line, so the
   * text stays centred the way it would with no label at all.
   */
  private val frameTopInsetPx: Float
    get() {
      if (!inputFrame.hasLabel || inputFrame.variant != Variant.FILLED) return 0f
      // 1.4 is a fudge, not a Material metric - see the note on iOS.
      return floatedLabelSizePx * 1.4f
    }

  private val restingLabelSizePx: Float get() = fonts.paint(Role.BODY).textSize

  private val floatedLabelSizePx: Float
    get() {
      val explicit = inputFrame.labelFontSize
      if (explicit > 0f) return explicit * density
      return max(MIN_FLOATED_LABEL_DP * density, restingLabelSizePx * FLOATED_LABEL_RATIO)
    }

  /** The label floats once focused or holding text - or always, if asked. */
  private val labelShouldFloat: Boolean
    get() {
      if (!inputFrame.hasLabel) return false
      if (inputFrame.labelBehavior == LabelBehavior.ALWAYS) return true
      return editText.hasFocus() || text.isNotEmpty()
    }

  /**
   * A label resting inside the field already labels it, so the placeholder
   * waits until the label has floated clear rather than printing over it.
   */
  private val effectivePlaceholder: String
    get() = if (inputFrame.hasLabel && !labelShouldFloat) "" else format.placeholder

  private fun resolvedStrokeColor(): Int {
    val base = inputFrame.strokeColor ?: defaultPlaceholderColor()
    return blend(base, inputFrame.focusedStrokeColor ?: base, focusProgress)
  }

  private fun resolvedLabelColor(): Int {
    val resting = inputFrame.labelColor ?: defaultPlaceholderColor()
    val focused = inputFrame.labelFocusedColor ?: inputFrame.focusedStrokeColor ?: resting
    return blend(resting, focused, focusProgress)
  }

  /** Doubles while focused, the way the iOS frame thickens its stroke. */
  private val strokeWidthPx: Float
    get() = inputFrame.strokeWidth * density * (1f + focusProgress)

  private fun blend(from: Int, to: Int, t: Float): Int {
    if (t <= 0f || from == to) return from
    if (t >= 1f) return to
    fun mix(shift: Int): Int {
      val a = (from shr shift) and 0xff
      val b = (to shr shift) and 0xff
      return (a + (b - a) * t).roundToInt().coerceIn(0, 255)
    }
    return Color.argb(mix(24), mix(16), mix(8), mix(0))
  }

  /**
   * Runs the stroke to its focused colour and weight. Separate from the label:
   * a field that already holds text does not move its label on focus, but the
   * stroke still travels.
   */
  private fun syncFocusProgress(animated: Boolean) {
    if (!inputFrame.draws) {
      focusAnimator?.cancel()
      focusAnimator = null
      focusProgress = if (editText.hasFocus()) 1f else 0f
      return
    }
    val target = if (editText.hasFocus()) 1f else 0f
    if (focusAnimator == null && focusProgress == target) return
    focusAnimator?.cancel()
    focusAnimator = null
    if (!animated || !isAttachedToWindow) {
      focusProgress = target
      invalidate()
      return
    }
    focusAnimator = run(focusProgress, target, FRAME_ANIM_MS, 0L) { focusProgress = it }
  }

  private fun rebuildLabelPaint() {
    val body = fonts.paint(Role.BODY)
    labelPaint.typeface = body.typeface
    labelPaint.textSize = restingLabelSizePx
  }

  /**
   * Runs the label to where it belongs. The morph glyphs are laid out against
   * the insets, and the placeholder appears only once the label is clear of it,
   * so a change re-feeds the engine as well as redrawing.
   */
  private fun syncLabelProgress(animated: Boolean) {
    if (!inputFrame.hasLabel) {
      labelAnimator?.cancel()
      labelAnimator = null
      notchAnimator?.cancel()
      notchAnimator = null
      labelProgress = 0f
      notchProgress = 0f
      return
    }
    val target = if (labelShouldFloat) 1f else 0f
    if (labelAnimator == null && labelProgress == target && notchProgress == target) return
    labelAnimator?.cancel()
    labelAnimator = null
    notchAnimator?.cancel()
    notchAnimator = null
    if (!animated || !isAttachedToWindow) {
      labelProgress = target
      notchProgress = target
      onLabelFloatChanged()
      invalidate()
      return
    }
    // The placeholder swaps at the start of the run, not the end: it is the
    // floated label that frees the line for it.
    onLabelFloatChanged()
    labelAnimator = run(labelProgress, target, FRAME_ANIM_MS, 0L) { labelProgress = it }
    // Staggered behind the label opening, ahead of it closing - the same shape
    // MUI gives its notched outline. See the timing note in the companion.
    val opening = target == 1f
    notchAnimator = run(
      notchProgress,
      target,
      if (opening) NOTCH_OPEN_MS else NOTCH_CLOSE_MS,
      if (opening) NOTCH_OPEN_DELAY_MS else 0L,
    ) { notchProgress = it }
  }

  /** One eased float animator, invalidating as it goes. */
  private inline fun run(
    from: Float,
    to: Float,
    durationMs: Long,
    delayMs: Long,
    crossinline apply: (Float) -> Unit,
  ): ValueAnimator = ValueAnimator.ofFloat(from, to).apply {
    duration = durationMs
    startDelay = delayMs
    interpolator = DECELERATE
    addUpdateListener {
      apply(it.animatedValue as Float)
      invalidate()
    }
    start()
  }

  /** The placeholder waits for a resting label to float clear of the line. */
  private fun applyHint() {
    val hint = effectivePlaceholder
    if (editText.hint?.toString() != hint) editText.hint = hint
  }

  /** Re-feeds the engine so the placeholder follows the label. */
  private fun onLabelFloatChanged() {
    applyHint()
    requestFeed(-1)
    overlay.invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (!inputFrame.draws || width <= 0 || height <= 0) return

    val filled = inputFrame.variant == Variant.FILLED
    val stroke = strokeWidthPx
    val label = inputFrame.label
    val floatedSize = floatedLabelSizePx
    val restingSize = restingLabelSizePx

    // The notch has to match the label at its floated size whatever the
    // progress, so the two paths we tween between describe the same shape.
    labelPaint.textSize = floatedSize
    val floatedWidth = if (inputFrame.hasLabel) labelPaint.measureText(label) else 0f
    labelPaint.textSize = restingSize
    val restingWidth = if (inputFrame.hasLabel) labelPaint.measureText(label) else 0f

    val inset = labelInsetPx
    val floatedCentreY = if (filled) floatedSize * 0.9f else 0f
    // Resting: on the text's own line. A single line is centred in the box, so
    // that is the middle; a wrapping one starts at the top, and the label
    // belongs where the first character will appear rather than halfway down
    // an empty field.
    val restingCentreY = if (keyboard.multiline) {
      editText.paddingTop + lineBoxPx / 2f
    } else {
      height / 2f
    }

    outlineGeometry.lerp(
      inset.toDouble(), restingCentreY.toDouble(), restingWidth.toDouble(), restingSize.toDouble(),
      inset.toDouble(), floatedCentreY.toDouble(), floatedWidth.toDouble(), floatedSize.toDouble(),
      labelProgress.toDouble(), labelRect,
    )

    // Filled is not stroked, so its path is the fill's own edge rather than the
    // centre line of a stroke, and its bottom is square: that is the edge the
    // indicator rule sits flush against. Only the outlined variant is notched.
    val gapWidth = if (inputFrame.hasLabel && !filled) floatedWidth.toDouble() else 0.0
    if (!buildOutlinePath(
          width.toDouble(), height.toDouble(), inputFrame.cornerRadius * density.toDouble(),
          if (filled) 0.0 else stroke.toDouble(), if (filled) 0.0 else -1.0,
          inset.toDouble(), gapWidth, (LABEL_GAP_PADDING_DP * density).toDouble(), notchProgress.toDouble(),
        )
    ) {
      return
    }

    if (filled) {
      framePaint.style = Paint.Style.FILL
      framePaint.color = inputFrame.fillColor ?: defaultFillColor()
      canvas.drawPath(framePath, framePaint)
      // The active indicator, along the square bottom edge.
      framePaint.style = Paint.Style.FILL
      framePaint.color = resolvedStrokeColor()
      canvas.drawRect(0f, height - stroke, width.toFloat(), height.toFloat(), framePaint)
    } else {
      framePaint.style = Paint.Style.STROKE
      framePaint.strokeWidth = stroke
      framePaint.color = resolvedStrokeColor()
      canvas.drawPath(framePath, framePaint)
    }

    if (!inputFrame.hasLabel) return
    labelPaint.textSize = restingSize + (floatedSize - restingSize) * labelProgress
    labelPaint.color = resolvedLabelColor()
    val metrics = labelPaint.fontMetrics
    // The rect's y is the label's vertical centre, as it is on iOS.
    val baseline = labelRect[1].toFloat() - (metrics.ascent + metrics.descent) / 2f
    canvas.drawText(label, labelRect[0].toFloat(), baseline, labelPaint)
  }

  /**
   * Traces the shared geometry into [framePath]. False when the box is too
   * small to have an outline at all.
   */
  private fun buildOutlinePath(
    boxWidth: Double,
    boxHeight: Double,
    radius: Double,
    stroke: Double,
    bottomRadius: Double,
    gapLeft: Double,
    gapWidth: Double,
    gapPadding: Double,
    progress: Double,
  ): Boolean {
    var count = outlineGeometry.outline(
      boxWidth, boxHeight, radius, stroke, bottomRadius, gapLeft, gapWidth, gapPadding, progress, outlineBuffer,
    )
    if (count < 0) {
      // Only ever a handful of segments, but grow rather than guess.
      outlineBuffer = DoubleArray(outlineBuffer.size * 2)
      count = outlineGeometry.outline(
        boxWidth, boxHeight, radius, stroke, bottomRadius, gapLeft, gapWidth, gapPadding, progress, outlineBuffer,
      )
    }
    if (count <= 0) return false

    framePath.rewind()
    for (i in 0 until count) {
      val base = i * OutlineGeometry.STRIDE
      val x = outlineBuffer[base + 1].toFloat()
      val y = outlineBuffer[base + 2].toFloat()
      when (outlineBuffer[base].toInt()) {
        OutlineGeometry.MOVE -> framePath.moveTo(x, y)
        OutlineGeometry.LINE -> framePath.lineTo(x, y)
        else -> {
          // x/y is the arc's centre; the angles are the degrees `arcTo` takes.
          val r = outlineBuffer[base + 3].toFloat()
          arcOval.set(x - r, y - r, x + r, y + r)
          framePath.arcTo(arcOval, outlineBuffer[base + 4].toFloat(), outlineBuffer[base + 5].toFloat())
        }
      }
    }
    return true
  }

  /** Matches iOS's `.secondarySystemFill`, which the filled variant defaults to. */
  private fun defaultFillColor(): Int = Color.argb(0x1f, 0x78, 0x78, 0x80)

  // endregion

  // region Drawing

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
    /** Matches iOS's `.placeholderText`, which is the label colour at 30-40%. */
    private const val PLACEHOLDER_ALPHA = 0.38f
    private const val ALL_DIGITS = "0123456789"
    private const val BLINK_MS = 500L
    private const val CARET_WIDTH_DP = 2f
    /** Fraction of the line height the caret leaves free (split between top and bottom). */
    private const val CARET_INSET = 0.1f
    /** How far the label starts from the frame's left edge, at a minimum. */
    private const val LABEL_INSET_DP = 16f
    /**
     * The room a framed field keeps above and below its text. Flat, unlike the
     * side inset: that one grows with `cornerRadius` because the *label* has to
     * clear the corner curve, which is a horizontal problem. The text sits in
     * the middle of the box, so a rounder frame must not make the field taller.
     */
    private const val FRAME_PADDING_DP = 16f
    /** Clearance the label keeps past the corner arc, so the notch opens onto the straight run. */
    private const val LABEL_CORNER_GAP_DP = 8f
    /** Breathing room the notch leaves on each side of the label. */
    private const val LABEL_GAP_PADDING_DP = 4f
    /** The floated label's size, as a fraction of the resting one. */
    private const val FLOATED_LABEL_RATIO = 0.75f
    private const val MIN_FLOATED_LABEL_DP = 9f
    /**
     * Taken from Material's own text fields. MUI's OutlinedInput runs the label
     * 200ms on the standard decelerate curve and the legend's width 100ms after
     * a 50ms delay when notching, 50ms flat when un-notching. Material
     * Components Android runs label and cutout off one animator instead (167ms,
     * or 400ms `motionDurationMedium4` under an M3 theme) and snaps the stroke;
     * we animate the stroke with the label.
     */
    private const val FRAME_ANIM_MS = 200L
    private const val NOTCH_OPEN_DELAY_MS = 50L
    private const val NOTCH_OPEN_MS = 100L
    private const val NOTCH_CLOSE_MS = 50L
    /** Material's standard decelerate, the same curve the iOS side uses. */
    private val DECELERATE = PathInterpolator(0f, 0f, 0.2f, 1f)
    private val ROLES = Role.values()
  }
}
