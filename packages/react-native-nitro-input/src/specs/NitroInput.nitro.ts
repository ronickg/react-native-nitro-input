import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules'

/**
 * What the field holds. `'number'` formats natively as you type (grouping,
 * decimal, currency affixes); `'mask'` applies a fixed pattern (`mask`);
 * `'text'` is a plain single-line field.
 */
export type NitroInputMode = 'text' | 'number' | 'mask'

/**
 * A caller-defined slot character for `mask`, beyond the built-in
 * `0 9 A a _ - …`. `characterSet` lists every character the slot accepts.
 */
export interface NitroInputNotation {
  /** The character that stands for this slot in the mask, e.g. `'H'`. */
  character: string
  /** Every accepted character, e.g. `'0123456789abcdef'`. */
  characterSet: string
  /** An optional slot may be skipped; a mandatory one must be filled. */
  isOptional: boolean
}

/**
 * Timing curve of the morph. `'expo'` is Torph's default
 * (`cubic-bezier(0.19, 1, 0.22, 1)`): a fast take-off that settles gently.
 */
export type NitroInputEasing =
  | 'expo'
  | 'easeOut'
  | 'easeInOut'
  | 'linear'
  | 'spring'

/**
 * How characters enter and leave. `'auto'`: digits and separators slide
 * vertically through the line box (digits from above, separators from
 * below), other characters fade and scale. `'slide'` / `'fade'` force one style.
 */
export type NitroInputEffect = 'auto' | 'slide' | 'fade'

/**
 * The field's frame. `'none'` draws nothing, leaving the border to the host
 * view's own `style` as before. `'outlined'` strokes a rounded rectangle whose
 * top edge is notched around the floating label - a real hole in the path, so
 * whatever is behind the field shows through it. `'filled'` tints the box and
 * underlines it instead, with the label floating inside.
 */
export type NitroInputVariant = 'none' | 'outlined' | 'filled'

/**
 * Where the label sits. `'float'` is the Material behaviour: inline while the
 * field is empty and unfocused, floating once it is focused or has text.
 * `'always'` keeps it floated.
 */
export type NitroInputLabelBehavior = 'float' | 'always'

/** Horizontal alignment of the text inside the view's frame. */
export type NitroInputTextAlign = 'left' | 'center' | 'right'

/** Where the text sits in a field taller than one line. */
export type NitroInputTextAlignVertical = 'auto' | 'top' | 'center' | 'bottom'

/**
 * Where a negative amount's sign sits relative to a `prefix`.
 * `'beforeAffix'` (the default) reads `-$1,234.56`, which is how a locale that
 * leads with its symbol writes it. `'afterAffix'` reads `$-1,234.56`, which
 * suits a symbol styled as an ornament rather than read as part of the number -
 * small, raised, in another colour. Only the morph honours it: a plain field's
 * affixes are accessory views that sit outside the text, so it is always
 * `'afterAffix'`.
 */
export type NitroInputSignPlacement = 'beforeAffix' | 'afterAffix'

/** How a prefix/suffix drawn at a different size lines up with the text. */
export type NitroInputAffixAlign = 'baseline' | 'center' | 'top' | 'bottom'

export type NitroInputKeyboardType =
  | 'default'
  | 'number-pad'
  | 'decimal-pad'
  | 'numeric'
  | 'email-address'
  | 'phone-pad'
  | 'url'
  | 'ascii-capable'
  | 'numbers-and-punctuation'

export type NitroInputReturnKeyType =
  | 'default'
  | 'done'
  | 'go'
  | 'next'
  | 'search'
  | 'send'

export type NitroInputAutoCapitalize =
  | 'none'
  | 'sentences'
  | 'words'
  | 'characters'

/**
 * What the return key does. `'blurAndSubmit'` (the default, and what the field
 * did unconditionally before) fires `onSubmitEditing` and dismisses the
 * keyboard; `'submit'` fires it and keeps focus, which is what a form that
 * moves to the next field needs.
 */
export type NitroInputSubmitBehavior = 'submit' | 'blurAndSubmit'

/** Light or dark keyboard (iOS). `'default'` follows the system appearance. */
export type NitroInputKeyboardAppearance = 'default' | 'light' | 'dark'

export interface NitroInputProps extends HybridViewProps {
  /**
   * The text the field should show. Applied natively (formatted in `'number'`
   * mode) when it changes and `mostRecentEventCount` shows JS has seen every
   * native edit, so a parent echoing `onChangeText` back never fights the
   * user. The native side owns the text in between: typing never waits for JS.
   */
  text: string
  /**
   * The `eventCount` from the latest `onChangeText` JS has processed. A `text`
   * update carrying a stale count is ignored (the user typed since), like
   * React Native's own `TextInput`.
   */
  mostRecentEventCount: number
  /** `'text'`, `'number'` or `'mask'`. Default: `'text'`. */
  mode: NitroInputMode
  /**
   * Draw the text with the system field itself and skip the morph overlay
   * entirely: no glyph engine, no per-glyph layers, no custom caret. This is
   * what `NitroInput` renders — an ordinary native input that keeps the rest of
   * the component (native formatting, the focus path, the text-input registry
   * and keyboard-controller support) but costs no more to mount than a plain
   * `UITextField` / `EditText`. Default: `false`.
   */
  plain: boolean
  /** `'number'`: most digits allowed after the decimal separator (`0` disables the decimal). Default: `2`. */
  fractionDigits: number
  /** `'number'`: most integer digits accepted. Default: `15`. */
  maxIntegerDigits: number
  /**
   * `'mask'`: the pattern, e.g. `'+1 ([000]) [000]-[0000]'`.
   *
   * `[0]` mandatory digit, `[9]` optional digit, `[A]` mandatory letter,
   * `[a]` optional letter, `[_]` mandatory alphanumeric, `[-]` optional
   * alphanumeric, `[…]` an unbounded run of the preceding type. `{…}` is a
   * fixed block whose characters count towards the extracted value; a literal
   * outside brackets is shown but not extracted. `\\` escapes.
   *
   * An invalid pattern leaves the field unmasked rather than breaking it.
   * Default: `''`.
   */
  mask: string
  /** `'mask'`: extra slot characters beyond the built-in ones. Default: none. */
  maskNotations: NitroInputNotation[]
  /**
   * `'mask'`: fill in the pattern's constant characters as soon as the caret
   * reaches them, so typing `212` into `'+1 ([000]) [000]'` leaves
   * `'+1 (212) '`. Default: `true`.
   */
  maskAutocomplete: boolean
  /**
   * `'mask'`: backspacing at the end of a run walks back over the constants
   * `maskAutocomplete` added, instead of stopping in front of them.
   * Default: `false`.
   */
  maskAutoSkip: boolean
  /** `'number'`: inserted between every three integer digits; empty disables grouping. Default: `','`. */
  groupingSeparator: string
  /** `'number'`: between the integer and fraction digits. Default: `'.'`. */
  decimalSeparator: string
  /** The field's frame. Default: `'none'` - the host view's `style` draws the border. */
  variant: NitroInputVariant
  /** Floating label. Empty draws none (and leaves the outline unbroken). Default: `''`. */
  label: string
  /** Whether the label floats on focus or stays floated. Default: `'float'`. */
  labelBehavior: NitroInputLabelBehavior
  /** Label colour at rest, as a processed ARGB integer; `NaN` follows `placeholderColor`. */
  labelColor: number
  /** Label colour while focused; `NaN` follows `focusedStrokeColor`. */
  labelFocusedColor: number
  /** Label size when floated, in points; `0` derives it from `fontSize`. */
  labelFontSize: number
  /**
   * Frame colour, as a processed ARGB integer; `NaN` = a platform hairline grey.
   *
   * Not `outlineColor`: React Native owns that name as a CSS-outline style prop
   * on every view, and would draw its own square outline over this one.
   */
  strokeColor: number
  /** Outline colour while focused; `NaN` follows `strokeColor`. */
  focusedStrokeColor: number
  /** Outline stroke width in points. Widened while focused, as Material does. Default: `1`. */
  strokeWidth: number
  /** Corner radius of the frame, clamped to half the shorter side. Default: `8`. */
  cornerRadius: number
  /** `'filled'`: the box tint, as a processed ARGB integer; `NaN` = a platform default. */
  fillColor: number
  /** Static text drawn before the field's text (e.g. `'$'`). Default: `''`. */
  prefix: string
  /** Static text drawn after the field's text (e.g. `' USD'`). Default: `''`. */
  suffix: string
  /** Font size of `prefix` in points. Defaults to `fontSize`. */
  prefixFontSize: number
  /** Font size of `suffix` in points. Defaults to `fontSize`. */
  suffixFontSize: number
  /** Vertical alignment of prefix and suffix relative to the text. Default: `'baseline'`. */
  affixAlign: NitroInputAffixAlign
  /** Where a negative amount's sign sits relative to `prefix`. */
  signPlacement: NitroInputSignPlacement
  /** Alignment of `prefix` only. Defaults to `affixAlign`. */
  prefixAlign: NitroInputAffixAlign
  /** Alignment of `suffix` only. Defaults to `affixAlign`. */
  suffixAlign: NitroInputAffixAlign
  /** Shown (and morphed away) while the field is empty. Default: `''`. */
  placeholder: string
  /** Color of the placeholder as a processed ARGB integer; `NaN` = platform default. */
  placeholderColor: number
  /** Duration in ms of the morph played on every change. `0` snaps. Default: `400`. */
  duration: number
  /** Timing curve of the morph. Default: `'expo'`. */
  easing: NitroInputEasing
  /** Overshoot of the `'spring'` easing, `0`–`1`. Default: `0.15`. */
  bounce: number
  /** How characters enter and leave. Default: `'auto'`. */
  effect: NitroInputEffect
  /** Font size of the text in points. Default: `32`. */
  fontSize: number
  /**
   * Height of the line box in points — the CSS meaning: the total height a
   * line occupies, not extra leading. `0` (the default) uses the font's own.
   *
   * Both platforms add the difference *above* the line, so the glyphs have to
   * be nudged back down by half of it or they ride high in the box. We apply
   * that whatever the value, including a line height *tighter* than the font —
   * which is the case React Native skips
   * (`RCTApplyBaselineOffsetForRange` returns early when
   * `lineHeight < font.lineHeight`), and the reason a compressed `lineHeight`
   * renders off-centre on a `TextInput`.
   */
  lineHeight: number
  /** Numeric font weight, `100`–`900`. Default: `400`. */
  fontWeight: number
  /** Font family name; empty = system font. */
  fontFamily: string
  /** Text color as a processed ARGB integer; `NaN` = platform label color. */
  color: number
  /** Where the text sits when the view is wider than it. Default: `'left'`. */
  textAlign: NitroInputTextAlign
  /** Caret color as a processed ARGB integer; `NaN` = platform tint. */
  caretColor: number
  /** Selection highlight color as a processed ARGB integer; `NaN` = platform tint. */
  selectionColor: number
  /** Hides the caret. Default: `false`. */
  caretHidden: boolean
  /** Scale the text down when it is wider than the view (fixed `width` in style). Default: `false`. */
  adjustsFontSizeToFit: boolean
  /** Smallest scale `adjustsFontSizeToFit` may apply, `0`–`1`. Default: `0.5`. */
  minimumFontScale: number
  /** Scale the fonts with the system text size, like `Text`. Default: `false`. */
  allowFontScaling: boolean
  /** Upper bound for `allowFontScaling`; `0` = no cap. Default: `0`. */
  maxFontSizeMultiplier: number
  /** Keyboard to show. Default: `'default'` (`'decimal-pad'` / `'number-pad'` in `'number'` mode). */
  keyboardType: NitroInputKeyboardType
  /** Label of the return key. Default: `'default'`. */
  returnKeyType: NitroInputReturnKeyType
  /** Auto-capitalisation (`'text'` mode). Default: `'sentences'`. */
  autoCapitalize: NitroInputAutoCapitalize
  /** Auto-correction (`'text'` mode). Default: `true`. */
  autoCorrect: boolean
  /** Whether the user can edit the field. Default: `true`. */
  editable: boolean
  /**
   * Let the text wrap onto more than one line.
   *
   * A multiline field is always drawn by the system view — the glyph engine
   * lays one run out on one baseline, so it cannot morph wrapped text — and it
   * is always `'text'` mode, since an amount and a mask are single-line ideas.
   * Setting `morph`, `'number'` or `'mask'` alongside it is ignored, with a
   * warning. Default: `false`.
   */
  multiline: boolean
  /**
   * `multiline`: how many lines tall the field is before it scrolls. `0` (the
   * default) lets it grow with its content; the height it wants is reported
   * through `onSizeChange`.
   */
  numberOfLines: number
  /** `multiline`: where the text sits in the box. Default: `'auto'` (top). */
  textAlignVertical: NitroInputTextAlignVertical
  /**
   * `multiline`: whether the field scrolls once the text is taller than it.
   * Turning it off lets a growing field drive its own height. Default: `true`.
   */
  scrollEnabled: boolean
  /** Focus the field when it mounts. Default: `false`. */
  autoFocus: boolean
  /**
   * The `testID` / accessibility label to put on the *hidden system field*.
   * React Native applies those to the wrapping host view, but the system field
   * is the element VoiceOver, TalkBack and e2e tools actually interact with,
   * so the wrapper forwards them explicitly. Empty leaves them unset.
   */
  fieldTestID: string
  /** Accessibility label for the hidden system field. Empty leaves it unset. */
  fieldAccessibilityLabel: string
  /** What the return key does. Default: `'blurAndSubmit'`. */
  submitBehavior: NitroInputSubmitBehavior
  /** Masks the text with bullets and opts the field out of autocorrect/autofill. Default: `false`. */
  secureTextEntry: boolean
  /** Light or dark keyboard (iOS). Default: `'default'`. */
  keyboardAppearance: NitroInputKeyboardAppearance
  /**
   * iOS `UITextContentType` / Android autofill hint, as its React Native name
   * (`'username'`, `'password'`, `'oneTimeCode'`, `'telephoneNumber'`, …).
   * Empty disables autofill. Default: `''`.
   */
  textContentType: string
  /** Disables the return key until the field has text. Default: `false`. */
  enablesReturnKeyAutomatically: boolean
  /** Show the soft keyboard when the field is focused. `false` keeps focus and caret without it. Default: `true`. */
  showSoftInputOnFocus: boolean
  /** Select all the text when the field gains focus. Default: `false`. */
  selectTextOnFocus: boolean
  /** Empty the field when it gains focus. Default: `false`. */
  clearTextOnFocus: boolean
  /** Hides the Cut/Copy/Paste menu. Default: `false`. */
  contextMenuHidden: boolean
  /** Spell checking (`'text'` mode). Defaults to `autoCorrect`. */
  spellCheck: boolean
  /** Caret/selection start to apply, in code points; `-1` leaves the selection alone. Default: `-1`. */
  selectionStart: number
  /** Caret/selection end to apply, in code points; `-1` leaves the selection alone. Default: `-1`. */
  selectionEnd: number
  /** `'text'` mode: most characters accepted; `0` = unlimited. Default: `0`. */
  maxLength: number
  /**
   * Id of a `transform` worklet registered with `NitroInputWorklets` (`0` = none):
   * run synchronously on the UI thread after every edit, it can rewrite the
   * text and selection before a frame is drawn (masks, custom formats).
   */
  transformWorklet: number
  /** Id of an `onChangeText` worklet run synchronously on the UI thread after every change (`0` = none). */
  onChangeTextWorklet: number
  /** Id of an `onChangeValue` worklet run synchronously on the UI thread after every change (`0` = none). */
  onChangeValueWorklet: number
  /** Id of an `onFocus`/`onBlur` worklet run on the UI thread when focus changes (`0` = none). */
  onFocusChangeWorklet: number
  /** Id of an `onSelectionChange` worklet run on the UI thread when the caret moves (`0` = none). */
  onSelectionChangeWorklet: number
  /** Id of an `onSubmitEditing` worklet run on the UI thread when the return key is pressed (`0` = none). */
  onSubmitEditingWorklet: number
  /** Id of an `onEndEditing` worklet run on the UI thread when editing finishes (`0` = none). */
  onEndEditingWorklet: number
  /** Id of an `onKeyPress` worklet run on the UI thread before the text changes (`0` = none). */
  onKeyPressWorklet: number
  /**
   * Called after every native edit with the field's (formatted) text and a
   * monotonically increasing event count. Feed the count back through
   * `mostRecentEventCount`.
   */
  onChangeText?: (text: string, eventCount: number) => void
  /**
   * `'mask'` mode: called after every edit with the masked text, the characters
   * the user actually contributed, what is still missing, and whether every
   * mandatory slot is filled.
   */
  onChangeMask?: (formatted: string, extracted: string, tailPlaceholder: string, complete: boolean) => void
  /** `'number'` mode: called after every edit with the numeric value, `NaN` when the field is empty. */
  onChangeValue?: (value: number) => void
  /**
   * The field gained (`true`) or lost (`false`) focus. One callback rather
   * than `onFocus` / `onBlur`: those names already exist on React Native's
   * `ViewProps` with an event argument and would clash on the host component.
   */
  onFocusChange?: (focused: boolean) => void
  /** The return key was pressed. */
  onSubmitEditing?: (text: string) => void
  /** Editing finished (focus lost or the keyboard was dismissed), like React Native's `onEndEditing`. */
  onEndEditing?: (text: string) => void
  /** The selection moved: code-point offsets into the (formatted) text. */
  onSelectionChange?: (start: number, end: number) => void
  /** A key was pressed: the character, or `'Backspace'`/`'Enter'`. Fires before the text changes. */
  onKeyPress?: (key: string) => void
  /**
   * Called whenever the settled intrinsic size changes (first layout, text
   * that grew or shrank, font change). `NitroInput` uses this to size itself
   * when the style gives it no width.
   */
  onSizeChange?: (width: number, height: number) => void
}

export interface NitroInputMethods extends HybridViewMethods {
  focus(): void
  blur(): void
  /** Empties the field (morphing the characters away). */
  clear(): void
  /**
   * Replaces the text (formatted in `'number'` mode), caret at the end.
   * (Not `setText`: Nitro generates `getText`/`setText` accessors for the
   * `text` prop, and a method of the same name would collide with them.)
   */
  replaceText(text: string): void
  /** `'number'` mode: shows `value` formatted; `NaN` empties the field. */
  setValue(value: number): void
  /** The field's current (formatted) text. */
  currentText(): string
  /** `'number'` mode: the field's numeric value, `NaN` when empty. */
  getValue(): number
  isFocused(): boolean
  /**
   * Moves the caret / selection, in code points into the (formatted) text.
   * `end` defaults to `start` for a plain caret move; both are clamped.
   */
  setSelection(start: number, end: number): void
}

export type NitroInputView = HybridView<NitroInputProps, NitroInputMethods>
