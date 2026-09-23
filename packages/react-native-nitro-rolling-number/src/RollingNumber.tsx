import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  I18nManager,
  StyleSheet,
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
  RollingNumberTransition,
  RollingNumberEasing,
  RollingNumberMethods,
  RollingNumberProps as NativeRollingNumberProps,
  RollingNumberRevealStyle,
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
   * At most 18 digits are shown: `|value| × 10^fractionDigits` is clamped at
   * 10^17, and a JS number carries exact integers only up to 2^53.
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
  /**
   * How a value change plays. `'roll'` (default) is the odometer: every
   * changed digit rolls through the digits between its old and new glyph, in
   * the direction of the change. `'numeric'` is the numeric transition, the
   * effect of SwiftUI's `.contentTransition(.numericText())`: each changed
   * glyph swaps in place, the old one softening, shrinking and sliding out
   * while the new one slides in from the other side and comes into focus, the
   * digits cascading from the left; unchanged digits stay put. `'scramble'`
   * shows a different random digit every few frames until each changed digit
   * locks on its target, from the left.
   *
   * Each swap style has its own defaults for `duration`, `easing` and
   * `stagger`: numeric 480 / (its own clocks) / 150, scramble 500 / `'linear'` / 60.
   */
  transition?: RollingNumberTransition
  /**
   * The change flash: every digit whose glyph changes lights up in this
   * colour when the value grew (e.g. a green), stays lit while it moves,
   * and fades back over `flashDuration` once it has landed. Unset: no flash.
   */
  flashUpColor?: ColorValue
  /** The change flash's colour when the value shrank (e.g. a red). Unset: no flash. */
  flashDownColor?: ColorValue
  /** Milliseconds a change flash takes to fade, once the digit has landed. Default: `600`. */
  flashDuration?: number
  /**
   * A punch of the whole figure on every value change, its peak overshoot
   * as a fraction of the size, `0` (none, the default) to `1`; rung out like
   * the reveal's landing pop. `0.08` is a nudge, `0.2` a slam.
   */
  popOnChange?: number
  /** Duration in ms of the roll played when `value` changes. `0` snaps. Default: `500` (each swap transition has its own, see `transition`). */
  duration?: number
  /** Timing curve of the roll. Default: `'easeInOut'` (the scramble has its own, see `transition`; the numeric transition keeps SwiftUI's own clocks and ignores it). */
  easing?: RollingNumberEasing
  /** Overshoot of the `'spring'` easing, `0`–`1`. Default: `0.15` (the numeric transition has its own, fixed). */
  bounce?: number
  /**
   * Delay in ms between the start of each digit's roll, least significant
   * digit first, so a change cascades like a mechanical carry. In the numeric
   * transition it is the span of the whole cascade instead: the digits that
   * change start spread evenly over it from the leftmost to the rightmost,
   * however many there are, the way the effect cascades on iOS. Default: `0`
   * (`150` for the numeric transition).
   */
  stagger?: number
  /** Which way the digits roll. `'auto'` follows the sign of the change. Default: `'auto'`. */
  direction?: RollingNumberDirection
  /**
   * Jackpot reveal, the casino "you won" presentation. While `false` the view
   * holds the opening frame of `value` ("$0.00": its layout, every digit blank
   * except the mandatory ones); when it turns `true` the figure plays its
   * `revealStyle` to `value` and lands with a pop. Pair it with
   * `textAlign="center"` for a centred hero figure. Leave it `undefined` for
   * a normal rolling number. To let the user skip the reveal, call `jumpTo(value)`.
   */
  reveal?: boolean
  /**
   * `'count'` (default) is the win-meter rollup: the figure tallies up from 0
   * like a slot's win counter, taking off at once, running at a constant
   * rate and braking into the total (and into each tier with
   * `revealMilestones`), swelling slightly as it climbs, digits swapping in
   * place and leading digits appearing as the count reaches them. `'spin'`
   * is the jackpot reels: every digit spins like a slot reel, then the reels
   * brake and lock one at a time from the left, each with a mechanical bounce.
   */
  revealStyle?: RollingNumberRevealStyle
  /** Duration of the reveal in ms (the count, or the time until the last reel locks). Default: `2200`. */
  revealDuration?: number
  /** Peak overshoot of the reveal's landing pop, `0` (none) to `1`. Default: `0.12`. */
  revealBounce?: number
  /**
   * `'count'` style: how much smaller the figure opens, as a fraction of its
   * size, growing to full size over the count, the way a big win's meter is
   * enlarged as it climbs. `0` = no growth. Default: `0.2`.
   */
  revealGrow?: number
  /** `'spin'` style: ms between one reel locking and the next, shortened to fit `revealDuration`. Default: `200`. */
  revealStagger?: number
  /**
   * `'count'` style: the win tiers of a casino rollup ("Big win" → "Mega win"
   * → "Epic win"), in the figure's units. When the count reaches one, the
   * figure punches, pauses on it for `revealMilestoneHold` and
   * `onRevealMilestone` fires, so the app can slam its banner in, fire the
   * confetti and play the sting on that beat. Values at or above `value` are ignored.
   */
  revealMilestones?: number[]
  /** `'count'` style: ms the count pauses on each milestone (the banner's moment). Default: `0`. */
  revealMilestoneHold?: number
  /** Called once a reveal has landed (count finished or last reel locked, and the pop rung out). */
  onRevealEnd?: () => void
  /** Called when the count reaches a milestone: its index among the usable milestones and its value. */
  onRevealMilestone?: (index: number, value: number) => void
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
  /**
   * Scale the fonts with the system text size (Dynamic Type / Android font
   * scale) like `Text` does. Off by default so amounts keep their design size.
   */
  allowFontScaling?: boolean
  /** Upper bound for `allowFontScaling`, e.g. `1.3`. `0` means no cap. Default: `0`. */
  maxFontSizeMultiplier?: number
  /** Font weight, like `Text`'s `fontWeight`. Default: `'normal'`. */
  fontWeight?: TextStyle['fontWeight']
  /** Font family name, like `Text`'s `fontFamily`. Defaults to the system font. */
  fontFamily?: string
  /** Text color. Defaults to the platform's primary label color. */
  color?: ColorValue
  /**
   * Where the number sits when the view is wider than its content, e.g. when
   * you give it a fixed `width` so it doesn't reflow as digits appear.
   * Default: `'auto'`: the start edge of the layout direction, as `Text`.
   * `'left'` and `'right'` are absolute.
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
  /** Plays a jackpot reveal to `value` (counts up from 0), whatever the `reveal` prop says. */
  revealTo(value: number): void
  /** The value currently shown or being rolled towards. */
  getValue(): number
  /** The native Nitro object, or `null` before mount. */
  readonly native: RollingNumberRef | null
}

// shared-helpers:start
// Kept byte-for-byte identical with packages/react-native-nitro-input/src/NitroInput.tsx
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

/** Each transition's own timing, used when the props leave it unsaid. */
const TRANSITION_DEFAULTS: Record<RollingNumberTransition, { duration: number; easing: RollingNumberEasing; stagger: number }> = {
  roll: { duration: 500, easing: 'easeInOut', stagger: 0 },
  numeric: { duration: 480, easing: 'spring', stagger: 150 },
  scramble: { duration: 500, easing: 'linear', stagger: 60 },
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
      transition,
      flashUpColor,
      flashDownColor,
      flashDuration,
      popOnChange,
      duration,
      easing,
      bounce,
      stagger,
      direction,
      reveal,
      revealStyle,
      revealDuration,
      revealBounce,
      revealGrow,
      revealStagger,
      revealMilestones,
      revealMilestoneHold,
      onRevealEnd,
      onRevealMilestone,
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
      allowFontScaling,
      maxFontSizeMultiplier,
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
    const latestOnRevealEnd = useRef(onRevealEnd)
    latestOnRevealEnd.current = onRevealEnd
    const latestOnRevealMilestone = useRef(onRevealMilestone)
    latestOnRevealMilestone.current = onRevealMilestone
    const latestValue = useRef(value)
    latestValue.current = value

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

    // Stable like the others; the latest handler is read through a ref so a
    // caller passing an inline arrow doesn't re-set the native prop each render.
    const onRevealEndCallback = useMemo(
      () =>
        callback(() => {
          latestOnRevealEnd.current?.()
        }),
      []
    )
    const onRevealMilestoneCallback = useMemo(
      () =>
        callback((index: number, milestone: number) => {
          latestOnRevealMilestone.current?.(index, milestone)
        }),
      []
    )
    // A new array literal each render must not re-set the native prop. Always an
    // array (empty = no tiers): removing the prop would reach native as `null`,
    // which Nitro's array parser rejects ("Value is null, expected an Object").
    const milestonesKey = revealMilestones?.join(',') ?? ''
    const stableMilestones = useMemo(
      () => (revealMilestones ? [...revealMilestones] : []),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [milestonesKey]
    )

    // One handle for the component's lifetime: `getValue` reads the latest
    // prop through a ref, so a value change doesn't hand the parent a new object.
    useImperativeHandle(
      ref,
      () => ({
        jumpTo: (next) => nativeRef.current?.jumpTo(next),
        animateTo: (next) => nativeRef.current?.animateTo(next),
        revealTo: (next) => nativeRef.current?.revealTo(next),
        getValue: () => nativeRef.current?.value ?? latestValue.current,
        get native() {
          return nativeRef.current
        },
      }),
      []
    )

    // Every native prop is sent with an explicit value: an optional prop that
    // is *removed* reaches native as `null`, which Nitro's parser rejects and
    // React Native turns into a fatal error. `Infinity` stands for "platform
    // default" where there is no value to express it (colors), `''` for fonts.
    // Not `NaN`: Nitro only calls a native setter when a prop's value changed,
    // and NaN never equals itself, so a NaN sentinel re-set the colour on every
    // render and had the whole configuration re-applied on every value change.
    const processedColor = useMemo(() => toProcessedColor(color) ?? Infinity, [color])
    const processedShimmerColor = useMemo(
      () => toProcessedColor(shimmerColor) ?? Infinity,
      [shimmerColor]
    )
    const processedFlashUp = useMemo(() => toProcessedColor(flashUpColor) ?? Infinity, [flashUpColor])
    const processedFlashDown = useMemo(() => toProcessedColor(flashDownColor) ?? Infinity, [flashDownColor])
    const numericWeight = toNumericWeight(fontWeight) ?? 400
    const resolvedFontSize = fontSize ?? 32
    const resolvedAffixAlign = affixAlign ?? 'baseline'

    const autoSize = useMemo(
      () =>
        size !== null
          ? { width: size.width, height: size.height }
          : { height: (fontSize ?? 32) * 1.25 },
      [size, fontSize]
    )

    // The layout direction, resolved the way React Native resolves it for its
    // own views: the view's `style.direction` if it says, else the app's. Fabric
    // does not hand a Hybrid View its resolved direction, so native is told.
    const layoutDirection = useMemo(
      () => (StyleSheet.flatten(style) as { direction?: unknown } | undefined)?.direction,
      [style]
    )
    const rightToLeft = layoutDirection === 'rtl' || (layoutDirection !== 'ltr' && I18nManager.isRTL)

    return (
      <NativeRollingNumberView
        {...viewProps}
        style={[autoSize, style]}
        hybridRef={hybridRef}
        value={value}
        fractionDigits={fractionDigits ?? 0}
        minimumIntegerDigits={minimumIntegerDigits ?? 1}
        groupingSeparator={groupingSeparator ?? ''}
        decimalSeparator={decimalSeparator ?? '.'}
        prefix={prefix ?? ''}
        suffix={suffix ?? ''}
        transition={transition ?? 'roll'}
        flashUpColor={processedFlashUp}
        flashDownColor={processedFlashDown}
        flashDuration={flashDuration ?? 600}
        popOnChange={popOnChange ?? 0}
        duration={duration ?? TRANSITION_DEFAULTS[transition ?? 'roll'].duration}
        easing={easing ?? TRANSITION_DEFAULTS[transition ?? 'roll'].easing}
        bounce={bounce ?? 0.15}
        stagger={stagger ?? TRANSITION_DEFAULTS[transition ?? 'roll'].stagger}
        rollDirection={direction ?? 'auto'}
        revealState={reveal === undefined ? 0 : reveal ? 2 : 1}
        revealStyle={revealStyle ?? 'count'}
        revealDuration={revealDuration ?? 2200}
        revealBounce={revealBounce ?? 0.12}
        revealGrow={revealGrow ?? 0.2}
        revealStagger={revealStagger ?? 200}
        revealMilestones={stableMilestones}
        revealMilestoneHold={revealMilestoneHold ?? 0}
        onRevealEnd={onRevealEndCallback}
        onRevealMilestone={onRevealMilestoneCallback}
        loading={loading ?? false}
        shimmerColor={processedShimmerColor}
        shimmerDuration={shimmerDuration ?? 950}
        fontSize={resolvedFontSize}
        prefixFontSize={prefixFontSize ?? resolvedFontSize}
        suffixFontSize={suffixFontSize ?? resolvedFontSize}
        affixAlign={resolvedAffixAlign}
        prefixAlign={prefixAlign ?? resolvedAffixAlign}
        suffixAlign={suffixAlign ?? resolvedAffixAlign}
        adjustsFontSizeToFit={adjustsFontSizeToFit ?? false}
        minimumFontScale={minimumFontScale ?? 0.5}
        allowFontScaling={allowFontScaling ?? false}
        maxFontSizeMultiplier={maxFontSizeMultiplier ?? 0}
        fontWeight={numericWeight}
        fontFamily={fontFamily ?? ''}
        color={processedColor}
        textAlign={textAlign ?? 'auto'}
        rightToLeft={rightToLeft}
        onSizeChange={onSizeChange}
      />
    )
  }
)
