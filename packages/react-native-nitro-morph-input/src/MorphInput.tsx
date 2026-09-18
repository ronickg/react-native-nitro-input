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
import MorphInputViewConfig from '../nitrogen/generated/shared/json/MorphInputViewConfig.json'
import type {
  MorphInputAffixAlign,
  MorphInputAutoCapitalize,
  MorphInputEasing,
  MorphInputEffect,
  MorphInputKeyboardType,
  MorphInputMethods,
  MorphInputMode,
  MorphInputProps as NativeMorphInputProps,
  MorphInputReturnKeyType,
  MorphInputTextAlign,
} from './specs/MorphInput.nitro'
import {
  isWorklet,
  registerCallback,
  registerTransform,
  unregisterWorklet,
  type MorphTransform,
} from './worklets'

/**
 * The raw Nitro host component. Prefer {@link MorphInput}, which adds the
 * controlled-value handshake, auto-sizing, color/weight conversion and a
 * convenient handle.
 */
export const NativeMorphInputView = getHostComponent<
  NativeMorphInputProps,
  MorphInputMethods
>('MorphInputView', () => MorphInputViewConfig)

/** The native Nitro `HybridObject` behind a mounted {@link MorphInput}. */
export type MorphInputRef = HybridRef<NativeMorphInputProps, MorphInputMethods>

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
  mode?: MorphInputMode
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
  affixAlign?: MorphInputAffixAlign
  /** Alignment of `prefix` only. Defaults to `affixAlign`. */
  prefixAlign?: MorphInputAffixAlign
  /** Alignment of `suffix` only. Defaults to `affixAlign`. */
  suffixAlign?: MorphInputAffixAlign
  /** Shown while the field is empty and morphed away by the first character. In `'number'` mode `'0'` reads well. */
  placeholder?: string
  /** Color of the placeholder. Defaults to the platform placeholder color. */
  placeholderTextColor?: ColorValue
  /** Duration in ms of the morph played on every change. `0` snaps. Default: `400`. */
  duration?: number
  /** Timing curve of the morph. Default: `'expo'` (Torph's `cubic-bezier(0.19, 1, 0.22, 1)`). */
  easing?: MorphInputEasing
  /** Overshoot of the `'spring'` easing, `0`–`1`. Default: `0.15`. */
  bounce?: number
  /**
   * How characters enter and leave. `'auto'`: digits and separators slide
   * through the line box (digits from above, separators from below), other
   * characters fade and scale. Default: `'auto'`.
   */
  effect?: MorphInputEffect
  /** Font size in points. Default: `32`. */
  fontSize?: number
  /** Font weight, like `Text`'s `fontWeight`. Default: `'normal'`. */
  fontWeight?: TextStyle['fontWeight']
  /** Font family name, like `Text`'s `fontFamily`. Defaults to the system font. */
  fontFamily?: string
  /** Text color. Defaults to the platform's primary label color. */
  color?: ColorValue
  /** Where the text sits when the view is wider than it. Default: `'left'`. */
  textAlign?: MorphInputTextAlign
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
  keyboardType?: MorphInputKeyboardType
  /** Label of the return key. Default: `'default'`. */
  returnKeyType?: MorphInputReturnKeyType
  /** Auto-capitalisation in `'text'` mode. Default: `'sentences'`. */
  autoCapitalize?: MorphInputAutoCapitalize
  /** Auto-correction in `'text'` mode. Default: `true`. */
  autoCorrect?: boolean
  /** Whether the user can edit the field. Default: `true`. */
  editable?: boolean
  /** Focus the field when it mounts. Default: `false`. */
  autoFocus?: boolean
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
  transform?: MorphTransform
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
    const latest = useRef({
      onNativeRef,
      onChangeText,
      onChangeValue,
      onFocus,
      onBlur,
      onSubmitEditing,
    })
    latest.current = {
      onNativeRef,
      onChangeText,
      onChangeValue,
      onFocus,
      onBlur,
      onSubmitEditing,
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
    // A field with a width of its own (the usual case) never needs a React
    // commit per keystroke: only the height (font-dependent) is taken from native.
    const flat = StyleSheet.flatten(style) as { width?: unknown; flex?: unknown } | undefined
    const autoWidth = flat?.width == null && flat?.flex == null
    const autoWidthRef = useRef(autoWidth)
    autoWidthRef.current = autoWidth
    const onSizeChange = useMemo(
      () =>
        callback((width: number, height: number) => {
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
      <NativeMorphInputView
        {...viewProps}
        style={[autoSize, style]}
        hybridRef={hybridRef}
        text={value ?? initialText}
        mostRecentEventCount={eventCount}
        mode={resolvedMode}
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
        editable={editable ?? true}
        autoFocus={autoFocus ?? false}
        maxLength={maxLength ?? 0}
        transformWorklet={transformId}
        onChangeTextWorklet={onChangeTextId}
        onChangeValueWorklet={onChangeValueId}
        onChangeText={onChangeTextCallback}
        onChangeValue={onChangeValueCallback}
        onFocusChange={onFocusChangeCallback}
        onSubmitEditing={onSubmitEditingCallback}
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
