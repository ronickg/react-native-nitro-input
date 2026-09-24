import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules'

/** Horizontal alignment of the number inside the view's frame. */
/**
 * `'auto'` is the start edge of the layout direction - left in a left-to-right
 * app, right in a right-to-left one - which is what `Text` does with no
 * `textAlign`; in a view that hugs the number it is the edge the parent keeps
 * the view to (the end of a row: right), so the digits open and close against
 * it. `'left'` and `'right'` are absolute, whatever the direction.
 */
export type NitroNumberTextAlign = 'auto' | 'left' | 'center' | 'right'

/** Timing curve used when a value change is rolled natively. */
export type NitroNumberEasing =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'spring'

/** Which way the digits roll: `'auto'` follows the sign of the change. */
export type NitroNumberDirection = 'auto' | 'up' | 'down'

/**
 * How a value change plays. `'roll'` is the odometer: every changed digit
 * rolls through the digits between its old and new glyph. `'numeric'` is the
 * numeric transition of SwiftUI's `.contentTransition(.numericText())`: each
 * changed glyph swaps in place, the old one softening, shrinking and sliding
 * out while the new one slides in from the other side and comes into focus,
 * digits cascading from the left; the unchanged digits stay put. `'scramble'`
 * shows a different random digit every few frames until each changed digit
 * locks on its target, from the left.
 */
export type NitroNumberTransition = 'roll' | 'numeric' | 'scramble'

/**
 * How a jackpot reveal plays: `'count'` is the casino win-meter rollup (the
 * figure counts up from 0, digits swapping in place); `'spin'` is the jackpot
 * reels (every digit spins like a slot reel, then the reels lock one at a
 * time from the left).
 */
export type NitroNumberRevealStyle = 'count' | 'spin'

/**
 * How a prefix/suffix drawn at a different size lines up with the digits:
 * `top` pins glyph tops (cap height), `bottom` pins the bottom of the line
 * boxes, `baseline` shares the digits' baseline, `center` centres the boxes.
 */
export type NitroNumberAffixAlign = 'baseline' | 'center' | 'top' | 'bottom'

export interface NitroNumberProps extends HybridViewProps {
  /**
   * The number to display.
   *
   * When this prop changes, every digit rolls natively from its old glyph to
   * its new glyph (in the direction of the change), using `duration` and
   * `easing`. The very first value is displayed without an animation.
   *
   * Reading it on the hybrid ref returns the value the view is currently
   * showing or rolling towards (also after `jumpTo` / `animateTo`).
   *
   * At most 18 digits are shown: `|value| × 10^fractionDigits` is clamped at
   * 10^17 (the same limit for a jump and a roll), and a JS number carries exact
   * integers only up to 2^53.
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
  easing?: NitroNumberEasing
  /** Overshoot of the `'spring'` easing, from `0` (none) to `1`. Default: `0.15`. */
  bounce?: number
  /**
   * Delay in ms between the start of each digit's roll, from the least
   * significant digit upwards (a cascading carry). Default: `0`.
   */
  stagger?: number
  /**
   * How a value change plays: the odometer roll, or the numeric transition
   * (glyphs swap in place). Default: `'roll'`.
   */
  transition?: NitroNumberTransition
  /**
   * The change flash: every digit whose glyph changes lights up in this
   * colour when the value grew, fading back over `flashDuration`. A processed
   * ARGB integer; `Infinity` (the wrapper's "unset") turns the flash off.
   */
  flashUpColor?: number
  /** The change flash's colour when the value shrank. `Infinity` = off. */
  flashDownColor?: number
  /** Milliseconds a change flash takes to fade. Default: `600`. */
  flashDuration?: number
  /**
   * A punch of the whole figure on every value change, its peak overshoot
   * as a fraction of the size, `0` (none, the default) to `1`; rung out like
   * the reveal's landing pop.
   */
  popOnChange?: number
  /**
   * Which way the digits roll. Default: `'auto'`.
   *
   * Named `rollDirection` and not `direction` because a Hybrid View's props
   * derive from `react::ViewProps`, so React Native parses every name we
   * declare as well: `direction` is Yoga's layout property, and it logged
   * `Could not parse yoga::Direction: up` on every update. The public prop the
   * wrapper exposes is still `direction`; see `NitroNumber.tsx`.
   */
  rollDirection?: NitroNumberDirection
  /**
   * Jackpot reveal state. `0` (default): a normal NitroNumber, `value`
   * changes roll. `1`: the view shows the opening frame of `value`, its layout
   * with every digit blank except the mandatory ones ("$0.00"). `2`: the
   * figure plays its `revealStyle` (counts up from 0, or spins its reels) to
   * `value` and lands with a pop. The JS wrapper maps its `reveal` boolean to
   * this; it is a number so the wrapper can always pass it (an optional prop
   * that is removed reaches native as `null`, which Nitro's parser rejects).
   */
  revealState?: number
  /** How the reveal plays. Default: `'count'`. */
  revealStyle?: NitroNumberRevealStyle
  /** Duration of the reveal in ms (the count, or the time until the last reel locks). Default: `2200`. */
  revealDuration?: number
  /** Peak overshoot of the reveal's landing pop, `0` (none) to `1`. Default: `0.12`. */
  revealBounce?: number
  /**
   * `'count'` style: how much smaller the figure opens, as a fraction of its
   * size, growing to full size over the count (a big win's meter is enlarged
   * as it climbs). `0` = no growth. Default: `0.2`.
   */
  revealGrow?: number
  /**
   * `'spin'` style: delay in ms between one reel locking and the next, from
   * the left. Shortened automatically when the reels wouldn't fit `revealDuration`. Default: `200`.
   */
  revealStagger?: number
  /**
   * `'count'` style: win tiers, in the figure's units. When the count reaches
   * one the figure punches, pauses on it for `revealMilestoneHold` and
   * `onRevealMilestone` fires. Values at or above `value` are ignored.
   */
  revealMilestones?: number[]
  /** `'count'` style: ms the count pauses on each milestone. Default: `0`. */
  revealMilestoneHold?: number
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
  affixAlign?: NitroNumberAffixAlign
  /** Vertical alignment of `prefix` only. Defaults to `affixAlign`. */
  prefixAlign?: NitroNumberAffixAlign
  /** Vertical alignment of `suffix` only. Defaults to `affixAlign`. */
  suffixAlign?: NitroNumberAffixAlign
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
  /** Where the number sits inside the view when the view is wider than the number. Default: `'auto'`, the start edge. */
  textAlign?: NitroNumberTextAlign
  /**
   * Lay the figure out right-to-left: `'auto'` alignment resolves to the right
   * edge, the prefix moves to the right and the suffix to the left, and the
   * digits still read left to right. Fabric does not hand a Hybrid View its
   * layout direction, so the JS side resolves it - from the view's
   * `style.direction`, else `I18nManager.isRTL` - the way React Native
   * resolves its own views. Default: `false`.
   */
  rightToLeft?: boolean
  /**
   * Called whenever the settled (target) intrinsic size of the number changes,
   * e.g. after the first layout, when a digit column appears/disappears, or
   * when the font changes. `NitroNumber` uses this to size itself.
   */
  onSizeChange?: (width: number, height: number) => void
  /**
   * Called when a reveal has landed: the count reached `value` and the landing
   * pop has rung out. Sequence whatever follows the figure (a haptic, the next
   * block of copy) from here.
   */
  onRevealEnd?: () => void
  /**
   * Called when a count-style reveal reaches a milestone, with its index in
   * the sorted usable milestones and its value: the moment to swap the win
   * banner, fire the confetti and play the sting.
   */
  onRevealMilestone?: (index: number, value: number) => void
}

export interface NitroNumberMethods extends HybridViewMethods {
  /**
   * Displays `value` immediately, positioning the digit columns continuously
   * (odometer style: `12.5` shows the last digit half way between `2` and `3`).
   * No animation is started and any running roll is cancelled. Useful for
   * scrubbing (scroll / drag handlers). Safe to call from any thread.
   */
  jumpTo(value: number): void
  /** Rolls to `value` natively, exactly like changing the `value` prop. Safe to call from any thread. */
  animateTo(value: number): void
  /**
   * Plays a jackpot reveal to `value` in the current `revealStyle` (see the
   * `reveal` prop) regardless of the prop's state. Safe to call from any thread.
   */
  revealTo(value: number): void
}

export type NitroNumberView = HybridView<
  NitroNumberProps,
  NitroNumberMethods
>
