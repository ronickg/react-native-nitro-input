import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  I18nManager,
  processColor,
  StyleSheet,
  type ColorValue,
  type TextStyle,
  type ViewProps,
} from 'react-native'
import {
  callback,
  getHostComponent,
  type HybridRef,
} from 'react-native-nitro-modules'
import NitroInputViewConfig from '../nitrogen/generated/shared/json/NitroInputViewConfig.json'
import type {
  NitroInputAffixAlign,
  NitroInputAutoCapitalize,
  NitroInputEasing,
  NitroInputEffect,
  NitroInputKeyboardAppearance,
  NitroInputKeyboardType,
  NitroInputLabelBehavior,
  NitroInputMethods,
  NitroInputMode,
  NitroInputProps as NativeNitroInputProps,
  NitroInputReturnKeyType,
  NitroInputSubmitBehavior,
  NitroInputTextAlign,
  NitroInputTextAlignVertical,
  NitroInputSignPlacement,
  NitroInputVariant,
  NitroInputNotation,
} from './specs/NitroInput.nitro'
import {
  allocateWorkletId,
  isWorklet,
  registerFocusChange,
  registerKeyPress,
  registerSelectionChange,
  registerTextEvent,
  registerCallback,
  registerTransform,
  unregisterWorklet,
  type NitroInputSelection,
  type NitroInputTransform,
} from './worklets'

/**
 * React Native's registry of mounted text inputs. `TextInput.State` only
 * exposes the read side publicly, but `Keyboard.dismiss()`,
 * `keyboardShouldPersistTaps` and a ScrollView's auto-blur all go through
 * `currentlyFocusedInput()`, so a field that never registers is invisible to
 * them. The internal module is the only way in; it is imported behind a guard
 * so a React Native version that moves it degrades instead of throwing.
 */
interface TextInputRegistry {
  currentlyFocusedInput(): unknown
  focusInput(input: unknown): void
  blurInput(input: unknown): void
  registerInput(input: unknown): void
  unregisterInput(input: unknown): void
}

interface TextInputCommands {
  focusTextInput(input: unknown): void
  blurTextInput(input: unknown): void
}

const textInputRegistry: (TextInputRegistry & Partial<TextInputCommands>) | null = (() => {
  try {
    // The registry has no public surface: `TextInput.State` exposes the focus
    // commands but not `registerInput`, and registering is the whole point -
    // it is how `ref.focus()`, `Keyboard.dismiss()` and a ScrollView's
    // `keyboardShouldPersistTaps` recognise a text input at all. React Native's
    // Babel preset logs a deprecation for every *literal* `react-native/...`
    // import, in every app that bundles this package, and the guard around
    // this call already is the deprecation policy: a version that moves the
    // module degrades to plain focus rather than throwing. A template literal
    // says the same path; Metro evaluates it, the warning plugin only matches
    // string literals.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(`react-native/Libraries/Components/TextInput/TextInputState`)
    const state = (mod?.default ?? mod) as Partial<TextInputRegistry> | undefined
    return typeof state?.focusInput === 'function' && typeof state?.blurInput === 'function'
      ? (state as TextInputRegistry & Partial<TextInputCommands>)
      : null
  } catch {
    return null
  }
})()

/** React Native's `inputMode`, the HTML-aligned alias for `keyboardType`. */
export type InputMode =
  | 'none'
  | 'text'
  | 'decimal'
  | 'numeric'
  | 'tel'
  | 'search'
  | 'email'
  | 'url'

/** React Native's `enterKeyHint`, the HTML-aligned alias for `returnKeyType`. */
export type EnterKeyHint = 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send'

// Both tables are React Native's own (`TextInput.js`), so an app that swaps a
// `TextInput` for this gets the same keyboard from the same prop.
const INPUT_MODE_TO_KEYBOARD: Record<InputMode, NitroInputKeyboardType> = {
  none: 'default',
  text: 'default',
  decimal: 'decimal-pad',
  numeric: 'number-pad',
  tel: 'phone-pad',
  // RN picks iOS `web-search` here; this component has no such keyboard type,
  // and Android already falls back to `default`.
  search: 'default',
  email: 'email-address',
  url: 'url',
}

const ENTER_KEY_HINT_TO_RETURN_KEY: Record<EnterKeyHint, NitroInputReturnKeyType> = {
  enter: 'default',
  done: 'done',
  go: 'go',
  next: 'next',
  // RN maps `previous` to an Android-only return key this component does not
  // expose, so it falls back to the default on both.
  previous: 'default',
  search: 'search',
  send: 'send',
}

/**
 * The react tag of a host instance, or 0 when there is none. Fabric's
 * `ReactNativeElement` keeps it on `__nativeTag`; the pre-Fabric name was
 * `_nativeTag`. Android's Nitro view hands out no instance at all, so 0.
 */
function reactTagOf(host: unknown): number {
  const instance = host as { _nativeTag?: number; __nativeTag?: number } | null
  const tag = instance?.__nativeTag ?? instance?._nativeTag
  return typeof tag === 'number' ? tag : 0
}

const EMPTY_NOTATIONS: NitroInputNotation[] = []

/** Mounted fields, by the host instance React Native's registry stores. */
const mountedFields = new WeakMap<object, { focus(): void; blur(): void }>()
let patchedRegistry = false

/**
 * `TextInputState.focusTextInput` / `blurTextInput` — which is how
 * `Keyboard.dismiss()`, `keyboardShouldPersistTaps` and a ScrollView's
 * auto-blur reach the focused input — dispatch a codegen `focus` / `blur`
 * *view command*. A Nitro view has no such command on Android, so the call
 * would be dropped and the keyboard would stay up. The two functions are
 * wrapped once, on the registry module, to route a NitroInput to its own
 * native focus/blur; every other input is passed straight through untouched.
 *
 * The wrap reaches every caller that reads the two off the module at call
 * time, which `Keyboard.dismiss()` and `ScrollView` do. It does not reach
 * `TextInput.State.focusTextInput` / `blurTextInput`: `TextInput.js` copies
 * those references when it is evaluated, before this runs, so a call through
 * them still dispatches the view command. On iOS `ios/NitroInputCommands.mm`
 * answers that command; on Android it is dropped.
 */
function patchRegistryOnce() {
  if (patchedRegistry || textInputRegistry == null) return
  patchedRegistry = true
  const registry = textInputRegistry
  const originalFocus = registry.focusTextInput
  const originalBlur = registry.blurTextInput
  if (typeof originalFocus === 'function') {
    registry.focusTextInput = (input: unknown) => {
      const field = input != null ? mountedFields.get(input as object) : undefined
      if (field) return field.focus()
      return originalFocus.call(registry, input)
    }
  }
  if (typeof originalBlur === 'function') {
    registry.blurTextInput = (input: unknown) => {
      const field = input != null ? mountedFields.get(input as object) : undefined
      if (field) return field.blur()
      return originalBlur.call(registry, input)
    }
  }
}

/**
 * The raw Nitro host component. Prefer {@link NitroInput}, which adds the
 * controlled-value handshake, auto-sizing, color/weight conversion and a
 * convenient handle.
 */
export const NativeNitroInputView = getHostComponent<
  NativeNitroInputProps,
  NitroInputMethods
>('NitroInputView', () => NitroInputViewConfig)

/** The native Nitro `HybridObject` behind a mounted {@link NitroInput}. */
export type NitroInputRef = HybridRef<NativeNitroInputProps, NitroInputMethods>

/**
 * The events this component hands to its callbacks.
 *
 * Each one is a superset of what `TextInput` passes: `nativeEvent` is there
 * with the same fields under the same names, so a handler written against a
 * `TextInput` keeps working when the component is swapped, and the fields are
 * repeated at the top level so new code can destructure them instead of
 * reaching through `nativeEvent`.
 */
export interface NitroInputTextEvent {
  text: string
  /** The host view's react tag, as `TextInput` reports for itself. */
  target: number
  nativeEvent: { text: string; target: number }
}

export interface NitroInputFocusEvent extends NitroInputTextEvent {
  /** The native edit counter, as in `TextInput`. */
  eventCount: number
  nativeEvent: { text: string; target: number; eventCount: number }
}

export interface NitroInputSelectionEvent {
  /** The selection, in code points. */
  selection: NitroInputSelection
  /** The selection's bounds, repeated so `({ start, end }) => …` works. */
  start: number
  end: number
  target: number
  nativeEvent: { selection: NitroInputSelection; target: number }
}

export interface NitroInputKeyPressEvent {
  /** The character, `'Backspace'` or `'Enter'`. */
  key: string
  eventCount: number
  target: number
  nativeEvent: { key: string; eventCount: number; target: number }
}

export interface NitroInputProps extends Omit<ViewProps, 'children' | 'onFocus' | 'onBlur'> {
  /**
   * The text to show (controlled). The native side formats and shows what the
   * user types on its own; this prop is applied when it changes to something
   * other than what the field already shows, so echoing `onChangeText` back
   * into state never fights the user or shows an unformatted frame.
   */
  value?: string
  /** The initial text (uncontrolled). */
  defaultValue?: string
  /**
   * The field's frame. `'outlined'` strokes a rounded rectangle notched around
   * the floating label - the notch is a real hole in the path, so whatever is
   * behind the field shows through. `'filled'` tints the box instead.
   * Default: `'none'`, leaving the border to `style` as before.
   */
  variant?: NitroInputVariant
  /** Floating label text. Requires a `variant` other than `'none'`. */
  label?: string
  /** Whether the label floats on focus/content or stays floated. Default: `'float'`. */
  labelBehavior?: NitroInputLabelBehavior
  /** Label colour at rest; defaults to `placeholderTextColor`. */
  labelColor?: ColorValue
  /** Label colour while focused; defaults to `focusedStrokeColor`. */
  labelFocusedColor?: ColorValue
  /** Label size when floated, in points; omit to derive it from `fontSize`. */
  labelFontSize?: number
  /** Outline colour; defaults to a platform hairline grey. */
  strokeColor?: ColorValue
  /** Outline colour while focused; defaults to `strokeColor`. */
  focusedStrokeColor?: ColorValue
  /** Outline stroke width in points, doubled while focused. Default: `1`. */
  strokeWidth?: number
  /** Corner radius of the frame. Default: `8`. */
  cornerRadius?: number
  /** `'filled'`: the box tint. */
  fillColor?: ColorValue
  /**
   * What the field holds. `'number'` formats natively as you type: grouping
   * separators, one decimal separator, up to `fractionDigits` decimals, a
   * currency `prefix` / `suffix`. `'mask'` applies a fixed pattern (`mask`).
   * `'text'` is a plain field. Default: `'text'`.
   */
  mode?: NitroInputMode
  /**
   * React Native's alias for `keyboardType`, following the HTML attribute.
   * Ignored when `keyboardType` is given. `'none'` also suppresses the soft
   * keyboard, as it does in `TextInput`.
   */
  inputMode?: InputMode
  /** React Native's alias for `returnKeyType`, following the HTML attribute. Ignored when `returnKeyType` is given. */
  enterKeyHint?: EnterKeyHint
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
   */
  mask?: string
  /** `'mask'`: extra slot characters beyond the built-in ones. */
  maskNotations?: NitroInputNotation[]
  /** `'mask'`: fill in constants as the caret reaches them. Default: `true`. */
  maskAutocomplete?: boolean
  /** `'mask'`: backspace walks back over autocompleted constants. Default: `false`. */
  maskAutoSkip?: boolean
  /**
   * `'mask'` mode: called after every edit with the masked text, the characters
   * the user contributed, what is still missing, and whether every mandatory
   * slot is filled.
   */
  onChangeMask?: (
    formatted: string,
    extracted: string,
    tailPlaceholder: string,
    complete: boolean
  ) => void
  /** `'number'`: most digits allowed after the decimal separator; `0` disables the decimal. Default: `2`. */
  fractionDigits?: number
  /** `'number'`: most integer digits accepted. Default: `15`. */
  maxIntegerDigits?: number
  /** `'number'`: inserted between every three integer digits; `''` disables grouping. Default: `','`. */
  groupingSeparator?: string
  /** `'number'`: placed between integer and fraction digits. Default: `'.'`. */
  decimalSeparator?: string
  /** Static text drawn before the field's text, e.g. `'$'`. */
  prefix?: string
  /** Static text drawn after the field's text, e.g. `' USD'`. */
  suffix?: string
  /** Font size of `prefix`, e.g. a smaller currency symbol. Defaults to `fontSize`. */
  prefixFontSize?: number
  /** Font size of `suffix`. Defaults to `fontSize`. */
  suffixFontSize?: number
  /**
   * How prefix and suffix line up with the text: `'top'` pins glyph tops,
   * `'bottom'` the bottom of the ink, `'baseline'` shares the baseline,
   * `'center'` centres. Default: `'baseline'`.
   */
  affixAlign?: NitroInputAffixAlign
  /**
   * Where a negative amount's sign sits relative to `prefix`. `'beforeAffix'`
   * (the default) reads `-$1,234.56`; `'afterAffix'` reads `$-1,234.56`, which
   * suits a symbol styled as an ornament rather than read as part of the
   * number. Only the morph honours it - a plain field's affixes are accessory
   * views outside the text, so it is always `'afterAffix'`.
   */
  signPlacement?: NitroInputSignPlacement
  /** Alignment of `prefix` only. Defaults to `affixAlign`. */
  prefixAlign?: NitroInputAffixAlign
  /** Alignment of `suffix` only. Defaults to `affixAlign`. */
  suffixAlign?: NitroInputAffixAlign
  /** Shown while the field is empty and morphed away by the first character. In `'number'` mode `'0'` reads well. */
  placeholder?: string
  /** Color of the placeholder. Defaults to the platform placeholder color. */
  placeholderTextColor?: ColorValue
  /** Duration in ms of the morph played on every change. `0` snaps. Default: `400`. */
  duration?: number
  /** Timing curve of the morph. Default: `'expo'` (Torph's `cubic-bezier(0.19, 1, 0.22, 1)`). */
  easing?: NitroInputEasing
  /** Overshoot of the `'spring'` easing, `0`–`1`. Default: `0.15`. */
  bounce?: number
  /**
   * How characters enter and leave. `'auto'`: digits and separators slide
   * through the line box (digits from above, separators from below), other
   * characters fade and scale. Default: `'auto'`.
   */
  effect?: NitroInputEffect
  /** Font size in points. Default: `32`. */
  fontSize?: number
  /**
   * Height of the line box in points — the CSS meaning, the total height a
   * line occupies rather than extra leading. Omit to use the font's own.
   *
   * Unlike `TextInput`, a line height *tighter* than the font is centred
   * correctly too, and it applies to single-line and morphing fields, not only
   * wrapped ones.
   */
  lineHeight?: number
  /** Font weight, like `Text`'s `fontWeight`. Default: `'normal'`. */
  fontWeight?: TextStyle['fontWeight']
  /** Font family name, like `Text`'s `fontFamily`. Defaults to the system font. */
  fontFamily?: string
  /** Text color. Defaults to the platform's primary label color. */
  color?: ColorValue
  /**
   * Where the text sits when the view is wider than it. Default: `'auto'`: the
   * start edge of the layout direction, as `TextInput`. `'left'` and `'right'`
   * are absolute.
   */
  textAlign?: NitroInputTextAlign
  /** Caret color. Defaults to the platform tint. */
  cursorColor?: ColorValue
  /** Selection highlight color. Defaults to the platform tint. */
  selectionColor?: ColorValue
  /** Hides the caret. Default: `false`. */
  caretHidden?: boolean
  /**
   * Scale the text down when it is wider than the view (give the view a fixed
   * `width` in `style`), and back up when it fits again. Default: `false`.
   */
  adjustsFontSizeToFit?: boolean
  /** Smallest scale `adjustsFontSizeToFit` may apply, `0`–`1`. Default: `0.5`. */
  minimumFontScale?: number
  /** Scale the fonts with the system text size, like `Text`. Default: `false`. */
  allowFontScaling?: boolean
  /** Upper bound for `allowFontScaling`, e.g. `1.3`. `0` = no cap. Default: `0`. */
  maxFontSizeMultiplier?: number
  /** Keyboard to show. Defaults to `'decimal-pad'` / `'number-pad'` in `'number'` mode, `'default'` otherwise. */
  keyboardType?: NitroInputKeyboardType
  /** Label of the return key. Default: `'default'`. */
  returnKeyType?: NitroInputReturnKeyType
  /** Auto-capitalisation in `'text'` mode. Default: `'sentences'`. */
  autoCapitalize?: NitroInputAutoCapitalize
  /** Auto-correction in `'text'` mode. Default: `true`. */
  autoCorrect?: boolean
  /** Whether the user can edit the field. Default: `true`. */
  editable?: boolean
  /**
   * Let the text wrap onto more than one line.
   *
   * A multiline field is always drawn by the system view and is always
   * `'text'` mode: the glyph engine lays one run out on one baseline, so it
   * cannot morph wrapped text, and an amount or a mask is a single-line idea.
   * `morph`, `mode="number"`, `mode="mask"` and the `prefix` / `suffix`
   * affixes are ignored alongside it, with one warning each in development.
   * The return key inserts a line break unless `submitBehavior` says otherwise.
   */
  multiline?: boolean
  /** `multiline`: lines tall before it scrolls. Omit to grow with the content. */
  numberOfLines?: number
  /** Alias for {@link numberOfLines}, matching `TextInput`. */
  rows?: number
  /** `multiline`: where the text sits in the box. Default: `'auto'` (top). */
  textAlignVertical?: NitroInputTextAlignVertical
  /** `multiline`: whether it scrolls once the text outgrows it. Default: `true`. */
  scrollEnabled?: boolean
  /** Focus the field when it mounts. Default: `false`. */
  autoFocus?: boolean
  /**
   * What the return key does. `'blurAndSubmit'` fires `onSubmitEditing` and
   * dismisses the keyboard; `'submit'` fires it and keeps focus, so a form can
   * move to the next field itself; `'newline'` inserts a line break instead
   * (`multiline` only). Defaults as `TextInput`'s: `'blurAndSubmit'` for a
   * single-line field, `'newline'` for a multiline one.
   */
  submitBehavior?: NitroInputSubmitBehavior
  /**
   * Deprecated alias of `submitBehavior`, resolved the way `TextInput` resolves
   * it: `false` means `'submit'` on a single-line field, and `true` means
   * `'blurAndSubmit'` on a multiline one (whose return key otherwise inserts a
   * line break). Ignored when `submitBehavior` is given.
   */
  blurOnSubmit?: boolean
  /** Masks the drawn glyphs with bullets and turns off autocorrect. Default: `false`. */
  secureTextEntry?: boolean
  /** Light or dark keyboard (iOS). Default: `'default'`. */
  keyboardAppearance?: NitroInputKeyboardAppearance
  /** iOS `textContentType` — the autofill kind (`'username'`, `'password'`, `'oneTimeCode'`, …). */
  textContentType?: string
  /** Cross-platform autofill hint; used as `textContentType` when that is not set. */
  autoComplete?: string
  /** Disables the return key until the field has text. Default: `false`. */
  enablesReturnKeyAutomatically?: boolean
  /** Show the soft keyboard on focus. `false` keeps focus and caret without it. Default: `true`. */
  showSoftInputOnFocus?: boolean
  /** Select all the text when the field gains focus. Default: `false`. */
  selectTextOnFocus?: boolean
  /** Empty the field when it gains focus. Default: `false`. */
  clearTextOnFocus?: boolean
  /** Hides the Cut/Copy/Paste menu. Default: `false`. */
  contextMenuHidden?: boolean
  /** Spell checking in `'text'` mode. Defaults to `autoCorrect`. */
  spellCheck?: boolean
  /** Read-only alias of `editable={false}`, like React Native's. */
  readOnly?: boolean
  /** The caret/selection to apply, in code points. */
  selection?: { start: number; end?: number }
  /**
   * Run the glyph engine, so text morphs as it changes rather than simply
   * appearing. Off by default: this is a text field first, and a `TextInput`
   * does not animate its characters. {@link MorphInput} is this component with
   * it on, which is what an amount field wants.
   */
  morph?: boolean
  /**
   * Whether the field sizes itself to its content.
   *
   * `false` (the default) takes no width of its own, so flexbox stretches it to
   * its parent the way a `TextInput` is stretched — that is what makes this a
   * drop-in. `true` always sizes to content. `'auto'` infers it: on unless
   * `style` gives a `width` or `flex`, which is what lets an amount grow as
   * digits arrive, and is what {@link MorphInput} uses.
   */
  autoWidth?: boolean | 'auto'
  /** `'text'` mode: most characters accepted. Default: unlimited. */
  maxLength?: number
  /**
   * A worklet that rewrites the text after every edit, synchronously on the UI
   * thread before a frame is drawn (needs `react-native-worklets`): masks,
   * custom formats, anything JS can express. It receives the edited text, the
   * previous text and both selections (code point offsets) and returns the
   * new text and optionally where the caret should go; `null` keeps the edit.
   * In `'number'` mode it runs after the native formatter. Create it once
   * (module scope or `useCallback`): a new function re-registers the worklet.
   */
  transform?: NitroInputTransform
  /**
   * Called after every edit with the field's (formatted) text. Mark it with
   * `'worklet'` (with `react-native-worklets` installed) and it runs
   * synchronously on the UI thread instead, where it can write shared values
   * before the next frame.
   */
  onChangeText?: (text: string) => void
  /**
   * React Native's other change callback, fired alongside `onChangeText` with
   * the same text. `nativeEvent.eventCount` is the native edit counter, as in
   * `TextInput`.
   */
  onChange?: (event: {
    nativeEvent: { text: string; eventCount: number; target: number }
  }) => void
  /** `'number'` mode: called after every edit with the numeric value, `NaN` when empty. A `'worklet'` runs on the UI thread. */
  onChangeValue?: (value: number) => void
  /**
   * Focused. The event is `TextInput`'s, so a handler written for one works
   * here unchanged - and the same fields are repeated at the top level, so
   * `({ text }) => …` reads better than `(e) => e.nativeEvent.text`.
   */
  onFocus?: (event: NitroInputFocusEvent) => void
  /** Blurred. Same event as {@link NitroInputProps.onFocus}. */
  onBlur?: (event: NitroInputFocusEvent) => void
  /** The return key was pressed. */
  onSubmitEditing?: (event: NitroInputTextEvent) => void
  /** Editing finished (focus lost or keyboard dismissed), like `TextInput`'s `onEndEditing`. */
  onEndEditing?: (event: NitroInputTextEvent) => void
  /** The caret or selection moved, in code points. */
  onSelectionChange?: (event: NitroInputSelectionEvent) => void
  /** A key was pressed, before the text changes: the character, `'Backspace'` or `'Enter'`. */
  onKeyPress?: (event: NitroInputKeyPressEvent) => void
  /** Receives the native Nitro object once the view is mounted. */
  onNativeRef?: (ref: NitroInputRef) => void
}

/** Imperative handle exposed through `ref`. Methods are no-ops before mount. */
export interface NitroInputHandle {
  focus(): void
  blur(): void
  /** Empties the field, morphing the characters away. */
  clear(): void
  /** Replaces the text (formatted in `'number'` mode), caret at the end. */
  setText(text: string): void
  /** `'number'` mode: shows `value` formatted; `NaN` empties the field. */
  setValue(value: number): void
  /** The field's current (formatted) text. */
  getText(): string
  /** `'number'` mode: the numeric value, `NaN` when empty. */
  getValue(): number
  isFocused(): boolean
  /** Moves the caret / selection; code points into the (formatted) text. */
  setSelection(start: number, end?: number): void
  /** The native Nitro object, or `null` before mount. */
  readonly native: NitroInputRef | null
}

// shared-helpers:start
// Kept byte-for-byte identical with packages/react-native-nitro-rolling-number/src/RollingNumber.tsx
// (a test compares the two blocks); change both together.
const FONT_WEIGHTS: Record<string, number> = {
  normal: 400,
  regular: 400,
  bold: 700,
  ultralight: 100,
  thin: 200,
  light: 300,
  medium: 500,
  semibold: 600,
  condensedBold: 700,
  condensed: 400,
  heavy: 800,
  black: 900,
}

function toNumericWeight(weight: TextStyle['fontWeight']): number | undefined {
  if (weight == null) return undefined
  if (typeof weight === 'number') return weight
  const parsed = Number(weight)
  if (!Number.isNaN(parsed)) return parsed
  return FONT_WEIGHTS[weight]
}

function toProcessedColor(color: ColorValue | undefined): number | undefined {
  if (color == null) return undefined
  const processed = processColor(color)
  return typeof processed === 'number' ? processed : undefined
}
// shared-helpers:end

interface Size {
  width: number
  height: number
}

const warnedIncompatible = new Set<string>()
/** Once per offending prop, not once per render. */
function warnIncompatible(what: string): void {
  if (warnedIncompatible.has(what)) return
  warnedIncompatible.add(what)
  console.warn(
    `[NitroInput] \`${what}\` is ignored on a multiline field: a wrapping ` +
      'field is drawn by the system view, and an amount, a mask and their ' +
      'affixes are single-line. Drop one of the two.'
  )
}

/**
 * A native text input: a system field (`UITextField` / `EditText`) that owns
 * the keyboard, editing, selection, paste and accessibility, with native
 * formatting (`mode="number"`), native masking (`mode="mask"`), an outlined
 * or filled frame with a floating label, and optionally the glyph engine
 * (`morph`), under which characters that stay glide to their new place, new
 * ones slide or fade in and removed ones leave alongside their neighbours.
 * In `'number'` mode every edit is formatted on the native side before a
 * frame is drawn, with the caret kept in place, so there is never an
 * unformatted frame and never a round trip through JS.
 *
 * Like a `TextInput`, it takes its width from its parent; `autoWidth`
 * (`'auto'` in {@link MorphInput}) sizes it to its content instead.
 */
export const NitroInput = forwardRef<NitroInputHandle, NitroInputProps>(
  function NitroInput(
    {
      value,
      defaultValue,
      mode,
      fractionDigits,
      maxIntegerDigits,
      groupingSeparator,
      decimalSeparator,
      prefix,
      suffix,
      prefixFontSize,
      suffixFontSize,
      affixAlign,
      signPlacement,
      prefixAlign,
      suffixAlign,
      placeholder,
      placeholderTextColor,
      duration,
      easing,
      bounce,
      effect,
      fontSize,
      lineHeight,
      fontWeight,
      fontFamily,
      color,
      textAlign,
      cursorColor,
      selectionColor,
      caretHidden,
      adjustsFontSizeToFit,
      minimumFontScale,
      allowFontScaling,
      maxFontSizeMultiplier,
      variant,
      label,
      labelBehavior,
      labelColor,
      labelFocusedColor,
      labelFontSize,
      strokeColor,
      focusedStrokeColor,
      strokeWidth,
      cornerRadius,
      fillColor,
      keyboardType,
      inputMode,
      enterKeyHint,
      mask,
      maskNotations,
      maskAutocomplete,
      maskAutoSkip,
      returnKeyType,
      autoCapitalize,
      autoCorrect,
      editable,
      multiline,
      numberOfLines,
      rows,
      textAlignVertical,
      scrollEnabled,
      autoFocus,
      morph,
      autoWidth: autoWidthProp,
      submitBehavior,
      blurOnSubmit,
      secureTextEntry,
      keyboardAppearance,
      textContentType,
      autoComplete,
      enablesReturnKeyAutomatically,
      showSoftInputOnFocus,
      selectTextOnFocus,
      clearTextOnFocus,
      contextMenuHidden,
      spellCheck,
      readOnly,
      selection,
      onEndEditing,
      onSelectionChange,
      onKeyPress,
      maxLength,
      transform,
      onChangeText,
      onChange,
      onChangeValue,
      onChangeMask,
      onFocus,
      onBlur,
      onSubmitEditing,
      onNativeRef,
      style,
      ...viewProps
    },
    ref
  ) {
    const nativeRef = useRef<NitroInputRef | null>(null)
    // What React Native's registry stores for this field. The React host
    // instance when there is one (iOS), otherwise a stable per-instance token:
    // on Android the Nitro host component hands out no instance, and the
    // registry only ever compares identity or passes the value back to us.
    const hostRef = useRef<unknown>(null)
    const registryKeyRef = useRef<object | null>(null)
    // The last text and edit counter the native side reported. `focus`, `blur`
    // and `keyPress` carry both but are not themselves edits, so they have
    // nothing of their own to read them from.
    const textRef = useRef(defaultValue ?? '')
    const eventCountRef = useRef(0)
    const latest = useRef({
      onNativeRef,
      onChangeText,
      onChange,
      onChangeValue,
      onChangeMask,
      onFocus,
      onBlur,
      onSubmitEditing,
      onEndEditing,
      onSelectionChange,
      onKeyPress,
    })
    latest.current = {
      onNativeRef,
      onChangeText,
      onChange,
      onChangeValue,
      onChangeMask,
      onFocus,
      onBlur,
      onSubmitEditing,
      onEndEditing,
      onSelectionChange,
      onKeyPress,
    }
    // A controlled field's text is the prop, not the last edit this saw.
    if (value != null) textRef.current = value

    const [size, setSize] = useState<Size | null>(null)
    // Worklets are registered on the UI runtime and referenced by id; a
    // handler marked 'worklet' runs there instead of on the JS thread.
    const transformId = useWorkletId(transform, registerTransform)
    const onChangeTextWorklet = isWorklet(onChangeText) ? onChangeText : undefined
    const onChangeValueWorklet = isWorklet(onChangeValue) ? onChangeValue : undefined
    const onChangeTextId = useWorkletId(onChangeTextWorklet, registerCallback)
    const onChangeValueId = useWorkletId(onChangeValueWorklet, registerCallback)
    // Marking any of these `'worklet'` moves it to the UI thread; the JS
    // handler is then skipped, exactly as `onChangeText` already worked.
    const onFocusId = useWorkletPairId(
      isWorklet(onFocus) ? (onFocus as never) : undefined,
      isWorklet(onBlur) ? (onBlur as never) : undefined,
      registerFocusChange
    )
    const onSelectionChangeId = useWorkletId(
      isWorklet(onSelectionChange) ? (onSelectionChange as never) : undefined,
      registerSelectionChange as never
    )
    const onSubmitEditingId = useWorkletId(
      isWorklet(onSubmitEditing) ? (onSubmitEditing as never) : undefined,
      registerTextEvent as never
    )
    const onEndEditingId = useWorkletId(
      isWorklet(onEndEditing) ? (onEndEditing as never) : undefined,
      registerTextEvent as never
    )
    const onKeyPressId = useWorkletId(
      isWorklet(onKeyPress) ? (onKeyPress as never) : undefined,
      registerKeyPress as never
    )
    // The latest native event count JS has processed: sent back with `text` so
    // native can tell a stale controlled value (the user typed since) from a
    // deliberate change. It lives in `eventCountRef` and is read from there at
    // render; only a controlled field takes the state update that forces one,
    // because only a controlled field's `text` prop can ever change. So an
    // uncontrolled (or worklet-driven) field never re-renders on a keystroke,
    // and a field made controlled later reads the fresh count on that render.
    const [, setEventCountState] = useState(0)
    const controlledRef = useRef(value != null)
    controlledRef.current = value != null
    // The initial text of an uncontrolled field never changes afterwards, so
    // native applies it exactly once.
    const [initialText] = useState(() => defaultValue ?? '')

    // Nitro callbacks must be wrapped with `callback()` and the wrapper object
    // has to be referentially stable, otherwise every render re-sets the prop.
    // Handlers are read through a ref so inline arrows don't re-set them either.
    const hybridRef = useMemo(
      () =>
        callback((instance: NitroInputRef) => {
          nativeRef.current = instance
          latest.current.onNativeRef?.(instance)
        }),
      []
    )
    useEffect(() => {
      if (textInputRegistry == null) return
      const key = (hostRef.current as object | null) ?? { nitroInput: true }
      registryKeyRef.current = key
      patchRegistryOnce()
      mountedFields.set(key, {
        focus: () => nativeRef.current?.focus(),
        blur: () => nativeRef.current?.blur(),
      })
      textInputRegistry.registerInput(key)
      return () => {
        if (textInputRegistry.currentlyFocusedInput() === key) textInputRegistry.blurInput(key)
        textInputRegistry.unregisterInput(key)
        mountedFields.delete(key)
        registryKeyRef.current = null
      }
    }, [])

    // A field with a width of its own (the usual case) never needs a React
    // commit per keystroke: only the height (font-dependent) is taken from native.
    const flat = useMemo(
      () =>
        StyleSheet.flatten(style) as
          | { width?: unknown; flex?: unknown; height?: unknown; direction?: unknown }
          | undefined,
      [style]
    )
    // The layout direction, resolved the way React Native resolves it for its
    // own views: the field's `style.direction` if it says, else the app's.
    // Fabric does not hand a Hybrid View its resolved direction, so native is
    // told outright.
    const rightToLeft =
      flat?.direction === 'rtl' || (flat?.direction !== 'ltr' && I18nManager.isRTL)
    // `TextInput` stretches to its parent; sizing to content is this
    // component's own behaviour, and it is what stops it being a drop-in.
    // `NitroInput` turns it off so flexbox gives it the parent's width, the
    // way a `TextInput` gets one.
    const inferredAutoWidth = flat?.width == null && flat?.flex == null
    const autoWidth =
      autoWidthProp === 'auto' ? inferredAutoWidth : (autoWidthProp ?? false)
    const autoWidthRef = useRef(autoWidth)
    autoWidthRef.current = autoWidth
    // When the style pins both axes, the measured size is never used: `style`
    // is applied after `autoSize`, so it wins. Taking the state update anyway
    // costs a React commit per field on mount, which is pure waste for the
    // common "field in a styled box" case.
    const measured = autoWidth || flat?.height == null
    const measuredRef = useRef(measured)
    measuredRef.current = measured
    const onSizeChange = useMemo(
      () =>
        callback((width: number, height: number) => {
          if (!measuredRef.current) return
          setSize((previous) => {
            if (!autoWidthRef.current) {
              return previous !== null && previous.height === height ? previous : { width: previous?.width ?? width, height }
            }
            return previous !== null && previous.width === width && previous.height === height
              ? previous
              : { width, height }
          })
        }),
      []
    )
    const onChangeTextCallback = useMemo(
      () =>
        callback((text: string, count: number) => {
          textRef.current = text
          eventCountRef.current = count
          if (controlledRef.current) setEventCountState(count)
          const handler = latest.current.onChangeText
          // A worklet handler already ran on the UI thread.
          if (handler && !isWorklet(handler)) handler(text)
          // `onChange` fires alongside it with the same text, as in RN. The
          // target is the host tag when there is one (iOS); Android's Nitro
          // view hands out no instance, so it is 0 there.
          latest.current.onChange?.({
            nativeEvent: { text, eventCount: count, target: reactTagOf(hostRef.current) },
          })
        }),
      []
    )
    const onChangeValueCallback = useMemo(
      () =>
        callback((next: number) => {
          const handler = latest.current.onChangeValue
          if (handler && !isWorklet(handler)) handler(next)
        }),
      []
    )
    const onChangeMaskCallback = useMemo(
      () =>
        callback(
          (formatted: string, extracted: string, tailPlaceholder: string, complete: boolean) => {
            latest.current.onChangeMask?.(formatted, extracted, tailPlaceholder, complete)
          }
        ),
      []
    )
    // Every event below carries `nativeEvent` for a handler written against a
    // `TextInput`, and the same fields at the top level for one written against
    // this. Built here rather than natively: the native side sends the values,
    // and the shape is a JavaScript convention React Native owns.
    const textEvent = (text: string): NitroInputTextEvent => {
      const target = reactTagOf(hostRef.current)
      return { text, target, nativeEvent: { text, target } }
    }
    const onFocusChangeCallback = useMemo(
      () =>
        callback((focused: boolean) => {
          const key = registryKeyRef.current
          if (key != null) {
            if (focused) textInputRegistry?.focusInput(key)
            else textInputRegistry?.blurInput(key)
          }
          const text = textRef.current
          const target = reactTagOf(hostRef.current)
          const count = eventCountRef.current
          const event: NitroInputFocusEvent = {
            text,
            target,
            eventCount: count,
            nativeEvent: { text, target, eventCount: count },
          }
          const handler = focused ? latest.current.onFocus : latest.current.onBlur
          if (handler && !isWorklet(handler)) handler(event)
        }),
      []
    )
    const onSubmitEditingCallback = useMemo(
      () =>
        callback((text: string) => {
          const handler = latest.current.onSubmitEditing
          if (handler && !isWorklet(handler)) handler(textEvent(text))
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    )
    const onEndEditingCallback = useMemo(
      () =>
        callback((text: string) => {
          const handler = latest.current.onEndEditing
          if (handler && !isWorklet(handler)) handler(textEvent(text))
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    )
    const onSelectionChangeCallback = useMemo(
      () =>
        callback((start: number, end: number) => {
          const handler = latest.current.onSelectionChange
          if (!handler || isWorklet(handler)) return
          const selection = { start, end }
          const target = reactTagOf(hostRef.current)
          handler({ selection, start, end, target, nativeEvent: { selection, target } })
        }),
      []
    )
    const onKeyPressCallback = useMemo(
      () =>
        callback((key: string) => {
          const handler = latest.current.onKeyPress
          if (!handler || isWorklet(handler)) return
          const target = reactTagOf(hostRef.current)
          const count = eventCountRef.current
          handler({ key, eventCount: count, target, nativeEvent: { key, eventCount: count, target } })
        }),
      []
    )

    // One handle for the component's lifetime: everything it reads goes
    // through a ref, so a value change never hands the parent a new object.
    useImperativeHandle(
      ref,
      () => ({
        focus: () => nativeRef.current?.focus(),
        blur: () => nativeRef.current?.blur(),
        clear: () => nativeRef.current?.clear(),
        setText: (text) => nativeRef.current?.replaceText(text),
        setValue: (next) => nativeRef.current?.setValue(next),
        // Before the native view attaches, `textRef` is a controlled field's
        // `value` and an uncontrolled one's initial text.
        getText: () => nativeRef.current?.currentText() ?? textRef.current,
        getValue: () => nativeRef.current?.getValue() ?? NaN,
        // The native view is the truth once there is one - it knows whether it
        // actually holds first responder. Before it attaches, fall back to the
        // registry this field already keeps up to date, which is the same place
        // `TextInput.isFocused()` reads from.
        isFocused: () =>
          nativeRef.current?.isFocused() ??
          (registryKeyRef.current != null &&
            textInputRegistry?.currentlyFocusedInput() === registryKeyRef.current),
        setSelection: (start: number, end?: number) =>
          nativeRef.current?.setSelection(start, end ?? start),
        get native() {
          return nativeRef.current
        },
      }),
      []
    )

    // Every native prop is sent with an explicit value: an optional prop that
    // is *removed* reaches native as `null`, which Nitro's parser rejects and
    // React Native turns into a fatal error. `NaN` stands for "platform default"
    // where there is no value to express it (colors), `''` for fonts.
    const processedColor = useMemo(() => toProcessedColor(color) ?? NaN, [color])
    const processedPlaceholderColor = useMemo(
      () => toProcessedColor(placeholderTextColor) ?? NaN,
      [placeholderTextColor]
    )
    const processedCursorColor = useMemo(
      () => toProcessedColor(cursorColor) ?? NaN,
      [cursorColor]
    )
    const processedSelectionColor = useMemo(
      () => toProcessedColor(selectionColor) ?? NaN,
      [selectionColor]
    )
    const processedLabelColor = useMemo(() => toProcessedColor(labelColor) ?? NaN, [labelColor])
    const processedLabelFocusedColor = useMemo(
      () => toProcessedColor(labelFocusedColor) ?? NaN,
      [labelFocusedColor]
    )
    const processedStrokeColor = useMemo(() => toProcessedColor(strokeColor) ?? NaN, [strokeColor])
    const processedFocusedStrokeColor = useMemo(
      () => toProcessedColor(focusedStrokeColor) ?? NaN,
      [focusedStrokeColor]
    )
    const processedFillColor = useMemo(() => toProcessedColor(fillColor) ?? NaN, [fillColor])
    const numericWeight = toNumericWeight(fontWeight) ?? 400
    const resolvedFontSize = fontSize ?? 32
    const resolvedAffixAlign = affixAlign ?? 'baseline'
    // Multiline is drawn by the system view and is always text: the glyph
    // engine lays one run out on one baseline, and an amount or a mask is a
    // single-line idea. Rather than half-honour the combination, drop the part
    // that cannot work and say so.
    const isMultiline = multiline ?? false
    if (__DEV__ && isMultiline) {
      if (mode != null && mode !== 'text') {
        warnIncompatible(`mode="${mode}"`)
      }
      if (morph) warnIncompatible('morph')
      if (prefix) warnIncompatible('prefix')
      if (suffix) warnIncompatible('suffix')
    }
    const resolvedMode = isMultiline ? 'text' : (mode ?? 'text')
    const resolvedMorph = isMultiline ? false : (morph ?? false)
    // The affixes are accessory views beside one line of text; a wrapping text
    // view has no slot for them, so they go with the mode rather than being
    // half-drawn on one platform and not the other.
    const resolvedPrefix = isMultiline ? '' : (prefix ?? '')
    const resolvedSuffix = isMultiline ? '' : (suffix ?? '')
    // A new `maskNotations` literal each render must not re-set the native
    // prop, so it is keyed on its contents. Always an array (empty = none):
    // removing the prop would reach native as `null`, which Nitro's array
    // parser rejects.
    const notationsKey =
      maskNotations != null && maskNotations.length > 0 ? JSON.stringify(maskNotations) : ''
    const stableNotations = useMemo(
      () => (notationsKey !== '' && maskNotations ? [...maskNotations] : EMPTY_NOTATIONS),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [notationsKey]
    )
    const resolvedFractionDigits = fractionDigits ?? 2
    const resolvedKeyboardType =
      keyboardType ??
      (inputMode != null
        ? INPUT_MODE_TO_KEYBOARD[inputMode]
        : resolvedMode === 'number'
          ? resolvedFractionDigits > 0
            ? 'decimal-pad'
            : 'number-pad'
          : 'default')
    const resolvedReturnKeyType =
      returnKeyType ?? (enterKeyHint != null ? ENTER_KEY_HINT_TO_RETURN_KEY[enterKeyHint] : 'default')
    // `inputMode="none"` means "focus it but show no keyboard", as in RN.
    const resolvedShowSoftInput =
      showSoftInputOnFocus ?? (inputMode != null ? inputMode !== 'none' : true)

    // React Native resolves its HTML-flavoured aliases inside its own
    // components; a Nitro view is handed the raw props, so `aria-label` and
    // `id` would arrive unresolved and be dropped by the C++ parser. Both take
    // precedence over the older spelling, as they do on a `TextInput`.
    //
    // The label goes on the hidden field (below), so leaving it on the host as
    // well would put the same label on two accessibility elements. `testID`
    // stays on the host too: it makes no accessibility element of its own, and
    // a test that already queries the host must keep working.
    const {
      accessibilityLabel,
      'aria-label': ariaLabel,
      id,
      nativeID,
      ...restViewProps
    } = viewProps as typeof viewProps & { 'aria-label'?: string }
    const resolvedAccessibilityLabel = ariaLabel ?? accessibilityLabel
    const resolvedNativeID = id ?? nativeID
    // Added only when there is one: a native prop is never sent `undefined`.
    const hostViewProps =
      resolvedNativeID != null ? { ...restViewProps, nativeID: resolvedNativeID } : restViewProps

    const autoSize = useMemo(
      () =>
        size !== null
          ? autoWidth
            ? { width: size.width, height: size.height }
            : { height: size.height }
          : { height: resolvedFontSize * 1.25 },
      [size, resolvedFontSize, autoWidth]
    )

    return (
      <NativeNitroInputView
        {...hostViewProps}
        ref={hostRef as React.Ref<never>}
        style={[autoSize, style]}
        hybridRef={hybridRef}
        text={value ?? initialText}
        mostRecentEventCount={eventCountRef.current}
        mode={resolvedMode}
        plain={!resolvedMorph}
        fractionDigits={resolvedFractionDigits}
        maxIntegerDigits={maxIntegerDigits ?? 15}
        groupingSeparator={groupingSeparator ?? ','}
        decimalSeparator={decimalSeparator ?? '.'}
        prefix={resolvedPrefix}
        suffix={resolvedSuffix}
        prefixFontSize={prefixFontSize ?? resolvedFontSize}
        suffixFontSize={suffixFontSize ?? resolvedFontSize}
        signPlacement={signPlacement ?? 'beforeAffix'}
        prefixAlign={prefixAlign ?? resolvedAffixAlign}
        suffixAlign={suffixAlign ?? resolvedAffixAlign}
        placeholder={placeholder ?? ''}
        placeholderColor={processedPlaceholderColor}
        duration={duration ?? 400}
        easing={easing ?? 'expo'}
        bounce={bounce ?? 0.15}
        effect={effect ?? 'auto'}
        fontSize={resolvedFontSize}
        lineHeight={Math.max(0, lineHeight ?? 0)}
        fontWeight={numericWeight}
        fontFamily={fontFamily ?? ''}
        color={processedColor}
        textAlign={textAlign ?? 'auto'}
        rightToLeft={rightToLeft}
        caretColor={processedCursorColor}
        selectionColor={processedSelectionColor}
        caretHidden={caretHidden ?? false}
        adjustsFontSizeToFit={adjustsFontSizeToFit ?? false}
        minimumFontScale={minimumFontScale ?? 0.5}
        allowFontScaling={allowFontScaling ?? false}
        maxFontSizeMultiplier={maxFontSizeMultiplier ?? 0}
        variant={variant ?? 'none'}
        label={label ?? ''}
        labelBehavior={labelBehavior ?? 'float'}
        labelColor={processedLabelColor}
        labelFocusedColor={processedLabelFocusedColor}
        labelFontSize={labelFontSize ?? 0}
        strokeColor={processedStrokeColor}
        focusedStrokeColor={processedFocusedStrokeColor}
        strokeWidth={strokeWidth ?? 1}
        cornerRadius={cornerRadius ?? 8}
        fillColor={processedFillColor}
        mask={resolvedMode === 'mask' ? (mask ?? '') : ''}
        maskNotations={stableNotations}
        maskAutocomplete={maskAutocomplete ?? true}
        maskAutoSkip={maskAutoSkip ?? false}
        onChangeMask={onChangeMaskCallback}
        keyboardType={resolvedKeyboardType}
        returnKeyType={resolvedReturnKeyType}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={autoCorrect ?? true}
        editable={(editable ?? true) && !(readOnly ?? false)}
        multiline={isMultiline}
        numberOfLines={Math.max(0, Math.trunc(numberOfLines ?? rows ?? 0))}
        textAlignVertical={textAlignVertical ?? 'auto'}
        scrollEnabled={scrollEnabled ?? true}
        autoFocus={autoFocus ?? false}
        fieldTestID={viewProps.testID ?? ''}
        fieldAccessibilityLabel={resolvedAccessibilityLabel ?? ''}
        submitBehavior={
          submitBehavior ??
          // As `TextInput` resolves the legacy `blurOnSubmit`: a multiline
          // field's return key inserts a line break unless told to blur.
          (multiline
            ? blurOnSubmit === true
              ? 'blurAndSubmit'
              : 'newline'
            : blurOnSubmit === false
              ? 'submit'
              : 'blurAndSubmit')
        }
        secureTextEntry={secureTextEntry ?? false}
        keyboardAppearance={keyboardAppearance ?? 'default'}
        textContentType={textContentType ?? autoComplete ?? ''}
        enablesReturnKeyAutomatically={enablesReturnKeyAutomatically ?? false}
        showSoftInputOnFocus={resolvedShowSoftInput}
        selectTextOnFocus={selectTextOnFocus ?? false}
        clearTextOnFocus={clearTextOnFocus ?? false}
        contextMenuHidden={contextMenuHidden ?? false}
        spellCheck={spellCheck ?? autoCorrect ?? true}
        selectionStart={selection?.start ?? -1}
        selectionEnd={selection?.end ?? selection?.start ?? -1}
        maxLength={maxLength ?? 0}
        transformWorklet={transformId}
        onChangeTextWorklet={onChangeTextId}
        onChangeValueWorklet={onChangeValueId}
        onFocusChangeWorklet={onFocusId}
        onSelectionChangeWorklet={onSelectionChangeId}
        onSubmitEditingWorklet={onSubmitEditingId}
        onEndEditingWorklet={onEndEditingId}
        onKeyPressWorklet={onKeyPressId}
        onChangeText={onChangeTextCallback}
        onChangeValue={onChangeValueCallback}
        onFocusChange={onFocusChangeCallback}
        onSubmitEditing={onSubmitEditingCallback}
        onEndEditing={onEndEditingCallback}
        onSelectionChange={onSelectionChangeCallback}
        onKeyPress={onKeyPressCallback}
        onSizeChange={onSizeChange}
      />
    )
  }
)

/**
 * Registers `fn` on the UI runtime for as long as it stays the same function
 * and returns its id (`0` while there is none or worklets are unavailable).
 *
 * The id is reserved during render so the first commit already carries it, but
 * the registration itself happens in the effect: a render React discards (under
 * StrictMode, or a concurrent render that loses) would otherwise leave an entry
 * on the UI runtime that no cleanup ever removes.
 */
function useWorkletId<T extends (...args: never[]) => unknown>(
  fn: T | undefined,
  register: (fn: T, id: number) => void
): number {
  const id = useMemo(() => (fn ? allocateWorkletId() : 0), [fn])
  useEffect(() => {
    if (id === 0 || !fn) return
    register(fn, id)
    return () => unregisterWorklet(id)
  }, [id, fn, register])
  return id
}

/**
 * The same, for the focus pair: native reports one focus change, so the two
 * handlers share an id and the wrapper picks between them.
 */
function useWorkletPairId<T extends (...args: never[]) => unknown>(
  onFocus: T | undefined,
  onBlur: T | undefined,
  register: (a: T | undefined, b: T | undefined, id: number) => void
): number {
  const id = useMemo(() => (onFocus || onBlur ? allocateWorkletId() : 0), [onFocus, onBlur])
  useEffect(() => {
    if (id === 0) return
    register(onFocus, onBlur, id)
    return () => unregisterWorklet(id)
  }, [id, onFocus, onBlur, register])
  return id
}
