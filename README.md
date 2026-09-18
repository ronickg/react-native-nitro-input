<h1 align="center">react-native-nitro-rolling-number</h1>

<p align="center">
  A native <b>rolling number</b> for React Native. Every digit is a wheel that rolls, driven by one C++ engine on iOS and Android.<br/>
  Built with <a href="https://nitro.margelo.com">Nitro Modules</a>.
</p>

<p align="center">
  <a href="https://ronickg.github.io/react-native-nitro-rolling-number/"><b>Docs &amp; live demos</b></a> ·
  <a href="https://ronickg.github.io/react-native-nitro-rolling-number/docs/reveal">Jackpot reveal</a> ·
  <a href="https://ronickg.github.io/react-native-nitro-rolling-number/docs/benchmarks">Benchmarks</a> ·
  <a href="packages/react-native-nitro-rolling-number/README.md">Package README</a>
</p>

<p align="center">
  <img src="docs/static/img/readme/market.gif" width="536" alt="A live market screen with about thirty rolling numbers, on an iPhone simulator and a Pixel emulator" />
</p>

<p align="center"><sub>The example app's market showcase on an iPhone 17 Pro simulator (left) and a Pixel 9 Pro emulator (right): fourteen coins with price and 24 h change, a handful ticking every 200 ms, the balance derived from them. Every number is native.</sub></p>

## Why

- **Native on both platforms.** A `value` change is one JSI call; the roll runs on a `CADisplayLink` (Core Animation layers) or a `Choreographer` (Canvas). A busy JS thread never delays an animation in flight.
- **Every digit is a wheel.** Shortest path in the direction of the change, columns sliding in and out as the number grows, easing, spring or a cascading stagger.
- **Money-ready.** Fraction digits, grouping and decimal separators, a currency symbol or code at its own size pinned to the top or bottom of the digits, zero padding, negatives.
- **Fits its box.** Auto-sizes to its content, or shrinks continuously to a fixed width without squeezing digits still on their way out.
- **Jackpot reveal.** The casino win-meter rollup (tiers that punch and hold, a figure that grows as it climbs) and the slot-reel reveal, all native.
- **Loading, accessible, recyclable.** A text-shaped shimmer while the value loads, VoiceOver / TalkBack read the formatted amount, Reduce Motion snaps, Fabric can recycle it in long lists.

## Install

```sh
bun add react-native-nitro-rolling-number react-native-nitro-modules
cd ios && pod install
```

React Native 0.78+ with the new architecture, Nitro Modules 0.37+.

## Use

```tsx
import { RollingNumber } from 'react-native-nitro-rolling-number'

<RollingNumber
  value={balance}
  fractionDigits={2}
  groupingSeparator=","
  prefix="$"
  prefixFontSize={24}
  affixAlign="top"
  fontSize={48}
  fontWeight="800"
  easing="spring"
  stagger={30}
/>
```

Change `value` and the digits roll. `ref.current.jumpTo(v)` positions the wheels continuously for scrubbing, `animateTo(v)` rolls, `revealTo(v)` plays a jackpot reveal.

## Jackpot reveal

<p align="center">
  <img src="docs/static/img/readme/reveal.gif" width="536" alt="The count reveal with tiers, then the slot-reel reveal, on iOS and Android" />
</p>

```tsx
<RollingNumber
  value={50000}
  reveal={reveal}                        // false holds "$0.00", true plays
  revealStyle="count"                    // or "spin" for slot reels
  revealMilestones={[1000, 10000, 25000]}
  revealMilestoneHold={400}
  revealDuration={4800}                  // about a second per tier
  onRevealMilestone={(index, at) => haptics.impact()}
  onRevealEnd={() => setShowNextStep(true)}
  prefix="$" fractionDigits={2} groupingSeparator="," textAlign="center" style={{ width: '100%' }}
/>
```

The count follows how slot machines present a win: a constant-rate tally per tier that winds up out of each milestone and crawls into the next, a figure that opens smaller and grows as it climbs, and punches that settle without dipping under the resting size. `jumpTo(value)` skips (tap to slam). Banners, confetti and sounds stay in the app: the callbacks give you the beats. [Guide →](https://ronickg.github.io/react-native-nitro-rolling-number/docs/reveal)

## Performance

Release builds, 24 copies fed a new value on every frame, UI-thread frame rate from a Reanimated frame callback:

| | iPhone 13 Pro Max (120 Hz) | Pixel 10 (60 Hz) |
| --- | --- | --- |
| **Nitro Rolling Number** | **120 fps, 0 dropped** | **60 fps, 0 dropped** |
| NumberFlow (View) | 35 fps | 33 fps |
| NumberFlow (Skia) | 95 fps | 59 fps |
| AnimatedNumbers | 114 fps | 56 fps |

Method and full tables: [BENCHMARKS.md](BENCHMARKS.md).

## Also in this repo: a morphing input

[`react-native-nitro-morph-input`](packages/react-native-nitro-morph-input) is a native single-line **text and amount input** whose text morphs as you type, the way [Torph](https://torph.lochie.me) morphs text on the web: characters that stay glide to their new place, new ones slide or fade in, removed ones leave with their neighbours. A system text field owns the keyboard, editing, selection and accessibility; in `mode="number"` every keystroke is formatted on the native side before a frame is drawn (grouping, decimals, a currency prefix or suffix, the caret kept in place), so there is no JS round trip and none of the flicker of a `TextInput` formatted in `onChangeText`.

```tsx
import { MorphInput } from 'react-native-nitro-morph-input'

<MorphInput mode="number" prefix="$" prefixFontSize={28} affixAlign="top" placeholder="0" fontSize={48} fontWeight="700" textAlign="center" style={{ width: '100%' }} onChangeValue={setAmount} />
```

[Guide and live demo →](https://ronickg.github.io/react-native-nitro-rolling-number/docs/morph-input) · [Package README](packages/react-native-nitro-morph-input/README.md)

## Repository

- [`packages/react-native-nitro-rolling-number`](packages/react-native-nitro-rolling-number) – the rolling number: the shared C++ engine (`cpp/`), the Swift and Kotlin views, the Nitro spec and the JS wrapper. Its [README](packages/react-native-nitro-rolling-number/README.md) is the API reference.
- [`packages/react-native-nitro-morph-input`](packages/react-native-nitro-morph-input) – the morphing input, same layout: `cpp/MorphEngine` + `cpp/AmountFormatter`, a Swift and a Kotlin view around a hidden system text field.
- [`example/`](example) – React Native 0.87 app with every demo, the benchmark harness and the showcase screens the recordings come from.
- [`docs/`](docs) – the Docusaurus site. Its live demos run the very same `RollingEngine.cpp` and `MorphEngine.cpp`, compiled to WebAssembly.

```sh
bun install                 # hoisted linker, see bunfig.toml
bun specs                   # re-run nitrogen after editing src/specs/*.nitro.ts
bun test                    # jest tests for the JS wrapper
bun --cwd packages/react-native-nitro-rolling-number run test:cpp   # engine tests (same for packages/react-native-nitro-morph-input)
bun example ios             # or: bun example android
cd docs && npm install && npm start                                  # docs site
```

Releasing: `bun --cwd packages/<package> release <patch|minor|major>` runs the typecheck, the Jest and engine tests, bumps the version, commits and tags `v<version>`, publishes to npm and creates the GitHub release (needs `npm login` and a `GITHUB_TOKEN`).

The example's Android Gradle files point at the workspace root `node_modules`, and Metro watches the whole repo.

## License

MIT
