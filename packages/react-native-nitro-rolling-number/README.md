# react-native-nitro-rolling-number

A native **rolling number** (odometer / ticker) view for React Native, built with
[Nitro Modules](https://nitro.margelo.com). Every digit is a wheel that rolls to
its new glyph, like SwiftUI's `.contentTransition(.numericText())`, with the
same look on iOS **and** Android.

- Change the `value` prop and the digits roll natively: per digit, direction
  aware, with easing or spring curves and an optional cascading `stagger`.
- Formatting on the native side: fraction digits, grouping separator, decimal
  separator, prefix/suffix (with their own font sizes), zero padding, negatives.
- Columns appear and disappear smoothly (`999 → 1000` slides a new `1` in while
  the layout widens), and the view auto-sizes to its content.
- `adjustsFontSizeToFit` keeps a fixed box and scales the amount to fit.
- `loading` shows a text-shaped shimmer skeleton that cross-fades to the value.
- `reveal` plays the casino "you won" presentation natively: the win-meter
  rollup (with tiers that punch and hold) or slot reels that lock from the left.
- Fabric only (new architecture), React Native ≥ 0.78, Nitro Modules ≥ 0.37.

Docs, live demos and benchmarks: **https://ronickg.github.io/react-native-nitro-rolling-number/**

## Install

```sh
bun add react-native-nitro-rolling-number react-native-nitro-modules
cd ios && pod install
```

> **Android and Nitro 0.37:** Nitro never hands a Hybrid View its `backgroundColor`, `border*`, `opacity`, `transform`, `testID` or accessibility props on Android with React Native 0.86+. Fixed upstream in [margelo/nitro#1655](https://github.com/margelo/nitro/pull/1655); until it ships, apply the [patch from this repository](https://github.com/ronickg/react-native-nitro-rolling-number/blob/main/patches/react-native-nitro-modules@0.37.1.patch) with `patchedDependencies` (Bun) or patch-package.

## Usage

```tsx
import { RollingNumber } from 'react-native-nitro-rolling-number'

<RollingNumber
  value={balance}
  fractionDigits={2}
  groupingSeparator=","
  prefix="$"
  fontSize={48}
  fontWeight="700"
  color="#0A84FF"
  easing="spring"
  bounce={0.2}
  stagger={40}
/>
```

Whenever `value` changes, each digit rolls from its old glyph to its new one in
the direction of the change. The first value is shown without animation.

### The transitions

```tsx
<RollingNumber value={count} transition="numeric" fontSize={48} fontWeight="700" />
<RollingNumber value={count} transition="scramble" />
```

The roll is the default. The others swap each changed glyph in place, digits
that don't change staying put, the change cascading from the leftmost changed
digit to the right (`stagger`); `duration` and `easing` apply to all of them,
each with its own defaults.

- **`numeric`**, after SwiftUI's `.contentTransition(.numericText())`: the
  old glyph softens, shrinks and slides out; the new one slides in from the
  other side, nearly full size and out of focus, and resolves. The glyphs move
  up when the value grows and down when it shrinks (`direction` overrides
  that). The blur is real on all three platforms: a blurred copy of each
  glyph rendered once per font and cross-faded with the sharp one, so a frame
  costs the same as a frame of a roll.
- **`scramble`**: each changed digit shows a different random digit every
  few frames, never the one it is leaving or arriving at, and locks on its
  target; the lock runs from the left.

Two more things happen on a change if you ask for them, with any transition:

```tsx
<RollingNumber value={price} flashUpColor="#16a34a" flashDownColor="#dc2626" popOnChange={0.08} />
```

`flashUpColor` / `flashDownColor` is the change flash of a trading screen:
every digit whose glyph changes lights up in the up colour when the value grew
and the down colour when it shrank, fading back over `flashDuration` (600 ms).
`popOnChange` punches the whole figure on every change, its peak overshoot as
a fraction of the size, rung out like the reveal's landing pop.

### Currency layouts and fitting a width

```tsx
// "$" smaller than the amount, aligned to the top of the digits
<RollingNumber value={total} prefix="$" prefixFontSize={22} affixAlign="top" fontSize={44} />

// currency code after the amount, smaller and pinned to the bottom
<RollingNumber value={total} suffix=" USD" suffixFontSize={18} suffixAlign="bottom" fractionDigits={2} />

// both at once: "$" pinned top, "USD" pinned bottom
<RollingNumber value={total} prefix="$" prefixAlign="top" suffix=" USD" suffixAlign="bottom" prefixFontSize={22} suffixFontSize={16} />

// fit the container without a fixed width: full size until it would overflow, then it shrinks
<RollingNumber value={total} fontSize={52} adjustsFontSizeToFit style={{ maxWidth: '100%' }} />

// fixed box: the box never resizes, the amount shrinks (down to 50%) and grows back to fit
<RollingNumber
  value={total}
  fontSize={64}
  adjustsFontSizeToFit
  minimumFontScale={0.5}
  textAlign="center"
  style={{ width: 240 }}
/>
```

### Loading skeleton

```tsx
<RollingNumber value={balance ?? 0} loading={balance === undefined} prefix="$" fractionDigits={2} />
```

While `loading` is true the glyphs keep their color and a slanted, text-wide
glint (`[color, shimmerColor, color]` at 10/50/90 %) sweeps through them every
950 ms, seeded with its core at the left edge so it shows immediately. It is
text-shaped, so the layout is exactly what the real number will occupy. When
the value arrives, flip `loading` off and set `value` in the same render: the
glint fades out while the digits roll to the amount.

### Jackpot reveal

```tsx
const [reveal, setReveal] = useState(false)

<RollingNumber
  value={50000}
  reveal={reveal}                      // false: hold "$0.00" in the final layout; true: play
  revealStyle="count"                  // the win-meter rollup, or "spin" for slot reels
  revealMilestones={[1000, 10000, 25000]}
  revealMilestoneHold={400}
  revealDuration={4800}                // about a second per tier
  onRevealMilestone={(index, at) => haptics.impact()}
  onRevealEnd={() => setShowNextStep(true)}
  prefix="$" fractionDigits={2} groupingSeparator="," textAlign="center" style={{ width: '100%' }}
/>
```

`count` opens at 0, smaller, and tallies up like a slot's win counter: it takes
off at once, runs at a constant rate (the low digits blur), grows as it climbs
(`revealGrow`) and crawls into the total; digits swap in place and leading
digits appear as the count reaches them. With `revealMilestones` (the "big win → mega
win" tiers, numbers in the figure's units) the count runs tier by tier: equal
time per tier, braking into each milestone, a punch, a pause of
`revealMilestoneHold` ms, then taking off again. `spin` spins every digit like
a slot reel and locks the reels one at a time from the left. Both land with a
pop. `jumpTo(value)` skips a running reveal (tap to slam). Banners, confetti
and sounds are the app's: the callbacks give you the beats.

### Imperative

```tsx
const ref = useRef<RollingNumberHandle>(null)

<RollingNumber ref={ref} value={0} />

ref.current?.animateTo(42)      // rolls, like changing the prop
ref.current?.jumpTo(41.75)      // positions the wheels continuously, no roll (scrubbing)
ref.current?.revealTo(1234.5)   // plays a jackpot reveal
ref.current?.getValue()         // value shown or being rolled towards
```

`jumpTo` positions every wheel from a continuous number (`41.75` shows the units
wheel three quarters of the way from `1` to `2`), which is what you want when a
scroll or drag handler drives the number.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | – | The number to display. Shown with at most 18 digits: `|value| × 10^fractionDigits` is clamped at 10^17, and a JS number carries exact integers only up to 2^53. |
| `fractionDigits` | `number` | `0` | Digits after the decimal separator. |
| `minimumIntegerDigits` | `number` | `1` | Zero-pads the integer part. |
| `groupingSeparator` | `string` | `''` | Inserted every three integer digits. |
| `decimalSeparator` | `string` | `'.'` | Between integer and fraction digits. |
| `prefix` / `suffix` | `string` | `''` | Static text around the number. |
| `duration` | `number` | `500` | Roll duration in ms; `0` snaps. |
| `easing` | `'linear' \| 'easeIn' \| 'easeOut' \| 'easeInOut' \| 'spring'` | `'easeInOut'` | Roll timing curve. A value that arrives while the wheels are still rolling continues with the ease-out half of the curve, so rapid updates never stall. |
| `bounce` | `number` | `0.15` | Overshoot of the `spring` easing (0–1). |
| `stagger` | `number` | `0` | ms between the start of each digit's roll (least significant first), a cascading carry; from the left in the numeric transition, where it defaults to `50`. |
| `transition` | `'roll' \| 'numeric' \| 'scramble'` | `'roll'` | How a change plays: the odometer roll; the numeric transition (each changed glyph swaps in place, SwiftUI's `numericText`); or a scramble that locks from the left. Each swap style has its own `duration` / `easing` / `stagger` defaults (numeric 450 / spring / 50, scramble 500 / linear / 60). |
| `flashUpColor`, `flashDownColor` | `ColorValue` | unset | The change flash: digits whose glyph changes light up in the up colour when the value grew, the down colour when it shrank, fading back over `flashDuration`. Unset: no flash. |
| `flashDuration` | `number` | `600` | ms a change flash takes to fade. |
| `popOnChange` | `number` | `0` | A punch of the whole figure on every change, peak overshoot 0–1, rung out like the reveal's landing pop. |
| `direction` | `'auto' \| 'up' \| 'down'` | `'auto'` | Roll direction; `auto` follows the sign of the change. |
| `reveal` | `boolean` | – | `false` holds the opening frame (`$0.00` in the final layout); `true` plays the reveal to `value`. Unset = a normal rolling number. |
| `revealStyle` | `'count' \| 'spin'` | `'count'` | The win-meter rollup, or slot reels locking from the left. |
| `revealDuration` | `number` | `2200` | ms of the count, or until the last reel locks (holds and the pop come on top). |
| `revealBounce` | `number` | `0.12` | Peak overshoot of the landing pop and the milestone punches; `0` = none. |
| `revealGrow` | `number` | `0.2` | `count`: how much smaller the figure opens, growing to full size over the count. |
| `revealStagger` | `number` | `200` | `spin`: ms between reel stops, shortened to fit the duration. |
| `revealMilestones` | `number[]` | – | `count`: tiers in the figure's units; the count lands on each, punches, holds, then accelerates again. |
| `revealMilestoneHold` | `number` | `0` | `count`: ms the count pauses on each milestone. |
| `onRevealMilestone` | `(index, value) => void` | – | The count reached a milestone. |
| `onRevealEnd` | `() => void` | – | The reveal landed (pop rung out). |
| `loading` | `boolean` | `false` | "Shine" glint: a slanted, text-wide band sweeps through the ink; cross-fades on toggle. |
| `shimmerColor` | `ColorValue` | light neutral | Color of the glint's core (`#D6D9E1`, `#2B2E37` in dark mode). |
| `shimmerDuration` | `number` | `950` | ms per sweep (linear, repeating). |
| `fontSize` | `number` | `32` | Font size of the digits in points. |
| `prefixFontSize` / `suffixFontSize` | `number` | `fontSize` | Smaller (or larger) prefix/suffix, e.g. a currency symbol or code. |
| `affixAlign` | `'baseline' \| 'center' \| 'top' \| 'bottom'` | `'baseline'` | How prefix/suffix line up with the digits: `top` pins the glyph tops (cap height), `bottom` the bottom of the glyphs' ink (a currency code sits on the digits' baseline, not down where a comma's tail reaches). |
| `prefixAlign` / `suffixAlign` | same | `affixAlign` | Per-affix override, e.g. `$` pinned top and `USD` pinned bottom. |
| `adjustsFontSizeToFit` | `boolean` | `false` | Shrink the whole number to fit the view's fixed `width`; the view keeps its full height. |
| `minimumFontScale` | `number` | `0.5` | Lower bound for `adjustsFontSizeToFit`. |
| `allowFontScaling` | `boolean` | `false` | Follow the system text size like `Text` (off by default so amounts keep their design size). |
| `maxFontSizeMultiplier` | `number` | `0` | Cap for `allowFontScaling`; `0` = no cap. |
| `fontWeight` | `TextStyle['fontWeight']` | `'normal'` | Font weight. |
| `fontFamily` | `string` | system | Font family, resolved like `Text` (bundled / expo-font fonts work). |
| `color` | `ColorValue` | label color | Text color. |
| `textAlign` | `'auto' \| 'left' \| 'center' \| 'right'` | `'auto'` | Alignment inside a wider frame. `'auto'` is the start edge of the layout direction; `'left'` and `'right'` are absolute. In a right-to-left app the prefix sits at the right edge and the suffix at the left, and the digits keep reading left to right. |
| `onNativeRef` | `(ref) => void` | – | Receives the Nitro object on mount. |
| `style`, `testID`, … | `ViewProps` | – | Regular view props. |

The view reports its intrinsic size from native and sizes itself. Give it an
explicit `width` in `style` plus `textAlign="right"` if you don't want the layout
to reflow while digits appear (e.g. a counter that grows past `999`).

## Accessibility

- VoiceOver / TalkBack read the formatted amount (prefix, sign, grouped digits,
  suffix, e.g. `$1,234.50 USD`), updated whenever the value changes; while
  `loading` the element is announced as loading.
- Reduce Motion (iOS) and "Remove animations" / animator scale 0 (Android)
  snap to the new value instead of rolling, and freeze the loading glint.
- The view implements Nitro's `RecyclableView`, so Fabric reuses instances in
  long lists; a recycled view forgets all props and animation state first.
- Custom fonts resolve like `Text`: on iOS by PostScript or family name from
  `UIAppFonts`, on Android through React Native's font manager (`assets/fonts`,
  `res/font`, or fonts registered by expo-font).

## Performance and threading

- A `value` change is delivered by React once; from there the roll runs
  natively (`CADisplayLink` on the main run loop, `ValueAnimator` on the UI
  thread). A busy JS thread delays the *next* value, never the animation in
  flight, the shimmer, or the shrink-to-fit scaling.
- On iOS a frame never redraws a bitmap: each glyph and wheel is a `CALayer`
  with a pre-rasterized image (a wheel is a clipped strip of the digits), and a
  frame only moves layers, so the render server composites the roll. The
  Core Graphics path is used only while the loading glint is showing. On
  Android a frame is about a dozen `Canvas.drawText` calls through HWUI's glyph
  cache. Scaling is a layer / canvas transform, so no fonts are rebuilt while
  fitting.
- `jumpTo` / `animateTo` coalesce: only the newest value per main-thread turn
  is applied, so pushing a value every frame into many views never builds a
  backlog of main-thread dispatches.
- The only JS round trip is auto-sizing: when the digit count changes the view
  reports its new intrinsic size and React applies it. Give the view a fixed
  `width` (recommended for amounts anyway) and nothing depends on JS at all;
  in auto-size mode the view is not clipped, so a late size update never cuts
  a digit off. A size that grows is reported at once; a size that shrinks is
  reported when the roll has finished, so the box never squeezes digits that
  are still on their way out.

## How it works

- All behaviour lives in one shared C++ engine (`cpp/RollingEngine.hpp`): each
  digit is a wheel with a continuous position on a `0–9` strip; the engine
  computes rolls (shortest path in the roll direction, blank↔digit for
  appearing/disappearing wheels), stagger, easing/spring curves, the odometer
  carry rule for `jumpTo`, the loading fade, the shimmer phase and the jackpot
  reveals (count curve, tiers, reels, landing pop).
- The Swift view calls the engine directly through Swift/C++ interop; the
  Kotlin view through a 60-line fbjni handle (the only hand-written JNI). Each
  platform only owns fonts, layout, fit-to-width and text drawing, and drives
  the engine from a `CADisplayLink` / `Choreographer` loop.
- A frame is about a dozen cached glyph draws with Core Graphics / `Canvas`.
- Props are parsed by Nitro from JSI (no Fabric codegen); the view is a Fabric
  component, so `style`, `opacity`, `transform` and friends work as usual.

## License

MIT
