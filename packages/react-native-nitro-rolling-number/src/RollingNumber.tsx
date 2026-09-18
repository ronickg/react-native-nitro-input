import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  processColor,
  type ColorValue,
  type TextStyle,
  type ViewProps,
} from 'react-native'
import {
  callback,
  getHostComponent,
  type HybridRef,
} from 'react-native-nitro-modules'
import RollingNumberViewConfig from '../nitrogen/generated/shared/json/RollingNumberViewConfig.json'
import type {
  RollingNumberAffixAlign,
  RollingNumberDirection,
  RollingNumberEasing,
  RollingNumberMethods,
  RollingNumberProps as NativeRollingNumberProps,
  RollingNumberTextAlign,
} from './specs/RollingNumber.nitro'

/**
 * The raw Nitro host component. Prefer {@link RollingNumber}, which adds
 * auto-sizing, color/weight conversion and a convenient handle.
 */
export const NativeRollingNumberView = getHostComponent<
  NativeRollingNumberProps,
  RollingNumberMethods
>('RollingNumberView', () => RollingNumberViewConfig)

/** The native Nitro `HybridObject` behind a mounted {@link RollingNumber}. */
export type RollingNumberRef = HybridRef<
  NativeRollingNumberProps,
  RollingNumberMethods
>

export interface RollingNumberProps extends Omit<ViewProps, 'children'> {
  /**
   * The number to display. Every change rolls each digit natively to its new
   * glyph, in the direction of the change. The first value is shown instantly.
   */
  value: number
  /** Digits shown after the decimal separator. Default: `0`. */
  fractionDigits?: number
  /** Zero-pads the integer part to at least this many digits. Default: `1`. */
  minimumIntegerDigits?: number
  /** Inserted between every three integer digits (e.g. `','`). Default: none. */
  groupingSeparator?: string
  /** Placed between integer and fraction digits. Default: `'.'`. */
  decimalSeparator?: string
  /** Static text drawn before the number, e.g. `'$'`. */
  prefix?: string
  /** Static text drawn after the number, e.g. `'%'`. */
  suffix?: string
  /** Duration in ms of the roll played when `value` changes. `0` snaps. Default: `500`. */
  duration?: number
  /** Timing curve of the roll. Default: `'easeInOut'`. */
  easing?: RollingNumberEasing
  /** Overshoot of the `'spring'` easing, `0`–`1`. Default: `0.15`. */
  bounce?: number
  /**
   * Delay in ms between the start of each digit's roll, least significant
   * digit first, so a change cascades like a mechanical carry. Default: `0`.
   */
  stagger?: number
  /** Which way the digits roll. `'auto'` follows the sign of the change. Default: `'auto'`. */
  direction?: RollingNumberDirection
  /**
   * Loading glint: the ink keeps its color while a slanted, text-wide band of
   * `shimmerColor` sweeps through the glyphs (a "shine" skeleton). Toggling
   * cross-fades; the number keeps its size so nothing jumps when the value
   * arrives. Default: `false`.
   */
  loading?: boolean
  /** Color of the glint's core, e.g. your theme's lightest neutral. Defaults to `#D6D9E1` (`#2B2E37` in dark mode). */
  shimmerColor?: ColorValue
  /** Duration of one sweep in ms (linear, repeating). Default: `950`. */
  shimmerDuration?: number
  /** Font size of the digits in points. Default: `32`. */
  fontSize?: number
  /** Font size of `prefix`, e.g. a smaller currency symbol. Defaults to `fontSize`. */
  prefixFontSize?: number
  /** Font size of `suffix`, e.g. a smaller currency code. Defaults to `fontSize`. */
  suffixFontSize?: number
  /**
   * How prefix and suffix line up with the digits: `'top'` pins glyph tops,
   * `'bottom'` pins the bottom of the line boxes, `'baseline'` shares the
   * digits' baseline, `'center'` centres. Default: `'baseline'`.
   */
  affixAlign?: RollingNumberAffixAlign
  /** Alignment of `prefix` only. Defaults to `affixAlign`. */
  prefixAlign?: RollingNumberAffixAlign
  /** Alignment of `suffix` only. Defaults to `affixAlign`. */
  suffixAlign?: RollingNumberAffixAlign
  /**
   * Scale the number down when the view is narrower than its content, and back
   * up (never above `fontSize`) when it fits again. Give the view a fixed
   * `width` in `style`; the view keeps its full-size height so the box around
   * it never moves, only the amount scales. Like `Text`'s prop. Default: `false`.
   */
  adjustsFontSizeToFit?: boolean
  /** Smallest scale `adjustsFontSizeToFit` may apply, `0`–`1`. Default: `0.5`. */
  minimumFontScale?: number
  /** Font weight, like `Text`'s `fontWeight`. Default: `'normal'`. */
  fontWeight?: TextStyle['fontWeight']
  /** Font family name, like `Text`'s `fontFamily`. Defaults to the system font. */
  fontFamily?: string
  /** Text color. Defaults to the platform's primary label color. */
  color?: ColorValue
  /**
   * Where the number sits when the view is wider than its content, e.g. when
   * you give it a fixed `width` so it doesn't reflow as digits appear.
   * Default: `'left'`.
   */
  textAlign?: RollingNumberTextAlign
  /** Receives the native Nitro object once the view is mounted. */
  onNativeRef?: (ref: RollingNumberRef) => void
}

/** Imperative handle exposed through `ref`. Methods are no-ops before mount. */
export interface RollingNumberHandle {
  /**
   * Shows `value` immediately with continuously positioned digits (odometer
   * style, `12.5` shows the last digit half way between `2` and `3`). No roll
   * is played. Useful for scrubbing, e.g. from a scroll or drag handler.
   */
  jumpTo(value: number): void
  /** Rolls to `value` natively, exactly like changing the `value` prop. */
  animateTo(value: number): void
  /** The value currently shown or being rolled towards. */
  getValue(): number
  /** The native Nitro object, or `null` before mount. */
  readonly native: RollingNumberRef | null
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
 * A natively animated rolling number (odometer / ticker).
 *
 * Change `value` and every digit rolls to its new glyph on the native side.
 * Use the ref's `animateTo` / `jumpTo` for imperative updates.
 *
 * The view sizes itself to its content unless you pass an explicit `width` /
 * `height` in `style`.
 */
export const RollingNumber = forwardRef<RollingNumberHandle, RollingNumberProps>(
  function RollingNumber(
    {
      value,
      fractionDigits,
      minimumIntegerDigits,
      groupingSeparator,
      decimalSeparator,
      prefix,
      suffix,
      duration,
      easing,
      bounce,
      stagger,
      direction,
      loading,
      shimmerColor,
      shimmerDuration,
      fontSize,
      prefixFontSize,
      suffixFontSize,
      affixAlign,
      prefixAlign,
      suffixAlign,
      adjustsFontSizeToFit,
      minimumFontScale,
      fontWeight,
      fontFamily,
      color,
      textAlign,
      onNativeRef,
      style,
      ...viewProps
    },
    ref
  ) {
    const nativeRef = useRef<RollingNumberRef | null>(null)
    const latestOnNativeRef = useRef(onNativeRef)
    latestOnNativeRef.current = onNativeRef

    const [size, setSize] = useState<Size | null>(null)

    // Nitro callbacks must be wrapped with `callback()` and the wrapper object
    // has to be referentially stable, otherwise every render re-sets the prop.
    const hybridRef = useMemo(
      () =>
        callback((instance: RollingNumberRef) => {
          nativeRef.current = instance
          latestOnNativeRef.current?.(instance)
        }),
      []
    )
    const onSizeChange = useMemo(
      () =>
        callback((width: number, height: number) => {
          setSize((previous) =>
            previous !== null &&
            previous.width === width &&
            previous.height === height
              ? previous
              : { width, height }
          )
        }),
      []
    )

    useImperativeHandle(
      ref,
      () => ({
        jumpTo: (next) => nativeRef.current?.jumpTo(next),
        animateTo: (next) => nativeRef.current?.animateTo(next),
        getValue: () => nativeRef.current?.value ?? value,
        get native() {
          return nativeRef.current
        },
      }),
      [value]
    )

    const processedColor = useMemo(() => toProcessedColor(color), [color])
    const processedShimmerColor = useMemo(
      () => toProcessedColor(shimmerColor),
      [shimmerColor]
    )
    const numericWeight = toNumericWeight(fontWeight)

    const autoSize = useMemo(
      () =>
        size !== null
          ? { width: size.width, height: size.height }
          : { height: (fontSize ?? 32) * 1.25 },
      [size, fontSize]
    )

    return (
      <NativeRollingNumberView
        {...viewProps}
        style={[autoSize, style]}
        hybridRef={hybridRef}
        value={value}
        fractionDigits={fractionDigits}
        minimumIntegerDigits={minimumIntegerDigits}
        groupingSeparator={groupingSeparator}
        decimalSeparator={decimalSeparator}
        prefix={prefix}
        suffix={suffix}
        duration={duration}
        easing={easing}
        bounce={bounce}
        stagger={stagger}
        direction={direction}
        loading={loading}
        shimmerColor={processedShimmerColor}
        shimmerDuration={shimmerDuration}
        fontSize={fontSize}
        prefixFontSize={prefixFontSize}
        suffixFontSize={suffixFontSize}
        affixAlign={affixAlign}
        prefixAlign={prefixAlign}
        suffixAlign={suffixAlign}
        adjustsFontSizeToFit={adjustsFontSizeToFit}
        minimumFontScale={minimumFontScale}
        fontWeight={numericWeight}
        fontFamily={fontFamily}
        color={processedColor}
        textAlign={textAlign}
        onSizeChange={onSizeChange}
      />
    )
  }
)
