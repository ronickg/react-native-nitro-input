import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules'

/** Horizontal alignment of the number inside the view's frame. */
export type RollingNumberTextAlign = 'left' | 'center' | 'right'

/** Timing curve used when a value change is rolled natively. */
export type RollingNumberEasing =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'spring'

/** Which way the digits roll: `'auto'` follows the sign of the change. */
export type RollingNumberDirection = 'auto' | 'up' | 'down'

/**
 * How a prefix/suffix drawn at a different size lines up with the digits:
 * `top` pins glyph tops (cap height), `bottom` pins the bottom of the line
 * boxes, `baseline` shares the digits' baseline, `center` centres the boxes.
 */
export type RollingNumberAffixAlign = 'baseline' | 'center' | 'top' | 'bottom'

export interface RollingNumberProps extends HybridViewProps {
  /**
   * The number to display.
   *
   * When this prop changes, every digit rolls natively from its old glyph to
   * its new glyph (in the direction of the change), using `duration` and
   * `easing`. The very first value is displayed without an animation.
   *
   * Reading it on the hybrid ref returns the value the view is currently
   * showing or rolling towards (also after `jumpTo` / `animateTo`).
   */
  value: number
  /** Digits shown after the decimal separator. Default: `0`. */
  fractionDigits?: number
  /** Zero-pads the integer part to at least this many digits. Default: `1`. */
  minimumIntegerDigits?: number
  /** Inserted between every three integer digits. Empty string disables grouping. Default: `''`. */
  groupingSeparator?: string
  /** Placed between the integer and fraction digits. Default: `'.'`. */
  decimalSeparator?: string
  /** Static text drawn before the number (e.g. `'$'`). Default: `''`. */
  prefix?: string
  /** Static text drawn after the number (e.g. `'%'`). Default: `''`. */
  suffix?: string
  /**
   * Duration in milliseconds of the native roll that plays when `value` changes.
   * `0` snaps to the new value immediately. Default: `500`.
   */
  duration?: number
  /** Timing curve of the native roll. Default: `'easeInOut'`. */
  easing?: RollingNumberEasing
  /** Overshoot of the `'spring'` easing, from `0` (none) to `1`. Default: `0.15`. */
  bounce?: number
  /**
   * Delay in ms between the start of each digit's roll, from the least
   * significant digit upwards (a cascading carry). Default: `0`.
   */
  stagger?: number
  /** Which way the digits roll. Default: `'auto'`. */
  direction?: RollingNumberDirection
  /**
   * Shows a "shine" glint over the number: the ink keeps its color while a
   * slanted, text-wide band of `shimmerColor` sweeps through the glyphs.
   * Toggling fades the glint in/out. Default: `false`.
   */
  loading?: boolean
  /**
   * Color of the glint's core as a processed ARGB integer. Defaults to a light
   * neutral (`#D6D9E1`, or `#2B2E37` in dark mode).
   */
  shimmerColor?: number
  /** Duration of one sweep in ms (linear, repeating). Default: `950`. */
  shimmerDuration?: number
  /** Font size of the digits in points. Default: `32`. */
  fontSize?: number
  /** Font size of `prefix` in points. Defaults to `fontSize`. */
  prefixFontSize?: number
  /** Font size of `suffix` in points. Defaults to `fontSize`. */
  suffixFontSize?: number
  /** Vertical alignment of prefix and suffix relative to the digits. Default: `'baseline'`. */
  affixAlign?: RollingNumberAffixAlign
  /** Vertical alignment of `prefix` only. Defaults to `affixAlign`. */
  prefixAlign?: RollingNumberAffixAlign
  /** Vertical alignment of `suffix` only. Defaults to `affixAlign`. */
  suffixAlign?: RollingNumberAffixAlign
  /**
   * When the view is narrower than the number (e.g. it has a fixed `width` or
   * `maxWidth`), scale the whole number down so it fits. Default: `false`.
   */
  adjustsFontSizeToFit?: boolean
  /** Smallest scale `adjustsFontSizeToFit` may apply, `0`–`1`. Default: `0.5`. */
  minimumFontScale?: number
  /**
   * Scale the fonts with the user's system text size (Dynamic Type / Android
   * font scale), like `Text`. Off by default so amounts keep their design size.
   */
  allowFontScaling?: boolean
  /** Upper bound for `allowFontScaling`, e.g. `1.3`. `0` means no cap. Default: `0`. */
  maxFontSizeMultiplier?: number
  /** Numeric font weight, `100`–`900`. Default: `400`. */
  fontWeight?: number
  /** Font family name. Defaults to the system font. */
  fontFamily?: string
  /** Text color as a processed ARGB integer (from `processColor`). Defaults to the platform label color. */
  color?: number
  /** Where the number sits inside the view when the view is wider than the number. Default: `'left'`. */
  textAlign?: RollingNumberTextAlign
  /**
   * Called whenever the settled (target) intrinsic size of the number changes,
   * e.g. after the first layout, when a digit column appears/disappears, or
   * when the font changes. `RollingNumber` uses this to size itself.
   */
  onSizeChange?: (width: number, height: number) => void
}

export interface RollingNumberMethods extends HybridViewMethods {
  /**
   * Displays `value` immediately, positioning the digit columns continuously
   * (odometer style: `12.5` shows the last digit half way between `2` and `3`).
   * No animation is started and any running roll is cancelled. Useful for
   * scrubbing (scroll / drag handlers). Safe to call from any thread.
   */
  jumpTo(value: number): void
  /** Rolls to `value` natively, exactly like changing the `value` prop. Safe to call from any thread. */
  animateTo(value: number): void
}

export type RollingNumberView = HybridView<
  RollingNumberProps,
  RollingNumberMethods
>
