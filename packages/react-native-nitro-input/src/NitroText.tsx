import React, { useMemo } from 'react'
import {
  I18nManager,
  PixelRatio,
  StyleSheet,
  type ColorValue,
  type TextStyle,
  type ViewProps,
} from 'react-native'
import { getHostComponent, NitroModules } from 'react-native-nitro-modules'
import NitroTextViewConfig from '../nitrogen/generated/shared/json/NitroTextViewConfig.json'
import type { NitroTextMeasure, NitroTextMethods, NitroTextProps as NativeNitroTextProps } from './specs/NitroText.nitro'
import type { NitroInputEasing, NitroInputEffect } from './specs/NitroInput.nitro'
import type { NitroNumberShimmerDirection, NitroNumberTextAlign } from './specs/NitroNumber.nitro'
import { toNumericWeight, toProcessedColor } from './styleHelpers'

/** The raw Nitro host component behind {@link NitroText}. */
export const NativeNitroTextView = getHostComponent<NativeNitroTextProps, NitroTextMethods>(
  'NitroTextView',
  () => NitroTextViewConfig
)

/** What a {@link NitroText} takes: the text, its typography, the morph's timing and the loading shimmer. */
export interface NitroTextProps extends Omit<ViewProps, 'children'> {
  /** The text: a string or a number. A change morphs to it. */
  children: string | number
  /** Default: `17`. */
  fontSize?: number
  /** Like `Text`'s. Default: `'normal'`. */
  fontWeight?: TextStyle['fontWeight']
  /** Defaults to the system font. */
  fontFamily?: string
  /** Defaults to the platform's label colour. */
  color?: ColorValue
  /** Points after every character. Default: `0`. */
  letterSpacing?: number
  /** Where the line sits in a wider view. Default: `'auto'`, the start edge. */
  textAlign?: NitroNumberTextAlign
  /** Scale with the system text size, like `Text`. Default: `false`. */
  allowFontScaling?: boolean
  /** Cap for `allowFontScaling`; `0` is none. Default: `0`. */
  maxFontSizeMultiplier?: number
  /** Of a morph, in ms; `0` switches at once. Default: `400`. */
  duration?: number
  /** Default: `'expo'`. */
  easing?: NitroInputEasing
  /** Overshoot of the `'spring'` easing. Default: `0.15`. */
  bounce?: number
  /** How characters enter and leave: `'auto'` slides digits and fades letters. Default: `'auto'`. */
  effect?: NitroInputEffect
  /** Snap instead of morphing while Reduce Motion is on. Default: `true`. */
  respectReduceMotion?: boolean
  /** A loading glint through the text, as `NitroNumber`'s `loading`. Default: `false`. */
  loading?: boolean
  shimmerColor?: ColorValue
  /** ms per sweep. Default: `950`. */
  shimmerDuration?: number
  /** Degrees; 0 upright. Default: `31`. */
  shimmerAngle?: number
  /** A fraction of the text's width. Default: `1`. */
  shimmerWidth?: number
  /** The glyphs' colour outside the band: a skeleton. Default: `color`. */
  shimmerBaseColor?: ColorValue
  /** Default: `'auto'`, the layout direction. */
  shimmerDirection?: NitroNumberShimmerDirection
  /** ms of pause after each sweep. Default: `0`. */
  shimmerDelay?: number
}

let measurer: NitroTextMeasure | null = null
function measure(): NitroTextMeasure {
  measurer ??= NitroModules.createHybridObject<NitroTextMeasure>('NitroTextMeasure')
  return measurer
}
const lineHeights = new Map<string, number>()

/**
 * A single line of text that morphs to the next, natively, as Torph does on
 * the web: the characters the two share glide to their new places, digits
 * matched by place ("$1,204" → "$1,318" rolls the hundreds and tens), and the
 * rest fade out and in ("Sign in" → "Signing in…"). At rest it is one line
 * drawn in one pass, like a label: no text field, no layer per character.
 * It sizes itself to its text in the render that mounts it (a native
 * measurement, synchronously); a `width` in `style` overrides it.
 *
 * Only the props that were set go to the native view, as
 * react-native-plain-text does: every prop that crosses is converted and
 * stored per view in the commit, and the native side holds the defaults.
 */
export function NitroText({
  children,
  fontSize,
  fontWeight,
  fontFamily,
  color,
  letterSpacing,
  textAlign,
  allowFontScaling,
  maxFontSizeMultiplier,
  duration,
  easing,
  bounce,
  effect,
  respectReduceMotion,
  loading,
  shimmerColor,
  shimmerDuration,
  shimmerAngle,
  shimmerWidth,
  shimmerBaseColor,
  shimmerDirection,
  shimmerDelay,
  style,
  ...viewProps
}: NitroTextProps) {
  const text = typeof children === 'string' ? children : String(children)
  const scale = allowFontScaling
    ? maxFontSizeMultiplier && maxFontSizeMultiplier > 0
      ? Math.min(PixelRatio.getFontScale(), maxFontSizeMultiplier)
      : PixelRatio.getFontScale()
    : 1
  const size = (fontSize ?? 17) * scale
  const weight = fontWeight === undefined ? 400 : toNumericWeight(fontWeight) ?? 400
  const family = fontFamily ?? ''
  const spacing = letterSpacing ?? 0
  const width = useMemo(() => measure().measure(text, size, weight, family, spacing), [text, size, weight, family, spacing])
  const fontKey = `${size}|${weight}|${family}`
  let height = lineHeights.get(fontKey)
  if (height === undefined) {
    height = measure().lineHeight(size, weight, family)
    lineHeights.set(fontKey, height)
  }

  const native: NativeNitroTextProps & Record<string, unknown> = viewProps as never
  native.text = text
  native.style = style == null ? { width: Math.ceil(width), height } : [{ width: Math.ceil(width), height }, style]
  if (size !== 17) native.fontSize = size
  if (weight !== 400) native.fontWeight = weight
  if (family !== '') native.fontFamily = family
  if (spacing !== 0) native.letterSpacing = spacing
  const processedColor = toProcessedColor(color)
  if (processedColor !== undefined) native.color = processedColor
  if (textAlign !== undefined) native.textAlign = textAlign
  if (duration !== undefined) native.duration = duration
  if (easing !== undefined) native.easing = easing
  if (bounce !== undefined) native.bounce = bounce
  if (effect !== undefined) native.effect = effect
  if (respectReduceMotion !== undefined) native.respectReduceMotion = respectReduceMotion
  if (loading !== undefined) native.loading = loading
  const processedShimmerColor = toProcessedColor(shimmerColor)
  if (processedShimmerColor !== undefined) native.shimmerColor = processedShimmerColor
  if (shimmerDuration !== undefined) native.shimmerDuration = shimmerDuration
  if (shimmerAngle !== undefined) native.shimmerAngle = shimmerAngle
  if (shimmerWidth !== undefined) native.shimmerWidth = shimmerWidth
  const processedShimmerBaseColor = toProcessedColor(shimmerBaseColor)
  if (processedShimmerBaseColor !== undefined) native.shimmerBaseColor = processedShimmerBaseColor
  if (shimmerDirection !== undefined) native.shimmerDirection = shimmerDirection
  if (shimmerDelay !== undefined) native.shimmerDelay = shimmerDelay
  // The start edge follows the layout direction, the app's unless the style sets one.
  const direction = style == null ? undefined : (StyleSheet.flatten(style) as { direction?: unknown }).direction
  if (direction === 'rtl' || (direction !== 'ltr' && I18nManager.isRTL)) native.rightToLeft = true
  // The native view is the accessibility element, labelled with its text and
  // announced as text. A label from outside takes over, on this view.
  if (native.accessibilityLabel != null && native.accessible === undefined) native.accessible = true
  return <NativeNitroTextView {...native} />
}
