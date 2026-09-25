<h1 align="center">react-native-nitro-input</h1>

<p align="center">
  Two native components for React Native in one package, built with <a href="https://nitro.margelo.com">Nitro Modules</a>:<br/>
  a <b>number</b> that animates its changes (rolling wheels, or SwiftUI's numeric transition), and a <b>text input</b> that formats amounts and applies masks natively, with a reflow you can turn on.<br/>
  One C++ engine each, iOS and Android, the new architecture.
</p>

<p align="center">
  <a href="https://ronickg.github.io/react-native-nitro-input/"><b>Docs &amp; live demos</b></a> ·
  <a href="BENCHMARKS.md">Benchmarks</a>
</p>

<table align="center">
  <tr>
    <td align="center" valign="top" width="50%">
      <h3><code>NitroNumber</code></h3>
      <img src="docs/static/img/readme/market.webp" width="260" alt="A trading dashboard with 48 NitroNumbers updating at once, on a Samsung Galaxy A22" />
      <p>A number that animates its changes. Every digit is a wheel, or swaps like SwiftUI's numeric text, driven by one C++ engine, with currency layouts, shrink-to-fit, a loading shimmer and the jackpot reveal.</p>
      <p>
        <a href="#nitronumber">Below</a> ·
        <a href="https://ronickg.github.io/react-native-nitro-input/docs/nitro-number">Guide</a> ·
        <a href="https://ronickg.github.io/react-native-nitro-input/docs/loading-and-reveal#jackpot-reveal">Jackpot reveal</a> ·
        <a href="https://ronickg.github.io/react-native-nitro-input/docs/benchmarks">Benchmarks</a> ·
        <a href="packages/react-native-nitro-input/README.md#nitronumber">API reference</a>
      </p>
    </td>
    <td align="center" valign="top" width="50%">
      <h3><code>NitroInput</code></h3>
      <img src="docs/static/img/readme/transfer.webp" width="260" alt="A transfer screen: an amount typed into a native field that reflows as it is formatted, the payout switching currency, on a Samsung Galaxy A22" />
      <p>A native text input. The system keyboard and accessibility stay; amounts are formatted and masks applied in C++ before a frame is drawn, the floating label is native, and the reflow is there when you turn it on.</p>
      <p>
        <a href="#nitroinput">Below</a> ·
        <a href="https://ronickg.github.io/react-native-nitro-input/docs/nitro-input">Guide</a> ·
        <a href="https://ronickg.github.io/react-native-nitro-input/docs/nitro-input#amounts">Amount field</a> ·
        <a href="https://ronickg.github.io/react-native-nitro-input/docs/nitro-input#masks">Masks</a> ·
        <a href="https://ronickg.github.io/react-native-nitro-input/docs/benchmarks">Benchmarks</a> ·
        <a href="packages/react-native-nitro-input/README.md#nitroinput">API reference</a>
      </p>
    </td>
  </tr>
</table>

<p align="center"><sub>The example app on a Samsung Galaxy A22, a budget phone (MediaTek Helio G80, 90 Hz), recorded with its own screen recorder. Left: the market showcase, 48 NitroNumbers (a portfolio, a heatmap, an order book and a trade tape) driven by one loop, about 210 updates a second with no re-render. Right: a transfer, the amount typed into a reflowing <code>NitroInput</code> while what they receive, the fee and three other currencies follow every keystroke. Every number is native.</sub></p>

Both components share the same formatting model (prefix and suffix at their own size, pinned to the top, bottom, baseline or centre of the digits; grouping and decimal separators of your choice) and ship in one package. React Native 0.78+ with the new architecture, Nitro Modules 0.37+; see the [Android note](#known-issue-view-props-on-android) before you ship.

## Install

```sh
bun add react-native-nitro-input react-native-nitro-modules
cd ios && pod install
```

`react-native-nitro-rolling-number` was NitroNumber's own package until 0.1.0, where the component was `RollingNumber`; it is `NitroNumber` in `react-native-nitro-input` now, with the same props.

## NitroNumber

- **Native on both platforms.** A `value` change is one JSI call; the roll runs on a `CADisplayLink` (Core Animation layers) or a `Choreographer` (Canvas). A busy JS thread never delays an animation in flight.
- **Every digit is a wheel.** Shortest path in the direction of the change, columns sliding in and out as the number grows, easing, spring or a cascading stagger.
- **Or another transition.** `transition="numeric"` plays a change the way SwiftUI's `numericText` does: each changed glyph swaps in place, softening, shrinking and sliding out as the new one slides in and comes into focus, cascading from the left; unchanged digits stay put. `"scramble"` locks random digits from the left. A change flash (`flashUpColor` / `flashDownColor`) and a pop (`popOnChange`) go with any of them.
- **Money-ready.** Fraction digits, grouping and decimal separators, a currency symbol or code at its own size pinned to the top or bottom of the digits, zero padding, negatives. Switching currency plays as one change: the old mark blurs out as the new one arrives, the decimals open or close, and the digits swap or roll to the new amount.
- **Drive it from anywhere.** `animateTo` / `jumpTo` on the Nitro object work from a Reanimated worklet, so a feed on the UI thread keeps the figure moving while the JS thread is busy.
- **Fits its box.** Auto-sizes to its content, growing from whichever edge its parent pins it to, or shrinks continuously to a fixed width without squeezing digits still on their way out.
- **Jackpot reveal.** The casino win-meter rollup (tiers that punch and hold, a figure that grows as it climbs) and the slot-reel reveal, all native.
- **Loading, accessible, recyclable.** A text-shaped shimmer while the value loads, VoiceOver / TalkBack read the formatted amount, Reduce Motion snaps, Fabric can recycle it in long lists.

### Use

```tsx
import { NitroNumber } from 'react-native-nitro-input'

<NitroNumber
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

Change `value` and the digits roll. `ref.current.jumpTo(v)` positions the wheels continuously for scrubbing, `animateTo(v)` rolls, `revealTo(v)` plays a jackpot reveal. [Guide →](https://ronickg.github.io/react-native-nitro-input/docs/nitro-number) · [Every prop →](https://ronickg.github.io/react-native-nitro-input/docs/nitro-number-props)

### Jackpot reveal

<p align="center">
  <img src="docs/static/img/readme/reveal.webp" width="260" alt="A jackpot counted up tier by tier, BIG, MEGA and EPIC WIN, on a Samsung Galaxy A22" />
</p>

```tsx
<NitroNumber
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

The count follows how slot machines present a win: a constant-rate tally per tier that winds up out of each milestone and crawls into the next, a figure that opens smaller and grows as it climbs, and punches that settle without dipping under the resting size. `jumpTo(value)` skips (tap to slam). Banners, confetti and sounds stay in the app: the callbacks give you the beats. [Guide →](https://ronickg.github.io/react-native-nitro-input/docs/loading-and-reveal#jackpot-reveal)

### Performance

Release builds on real phones, 24 copies fed a new value on every frame, frames per second the UI thread delivered and how many it missed in five seconds (the JS thread is the other half of the story: see the full tables):

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/static/img/bench/glance-dark.svg">
  <img alt="Frames per second the main thread delivered with 24 animated numbers updating every frame, on an iPhone 11 Pro and a Galaxy A22: every Nitro path holds 60 fps on the iPhone, and on the Galaxy A22 jumpTo matches plain text while the other libraries drop to 11–53 fps" src="docs/static/img/bench/glance-light.svg" width="562">
</picture>

| | iPhone 11 Pro (60 Hz) | Galaxy A22 (90 Hz, low-end) |
| --- | --- | --- |
| **NitroNumber** (`value` prop) | 59.9 fps (0 dropped) | 72.5 fps (89 dropped) |
| **NitroNumber** (`jumpTo`) | 59.9 fps (0 dropped) | 81.4 fps (45 dropped) |
| **NitroNumber** (numeric transition) | 59.9 fps (0 dropped) | 73.6 fps (84 dropped) |
| react-native-number-animation (native) | 58.9 fps (5 dropped) | 49.7 fps (203 dropped) |
| react-native-animated-rolling-numbers | 58.9 fps (5 dropped) | 18.6 fps (371 dropped) |
| NumberFlow (View) | 46.1 fps (70 dropped) | 24.4 fps (354 dropped) |
| NumberFlow (Skia) | 53.9 fps (35 dropped) | 30.3 fps (298 dropped) |
| react-native-number-bloom | 47.8 fps (63 dropped) | 52.5 fps (189 dropped) |
| react-native-animated-numbers | 57.3 fps (12 dropped) | 46.6 fps (226 dropped) |
| react-native-ticker | 7.4 fps (256 dropped) | 11.4 fps (383 dropped) |

Method, the JS-thread and CPU columns, the ten-a-second and one-copy cases, a scrolling list, mount cost and the Instruments cross-check: [BENCHMARKS.md](BENCHMARKS.md); the same tables as charts you can hover and switch between metrics: [the benchmark pages of the docs](https://ronickg.github.io/react-native-nitro-input/docs/benchmarks).

## NitroInput

`NitroInput` is a system text field (`UITextField` / `EditText`) that owns the keyboard, editing, selection, paste and accessibility, with native formatting, native masking and an outlined or filled frame with a floating label on top of it. `transition="reflow"` animates the characters as they change, for the one case where that is the point: an amount.

- **It is a real input.** Focus, blur, return key, keyboard types, auto-capitalisation, max length, selection, the text-input registry, all the usual. Not a re-implementation of text editing.
- **Amounts are formatted natively as you type.** In `mode="number"` every keystroke is formatted on the native side before the field shows a frame: grouping separators, one decimal separator, at most `fractionDigits` decimals, a currency `prefix` / `suffix`, the caret kept where you typed. No JS round trip, so none of the flicker, caret jumps or dropped keystrokes of a controlled `TextInput` that formats in `onChangeText`.
- **Masks are native.** `mode="mask"` compiles the pattern once into a state machine in C++ and applies it below the keystroke, no caret fighting.
- **The outlined frame's notch is a real hole** in the stroked path, not background paint over the line, so whatever is behind the field shows through it. No Skia.
- **Reflow, when you want it.** With `transition="reflow"`, text reflows as you type the way [Torph](https://torph.lochie.me) morphs text on the web: characters that stay glide to their new place, new ones slide or fade in, removed ones leave with their neighbours.
- **Worklets, if you have them.** With `react-native-worklets` installed, a `transform` worklet and worklet change handlers run on the UI thread inside the edit, for masks written in JS and shared values updated before the next frame.

### Use

```tsx
import { NitroInput } from 'react-native-nitro-input'

// a form field: outlined frame, floating label, the system keyboard
<NitroInput variant="outlined" label="Email address" keyboardType="email-address" />

// an amount, formatted natively as it is typed
<NitroInput mode="number" prefix="$" fractionDigits={2} groupingSeparator="," onChangeValue={setAmount} />

// a mask, compiled once in C++
<NitroInput mode="mask" mask="+1 (###) ###-####" keyboardType="number-pad" />

// the send-money screen: the amount reflows into place
<NitroInput transition="reflow" mode="number" prefix="$" prefixFontSize={28} affixAlign="top" placeholder="0" fontSize={48} fontWeight="700" textAlign="center" style={{ width: '100%' }} onChangeValue={setAmount} />
```

[Guide and live demo →](https://ronickg.github.io/react-native-nitro-input/docs/nitro-input) · [Every prop →](https://ronickg.github.io/react-native-nitro-input/docs/nitro-input-props)

### Performance

Typed into at eight keys a second by the benchmark probe, the way a keyboard types: how many of 12 keys were rewritten a frame later (the flicker of formatting in JavaScript), how long a key took to settle at p95, and JavaScript per key:

| | iPhone 11 Pro | Galaxy A22 |
| --- | --- | --- |
| **NitroInput** (`mode="number"`) | 0 of 12 keys, 0 ms, JS 1 ms/key | 0 of 12 keys, 0 ms, JS 3 ms/key |
| **NitroInput reflow** (`mode="number"`) | 0 of 12 keys, 0 ms, JS 11 ms/key | 0 of 12 keys, 0 ms, JS 17 ms/key |
| TextInput + formatting in `onChangeText` | 10 of 12 keys, 54 ms, JS 13 ms/key | 10 of 12 keys, 66 ms, JS 40 ms/key |
| react-native-currency-input | 10 of 12 keys, 52 ms, JS 13 ms/key | 10 of 12 keys, 77 ms, JS 43 ms/key |
| react-native-mask-input | 10 of 12 keys, 52 ms, JS 11 ms/key | 10 of 12 keys, 55 ms, JS 33 ms/key |
| TextInput (plain, no formatting) | 0 of 12 keys, 0 ms, JS 9 ms/key | 0 of 12 keys, 0 ms, JS 27 ms/key |

Full tables, focus latency and mount cost: [BENCHMARKS.md](BENCHMARKS.md#the-inputs); as charts: [the input benchmarks page](https://ronickg.github.io/react-native-nitro-input/docs/benchmarks).

## NitroText

A single line of text that morphs to the next, natively, as [Torph](https://torph.lochie.me) does on the web: the characters two strings share glide to their new places and the rest fade ("Sign in" → "Signing in…"), digits matched by place ("$1,204" → "$1,318" rolls the hundreds and tens). At rest it is one draw, like a label, with the loading shimmer when you need a skeleton.

```tsx
import { NitroText } from 'react-native-nitro-input'

<NitroText fontSize={17} fontWeight="600">{busy ? 'Signing in…' : 'Sign in'}</NitroText>
```

Mounting 1000 of them (Release, warm) costs 54 ms of main thread on an iPhone 11 Pro and ~450 ms on a Galaxy A22, against `react-native-plain-text`'s 50 and ~590 and `Text`'s 149 and ~720. [Guide →](https://ronickg.github.io/react-native-nitro-input/docs/reflow#any-text-nitrotext)

## NumberFormat

`NumberFormat` is `Intl.NumberFormat`, formatted natively. It learns a locale's format once from the platform's own formatter (Foundation on iOS, ICU on Android, the data Hermes' `Intl` uses too) and formats every number after that in C++, so the output matches Hermes' `Intl` while building a formatter and formatting stop costing milliseconds. It also brings what Hermes leaves out on iOS: `formatToParts`, `formatRange`, `signDisplay`, engineering notation, rounding modes and increments, and ECMA-402's rounding of ties (`1.005` → `1.01`). Against test262's `intl402/NumberFormat` suite it passes 242 of 251 tests on iOS and 244 on Android, where Hermes' own `Intl` passes 121 and 101.

```ts
import { NumberFormat } from 'react-native-nitro-input'

const php = new NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
php.format(1234.5) // "₱1,234.50"
php.formatToParts(-12)

<NitroNumber value={balance} format={php} />   // the components follow a format too
```

Per call, Release builds, against Hermes' `Intl.NumberFormat`:

| | iPhone 11 Pro | Galaxy A22 |
| --- | --- | --- |
| Building a formatter | 4.9 µs (Hermes 42 µs) | 9.2 µs (Hermes 3.3 ms) |
| `format()` | 1.2 µs (Hermes 1.6 µs) | 2.8 µs (Hermes 10.0 µs) |
| `formatToParts()` | 3.4 µs (Hermes: not implemented) | 7.6 µs (Hermes 93 µs) |
| A formatter per call (`toLocaleString`) | 6.2 µs (Hermes 85 µs) | 11 µs (Hermes 2.0 ms) |

[Guide →](https://ronickg.github.io/react-native-nitro-input/docs/number-format)

## Repository

- [`packages/react-native-nitro-input`](packages/react-native-nitro-input) – the package: the shared C++ engines (`cpp/RollingEngine` for NitroNumber; `cpp/ReflowEngine`, `cpp/AmountFormatter`, `cpp/MaskEngine` and `cpp/OutlineGeometry` for the input), the Swift and Kotlin views (the input's around a hidden system text field), the Nitro specs and the JS wrappers. Its [README](packages/react-native-nitro-input/README.md) is the API reference.
- [`example/`](example) – the React Native 0.87 app you test in: the demos, the manual checks and the showcase screens the recordings come from, with only this library and what an app pairs it with, so it builds quickly. Its [`__tests__/*.harness.tsx`](example/__tests__) are on-device suites run by [React Native Harness](https://www.react-native-harness.dev) inside the app (see [`example/__tests__/README.md`](example/__tests__/README.md)); CI runs them on an Android emulator and an iOS simulator.
- [`bench/`](bench) – the benchmark app: this library against the other animated-number and input libraries on npm (Skia, NumberFlow, Expo UI and the rest), kept out of the example so it never builds them. [`modules/bench-probe`](modules/bench-probe) is the native probe both apps use.
- [`docs/`](docs) – the Docusaurus site. Its live demos run the very same `RollingEngine.cpp` and `ReflowEngine.cpp`, compiled to WebAssembly.
- [`scripts/bench`](scripts/bench) – the device benchmarks behind [BENCHMARKS.md](BENCHMARKS.md): `run.mjs` builds, installs and drives the bench app on real phones, `report.mjs` renders the tables from `results/`. [`scripts/ui`](scripts/ui) – `recycle-check.mjs` drives the example's "Recycle check" screen through [argent](https://github.com/software-mansion/argent) on a simulator, an emulator or a phone and checks that every row shows and paints the value it should, mid-roll frames included; the release-time check for view recycling.

```sh
bun install                 # hoisted linker, see bunfig.toml
bun specs                   # re-run nitrogen after editing src/specs/*.nitro.ts
bun run test                # jest tests for the JS wrappers (plain `bun test` would run Bun's own runner against them)
bun run test:cpp            # C++ engine tests (host clang++)
bun run build               # lib/: ES modules, CommonJS and declarations
bun example ios             # or: bun example android
bun bench ios               # the benchmark app (competitor libraries, Skia, Expo); scripts/bench/run.mjs drives it on phones
bun run test:harness:ios    # on-device suites (example/__tests__/*.harness.tsx) in the example app on a simulator; `:android` for the emulator
node scripts/ui/recycle-check.mjs --udid <device>   # the recycling check, on a device with the example app installed (needs argent)
cd docs && npm install && npm start                                  # docs site
```

Releasing: `bun --cwd packages/react-native-nitro-input release <patch|minor|major>` runs the typecheck, the Jest and engine tests, bumps the version, commits, tags, publishes to npm and creates the GitHub release (needs `npm login` and a `GITHUB_TOKEN`).

Releases are tagged `nitro-input-v<version>`. The `release-it` config pins `tagMatch` to that prefix and `commitsPath` to the package directory, so "the previous release" and "what changed since it" mean this package's. A release with no commits touching the package is refused. The GitHub release body is the matching `## <version>` section of the package's own `CHANGELOG.md`, read by `scripts/release/changelog-section.mjs` — write that section before releasing, or the release stops.

The example's Android Gradle files point at the workspace root `node_modules`, and Metro watches the whole repo.

## Known issue: view props on Android

Nitro Modules 0.37 never fills a Hybrid View's raw props on Android from React Native 0.86 on, so `backgroundColor`, `border*`, `opacity`, `transform`, `testID` and the accessibility props you pass to `<NitroNumber>` or `<NitroInput>` are silently ignored there. iOS is unaffected. The fix is filed upstream as [margelo/nitro#1655](https://github.com/margelo/nitro/pull/1655) (issue [#1656](https://github.com/margelo/nitro/issues/1656)); until a Nitro release carries it, apply the patch this repo uses: copy [`patches/react-native-nitro-modules@0.37.1.patch`](patches/react-native-nitro-modules@0.37.1.patch) into your app and register it under `patchedDependencies` in `package.json` (Bun) or with [patch-package](https://github.com/ds300/patch-package) (npm / Yarn).

## Credits

The input's reflow is based on [Torph](https://torph.lochie.me) by [Lochie Axon](https://github.com/lochie). Thanks for building it.

NitroNumber's numeric transition follows SwiftUI's `.contentTransition(.numericText())`; it is our own reading of that effect, in the shared engine. [react-native-numeric-text](https://github.com/AmatoGiulio/react-native-numeric-text) by [Giulio Amato](https://github.com/AmatoGiulio) is a native re-implementation of the same effect for React Native `Text`, and the place to go when a whole text should transition rather than a number.

## License

MIT
