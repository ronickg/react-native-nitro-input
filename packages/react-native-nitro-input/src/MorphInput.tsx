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
  NitroInputMethods,
  NitroInputMode,
  NitroInputProps as NativeNitroInputProps,
  NitroInputReturnKeyType,
  NitroInputSubmitBehavior,
  NitroInputTextAlign,
} from './specs/NitroInput.nitro'
import {
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
const mountedFields = new WeakMap<object, { focus(): void; blur(): void }>()
let patchedRegistry = false

/**
 * `TextInput.State.focusTextInput` / `blurTextInput` — and therefore
 * `Keyboard.dismiss()`, `keyboardShouldPersistTaps` and a ScrollView's
 * auto-blur — reach a text input by dispatching a codegen `focus` / `blur`
 * *view command*. A Nitro view has no such command on Android, so the call
 * would be dropped and the keyboard would stay up. These two functions are
 * wrapped once to route a MorphInput to its own native focus/blur; every other
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
 * The raw Nitro host component. Prefer {@link MorphInput}, which adds the
 * controlled-value handshake, auto-sizing, color/weight conversion and a
 * convenient handle.
 */
export const NativeNitroInputView = getHostComponent<
  NativeNitroInputProps,
  NitroInputMethods
>('NitroInputView', () => NitroInputViewConfig)

/** The native Nitro `HybridObject` behind a mounted {@link MorphInput}. */
export type MorphInputRef = HybridRef<NativeNitroInputProps, NitroInputMethods>

export interface MorphInputProps extends Omit<ViewProps, 'children'> {
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
  mode?: NitroInputMode
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
   * Draw the text with the system field and skip the morph overlay entirely.
   * `MorphInput` is this component with `plain` on; you rarely set it here.
   * Default: `false`.
   */
  plain?: boolean
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
  onNativeRef?: (ref: MorphInputRef) => void
}

/** Imperative handle exposed through `ref`. Methods are no-ops before mount. */
export interface MorphInputHandle {
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
  /** The native Nitro object, or `null` before mount. */
  readonly native: MorphInputRef | null
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
export const MorphInput = forwardRef<MorphInputHandle, MorphInputProps>(
  function MorphInput(
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
      keyboardType,
      returnKeyType,
      autoCapitalize,
      autoCorrect,
      editable,
      autoFocus,
      plain,
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
      onChangeValue,
      onFocus,
      onBlur,
      onSubmitEditing,
      onNativeRef,
      style,
      ...viewProps
    },
    ref
  ) {
    const nativeRef = useRef<MorphInputRef | null>(null)
    // What React Native's registry stores for this field. The React host
    // instance when there is one (iOS), otherwise a stable per-instance token:
    // on Android the Nitro host component hands out no instance, and the
    // registry only ever compares identity or passes the value back to us.
    const hostRef = useRef<unknown>(null)
    const registryKeyRef = useRef<object | null>(null)
    const latest = useRef({
      onNativeRef,
      onChangeText,
      onChangeValue,
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
      onChangeValue,
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
        callback((instance: MorphInputRef) => {
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
    const autoWidth = flat?.width == null && flat?.flex == null
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
      (resolvedMode === 'number'
        ? resolvedFractionDigits > 0
          ? 'decimal-pad'
          : 'number-pad'
        : 'default')

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
        plain={plain ?? false}
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
        keyboardType={resolvedKeyboardType}
        returnKeyType={returnKeyType ?? 'default'}
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
        showSoftInputOnFocus={showSoftInputOnFocus ?? true}
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
 */
function useWorkletId<T extends (...args: never[]) => unknown>(
  fn: T | undefined,
  register: (fn: T) => number
): number {
  const id = useMemo(() => (fn ? register(fn) : 0), [fn, register])
  useEffect(() => () => unregisterWorklet(id), [id])
  return id
}
