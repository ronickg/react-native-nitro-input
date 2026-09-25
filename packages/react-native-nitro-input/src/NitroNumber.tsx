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
  type ColorValue,
  type TextStyle,
  type ViewProps,
} from 'react-native'
import {
  callback,
  getHostComponent,
  type HybridRef,
} from 'react-native-nitro-modules'
import NitroNumberViewConfig from '../nitrogen/generated/shared/json/NitroNumberViewConfig.json'
import type {
  NitroNumberAffixAlign,
  NitroNumberDirection,
  NitroNumberTransition,
  NitroNumberEasing,
  NitroNumberMethods,
  NitroNumberProps as NativeNitroNumberProps,
  NitroNumberRevealStyle,
  NitroNumberSignDisplay,
  NitroNumberTextAlign,
} from './specs/NitroNumber.nitro'
import { toNumericWeight, toProcessedColor } from './styleHelpers'
import { compactParts, formatProps } from './formatProps'
import type { NumberFormat } from './NumberFormat'

/**
 * The raw Nitro host component. Prefer {@link NitroNumber}, which adds
 * auto-sizing, color/weight conversion and a convenient handle.
 */
export const NativeNitroNumberView = getHostComponent<
  NativeNitroNumberProps,
  NitroNumberMethods
>('NitroNumberView', () => NitroNumberViewConfig)

/** The native Nitro `HybridObject` behind a mounted {@link NitroNumber}. */
export type NitroNumberRef = HybridRef<
  NativeNitroNumberProps,
  NitroNumberMethods
>

export interface NitroNumberProps extends Omit<ViewProps, 'children'> {
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
  transition?: NitroNumberTransition
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
  easing?: NitroNumberEasing
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
  /**
   * Which way the digits roll. `'auto'` follows the sign of the change;
   * `'up'` / `'down'` force one; `'shortest'` rolls each digit its own
   * shorter way round (1 → 2 is one step up even when the value falls, where
   * `'auto'` rolls nine steps down), which is calmer on big jumps. The numeric transition and the reveal ignore it. Default: `'auto'`.
   */
  direction?: NitroNumberDirection
  /**
   * Jackpot reveal, the casino "you won" presentation. While `false` the view
   * holds the opening frame of `value` ("$0.00": its layout, every digit blank
   * except the mandatory ones); when it turns `true` the figure plays its
   * `revealStyle` to `value` and lands with a pop. Pair it with
   * `textAlign="center"` for a centred hero figure. Leave it `undefined` for
   * a normal NitroNumber. To let the user skip the reveal, call `jumpTo(value)`.
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
  revealStyle?: NitroNumberRevealStyle
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
  affixAlign?: NitroNumberAffixAlign
  /** Alignment of `prefix` only. Defaults to `affixAlign`. */
  prefixAlign?: NitroNumberAffixAlign
  /** Alignment of `suffix` only. Defaults to `affixAlign`. */
  suffixAlign?: NitroNumberAffixAlign
  /**
   * Points added after every glyph, like `Text`'s `letterSpacing` (negative
   * tightens). A smaller prefix or suffix gets it in proportion to its size.
   * Default: `0`.
   */
  letterSpacing?: number
  /** Points between the prefix and the digits, in place of the letter spacing there. Defaults to the letter spacing. */
  prefixSpacing?: number
  /** Points between the digits and the suffix, in place of the letter spacing there. Defaults to the letter spacing. */
  suffixSpacing?: number
  /** Points the prefix is moved down after `prefixAlign` places it (negative: up). Default: `0`. */
  prefixOffset?: number
  /** Points the suffix is moved down after `suffixAlign` places it (negative: up). Default: `0`. */
  suffixOffset?: number
  /**
   * `true` (the default): every digit as wide as the widest, so columns never
   * move, what a ticker or a price wants. `false`: each digit at its own
   * width, the font's proportional figures, for a face whose "1" is narrow
   * (or that has no tabular figures at all); a changing column's width
   * then eases once from the old digit's to the new one's.
   */
  tabularNums?: boolean
  /**
   * A `NumberFormat` the number follows: its prefix and suffix (the currency
   * where the locale puts it), grouping and decimal separators, fraction
   * digits and minimum integer digits. The individual props override what it
   * says.
   */
  format?: NumberFormat
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
  textAlign?: NitroNumberTextAlign
  /**
   * Which values carry a sign, as `Intl.NumberFormat`'s `signDisplay`:
   * `'always'` and `'exceptZero'` put a plus on gains ("+$12.40"), and a plus
   * that turns into a minus swaps like any other glyph. A value that rounds to
   * zero at the shown fraction digits counts as zero. Default: `'auto'`
   * (negatives), or the `format`'s.
   */
  signDisplay?: NitroNumberSignDisplay
  /** The glyph drawn for a plus sign. Default: `'+'`. */
  plusSign?: string
  /** The glyph drawn for a minus sign, e.g. `'−'` (U+2212). Default: `'-'`, or the `format` locale's. */
  minusSign?: string
  /** The prefix's color. Default: `color`. */
  prefixColor?: ColorValue
  /** The suffix's color. Default: `color`. */
  suffixColor?: ColorValue
  /** The fraction digits' and decimal separator's color: dimmer cents. Default: `color`. */
  fractionColor?: ColorValue
  /** The fraction digits' and decimal separator's size: smaller cents. Default: `fontSize`. */
  fractionFontSize?: number
  /**
   * How smaller fraction digits line up with the integer ones: `'baseline'`,
   * or `'top'` for superscript cents ("$12⁹⁹"). Default: `'baseline'`.
   */
  fractionAlign?: NitroNumberAffixAlign
  /**
   * The ten glyphs drawn for 0 to 9, for native digits (Arabic-Indic,
   * Devanagari…). Default: `'0'`…`'9'`, or the `format`'s numbering system.
   */
  digitGlyphs?: string[]
  /**
   * Digit group sizes counted from the decimal point: the first group, then
   * every later one. `[3, 2]` is Indian grouping (12,34,567), `[2]` a clock
   * (12:34:56 with `groupingSeparator=":"`). Default: `[3]`, or the `format`'s.
   */
  groupingSizes?: number[]
  /**
   * The highest digit a position shows before it wraps to 0, keyed by integer
   * position (0 the ones, 1 the tens…), as NumberFlow's `digits`:
   * `{ 1: { max: 5 } }` makes the tens of a clock's seconds wrap after 5, so
   * 59 → 00 turns them one step instead of five back.
   */
  digits?: Record<number, { max: number }>
  /**
   * Rolls turn the wheels below the highest one that changes a full turn too,
   * so 100 → 200 seems to pass through every value between. Rolls only.
   * Default: `false`.
   */
  continuous?: boolean
  /**
   * `false` shows every change at once, without a roll or a reveal (the flash
   * and the pop still play). Default: `true`.
   */
  animated?: boolean
  /** Snap instead of animating while the system's Reduce Motion is on. Default: `true`. */
  respectReduceMotion?: boolean
  /** Called when the figure starts moving from rest: a change, or a reveal. */
  onAnimationStart?: () => void
  /**
   * Called when the figure comes to rest, with the value it shows: once for a
   * run of changes that arrived while it was moving. Snapped changes fire neither.
   */
  onAnimationEnd?: (value: number) => void
  /** Receives the native Nitro object once the view is mounted. */
  onNativeRef?: (ref: NitroNumberRef) => void
}

/** Imperative handle exposed through `ref`. Methods are no-ops before mount. */
export interface NitroNumberHandle {
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
  readonly native: NitroNumberRef | null
}

interface Size {
  width: number
  height: number
}

const EMPTY: number[] = []
const EMPTY_STRINGS: string[] = []

/** Each transition's own timing, used when the props leave it unsaid. */
const TRANSITION_DEFAULTS: Record<NitroNumberTransition, { duration: number; easing: NitroNumberEasing; stagger: number }> = {
  roll: { duration: 500, easing: 'easeInOut', stagger: 0 },
  numeric: { duration: 480, easing: 'spring', stagger: 150 },
  scramble: { duration: 500, easing: 'linear', stagger: 60 },
}

/**
 * A number that animates its changes natively: an odometer roll, SwiftUI's
 * numeric transition or a scramble.
 *
 * Change `value` and every digit rolls to its new glyph on the native side.
 * Use the ref's `animateTo` / `jumpTo` for imperative updates.
 *
 * The view sizes itself to its content unless you pass an explicit `width` /
 * `height` in `style`.
 */
export const NitroNumber = forwardRef<NitroNumberHandle, NitroNumberProps>(
  function NitroNumber(
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
      letterSpacing,
      prefixSpacing,
      suffixSpacing,
      prefixOffset,
      suffixOffset,
      tabularNums,
      format,
      adjustsFontSizeToFit,
      minimumFontScale,
      allowFontScaling,
      maxFontSizeMultiplier,
      fontWeight,
      fontFamily,
      color,
      textAlign,
      signDisplay,
      plusSign,
      minusSign,
      prefixColor,
      suffixColor,
      fractionColor,
      fractionFontSize,
      fractionAlign,
      digitGlyphs,
      groupingSizes,
      digits,
      continuous,
      animated,
      respectReduceMotion,
      onAnimationStart,
      onAnimationEnd,
      onNativeRef,
      style,
      ...viewProps
    },
    ref
  ) {
    const nativeRef = useRef<NitroNumberRef | null>(null)
    const latestOnNativeRef = useRef(onNativeRef)
    latestOnNativeRef.current = onNativeRef
    const latestOnRevealEnd = useRef(onRevealEnd)
    latestOnRevealEnd.current = onRevealEnd
    const latestOnRevealMilestone = useRef(onRevealMilestone)
    latestOnRevealMilestone.current = onRevealMilestone
    const latestValue = useRef(value)
    latestValue.current = value
    const latestOnAnimationStart = useRef(onAnimationStart)
    latestOnAnimationStart.current = onAnimationStart
    const latestOnAnimationEnd = useRef(onAnimationEnd)
    latestOnAnimationEnd.current = onAnimationEnd

    const [size, setSize] = useState<Size | null>(null)

    // Nitro callbacks must be wrapped with `callback()` and the wrapper object
    // has to be referentially stable, otherwise every render re-sets the prop.
    const hybridRef = useMemo(
      () =>
        callback((instance: NitroNumberRef) => {
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
    const onAnimationStartCallback = useMemo(
      () =>
        callback(() => {
          latestOnAnimationStart.current?.()
        }),
      []
    )
    // The figure a compact format rolls is not the value (1.2 for 1,234): report the value.
    const onAnimationEndCallback = useMemo(
      () =>
        callback((shown: number) => {
          latestOnAnimationEnd.current?.(compactRef.current ? latestValue.current : shown)
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
        getValue: () => (compactRef.current ? latestValue.current : nativeRef.current?.value ?? latestValue.current),
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
    const derived = format ? formatProps(format) : undefined
    // Compact notation: "1.2K" rolls the figure 1.2 and swaps the suffix.
    const compact = format && derived?.compact ? compactParts(format, value) : undefined
    const compactRef = useRef(false)
    compactRef.current = compact !== undefined
    // Which way the value moved, for a compact figure that fell while the value grew (999 → 1K).
    const previousValue = useRef(value)
    const compactDirection = compact && direction === undefined ? (value >= previousValue.current ? 'up' : 'down') : undefined
    previousValue.current = value
    const processedPrefixColor = useMemo(() => toProcessedColor(prefixColor) ?? Infinity, [prefixColor])
    const processedSuffixColor = useMemo(() => toProcessedColor(suffixColor) ?? Infinity, [suffixColor])
    const processedFractionColor = useMemo(() => toProcessedColor(fractionColor) ?? Infinity, [fractionColor])
    // Arrays reach native only when their contents change.
    const digitMaxKey = digits ? JSON.stringify(digits) : ''
    const digitMax = useMemo(() => {
      if (!digits) return EMPTY
      const out: number[] = []
      for (const [position, spec] of Object.entries(digits)) {
        const index = Number(position)
        if (!Number.isInteger(index) || index < 0 || index >= 20) continue
        while (out.length <= index) out.push(9)
        out[index] = spec.max
      }
      return out
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [digitMaxKey])
    const glyphs = digitGlyphs ?? derived?.digitGlyphs ?? EMPTY_STRINGS
    const glyphsKey = glyphs.join('|')
    const stableGlyphs = useMemo(() => glyphs, [glyphsKey]) // eslint-disable-line react-hooks/exhaustive-deps
    const groups = groupingSizes ?? derived?.groupingSizes ?? EMPTY
    const groupsKey = groups.join(',')
    const stableGroups = useMemo(() => groups, [groupsKey]) // eslint-disable-line react-hooks/exhaustive-deps
    const still = animated === false

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
      <NativeNitroNumberView
        {...viewProps}
        style={[autoSize, style]}
        hybridRef={hybridRef}
        value={compact ? compact.value : value}
        fractionDigits={fractionDigits ?? compact?.fractionDigits ?? derived?.fractionDigits ?? 0}
        minimumIntegerDigits={minimumIntegerDigits ?? derived?.minimumIntegerDigits ?? 1}
        groupingSeparator={groupingSeparator ?? derived?.groupingSeparator ?? ''}
        decimalSeparator={decimalSeparator ?? derived?.decimalSeparator ?? '.'}
        prefix={prefix ?? compact?.prefix ?? derived?.prefix ?? ''}
        suffix={suffix ?? compact?.suffix ?? derived?.suffix ?? ''}
        transition={transition ?? 'roll'}
        flashUpColor={processedFlashUp}
        flashDownColor={processedFlashDown}
        flashDuration={flashDuration ?? 600}
        popOnChange={popOnChange ?? 0}
        duration={still ? 0 : duration ?? TRANSITION_DEFAULTS[transition ?? 'roll'].duration}
        easing={easing ?? TRANSITION_DEFAULTS[transition ?? 'roll'].easing}
        bounce={bounce ?? 0.15}
        stagger={stagger ?? TRANSITION_DEFAULTS[transition ?? 'roll'].stagger}
        rollDirection={direction ?? compactDirection ?? 'auto'}
        revealState={reveal === undefined ? 0 : reveal ? 2 : 1}
        revealStyle={revealStyle ?? 'count'}
        revealDuration={still ? 0 : revealDuration ?? 2200}
        revealBounce={revealBounce ?? 0.12}
        revealGrow={revealGrow ?? 0.2}
        revealStagger={revealStagger ?? 200}
        revealMilestones={stableMilestones}
        revealMilestoneHold={revealMilestoneHold ?? 0}
        onRevealEnd={onRevealEndCallback}
        onRevealMilestone={onRevealMilestoneCallback}
        onAnimationStart={onAnimationStartCallback}
        onAnimationEnd={onAnimationEndCallback}
        loading={loading ?? false}
        shimmerColor={processedShimmerColor}
        shimmerDuration={shimmerDuration ?? 950}
        fontSize={resolvedFontSize}
        prefixFontSize={prefixFontSize ?? resolvedFontSize}
        suffixFontSize={suffixFontSize ?? resolvedFontSize}
        affixAlign={resolvedAffixAlign}
        prefixAlign={prefixAlign ?? resolvedAffixAlign}
        suffixAlign={suffixAlign ?? resolvedAffixAlign}
        letterSpacing={letterSpacing ?? 0}
        prefixSpacing={prefixSpacing ?? Infinity}
        suffixSpacing={suffixSpacing ?? Infinity}
        prefixOffset={prefixOffset ?? 0}
        suffixOffset={suffixOffset ?? 0}
        tabularNums={tabularNums ?? true}
        signDisplay={signDisplay ?? derived?.signDisplay ?? 'auto'}
        plusSign={plusSign ?? derived?.plusSign ?? '+'}
        minusSign={minusSign ?? derived?.minusSign ?? '-'}
        digitGlyphs={stableGlyphs}
        groupingSizes={stableGroups}
        digitMax={digitMax}
        continuous={continuous ?? false}
        prefixColor={processedPrefixColor}
        suffixColor={processedSuffixColor}
        fractionColor={processedFractionColor}
        fractionFontSize={fractionFontSize ?? Infinity}
        fractionAlign={fractionAlign ?? 'baseline'}
        respectReduceMotion={respectReduceMotion ?? true}
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
