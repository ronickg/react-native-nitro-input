import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
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
  NitroInputVariant,
  NitroInputNotation,
} from './specs/NitroInput.nitro'
import {
  allocateWorkletId,
  isWorklet,
  registerCallback,
  registerTransform,
  unregisterWorklet,
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native/Libraries/Components/TextInput/TextInputState')
    const state = (mod?.default ?? mod) as Partial<TextInputRegistry> | undefined
    return typeof state?.focusInput === 'function' && typeof state?.blurInput === 'function'
      ? (state as TextInputRegistry & Partial<TextInputCommands>)
      : null
  } catch {
    return null
  }
})()

/** Mounted fields, by the host instance React Native's registry stores. */
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

const mountedFields = new WeakMap<object, { focus(): void; blur(): void }>()
let patchedRegistry = false

/**
 * `TextInput.State.focusTextInput` / `blurTextInput` — and therefore
 * `Keyboard.dismiss()`, `keyboardShouldPersistTaps` and a ScrollView's
 * auto-blur — reach a text input by dispatching a codegen `focus` / `blur`
 * *view command*. A Nitro view has no such command on Android, so the call
 * would be dropped and the keyboard would stay up. These two functions are
 * wrapped once to route a NitroInput to its own native focus/blur; every other
 * input is passed straight through untouched.
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

export interface NitroInputProps extends Omit<ViewProps, 'children'> {
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
   * `'number'` formats natively as you type: grouping separators, one decimal
   * separator, up to `fractionDigits` decimals, a currency `prefix` /
   * `suffix`. `'text'` is a plain single-line field. Default: `'text'`.
   */
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
  /** Font weight, like `Text`'s `fontWeight`. Default: `'normal'`. */
  fontWeight?: TextStyle['fontWeight']
  /** Font family name, like `Text`'s `fontFamily`. Defaults to the system font. */
  fontFamily?: string
  /** Text color. Defaults to the platform's primary label color. */
  color?: ColorValue
  /** Where the text sits when the view is wider than it. Default: `'left'`. */
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
  /** Focus the field when it mounts. Default: `false`. */
  autoFocus?: boolean
  /**
   * What the return key does: `'blurAndSubmit'` (default) fires
   * `onSubmitEditing` and dismisses the keyboard, `'submit'` fires it and keeps
   * focus so a form can move to the next field itself.
   */
  submitBehavior?: NitroInputSubmitBehavior
  /** Deprecated alias of `submitBehavior`, like React Native's. `false` means `'submit'`. */
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
  onFocus?: () => void
  onBlur?: () => void
  /** The return key was pressed. */
  onSubmitEditing?: (text: string) => void
  /** Editing finished (focus lost or keyboard dismissed), like `TextInput`'s `onEndEditing`. */
  onEndEditing?: (text: string) => void
  /** The caret or selection moved, in code points. */
  onSelectionChange?: (selection: { start: number; end: number }) => void
  /** A key was pressed, before the text changes: the character, `'Backspace'` or `'Enter'`. */
  onKeyPress?: (key: string) => void
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

interface Size {
  width: number
  height: number
}

/**
 * A native single-line input whose text morphs as you type: characters that
 * stay glide to their new place, new ones slide or fade in, removed ones leave
 * alongside their neighbours. In `'number'` mode the amount is formatted on
 * the native side as it is typed (grouping, decimal, currency affixes), with
 * the caret kept in place, so there is never an unformatted frame and never a
 * round trip through JS.
 *
 * The view sizes itself to its content unless `style` gives it a width.
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
      prefixAlign,
      suffixAlign,
      placeholder,
      placeholderTextColor,
      duration,
      easing,
      bounce,
      effect,
      fontSize,
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

    const [size, setSize] = useState<Size | null>(null)
    // Worklets are registered on the UI runtime and referenced by id; a
    // handler marked 'worklet' runs there instead of on the JS thread.
    const transformId = useWorkletId(transform, registerTransform)
    const onChangeTextWorklet = isWorklet(onChangeText) ? onChangeText : undefined
    const onChangeValueWorklet = isWorklet(onChangeValue) ? onChangeValue : undefined
    const onChangeTextId = useWorkletId(onChangeTextWorklet, registerCallback)
    const onChangeValueId = useWorkletId(onChangeValueWorklet, registerCallback)
    // The latest native event count JS has processed: sent back with `text` so
    // native can tell a stale controlled value (the user typed since) from a
    // deliberate change.
    const [eventCount, setEventCount] = useState(0)
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
    const flat = StyleSheet.flatten(style) as
      | { width?: unknown; flex?: unknown; height?: unknown }
      | undefined
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
          setEventCount(count)
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
    const onFocusChangeCallback = useMemo(
      () =>
        callback((focused: boolean) => {
          const key = registryKeyRef.current
          if (key != null) {
            if (focused) textInputRegistry?.focusInput(key)
            else textInputRegistry?.blurInput(key)
          }
          if (focused) latest.current.onFocus?.()
          else latest.current.onBlur?.()
        }),
      []
    )
    const onSubmitEditingCallback = useMemo(
      () =>
        callback((text: string) => {
          latest.current.onSubmitEditing?.(text)
        }),
      []
    )
    const onEndEditingCallback = useMemo(
      () =>
        callback((text: string) => {
          latest.current.onEndEditing?.(text)
        }),
      []
    )
    const onSelectionChangeCallback = useMemo(
      () =>
        callback((start: number, end: number) => {
          latest.current.onSelectionChange?.({ start, end })
        }),
      []
    )
    const onKeyPressCallback = useMemo(
      () =>
        callback((key: string) => {
          latest.current.onKeyPress?.(key)
        }),
      []
    )

    useImperativeHandle(
      ref,
      () => ({
        focus: () => nativeRef.current?.focus(),
        blur: () => nativeRef.current?.blur(),
        clear: () => nativeRef.current?.clear(),
        setText: (text) => nativeRef.current?.replaceText(text),
        setValue: (next) => nativeRef.current?.setValue(next),
        getText: () => nativeRef.current?.currentText() ?? value ?? initialText,
        getValue: () => nativeRef.current?.getValue() ?? NaN,
        isFocused: () => nativeRef.current?.isFocused() ?? false,
        setSelection: (start: number, end?: number) =>
          nativeRef.current?.setSelection(start, end ?? start),
        get native() {
          return nativeRef.current
        },
      }),
      [value, initialText]
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
    const numericWeight = toNumericWeight(fontWeight) ?? 400
    const resolvedFontSize = fontSize ?? 32
    const resolvedAffixAlign = affixAlign ?? 'baseline'
    const resolvedMode = mode ?? 'text'
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

    // The label goes on the hidden field (below), so leaving it on the host as
    // well would put the same label on two accessibility elements. `testID`
    // stays on the host too: it makes no accessibility element of its own, and
    // a test that already queries the host must keep working.
    const { accessibilityLabel, ...hostViewProps } = viewProps

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
        mostRecentEventCount={eventCount}
        mode={resolvedMode}
        plain={!morph}
        fractionDigits={resolvedFractionDigits}
        maxIntegerDigits={maxIntegerDigits ?? 15}
        groupingSeparator={groupingSeparator ?? ','}
        decimalSeparator={decimalSeparator ?? '.'}
        prefix={prefix ?? ''}
        suffix={suffix ?? ''}
        prefixFontSize={prefixFontSize ?? resolvedFontSize}
        suffixFontSize={suffixFontSize ?? resolvedFontSize}
        affixAlign={resolvedAffixAlign}
        prefixAlign={prefixAlign ?? resolvedAffixAlign}
        suffixAlign={suffixAlign ?? resolvedAffixAlign}
        placeholder={placeholder ?? ''}
        placeholderColor={processedPlaceholderColor}
        duration={duration ?? 400}
        easing={easing ?? 'expo'}
        bounce={bounce ?? 0.15}
        effect={effect ?? 'auto'}
        fontSize={resolvedFontSize}
        fontWeight={numericWeight}
        fontFamily={fontFamily ?? ''}
        color={processedColor}
        textAlign={textAlign ?? 'left'}
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
        labelColor={toProcessedColor(labelColor) ?? NaN}
        labelFocusedColor={toProcessedColor(labelFocusedColor) ?? NaN}
        labelFontSize={labelFontSize ?? 0}
        strokeColor={toProcessedColor(strokeColor) ?? NaN}
        focusedStrokeColor={toProcessedColor(focusedStrokeColor) ?? NaN}
        strokeWidth={strokeWidth ?? 1}
        cornerRadius={cornerRadius ?? 8}
        fillColor={toProcessedColor(fillColor) ?? NaN}
        mask={resolvedMode === 'mask' ? (mask ?? '') : ''}
        maskNotations={maskNotations ?? EMPTY_NOTATIONS}
        maskAutocomplete={maskAutocomplete ?? true}
        maskAutoSkip={maskAutoSkip ?? false}
        onChangeMask={onChangeMaskCallback}
        keyboardType={resolvedKeyboardType}
        returnKeyType={resolvedReturnKeyType}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={autoCorrect ?? true}
        editable={(editable ?? true) && !(readOnly ?? false)}
        autoFocus={autoFocus ?? false}
        fieldTestID={viewProps.testID ?? ''}
        fieldAccessibilityLabel={accessibilityLabel ?? ''}
        submitBehavior={submitBehavior ?? (blurOnSubmit === false ? 'submit' : 'blurAndSubmit')}
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
