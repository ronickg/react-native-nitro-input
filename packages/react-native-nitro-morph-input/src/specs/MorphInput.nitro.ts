import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules'

/**
 * What the field holds. `'number'` formats natively as you type (grouping,
 * decimal, currency affixes); `'text'` is a plain single-line field.
 */
export type MorphInputMode = 'text' | 'number'

/**
 * Timing curve of the morph. `'expo'` is Torph's default
 * (`cubic-bezier(0.19, 1, 0.22, 1)`): a fast take-off that settles gently.
 */
export type MorphInputEasing =
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
export type MorphInputEffect = 'auto' | 'slide' | 'fade'

/** Horizontal alignment of the text inside the view's frame. */
export type MorphInputTextAlign = 'left' | 'center' | 'right'

/** How a prefix/suffix drawn at a different size lines up with the text. */
export type MorphInputAffixAlign = 'baseline' | 'center' | 'top' | 'bottom'

export type MorphInputKeyboardType =
  | 'default'
  | 'number-pad'
  | 'decimal-pad'
  | 'numeric'
  | 'email-address'
  | 'phone-pad'
  | 'url'
  | 'ascii-capable'
  | 'numbers-and-punctuation'

export type MorphInputReturnKeyType =
  | 'default'
  | 'done'
  | 'go'
  | 'next'
  | 'search'
  | 'send'

export type MorphInputAutoCapitalize =
  | 'none'
  | 'sentences'
  | 'words'
  | 'characters'

export interface MorphInputProps extends HybridViewProps {
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
  /** `'text'` or `'number'`. Default: `'text'`. */
  mode: MorphInputMode
  /** `'number'`: most digits allowed after the decimal separator (`0` disables the decimal). Default: `2`. */
  fractionDigits: number
  /** `'number'`: most integer digits accepted. Default: `15`. */
  maxIntegerDigits: number
  /** `'number'`: inserted between every three integer digits; empty disables grouping. Default: `','`. */
  groupingSeparator: string
  /** `'number'`: between the integer and fraction digits. Default: `'.'`. */
  decimalSeparator: string
  /** Static text drawn before the field's text (e.g. `'$'`). Default: `''`. */
  prefix: string
  /** Static text drawn after the field's text (e.g. `' USD'`). Default: `''`. */
  suffix: string
  /** Font size of `prefix` in points. Defaults to `fontSize`. */
  prefixFontSize: number
  /** Font size of `suffix` in points. Defaults to `fontSize`. */
  suffixFontSize: number
  /** Vertical alignment of prefix and suffix relative to the text. Default: `'baseline'`. */
  affixAlign: MorphInputAffixAlign
  /** Alignment of `prefix` only. Defaults to `affixAlign`. */
  prefixAlign: MorphInputAffixAlign
  /** Alignment of `suffix` only. Defaults to `affixAlign`. */
  suffixAlign: MorphInputAffixAlign
  /** Shown (and morphed away) while the field is empty. Default: `''`. */
  placeholder: string
  /** Color of the placeholder as a processed ARGB integer; `NaN` = platform default. */
  placeholderColor: number
  /** Duration in ms of the morph played on every change. `0` snaps. Default: `400`. */
  duration: number
  /** Timing curve of the morph. Default: `'expo'`. */
  easing: MorphInputEasing
  /** Overshoot of the `'spring'` easing, `0`–`1`. Default: `0.15`. */
  bounce: number
  /** How characters enter and leave. Default: `'auto'`. */
  effect: MorphInputEffect
  /** Font size of the text in points. Default: `32`. */
  fontSize: number
  /** Numeric font weight, `100`–`900`. Default: `400`. */
  fontWeight: number
  /** Font family name; empty = system font. */
  fontFamily: string
  /** Text color as a processed ARGB integer; `NaN` = platform label color. */
  color: number
  /** Where the text sits when the view is wider than it. Default: `'left'`. */
  textAlign: MorphInputTextAlign
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
  keyboardType: MorphInputKeyboardType
  /** Label of the return key. Default: `'default'`. */
  returnKeyType: MorphInputReturnKeyType
  /** Auto-capitalisation (`'text'` mode). Default: `'sentences'`. */
  autoCapitalize: MorphInputAutoCapitalize
  /** Auto-correction (`'text'` mode). Default: `true`. */
  autoCorrect: boolean
  /** Whether the user can edit the field. Default: `true`. */
  editable: boolean
  /** Focus the field when it mounts. Default: `false`. */
  autoFocus: boolean
  /** `'text'` mode: most characters accepted; `0` = unlimited. Default: `0`. */
  maxLength: number
  /**
   * Called after every native edit with the field's (formatted) text and a
   * monotonically increasing event count. Feed the count back through
   * `mostRecentEventCount`.
   */
  onChangeText?: (text: string, eventCount: number) => void
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
  /**
   * Called whenever the settled intrinsic size changes (first layout, text
   * that grew or shrank, font change). `MorphInput` uses this to size itself
   * when the style gives it no width.
   */
  onSizeChange?: (width: number, height: number) => void
}

export interface MorphInputMethods extends HybridViewMethods {
  focus(): void
  blur(): void
  /** Empties the field (morphing the characters away). */
  clear(): void
  /** Replaces the text (formatted in `'number'` mode), caret at the end. */
  setText(text: string): void
  /** `'number'` mode: shows `value` formatted; `NaN` empties the field. */
  setValue(value: number): void
  /** The field's current (formatted) text. */
  getText(): string
  /** `'number'` mode: the field's numeric value, `NaN` when empty. */
  getValue(): number
  isFocused(): boolean
}

export type MorphInputView = HybridView<MorphInputProps, MorphInputMethods>
