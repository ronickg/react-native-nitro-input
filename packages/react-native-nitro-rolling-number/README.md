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
- Fabric only (new architecture), React Native ≥ 0.78, Nitro Modules ≥ 0.37.

## Install

```sh
bun add react-native-nitro-rolling-number react-native-nitro-modules
cd ios && pod install
```

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

### Imperative

```tsx
const ref = useRef<RollingNumberHandle>(null)

<RollingNumber ref={ref} value={0} />

ref.current?.animateTo(42)      // rolls, like changing the prop
ref.current?.jumpTo(41.75)      // positions the wheels continuously, no roll (scrubbing)
ref.current?.getValue()         // value shown or being rolled towards
```

`jumpTo` positions every wheel from a continuous number (`41.75` shows the units
wheel three quarters of the way from `1` to `2`), which is what you want when a
scroll or drag handler drives the number.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | – | The number to display. |
| `fractionDigits` | `number` | `0` | Digits after the decimal separator. |
| `minimumIntegerDigits` | `number` | `1` | Zero-pads the integer part. |
| `groupingSeparator` | `string` | `''` | Inserted every three integer digits. |
| `decimalSeparator` | `string` | `'.'` | Between integer and fraction digits. |
| `prefix` / `suffix` | `string` | `''` | Static text around the number. |
| `duration` | `number` | `500` | Roll duration in ms; `0` snaps. |
| `easing` | `'linear' \| 'easeIn' \| 'easeOut' \| 'easeInOut' \| 'spring'` | `'easeInOut'` | Roll timing curve. |
| `bounce` | `number` | `0.15` | Overshoot of the `spring` easing (0–1). |
| `stagger` | `number` | `0` | ms between the start of each digit's roll (least significant first), a cascading carry. |
| `direction` | `'auto' \| 'up' \| 'down'` | `'auto'` | Roll direction; `auto` follows the sign of the change. |
| `loading` | `boolean` | `false` | "Shine" glint: a slanted, text-wide band sweeps through the ink; cross-fades on toggle. |
| `shimmerColor` | `ColorValue` | light neutral | Color of the glint's core (`#D6D9E1`, `#2B2E37` in dark mode). |
| `shimmerDuration` | `number` | `950` | ms per sweep (linear, repeating). |
| `fontSize` | `number` | `32` | Font size of the digits in points. |
| `prefixFontSize` / `suffixFontSize` | `number` | `fontSize` | Smaller (or larger) prefix/suffix, e.g. a currency symbol or code. |
| `affixAlign` | `'baseline' \| 'center' \| 'top' \| 'bottom'` | `'baseline'` | How prefix/suffix line up with the digits: `top` pins glyph tops, `bottom` the bottom of the line boxes. |
| `prefixAlign` / `suffixAlign` | same | `affixAlign` | Per-affix override, e.g. `$` pinned top and `USD` pinned bottom. |
| `adjustsFontSizeToFit` | `boolean` | `false` | Shrink the whole number to fit the view's fixed `width`; the view keeps its full height. |
| `minimumFontScale` | `number` | `0.5` | Lower bound for `adjustsFontSizeToFit`. |
| `allowFontScaling` | `boolean` | `false` | Follow the system text size like `Text` (off by default so amounts keep their design size). |
| `maxFontSizeMultiplier` | `number` | `0` | Cap for `allowFontScaling`; `0` = no cap. |
| `fontWeight` | `TextStyle['fontWeight']` | `'normal'` | Font weight. |
| `fontFamily` | `string` | system | Font family, resolved like `Text` (bundled / expo-font fonts work). |
| `color` | `ColorValue` | label color | Text color. |
| `textAlign` | `'left' \| 'center' \| 'right'` | `'left'` | Alignment inside a wider frame. |
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
- Per frame the view draws about a dozen glyphs with cached fonts and widths;
  scaling is a canvas transform, so no fonts are rebuilt while fitting.
- The only JS round trip is auto-sizing: when the digit count changes the view
  reports its new intrinsic size and React applies it. Give the view a fixed
  `width` (recommended for amounts anyway) and nothing depends on JS at all;
  in auto-size mode the view is not clipped, so a late size update never cuts
  a digit off.

## How it works

- Each digit is a column with a continuous position on a `0–9` strip. The view
  draws the two visible glyphs of every column with Core Graphics / `Canvas`,
  so a frame costs about a dozen text draws.
- **`animateTo` / the `value` prop** compute per-column targets (shortest roll
  in the direction of the change, blank↔digit for appearing/disappearing
  columns) and animate them with a `CADisplayLink` / `ValueAnimator`.
- **`jumpTo`** derives the column positions directly from the number using the
  mechanical odometer rule (a wheel turns only while every lower wheel travels
  from `9` to `0`).
- Props are parsed by Nitro from JSI (no Fabric codegen); the view is a Fabric
  component, so `style`, `opacity`, `transform` and friends work as usual.

## License

MIT
