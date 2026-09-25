import type {
  HybridObject,
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules'
import type { NitroNumberShimmerDirection, NitroNumberTextAlign } from './NitroNumber.nitro'
import type { NitroInputEasing, NitroInputEffect } from './NitroInput.nitro'

/**
 * A single line of text that morphs to the next: the reflow engine's
 * characters drawn in one pass, no text field. `NitroText` measures it (see
 * `NitroTextMeasure`) and gives it its size, so a label lays out in the same
 * commit that mounts it.
 *
 * Everything but the text is optional and the wrapper sends only what was
 * set: each prop that crosses costs a conversion and an allocation per view
 * in the commit, and a label usually sets two or three. The native side holds
 * the defaults, and forgets what the last element set when it is recycled.
 */
export interface NitroTextProps extends HybridViewProps {
  text: string
  /** In points, already scaled for the system text size when the wrapper was asked to. Default 17. */
  fontSize?: number
  /** Numeric weight, 100–900. Default 400. */
  fontWeight?: number
  /** Default: the system font. */
  fontFamily?: string
  /** Processed ARGB. Default: the platform label colour. */
  color?: number
  /** Points after every character. */
  letterSpacing?: number
  textAlign?: NitroNumberTextAlign
  rightToLeft?: boolean
  /** Of a morph, in ms. Default 400. */
  duration?: number
  easing?: NitroInputEasing
  bounce?: number
  effect?: NitroInputEffect
  respectReduceMotion?: boolean
  loading?: boolean
  shimmerColor?: number
  shimmerDuration?: number
  shimmerAngle?: number
  shimmerWidth?: number
  shimmerBaseColor?: number
  shimmerDirection?: NitroNumberShimmerDirection
  shimmerDelay?: number
}

export interface NitroTextMethods extends HybridViewMethods {}

export type NitroTextView = HybridView<NitroTextProps, NitroTextMethods>

/**
 * Measures a line the way `NitroTextView` lays it out (the sum of each
 * character's advance plus the letter spacing), synchronously, so the
 * component knows its size while it renders.
 */
export interface NitroTextMeasure extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** The line's width in points. */
  measure(text: string, fontSize: number, fontWeight: number, fontFamily: string, letterSpacing: number): number
  /** The line box's height in points. */
  lineHeight(fontSize: number, fontWeight: number, fontFamily: string): number
}
