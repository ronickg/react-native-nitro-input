# Benchmarks

Measured on 2026‑09‑24 on two phones with the bench app
(`bench/src/bench`, driven from the host by `scripts/bench/run.mjs`): an
**iPhone 11 Pro** (iOS 26.6.1, 60 Hz) and a **Samsung Galaxy A22** (Android
13, 90 Hz, a MediaTek Helio G80: a low-end phone). Slower phones on purpose: a
flagship hides what a library costs. Release builds, React Native 0.87.1,
twelve rolling-number implementations (this library's roll and its numeric
transition among them) and eleven text fields. Every number below is in a
result file in `scripts/bench/results/`, and the tables are what
`scripts/bench/report.mjs` prints from them. Earlier runs, which also had an
iPhone 13 Pro Max, are in `scripts/bench/results/archive/` and this file's git
history.

## At a glance

24 copies of a number, a new value pushed on every JS frame for five measured
seconds. UI = main-thread frames per second and how many the main thread
missed; JS = frames per second the JS thread still managed:

| Implementation | iPhone 11 Pro, 60 Hz | Galaxy A22, 90 Hz |
| --- | --- | --- |
| Text (no animation) | 59.9 fps, 0 dropped, JS 60 | 81.2 fps, 46 dropped, JS 68 |
| AnimateableText (shared value) | 59.9 fps, 0 dropped, JS 60 | 87.8 fps, 13 dropped, JS 46 |
| **Nitro `value` prop** | 59.9 fps, 0 dropped, JS 60 | 72.5 fps, 89 dropped, JS 60 |
| **Nitro `jumpTo`** | 59.9 fps, 0 dropped, JS 60 | 81.4 fps, 45 dropped, JS 76 |
| **Nitro numeric transition** | 59.9 fps, 0 dropped, JS 60 | 73.6 fps, 84 dropped, JS 58 |
| number-animation (native) | 58.9 fps, 5 dropped, JS 60 | 49.7 fps, 203 dropped, JS 17 |
| animated-rolling-numbers | 58.9 fps, 5 dropped, JS 11 | 18.6 fps, 371 dropped, JS 4 |
| NumberFlow View | 46.1 fps, 70 dropped, JS 8 | 24.4 fps, 354 dropped, JS 2 |
| NumberFlow Skia | 53.9 fps, 35 dropped, JS 1 | 30.3 fps, 298 dropped, JS 13 |
| NumberFlow Skia sharedValue | 51.9 fps, 54 dropped, JS 27 | 19.6 fps, 349 dropped, JS 4 |
| NumberBloom (Skia) | 47.8 fps, 63 dropped, JS 2 | 52.5 fps, 189 dropped, JS 8 |
| react-native-ticker | 7.4 fps, 256 dropped, JS 10 | 11.4 fps, 383 dropped, JS 4 |
| AnimatedNumbers | 57.3 fps, 12 dropped, JS 12 | 46.6 fps, 226 dropped, JS 3 |

On the iPhone 11 Pro five rows hold the panel's 60 fps with nothing dropped:
plain text, AnimateableText and all three Nitro paths, the numeric transition
included. On the Galaxy A22, where plain text managed 81 of 90 fps on the day
of this run, `jumpTo` matches plain text with its JS thread at 76 fps, and the
`value` prop and the numeric transition, a React render of 24 components a
frame plus their digits, hold 72–74. Every other library drops frames,
starves the JS thread, or both: a UI thread at 59 fps next to a JS thread at
11 (animated-rolling-numbers on the 11 Pro) is a screen that animates but does
not respond. The per-device tables below add CPU per thread, the ten-a-second
and one-copy cases, a scrolling list, mounting and unmounting, and then the
text fields.

## Method

Everything below comes from `scripts/bench/run.mjs`, which builds the bench
app in release, installs it on each phone, launches it with a plan and collects
what the app reports; the tables are `scripts/bench/report.mjs` over the
result files in `scripts/bench/results/`. Nothing on the host touches the
phone during a run: no accessibility polling, no screen mirroring, no
debugger, no Metro.

- **The stream.** The harness pushes a new value (about seven digits change
  each time) into `count` copies of one implementation, either on every JS
  frame or ten times a second (a live ticker). Each scenario sits mounted and
  idle for 1 s, runs 1.5 s unmeasured (fonts, caches and JIT warm), then 5 s
  measured: 300 frames at 60 Hz, 600 at 120, enough for a frame rate, a
  dropped-frame count and a CPU percentage. The "24 copies, every frame" row
  is the median of three rounds. The light rounds (one copy; ten values a
  second) sit between the heavy ones, and within a round a light library
  alternates with a heavy one, so the chip cools during the light scenarios
  and no library runs hotter than its neighbours.
- **UI fps / dropped / p95** come from a display link on the main thread
  (`CADisplayLink` on iOS, `Choreographer` on Android) inside a small native
  probe module (`modules/bench-probe`). A gap of *n* refresh intervals counts as
  *n − 1* dropped frames; p95 is the 95th percentile gap in ms. The interval is
  the one the display was actually running at: the display link's own
  `targetTimestamp` on iOS, the display mode on Android (checked against the
  steady gap). This is what React Native's own perf monitor measures, and it
  sees stalls inside the process only: Core Animation can still drop frames
  while compositing, which is why there is an Instruments cross-check below.
- **Every frame means the panel's maximum.** A Samsung "adaptive" panel idles
  at 60 Hz until something asks for more, so the probe asks (the fastest
  display mode on Android, a `preferredFrameRateRange` at the maximum on iOS)
  and every library sees the same yardstick: 90 Hz frames on the A22, 60 on
  the iPhone 11 Pro.
- **JS fps** is the pacing of the `requestAnimationFrame` loop that pushes the
  values: how responsive the JS thread stayed under the library's own work.
- **CPU** is per-thread time read by the process about itself
  (`thread_info` on iOS, `/proc/self/task` on Android) at the start and end of
  the measured window, in percent of one core. "main" is the UI thread, "JS
  thread" the React Native JavaScript thread, "RenderThread" HWUI's on Android.
- **Heat is the big one.** Ten seconds of a library at 200 % CPU warms a
  phone; a first attempt at this matrix (10 s windows, no cooling) had the
  iPhone 11 Pro at thermal state "serious", which is where iOS starts
  throttling, after twelve scenarios, and every later row was slower than it
  should have been. So before each scenario the app reads the thermal state
  and, if the phone is throttling ("serious" on iOS, "severe" on Android),
  waits for it to drop back, up to two minutes. "Fair" is elevated but not
  throttled and does not wait. Every result records the state before and after
  its window, and a row that still started throttled is marked ‡ in the
  tables. Low Power Mode / battery saver are recorded too (both cap the frame
  rate); every run below had them off.

### The other measurements

- **Mount and unmount.** 24 numbers (20 fields) rendered in one state update,
  timed from that update to the last one's `onLayout`, then unmounted and
  timed to the second frame after; ten cold passes, medians. Main- and
  JS-thread CPU per pass come from the probe.
- **A scrolling list.** 200 rows of one number in a `FlatList`, scrolled a
  screen's worth back and forth every three seconds by the same loop that
  pushes ten values a second into every row; measured like a stream. The JS
  column includes the list's own scroll handling, the same for every row type.
- **Typing.** The probe types into the focused field one key at a time
  through the path real typing takes (`insertText` on the first responder on
  iOS, the input connection's `commitText` on Android), at 8 and at 15 keys a
  second, and watches the field's text on every following frame. A key whose
  text is rewritten in a later frame is the flicker of a JS round trip: the
  raw digit lands, JS formats, the formatted text comes back a frame or two
  later. The table counts those rewrites per key, how long a key took to
  settle, main- and JS-thread CPU per key, change callbacks JS received per
  key, and frames the main thread dropped while typing. The keyboard is up
  before the first key and is not part of any figure.
- **Focus latency.** `focus()` to `onFocus`, eight runs, medians; the first
  run pays for the keyboard appearing and is listed separately.
- **Memory.** Two ways to leak: 24 copies (20 fields) mounted and unmounted
  40 times, and the 200-row list scrolled for 30 s with values arriving.
  Garbage collectors make a process's memory swing by megabytes, so a floor is
  taken only after a forced collection: on Android the probe runs the Java
  collector and its finalizers (a detached view, and the C++ engine its
  `HybridData` owns, are only freed then), on iOS it asks malloc to return
  freed pages. The tables give the footprint at that start floor and at the
  end floor (the physical footprint on iOS, what Xcode and jetsam count; the
  resident set on Android), the peak in between, a least-squares slope of the
  samples taken every four cycles or every second, and malloc's bytes in use
  at both floors, which is where C++ engines and native views live and where
  the JS heap is not. The list's first six seconds (two scroll periods, every
  row mounted once and the caches warm) are not part of the slope. On Android
  the live `View` count from `dumpsys meminfo` at both floors is the
  decisive column: a detached view that is still alive after a collection is
  held by something. A separate run mounts 100 copies (50 fields) once,
  reads memory after a settled forced collection before and with them, and
  divides the difference by the count: what one copy costs. Three rounds
  interleaved; Android rows are medians, iOS rows the first mount, because
  Fabric hands later mounts the pooled views of the earlier ones. Instruments' Leaks template was meant as the iOS
  cross-check; on these phones it recorded no allocation data (see the memory
  section), so the iOS evidence is the floors.

## What was compared

Every animated-number library on npm that builds against React Native 0.87
with the new architecture, plus two floors:

| Row | Package | How it renders | Fed by |
| --- | --- | --- | --- |
| Text (no animation) | `react-native` | a `<Text>` re-rendered with the formatted value | React render |
| AnimateableText (shared value) | `react-native-animateable-text` 0.19.3 | a native text view whose string is a Reanimated shared value | shared value, no render |
| **Nitro `value` prop** | this library | Core Animation layer wheels / Canvas, one C++ engine | React render, then one JSI call |
| **Nitro `jumpTo`** | this library | same | one JSI call, no render |
| **Nitro numeric transition** | this library | the `value` prop with `transition="numeric"`: each changed digit swaps in place, scaled, faded and blurred (pre-blurred glyph images cross-faded), after SwiftUI | React render, then one JSI call |
| number-animation (native) | `react-native-number-animation` 0.1.5 | a Fabric view with Core Animation / Canvas wheels; React formats and sends the string | React render |
| animated-rolling-numbers | `react-native-animated-rolling-numbers` 2.0.0 | Reanimated, an `Animated.View` per digit | React render |
| NumberFlow View | `number-flow-react-native` 0.5.1 | Reanimated-driven digit views | React render |
| NumberFlow Skia | `number-flow-react-native/skia` | a Skia canvas | React render |
| NumberFlow Skia sharedValue | `number-flow-react-native/skia` | a Skia canvas | shared value, no render |
| NumberBloom (Skia) | `react-native-number-bloom` 1.1.7 | a Skia canvas, Reanimated worklets; snaps and blooms rather than rolls | React render |
| react-native-ticker | `react-native-ticker` 6.0.1 | Reanimated, a column of ten `<Text>`s per digit | React render |
| AnimatedNumbers | `react-native-animated-numbers` 0.6.3 | the Animated API with the native driver; integer-only, so it is fed cents | React render |

Every library that takes a duration gets 500 ms; the number is `4,321.09`
climbing with cents that tick every push and thousands that drift, formatted
with two decimals and grouping, bold, 44 pt for one copy and 22 pt for 24.
React Native 0.87.1, Reanimated 4.6.0, Worklets 0.12.2, Skia 2.12.0, release
builds, Hermes.

Not in the tables: `react-native-animated-number` (2021, tweens a number by
re-rendering), `react-native-countup-component`, `react-native-rolling-number-ticker`
(single-digit weekly downloads, no new-architecture support).

## iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | UI fps | dropped | p95 ms | JS fps | process CPU | main | JS thread | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 59.9 | 0 | 17 | 59.9 | 40 % | 23 % | 16 % | 3 |
| AnimateableText (shared value) | 59.9 | 0 | 17 | 59.9 | 39 % | 37 % | 1 % | 3 |
| **Nitro `value` prop** | 59.9 | 0 | 17 | 59.9 | 44 % | 11 % | 33 % | 3 |
| **Nitro `jumpTo`** | 59.9 | 0 | 17 | 59.9 | 23 % | 17 % | 5 % | 3 |
| **Nitro numeric transition** | 59.9 | 0 | 17 | 59.9 | 47 % | 23 % | 23 % | 3 |
| number-animation (native) | 58.9 | 5 | 17 | 59.9 | 148 % | 91 % | 53 % | 3 |
| animated-rolling-numbers | 58.9 | 5 | 17 | 10.6 | 177 % | 72 % | 99 % | 3 |
| NumberFlow View | 46.1 | 70 | 48 | 8.3 | 185 % | 77 % | 99 % | 3 |
| NumberFlow Skia | 53.9 | 35 | 33 | 1.2 | 189 % | 85 % | 47 % | 3 |
| NumberFlow Skia sharedValue | 51.9 | 54 | 34 | 27.0 | 147 % | 83 % | 28 % | 3 |
| NumberBloom (Skia) | 47.8 | 63 | 41 | 2.4 | 219 % | 79 % | 59 % | 3 |
| react-native-ticker | 7.4 | 256 | 230 | 10.1 | 204 % | 98 % | 98 % | 3 |
| AnimatedNumbers | 57.3 | 12 | 17 | 11.7 | 180 % | 48 % | 99 % | 3 |

| Implementation | UI fps | dropped | p95 ms | JS fps | process CPU | main | JS thread | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 59.9 | 0 | 17 | 59.3 | 37 % | 18 % | 19 % | 1 |
| AnimateableText (shared value) | 59.9 | 0 | 17 | 59.9 | 29 % | 26 % | 2 % | 1 |
| **Nitro `value` prop** | 59.9 | 0 | 17 | 59.9 | 41 % | 21 % | 18 % | 1 |
| **Nitro `jumpTo`** | 59.9 | 0 | 17 | 59.9 | 8 % | 5 % | 3 % | 1 |
| **Nitro numeric transition** | 59.9 | 0 | 17 | 59.9 | 44 % | 34 % | 9 % | 1 |
| number-animation (native) | 59.9 | 0 | 17 | 59.9 | 36 % | 20 % | 14 % | 1 |
| animated-rolling-numbers | 58.9 | 5 | 17 | 18.0 | 155 % | 68 % | 83 % | 1 |
| NumberFlow View | 47.6 | 65 | 42 | 5.0 | 175 % | 69 % | 99 % | 1 |
| NumberFlow Skia | 56.6 | 20 | 25 | 1.2 | 200 % | 82 % | 55 % | 1 |
| NumberFlow Skia sharedValue | 50.3 | 64 | 41 | 25.5 | 139 % | 77 % | 26 % | 1 |
| NumberBloom (Skia) | 47.6 | 66 | 41 | 2.4 | 222 % | 78 % | 62 % | 1 |
| react-native-ticker | 7.0 | 258 | 192 | 13.1 | 196 % | 99 % | 90 % | 1 |
| AnimatedNumbers | 57.7 | 11 | 17 | 18.7 | 149 % | 43 % | 81 % | 1 |

| Implementation | UI fps | dropped | p95 ms | JS fps | process CPU | main | JS thread | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 59.9 | 0 | 17 | 59.9 | 46 % | 15 % | 28 % | 1 |
| AnimateableText (shared value) | 59.9 | 0 | 17 | 59.9 | 43 % | 37 % | 4 % | 1 |
| **Nitro `value` prop** | 59.9 | 0 | 17 | 59.7 | 43 % | 10 % | 30 % | 1 |
| **Nitro `jumpTo`** | 59.9 | 0 | 17 | 59.9 | 12 % | 6 % | 3 % | 1 |
| **Nitro numeric transition** | 59.9 | 0 | 17 | 59.9 | 47 % | 14 % | 31 % | 1 |
| number-animation (native) | 59.9 | 0 | 17 | 59.9 | 47 % | 19 % | 26 % | 1 |
| animated-rolling-numbers | 59.9 | 0 | 17 | 59.9 | 47 % | 11 % | 34 % | 1 |
| NumberFlow View | 59.9 | 0 | 17 | 59.9 | 51 % | 17 % | 32 % | 1 |
| NumberFlow Skia | 60.3 | 1 | 17 | 60.5 | 86 % | 13 % | 59 % | 1 |
| NumberFlow Skia sharedValue | 59.9 | 0 | 17 | 57.5 | 34 % | 24 % | 9 % | 1 |
| NumberBloom (Skia) | 30.2 | 147 | 69 | 59.9 | 81 % | 14 % | 50 % | 1 |
| react-native-ticker | 59.9 | 0 | 17 | 59.9 | 58 % | 34 % | 22 % | 1 |
| AnimatedNumbers | 59.9 | 0 | 17 | 59.9 | 52 % | 10 % | 33 % | 1 |

A 2019 chip at 60 Hz. Five rows hold 60 fps with nothing dropped at 24
copies: plain text, AnimateableText and all three Nitro paths. The Nitro
`value` prop costs less main thread than re-rendering 24 plain `<Text>`s
(11 % against 23 %), `jumpTo` runs the whole screen on 23 % of a core with the
JS thread nearly idle, and the numeric transition, which swaps and blurs every
changed digit, holds the same 60 fps on 23 % of the main thread.
number-animation holds 59 fps but pins the main thread at 91 % to do it. The
View, Skia and Bloom renderers drop between one in ten and one in five frames
with the JS thread at 1–27 frames a second; animated-rolling-numbers and
AnimatedNumbers keep the UI thread near 60 only by running the JS thread at
11–12.

Ten values a second is the live-ticker case: every light row holds 60, and
`jumpTo` runs the whole screen at 8 % of a core.

## Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | UI fps | dropped | p95 ms | JS fps | process CPU | main | JS thread | RenderThread | HWUI janky (of frames drawn) | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 81.2 | 46 | 22 | 67.9 | 208 % | 62 % | 78 % | 44 % | 81 % of 304 | 3 |
| AnimateableText (shared value) | 87.8 | 13 | 11 | 45.6 | 139 % | 76 % | 8 % | 38 % | 97 % of 218 | 3 |
| **Nitro `value` prop** | 72.5 | 89 | 22 | 60.5 | 194 % | 44 % | 82 % | 56 % | 98 % of 364 | 3 |
| **Nitro `jumpTo`** | 81.4 | 45 | 22 | 75.8 | 121 % | 43 % | 8 % | 53 % | 82 % of 381 | 3 |
| **Nitro numeric transition** | 73.6 | 84 | 22 | 58.4 | 188 % | 49 % | 75 % | 50 % | 99 % of 367 | 3 |
| number-animation (native) | 49.7 | 203 | 44 | 17.1 | 271 % | 84 % | 99 % | 51 % | 100 % of 250 | 3 |
| animated-rolling-numbers | 18.6 | 371 | 88 | 3.6 | 257 % | 90 % | 99 % | 37 % | 100 % of 91 | 3 |
| NumberFlow View | 24.4 | 354 | 133 | 2.2 | 239 % | 86 % | 98 % | 34 % | 100 % of 41 | 3 |
| NumberFlow Skia | 30.3 | 298 | 100 | 13.4 | 261 % | 73 % | 93 % | 20 % | 89 % of 133 | 3 |
| NumberFlow Skia sharedValue | 19.6 | 349 | 177 | 3.9 | 171 % | 69 % | 35 % | 19 % | 94 % of 70 | 3 |
| NumberBloom (Skia) | 52.5 | 189 | 33 | 8.2 | 185 % | 62 % | 53 % | 24 % | 71 % of 144 | 3 |
| react-native-ticker | 11.4 | 383 | 254 | 3.7 | 233 % | 92 % | 95 % | 23 % | 100 % of 51 | 3 |
| AnimatedNumbers | 46.7 | 226 | 33 | 3.2 | 273 % | 64 % | 97 % | 60 % | 100 % of 226 | 3 |

| Implementation | UI fps | dropped | p95 ms | JS fps | process CPU | main | JS thread | RenderThread | HWUI janky (of frames drawn) | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 81.4 | 45 | 22 | 55.0 | 87 % | 32 % | 41 % | 8 % | 100 % of 49 | 1 |
| AnimateableText (shared value) | 64.4 | 129 | 44 | 60.9 | 69 % | 50 % | 4 % | 9 % | 100 % of 51 | 1 |
| **Nitro `value` prop** | 77.4 | 65 | 22 | 53.8 | 149 % | 45 % | 36 % | 54 % | 97 % of 388 | 1 |
| **Nitro `jumpTo`** | 90.2 | 1 | 11 | 87.4 | 63 % | 22 % | 8 % | 26 % | 90 % of 104 | 1 |
| **Nitro numeric transition** | 69.8 | 103 | 22 | 53.1 | 157 % | 47 % | 34 % | 59 % | 100 % of 350 | 1 |
| number-animation (native) | 60.0 | 153 | 33 | 27.3 | 214 % | 61 % | 59 % | 55 % | 99 % of 304 | 1 |
| animated-rolling-numbers | 18.2 | 364 | 88 | 3.7 | 256 % | 91 % | 99 % | 37 % | 100 % of 86 | 1 |
| NumberFlow View | 30.5 | 299 | 122 | 2.2 | 235 % | 83 % | 97 % | 33 % | 100 % of 35 | 1 |
| NumberFlow Skia | 29.7 | 305 | 100 | 11.5 | 253 % | 74 % | 92 % | 20 % | 84 % of 120 | 1 |
| NumberFlow Skia sharedValue | 25.9 | 312 | 155 | 3.3 | 172 % | 70 % | 37 % | 20 % | 91 % of 76 | 1 |
| NumberBloom (Skia) | 49.4 | 205 | 44 | 8.5 | 199 % | 62 % | 56 % | 26 % | 79 % of 141 | 1 |
| react-native-ticker | 11.8 | 408 | 221 | 3.8 | 233 % | 93 % | 97 % | 23 % | 100 % of 51 | 1 |
| AnimatedNumbers | 46.4 | 228 | 33 | 3.0 | 278 % | 63 % | 97 % | 62 % | 99 % of 231 | 1 |

| Implementation | UI fps | dropped | p95 ms | JS fps | process CPU | main | JS thread | RenderThread | HWUI janky (of frames drawn) | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 82.8 | 38 | 22 | 78.8 | 148 % | 27 % | 56 % | 46 % | 67 % of 376 | 1 |
| AnimateableText (shared value) | 83.4 | 35 | 22 | 77.5 | 122 % | 53 % | 9 % | 45 % | 71 % of 376 | 1 |
| **Nitro `value` prop** | 76.9 | 67 | 22 | 69.7 | 133 % | 18 % | 49 % | 47 % | 94 % of 383 | 1 |
| **Nitro `jumpTo`** | 75.5 | 74 | 22 | 73.5 | 79 % | 14 % | 4 % | 46 % | 80 % of 362 | 1 |
| **Nitro numeric transition** | 79.2 | 56 | 22 | 68.3 | 130 % | 17 % | 49 % | 48 % | 95 % of 398 | 1 |
| number-animation (native) | 78.6 | 59 | 22 | 59.8 | 169 % | 37 % | 61 % | 49 % | 100 % of 394 | 1 |
| animated-rolling-numbers | 73.1 | 86 | 22 | 64.0 | 205 % | 45 % | 79 % | 53 % | 93 % of 363 | 1 |
| NumberFlow View | 77.6 | 64 | 22 | 53.4 | 222 % | 57 % | 86 % | 56 % | 77 % of 329 | 1 |
| NumberFlow Skia | 87.8 | 13 | 11 | 20.8 | 211 % | 56 % | 93 % | 0 % | 0 % of 0 | 1 |
| NumberFlow Skia sharedValue | 89.6 | 4 | 11 | 50.4 | 97 % | 61 % | 18 % | 0 % | 0 % of 0 | 1 |
| NumberBloom (Skia) | 81.5 | 47 | 22 | 5.1 | 201 % | 69 % | 48 % | 46 % | 66 % of 409 | 1 |
| react-native-ticker | 64.0 | 132 | 22 | 50.7 | 186 % | 45 % | 74 % | 50 % | 98 % of 315 | 1 |
| AnimatedNumbers | 83.2 | 36 | 22 | 50.3 | 230 % | 43 % | 95 % | 47 % | 75 % of 374 | 1 |

A low-end phone: a MediaTek Helio G80 (two A75 cores, six A55) driving a
90 Hz panel, so the frame budget is 11 ms and everything costs more. It ran
slower on the day of this run than on 2026‑09‑22 (plain text at 24 copies
81 fps against 89), and that moves every row alike: the old and the new
Android drawing code run back to back the same afternoon put the new one
ahead (the `value` prop 73–77 fps against 73–74, `jumpTo` 80–84 against
74–80 on 102–119 % of a core against 121–129 %) with plain text level in
both. At 24 copies `jumpTo` matches plain text at 81 fps with its JS thread at
76; the `value` prop and the numeric transition hold 72–74, the React render
of 24 components a frame (the same 78–82 % of the JS thread plain text needs)
plus their digits. Every other library is at 11–53 fps with the JS thread at
2–17 frames a second; number-animation, native as well, is at 50 fps with the
JS thread saturated.

At ten values a second `jumpTo` holds 90 fps with one frame dropped, while
the rows that re-render with React still drop 45–103, and that is the phone,
not the harness: with little to do, the governor drops the cores to idle
clocks, and the React commit that lands every 100 ms then takes longer than
an 11 ms frame. HWUI's own accounting (the last column, from `dumpsys
gfxinfo`) counts a frame as "janky" when it missed its deadline, and on this
chip a frame that reaches the display one vsync late still counts, so the
column runs high for every row.

At one copy every row sits between 64 and 90 fps and the CPU column is what
separates them: `jumpTo` at 79 % of a core is among the lowest, most of the
Skia and Reanimated libraries at 190–230 %.

## The list

A market screen is a list, so this is 200 rows of one number in a
`FlatList`, scrolled a screen's worth back and forth every three seconds
while ten values a second arrive in every row; rows mount and unmount as
they scroll through the window. The harness's own cost is the list's scroll
handling on the JS thread, the same for every row type: on the Galaxy A22
it alone holds the JS thread at 14–35 frames a second, which is why the
Android JS column is low for everyone there.

The roll keeps the list at the panel's rate on the iPhone 11 Pro (60 fps with
nothing dropped, the `value` prop and `jumpTo` alike) and leads on the Android
phone (79 fps for `jumpTo` and 67 for the `value` prop against plain text's 59,
because a re-rendered `<Text>` is re-measured on every update and a Nitro
number is not). The numeric transition draws more for every changed digit and
costs it here: 56 fps with 19 dropped on the 11 Pro, 65 on the A22. The other
libraries mostly fall apart in a list: number-animation to 34 fps on the
11 Pro, animated-rolling-numbers to 23–38, NumberFlow View to under one frame
a second on the 11 Pro with a JS thread at 0.3, the NumberFlow Skia renderers
to 30–45, because each row mounting on the way in is a whole digit tree or a
canvas to create, on top of the updates. NumberBloom holds 56 on the 11 Pro
and 84 on the A22, with its JS thread at 1 frame a second.

#### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | UI fps | dropped | p95 ms | JS fps | process CPU | main | JS thread | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 59.9 | 0 | 17 | 57.7 | 63 % | 24 % | 38 % | 1 |
| AnimateableText (shared value) | 59.9 | 0 | 17 | 59.9 | 55 % | 32 % | 22 % | 1 |
| **Nitro `value` prop** | 59.9 | 0 | 17 | 58.4 | 70 % | 27 % | 42 % | 1 |
| **Nitro `jumpTo`** | 59.9 | 0 | 17 | 59.5 | 52 % | 20 % | 31 % | 1 |
| **Nitro numeric transition** | 56.1 | 19 | 30 | 52.3 | 143 % | 91 % | 51 % | 1 |
| number-animation (native) | 33.9 | 130 | 69 | 35.6 | 137 % | 74 % | 60 % | 1 |
| animated-rolling-numbers | 23.0 | 182 | 143 | 2.5 | 191 % | 88 % | 97 % | 1 |
| NumberFlow View | 0.4 | 310 | 2586 | 0.3 | 204 % | 100 % | 99 % | 1 |
| NumberFlow Skia | 45.0 | 83 | 50 | 0.7 | 203 % | 79 % | 80 % | 1 |
| NumberFlow Skia sharedValue | 39.2 | 135 | 75 | 0.9 | 173 % | 76 % | 65 % | 1 |
| NumberBloom (Skia) | 56.2 | 19 | 20 | 0.8 | 176 % | 57 % | 82 % | 1 |
| react-native-ticker | 11.7 | 241 | 392 | 7.5 | 188 % | 89 % | 92 % | 1 |
| AnimatedNumbers | 24.0 | 166 | 186 | 7.3 | 210 % | 88 % | 95 % | 1 |

#### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | UI fps | dropped | p95 ms | JS fps | process CPU | main | JS thread | RenderThread | HWUI janky (of frames drawn) | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 59.1 | 155 | 55 | 14.0 | 182 % | 60 % | 85 % | 21 % | 94 % of 124 | 1 |
| AnimateableText (shared value) | 60.3 | 152 | 44 | 19.7 | 187 % | 69 % | 79 % | 26 % | 95 % of 143 | 1 |
| **Nitro `value` prop** | 67.1 | 116 | 33 | 16.2 | 209 % | 58 % | 99 % | 36 % | 91 % of 251 | 1 |
| **Nitro `jumpTo`** | 78.7 | 59 | 22 | 34.6 | 198 % | 52 % | 88 % | 43 % | 82 % of 278 | 1 |
| **Nitro numeric transition** | 65.0 | 126 | 33 | 17.4 | 223 % | 58 % | 99 % | 43 % | 96 % of 249 | 1 |
| number-animation (native) | 61.4 | 148 | 44 | 8.4 | 202 % | 63 % | 97 % | 23 % | 94 % of 128 | 1 |
| animated-rolling-numbers | 37.9 | 277 | 100 | 0.5 | 205 % | 82 % | 98 % | 7 % | 100 % of 46 | 1 |
| NumberFlow View | 46.9 | 254 | 22 | 0.3 | 198 % | 66 % | 95 % | 6 % | 95 % of 41 | 1 |
| NumberFlow Skia | 35.2 | 271 | 155 | 6.6 | 200 % | 67 % | 95 % | 14 % | 97 % of 38 | 1 |
| NumberFlow Skia sharedValue | 30.0 | 322 | 188 | 6.0 | 184 % | 74 % | 77 % | 14 % | 95 % of 43 | 1 |
| NumberBloom (Skia) | 84.4 | 67 | 11 | 1.0 | 138 % | 25 % | 96 % | 5 % | 92 % of 59 | 1 |
| react-native-ticker | 27.1 | 322 | 144 | 1.1 | 223 % | 88 % | 99 % | 8 % | 98 % of 51 | 1 |
| AnimatedNumbers | 61.1 | 145 | 22 | 2.7 | 233 % | 71 % | 99 % | 11 % | 90 % of 72 | 1 |

## Mount and unmount

24 numbers rendered in one state update, timed to the last one's first
`onLayout`, then unmounted and timed to the second frame after; ten cold
passes, medians, with the main- and JS-thread CPU each pass cost. Unmount
is two frames for everyone that keeps the JS thread free (the 31–32 ms is
the two-frame wait, not work) and longer only where the JS thread is busy
tearing a digit tree down.

Mounting is where a native view pays for being native: a Nitro
`HybridView` is a Swift or Kotlin object, a native view, a C++ engine and
fonts to create, where a `<Text>` is a string. On the iPhone 11 Pro the 24
numbers mount in 28–34 ms against 17 ms for plain text, 14–15 ms of main-thread
time for all 24; on the Galaxy A22 in 158–172 ms against 99. That is faster
than number-animation, the other native library (86 ms and 259 ms), and a
fraction of what the Reanimated digit trees cost (animated-rolling-numbers,
NumberFlow View, react-native-ticker: 180–400 ms on the 11 Pro, 1–2 s on the
A22, most of it JavaScript). The Skia renderers mount their canvases quickly
on the 11 Pro and then spend 480–550 ms of JS-thread time per pass warming
them up; on the A22 two of them did not finish a pass inside the five-second
limit.

The number to keep in mind: 24 rolling numbers cost about 11–18 ms of extra
mount time on an iPhone 11 Pro, once, and nothing after that. For a list that
mounts rows as they scroll, the list section above is the measurement that
matters, and there the same views are the ones that keep the list at the
panel's rate.

#### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | mount ms | min | max | unmount ms | main-thread ms | JS-thread ms | runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 16.6 | 15.7 | 58.9 | 31.6 | 7.1 | 14.0 | 1 |
| AnimateableText (shared value) | 28.6 | 25.5 | 65.9 | 31.0 | 10.1 | 30.9 | 1 |
| **Nitro `value` prop** | 34.4 | 26.9 | 98.1 | 31.5 | 14.2 | 34.5 | 1 |
| **Nitro `jumpTo`** | 28.1 | 25.2 | 95.4 | 31.5 | 15.3 | 27.9 | 1 |
| **Nitro numeric transition** | 29.8 | 10.6 | 96.9 | 31.4 | 14.7 | 28.5 | 1 |
| number-animation (native) | 86.2 | 50.0 | 90.3 | 30.2 | 63.6 | 37.4 | 1 |
| animated-rolling-numbers | 270.1 | 261.1 | 310.7 | 65.6 | 147.0 | 314.1 | 1 |
| NumberFlow View | 399.6 | 335.6 | 424.4 | 166.2 | 225.6 | 552.0 | 1 |
| NumberFlow Skia | 80.2 | 54.0 | 111.6 | 64.6 | 248.0 | 497.2 | 1 |
| NumberFlow Skia sharedValue | 101.7 | 29.3 | 155.0 | 81.1 | 256.4 | 553.9 | 1 |
| NumberBloom (Skia) | 112.9 | 44.0 | 118.5 | 64.6 | 199.2 | 475.5 | 1 |
| react-native-ticker | 184.2 | 171.0 | 194.5 | 65.6 | 68.5 | 203.0 | 1 |
| AnimatedNumbers | 89.5 | 86.5 | 120.9 | 32.2 | 12.2 | 88.0 | 1 |

#### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | mount ms | min | max | unmount ms | main-thread ms | JS-thread ms | runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 98.5 | 60.2 | 201.5 | 152.2 | 150.0 | 90.0 | 1 |
| AnimateableText (shared value) | 129.9 | 68.4 | 162.2 | 138.4 | 140.0 | 160.0 | 1 |
| **Nitro `value` prop** | 171.9 | 34.1 | 241.0 | 145.1 | 230.0 | 190.0 | 1 |
| **Nitro `jumpTo`** | 158.2 | 86.1 | 197.5 | 142.0 | 260.0 | 170.0 | 1 |
| **Nitro numeric transition** | 169.4 | 79.0 | 231.7 | 154.9 | 260.0 | 180.0 | 1 |
| number-animation (native) | 258.8 | 159.3 | 287.7 | 146.9 | 210.0 | 220.0 | 1 |
| animated-rolling-numbers | 1951.5 | 1822.1 | 2785.2 | 390.7 | 1690.0 | 2400.0 | 1 |
| NumberFlow View | 1720.6 | 1495.8 | 1989.0 | 477.5 | 2210.0 | 1980.0 | 1 |
| NumberFlow Skia | timed out | 44.8 | timed out | 183.7 | 760.0 | 750.0 | 1 |
| NumberFlow Skia sharedValue | timed out | 29.3 | timed out | 256.2 | 2250.0 | 2730.0 | 1 |
| NumberBloom (Skia) | 184.9 | 121.4 | timed out | 288.8 | 320.0 | 490.0 | 1 |
| react-native-ticker | 957.9 | 853.2 | 1188.1 | 308.1 | 910.0 | 1210.0 | 1 |
| AnimatedNumbers | 790.8 | 733.6 | 833.8 | 255.1 | 1090.0 | 800.0 | 1 |

## Memory

Two ways for a rolling number to leak: the copies it leaves behind when a
screen unmounts, and the rows a list drops as it scrolls. The first is 24
copies (20 fields) mounted and unmounted 40 times; the second is the list
from the list section scrolling for 30 s with ten values a second arriving.
Both are read as floors after a forced collection (the method section has
the details), so the tables say what stayed allocated, not what was waiting
for a collector. They run as a plan of their own, in a fresh process: run at
the end of the full matrix, after an hour of other scenarios in the same
process, every library's floor climbed with the process's footprint (those
results are kept in `scripts/bench/results/archive/`).

What we found, and fixed, first. Before this round a mount/unmount loop on
the Galaxy A22 left every Nitro copy alive: 24 more live `View`s a cycle in
`dumpsys meminfo`, about a megabyte of resident memory a cycle, linear for
as long as the loop ran, and the same for the fields of
`react-native-nitro-input`. The cause is how a Nitro view lives: the Kotlin
or Swift object behind it is held by its C++ part until the JavaScript
handle from `hybridRef` is garbage-collected, and Hermes collects a handle it
takes for an empty object only when the JS heap fills up, which a quiet
screen never does. On Android the hybrid held the platform view, so the
view, its display list and its digit-strip texture lived on with it. The
library now lets go of the view when Fabric drops it (unless Fabric is
recycling it), shares the digit strips between every rolling number drawn
with the same font, and tells Nitro how much memory each handle stands for;
on iOS, where Fabric pools the component view and reuses it, a drop releases
the display link, the layers and the engine's wheels. With that, the live
`View` count on the A22 is flat for all of this library's components (the
count climbs by one per scenario across the plan, 104 to 127: that is the
harness's own stage view), and the floors below are what remains.

**Mount and unmount.** After 40 cycles the Nitro number's footprint is where
it started on both phones, whichever transition: 143 → 140 MB (the `value`
prop), 115 → 124 (`jumpTo`) and 117 → 131 (numeric) on the 11 Pro, 453 → 427,
382 → 407 and 394 → 422 on the A22, where the live `View` count stays flat.
Plain text moves by the same few megabytes (29 → 37, 253 → 268). The fields
are the same story: NitroInput, plain and reflowing, ends within 6–17 MB of
where it began on the 11 Pro and within 4–64 MB either way on the A22,
alongside `TextInput` (244 → 247 and 1303 → 1353 MB). The libraries that leave
something behind are the digit trees: react-native-ticker grows by 2 MB a
cycle on the 11 Pro and 23 MB a cycle on the A22 (157 → 300 MB and
431 → 1429 MB in 40 cycles), animated-rolling-numbers by 3–16 MB a cycle
(151 → 268, 624 → 1345), NumberFlow View by 1.6–1.9 MB (32 → 193,
261 → 484) and the Reanimated text by about 1 MB (130 → 163, 407 → 442).
Whether that is a leak or garbage a collector will take later, a floor cannot
say for certain on iOS, where there is no collector to force; a flat floor,
which is what this library's components show, is the stronger statement
either way.

**The scrolling list.** Rows mount and unmount as the list scrolls; anything
a row keeps alive shows as a footprint that keeps rising after the first six
seconds. On the iPhone 11 Pro the Nitro number's does not: −1.8 MB/s for the
`value` prop (742 → 735 MB), −1.2 for the numeric transition, +1.7 for
`jumpTo`, where animated-rolling-numbers and NumberFlow View climb 10–14 MB/s.
On the A22 the list is where the method meets its limit: the footprint rose
for the whole 30 s for most rows, ours included (`jumpTo` 1.5 MB/s, the
`value` prop 6.4, the numeric transition 11.5, from 988 to 1258 MB), as it
did for the Reanimated text (9.0), react-native-ticker (7.0) and
AnimatedNumbers (6.6), while plain text rose 1.4. That is the garbage of a
list of native views arriving faster than it is collected: React keeps a
handle to each old version of a row's shadow node until its collector runs,
and each version carries the row's props; the Nitro rows allocate little in
JavaScript and so bring few collections. The run of 2026‑09‑22 saw the same
on this phone (the `value` prop at 8.1 MB/s), and the mount/unmount floors
above, read after a forced collection, show nothing kept. A list that pushes
ten values a second into a hundred mounted native rows is a stress case; it is
the one where a low-end phone shows how late a collector can be.

**What one copy costs.** The tables below this section come from a
different run: 100 numbers (50 fields) mounted at once, memory read after a
forced collection before and with them, the difference divided by the
count, three rounds interleaved on Android. The method has a floor of its
own: a round differs from the next by up to 50 KB a copy, the first round
after launch carries one-time costs (font caches, glyph atlases, shaders),
and on iOS Fabric hands a later mount the pooled views of an earlier one, so
only the first mount there measures a copy (and the reflowing field, mounted
after the plain one, reuses its views). With that read, a mounted Nitro
number is about 51 KB on the Galaxy A22 (56 KB of malloc and 13 KB of Java
heap, the median of three) and 77 KB cold on the iPhone, where plain `Text`
costs 127 KB because its layer backing store is redrawn on every mount. A
NitroInput field is about 36 KB on the A22 and 141 KB cold on the iPhone, a
`TextInput` 54 and 95; the reflowing field measured 137 KB on the A22 in this
run, within the method's spread of the plain one in earlier runs (a native
heap profile on the A22 put the difference at about 27 KB of malloc, Hermes
and Fabric objects rather than the glyph engine). These are the figures
behind the `memorySize` the hybrids report to Nitro, 64 KB for a number and
96 KB for a field: what the JS garbage collector is told a handle stands for,
to the nearest order of magnitude, which is what the hint is for.

**What is not here.** Instruments' Leaks template was to be the iOS
cross-check (`scripts/bench/leaks.mjs` records this library's four
components under it); on these phones with this Xcode the recording comes
back with process and thread tables and no allocation data, launched by
Instruments or attached to a running app, so there is no leaks table to
show. The evidence for iOS is the floors above; for Android it is the floors
and the live `View` count, which is the one figure a collector cannot
flatter.

### Mount and unmount cycles

#### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | footprint, start | footprint, end | peak | growth per cycle | malloc heap, start → end | runs |
| --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 28.8 MB | 36.5 MB | 38.0 MB | +76.8 KB | 14.2 → 20.0 MB | 1 |
| AnimateableText (shared value) | 130.0 MB | 162.6 MB | 162.6 MB | +733.2 KB | 78.2 → 90.3 MB | 1 |
| **Nitro `value` prop** | 142.9 MB | 140.3 MB | 146.8 MB | -58.6 KB | 69.2 → 66.3 MB | 1 |
| **Nitro `jumpTo`** | 115.1 MB | 124.4 MB | 124.4 MB | +226.6 KB | 59.3 → 69.8 MB | 1 |
| **Nitro numeric transition** | 116.7 MB | 131.0 MB | 131.0 MB | +259.4 KB | 61.0 → 78.0 MB | 1 |
| number-animation (native) | 292.1 MB | 294.3 MB | 298.6 MB | -56.7 KB | 318.6 → 311.5 MB | 1 |
| animated-rolling-numbers | 150.8 MB | 267.9 MB | 357.4 MB | +2887.6 KB | 99.7 → 111.5 MB | 1 |
| NumberFlow View | 32.1 MB | 193.0 MB | 193.0 MB | +1570.6 KB | 20.2 → 79.8 MB | 1 |
| NumberFlow Skia | 140.0 MB | 123.9 MB | 140.0 MB | -383.2 KB | 66.5 → 59.2 MB | 1 |
| NumberFlow Skia sharedValue | 294.7 MB | 180.9 MB | 294.7 MB | -1152.8 KB | 309.3 → 77.6 MB | 1 |
| NumberBloom (Skia) | 123.7 MB | 155.5 MB | 158.8 MB | +410.0 KB | 70.1 → 60.7 MB | 1 |
| react-native-ticker | 157.0 MB | 300.2 MB | 530.0 MB | +2013.2 KB | 90.2 → 318.2 MB | 1 |
| AnimatedNumbers | 162.8 MB | 168.1 MB | 206.9 MB | -661.5 KB | 77.9 → 103.3 MB | 1 |

#### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | footprint, start | footprint, end | peak | growth per cycle | malloc heap, start → end | live Views, start → end | runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 253.0 MB | 267.6 MB | 273.6 MB | +307.0 KB | 27.7 → 35.3 MB | 104 → 105 | 1 |
| AnimateableText (shared value) | 406.9 MB | 442.2 MB | 442.2 MB | +947.2 KB | 106.6 → 140.7 MB | 111 → 112 | 1 |
| **Nitro `value` prop** | 452.5 MB | 426.9 MB | 452.5 MB | -452.9 KB | 108.0 → 104.0 MB | 106 → 107 | 1 |
| **Nitro `jumpTo`** | 381.8 MB | 407.4 MB | 407.4 MB | +602.0 KB | 78.2 → 96.8 MB | 108 → 109 | 1 |
| **Nitro numeric transition** | 394.3 MB | 422.3 MB | 422.3 MB | +594.9 KB | 96.1 → 115.9 MB | 110 → 111 | 1 |
| number-animation (native) | 1356.8 MB | 1415.2 MB | 1415.2 MB | +1165.4 KB | 802.0 → 851.6 MB | 113 → 114 | 1 |
| animated-rolling-numbers | 623.7 MB | 1345.3 MB | 1375.3 MB | +16376.3 KB | 208.1 → 882.8 MB | 116 → 117 | 1 |
| NumberFlow View | 261.0 MB | 484.1 MB | 528.1 MB | +1892.1 KB | 28.2 → 135.5 MB | 105 → 106 | 1 |
| NumberFlow Skia | 418.1 MB | 403.2 MB | 418.1 MB | +174.7 KB | 102.7 → 96.5 MB | 107 → 108 | 1 |
| NumberFlow Skia sharedValue | 1398.7 MB | 624.7 MB | 1398.7 MB | -10784.6 KB | 838.7 → 195.5 MB | 114 → 115 | 1 |
| NumberBloom (Skia) | 394.5 MB | 416.9 MB | 420.8 MB | +756.0 KB | 88.8 → 118.7 MB | 109 → 110 | 1 |
| react-native-ticker | 430.7 MB | 1428.6 MB | 1485.9 MB | +22949.8 KB | 137.5 → 822.5 MB | 112 → 113 | 1 |
| AnimatedNumbers | 613.7 MB | 673.8 MB | 1132.3 MB | +4829.5 KB | 182.1 → 225.9 MB | 115 → 116 | 1 |

### A list scrolling for 30 seconds

#### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | footprint, start | footprint, end | peak | growth per second | malloc heap, start → end | runs |
| --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 300.3 MB | 305.4 MB | 310.8 MB | +18.6 KB | 157.1 → 152.5 MB | 1 |
| AnimateableText (shared value) | 329.2 MB | 342.3 MB | 345.6 MB | +600.0 KB | 234.8 → 269.4 MB | 1 |
| **Nitro `value` prop** | 741.6 MB | 734.6 MB | 1052.3 MB | -1765.2 KB | 339.9 → 379.6 MB | 1 |
| **Nitro `jumpTo`** | 322.6 MB | 358.7 MB | 359.5 MB | +1714.2 KB | 194.0 → 208.4 MB | 1 |
| **Nitro numeric transition** | 348.2 MB | 324.9 MB | 350.2 MB | -1214.8 KB | 203.9 → 205.9 MB | 1 |
| number-animation (native) | 476.2 MB | 430.0 MB | 505.8 MB | -2977.5 KB | 243.6 → 259.7 MB | 1 |
| animated-rolling-numbers | 676.6 MB | 817.5 MB | 1006.1 MB | +10171.8 KB | 374.4 → 312.8 MB | 1 |
| NumberFlow View | 786.3 MB | 1090.2 MB | 1090.2 MB | +13844.0 KB | 473.5 → 607.1 MB | 1 |
| NumberFlow Skia | 398.8 MB | 379.4 MB | 615.1 MB | -1405.0 KB | 197.3 → 177.6 MB | 1 |
| NumberFlow Skia sharedValue | 629.8 MB | 778.6 MB | 782.6 MB | +3597.4 KB | 257.0 → 273.3 MB | 1 |
| NumberBloom (Skia) | 329.1 MB | 321.1 MB | 425.1 MB | -519.4 KB | 175.1 → 175.4 MB | 1 |
| react-native-ticker | 659.3 MB | 565.6 MB | 955.2 MB | -4080.7 KB | 362.3 → 318.4 MB | 1 ‡ |
| AnimatedNumbers | 689.3 MB | 629.7 MB | 821.5 MB | -3452.6 KB | 278.2 → 317.5 MB | 1 ‡ |

#### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | footprint, start | footprint, end | peak | growth per second | malloc heap, start → end | live Views, start → end | runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Text (no animation) | 1233.9 MB | 1279.8 MB | 1289.9 MB | +1362.2 KB | 845.2 → 1031.3 MB | 340 → 1127 | 1 |
| AnimateableText (shared value) | 1313.1 MB | 1504.4 MB | 1517.5 MB | +9037.4 KB | 715.8 → 905.1 MB | 375 → 1333 | 1 |
| **Nitro `value` prop** | 1255.5 MB | 1407.9 MB | 1419.7 MB | +6427.8 KB | 1089.8 → 1317.3 MB | 332 → 193 | 1 |
| **Nitro `jumpTo`** | 993.4 MB | 1046.7 MB | 1047.5 MB | +1493.5 KB | 378.1 → 403.7 MB | 174 → 175 | 1 |
| **Nitro numeric transition** | 988.1 MB | 1258.0 MB | 1258.0 MB | +11456.9 KB | 368.9 → 654.2 MB | 468 → 347 | 1 |
| number-animation (native) | 1204.1 MB | 1323.3 MB | 1848.8 MB | -4267.3 KB | 1332.7 → 593.5 MB | 499 → 200 | 1 |
| animated-rolling-numbers | 1362.4 MB | 1254.3 MB | 1439.8 MB | -9024.4 KB | 698.4 → 522.8 MB | 2241 → 141 | 1 |
| NumberFlow View | 1201.6 MB | 1273.1 MB | 1367.7 MB | +2347.7 KB | 884.9 → 1045.4 MB | 3132 → 272 | 1 |
| NumberFlow Skia | 919.1 MB | 929.6 MB | 1017.3 MB | +222.1 KB | 267.3 → 309.0 MB | 193 → 486 | 1 |
| NumberFlow Skia sharedValue | 1044.9 MB | 1039.5 MB | 1228.0 MB | -3919.8 KB | 363.9 → 329.7 MB | 200 → 458 | 1 |
| NumberBloom (Skia) | 913.0 MB | 925.4 MB | 1042.1 MB | +316.9 KB | 268.8 → 296.7 MB | 255 → 559 | 1 |
| react-native-ticker | 1638.8 MB | 1794.8 MB | 1798.5 MB | +6978.5 KB | 1021.9 → 1262.7 MB | 2062 → 465 | 1 |
| AnimatedNumbers | 1156.1 MB | 1336.8 MB | 1336.8 MB | +6559.4 KB | 449.9 → 625.5 MB | 1661 → 1692 | 1 |

### What one copy costs

#### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | footprint per copy | malloc per copy | left behind per copy | runs |
| --- | --- | --- | --- | --- |
| Text (no animation) | 127.0 KB | 25.6 KB | 30.6 KB | 1 |
| **Nitro `value` prop** | 77.0 KB | 68.8 KB | 67.7 KB | 1 |

#### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | footprint per copy | malloc per copy | Java heap per copy | left behind per copy | runs |
| --- | --- | --- | --- | --- | --- |
| Text (no animation) | 13.1 KB | 29.3 KB | 5.3 KB | 9.1 KB | 3 |
| **Nitro `value` prop** | 50.7 KB | 56.5 KB | 13.0 KB | 43.2 KB | 3 |

## The render-server cross-check

The in-app meter sees the main thread miss a display-link tick. It cannot see
Core Animation miss a frame while compositing, and that blind spot matters
most for the one library whose per-frame work lives in the render server: this
one, where a wheel is a `CALayer` strip the compositor moves. So on
2026‑09‑22, with the build of that day (Instruments could not reach the phone
for the 2026‑09‑24 run), the same 24-copies-every-frame scenario was recorded
again on the iPhone 11 Pro under
Instruments' *Animation Hitches* template (`scripts/bench/hitches.mjs`, one
recording per library), whose hitches table is the display's own record of
frames that arrived late, counted here inside the 5 s the app measured. The
hitch ratio is milliseconds of lateness per second; Apple's guidance is that
under 5 ms/s is unnoticeable and over 10 ms/s is a problem.

| Implementation | hitches | hitch time | hitch ratio (ms/s) | worst hitch | in-app UI fps | in-app dropped | thermal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Nitro `value` prop** | 0 | 0 ms | 0.0 | 0 ms | 59.9 | 0 | nominal |
| **Nitro `jumpTo`** | 0 | 0 ms | 0.0 | 0 ms | 59.9 | 0 | nominal |
| number-animation (native) | 26 | 451 ms | 90.1 | 33 ms | 49.9 | 50 | nominal |
| animated-rolling-numbers | 6 | 100 ms | 19.9 | 17 ms | 58.9 | 5 | nominal |
| NumberFlow View | 77 | 1290 ms | 252.7 | 17 ms | 40.9 | 96 | nominal |
| AnimatedNumbers | 3 | 50 ms | 10.0 | 17 ms | 57.5 | 11 | nominal |

The two views agree. The render server saw no late frame at all for either
Nitro path while the main thread missed none, so the layer approach is not
hiding compositing cost the in-app meter cannot see. Where the meter saw
drops, Instruments saw hitches in proportion: 77 hitches to 96 dropped frames
for NumberFlow View, 26 to 50 for number-animation, 6 to 5 for
animated-rolling-numbers. A 17 ms worst hitch is one missed 60 Hz frame;
number-animation's 33 ms is two in a row.

## The inputs

Nine ways to put an amount, a phone number or plain text into a field, typed
into by the probe the way a keyboard types: `insertText` on the first
responder on iOS, the input connection on Android. The column to read first
is **rewrites per key**. A field that formats in JavaScript (the usual
`TextInput` with `onChangeText` → `Intl.NumberFormat` → `value`, and the two
popular libraries built on that pattern) shows the raw keystroke first and the
formatted text a frame or two later: 10 of 12 keys are rewritten and a key
takes 52–77 ms to settle. That is the flicker people report with formatted
inputs, measured. NitroInput, plain and reflowing, format inside the native edit,
before the frame is drawn, and so does the native mask library on Android:
no key is ever rewritten. The JS thread tells the same story from the other
side, 11–13 ms of JavaScript per key on the iPhone 11 Pro and 33–43 ms on
the A22 for the JS-formatted fields against 1–5 ms for the Nitro ones (their
one change callback per key), and at 15 keys a second the JS-formatted fields
fall behind the driver, which waits for a key to settle before the next one
(13.3–13.6 keys a second on the 11 Pro, where every other field keeps up).

The reflow costs what it looks like it costs: its animation's frames on the
main thread, and 9–11 ms (11 Pro) to 17 ms (A22) of JavaScript per key,
because a reflowing field sizes to its text and React Native lays each new
width out (with a fixed width it is about 2.5 ms on the A22). Nothing drops on
the 11 Pro. On the A22 it drops 22–32 frames in twelve keys: that phone
redraws the whole window on every frame, and the animation makes twice as
many frames as plain typing does.

Focus latency is `focus()` to `onFocus`; the Nitro fields answer in 6–10 ms
on the 11 Pro and under 2 ms on the A22, where `TextInput` takes 51 and 21 ms, for the reason the old page gave:
`focus()` is a direct call into the hybrid that lands on the next runloop
turn and `onFocus` comes back from the field's own delegate, while
`TextInput.focus()` goes through `TextInputState`, a Fabric view command
applied with the mounting transaction, and the batched event emitter. Tapping
a field is unaffected: the OS grants focus directly, with no JS in the loop.

Mounting 20 fields is where the Nitro views pay: a Nitro `HybridView` costs
more to create than a `TextInput`, on both platforms, and the numbers say by
how much on each phone. Unmounting costs about the same for every field.

### Typing at 8 keys a second

#### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | keys/s | rewrites per key | keys rewritten | settled p95 ms | main ms/key | JS ms/key | change events/key | dropped | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TextInput (text) | 7.5 | 0 | 0 of 12 | 0 | 28.8 | 8.8 | 1.0 | 3 | 1 |
| **NitroInput (text)** | 7.5 | 0 | 0 of 12 | 0 | 21.3 | 1.1 | 1.0 | 0 | 1 |
| **NitroInput reflow (text)** | 7.5 | 0 | 0 of 12 | 0 | 37.9 | 9.1 | 1.0 | 0 | 1 |
| TextInput + JS formatting | 7.5 | 1 | 10 of 12 | 54 | 36.3 | 12.6 | 1.0 | 3 | 1 |
| react-native-currency-input | 7.5 | 1 | 10 of 12 | 52 | 37.1 | 13.2 | 1.0 | 2 | 1 |
| react-native-mask-input (number mask) | 7.5 | 1 | 10 of 12 | 52 | 38.2 | 11.2 | 1.0 | 2 | 1 |
| **NitroInput (number)** | 7.5 | 0 | 0 of 12 | 0 | 19.3 | 1.3 | 1.0 | 0 | 1 |
| **NitroInput reflow (number)** | 7.5 | 0 | 0 of 12 | 0 | 36.4 | 10.9 | 1.0 | 0 | 1 |
| **NitroInput (mask)** | 7.5 | 0 | 0 of 10 | 0 | 20.0 | 1.4 | 1.0 | 0 | 1 |
| Expo UI TextField | 7.5 | 0 | 0 of 12 | 0 | 34.8 | 1.2 | 0.0 | 0 | 1 |

#### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | keys/s | rewrites per key | keys rewritten | settled p95 ms | main ms/key | JS ms/key | change events/key | dropped | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TextInput (text) | 7.5 | 0 | 0 of 12 | 0 | 70.0 | 26.7 | 1.0 | 1 | 1 |
| **NitroInput (text)** | 7.5 | 0 | 0 of 12 | 0 | 63.3 | 3.3 | 1.0 | 1 | 1 |
| **NitroInput reflow (text)** | 7.3 | 0 | 0 of 12 | 0 | 58.3 | 16.7 | 1.0 | 32 | 1 |
| TextInput + JS formatting | 7.5 | 1 | 10 of 12 | 66 | 77.5 | 40.0 | 1.0 | 0 | 1 |
| react-native-currency-input | 7.5 | 1 | 10 of 12 | 77 | 80.0 | 43.3 | 1.0 | 0 | 1 |
| react-native-mask-input (number mask) | 7.5 | 1 | 10 of 12 | 55 | 66.7 | 32.5 | 1.0 | 0 | 1 |
| **NitroInput (number)** | 7.5 | 0 | 0 of 12 | 0 | 61.7 | 3.3 | 1.0 | 0 | 1 |
| **NitroInput reflow (number)** | 7.4 | 0 | 0 of 12 | 0 | 60.0 | 16.7 | 1.0 | 22 | 1 |
| react-native-advanced-input-mask | 7.5 | 0 | 0 of 10 | 0 | 73.0 | 32.0 | 1.0 | 1 | 1 |
| **NitroInput (mask)** | 7.5 | 0 | 0 of 10 | 0 | 60.0 | 5.0 | 1.0 | 0 | 1 |
| Expo UI TextField | 7.5 | 0 | 0 of 12 | 0 | 47.5 | 3.3 | 0.0 | 4 | 1 |

### Typing at 15 keys a second

#### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | keys/s | rewrites per key | keys rewritten | settled p95 ms | main ms/key | JS ms/key | change events/key | dropped | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TextInput (text) | 15.0 | 0 | 0 of 12 | 0 | 18.9 | 10.2 | 1.0 | 0 | 1 |
| **NitroInput (text)** | 15.0 | 0 | 0 of 12 | 0 | 17.4 | 1.1 | 1.0 | 0 | 1 |
| **NitroInput reflow (text)** | 15.0 | 0 | 0 of 12 | 0 | 22.6 | 9.0 | 1.0 | 0 | 1 |
| TextInput + JS formatting | 13.6 | 1 | 10 of 12 | 52 | 22.3 | 8.6 | 1.0 | 2 | 1 |
| react-native-currency-input | 13.3 | 1 | 10 of 12 | 52 | 22.9 | 8.1 | 1.0 | 4 | 1 |
| react-native-mask-input (number mask) | 13.3 | 1 | 10 of 12 | 55 | 23.1 | 8.8 | 1.0 | 3 | 1 |
| **NitroInput (number)** | 15.0 | 0 | 0 of 12 | 0 | 17.1 | 1.3 | 1.0 | 0 | 1 |
| **NitroInput reflow (number)** | 15.0 | 0 | 0 of 12 | 0 | 21.3 | 8.2 | 1.0 | 0 | 1 |
| **NitroInput (mask)** | 15.0 | 0 | 0 of 10 | 0 | 16.7 | 1.2 | 1.0 | 0 | 1 |
| Expo UI TextField | 14.7 | 0 | 0 of 12 | 0 | 24.4 | 1.0 | 0.0 | 0 | 1 |

#### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | keys/s | rewrites per key | keys rewritten | settled p95 ms | main ms/key | JS ms/key | change events/key | dropped | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TextInput (text) | 12.9 | 0 | 0 of 12 | 0 | 47.5 | 30.8 | 1.0 | 1 | 1 |
| **NitroInput (text)** | 12.9 | 0 | 0 of 12 | 0 | 35.8 | 3.3 | 1.0 | 0 | 1 |
| **NitroInput reflow (text)** | 12.3 | 0 | 0 of 12 | 0 | 33.3 | 18.3 | 1.0 | 23 | 1 |
| TextInput + JS formatting | 12.6 | 1 | 10 of 12 | 66 | 42.5 | 30.0 | 1.0 | 0 | 1 |
| react-native-currency-input | 12.2 | 1 | 10 of 12 | 77 | 48.3 | 35.0 | 1.0 | 0 | 1 |
| react-native-mask-input (number mask) | 12.6 | 1 | 9 of 12 | 66 | 44.2 | 34.2 | 1.0 | 0 | 1 |
| **NitroInput (number)** | 12.9 | 0 | 0 of 12 | 0 | 39.2 | 1.7 | 1.0 | 0 | 1 |
| **NitroInput reflow (number)** | 12.6 | 0 | 0 of 12 | 0 | 35.0 | 17.5 | 1.0 | 18 | 1 |
| react-native-advanced-input-mask | 12.9 | 0 | 0 of 10 | 0 | 47.0 | 28.0 | 1.0 | 0 | 1 |
| **NitroInput (mask)** | 12.9 | 0 | 0 of 10 | 0 | 32.0 | 3.0 | 1.0 | 2 | 1 |
| Expo UI TextField | 12.9 | 0 | 0 of 12 | 0 | 34.2 | 2.5 | 0.0 | 0 | 1 |

### Focus latency

#### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | focus → onFocus ms | p95 | first (keyboard) | runs |
| --- | --- | --- | --- | --- |
| TextInput (text) | 51.1 | 51.9 | 29.3 | 1 |
| **NitroInput (text)** | 10.1 | 10.9 | 3.8 | 1 |
| **NitroInput reflow (text)** | 10.3 | 10.7 | 5.1 | 1 |
| TextInput + JS formatting | 45.5 | 46.2 | 39.4 | 1 |
| react-native-currency-input | 45.9 | 46.4 | 37.8 | 1 |
| react-native-mask-input (number mask) | 46.5 | 47.5 | 36.4 | 1 |
| **NitroInput (number)** | 5.6 | 6.9 | 6.9 | 1 |
| **NitroInput reflow (number)** | 9.9 | 11.0 | 5.1 | 1 |
| **NitroInput (mask)** | 10.2 | 10.6 | 4.2 | 1 |
| Expo UI TextField | 120.2 | 149.8 | 91.0 | 1 |

‡ at least one of these runs started with the phone already throttled (thermal state serious or worse).

#### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | focus → onFocus ms | p95 | first (keyboard) | runs |
| --- | --- | --- | --- | --- |
| TextInput (text) | 21.0 | 27.3 | 27.3 | 1 |
| **NitroInput (text)** | 1.6 | 5.2 | 5.2 | 1 |
| **NitroInput reflow (text)** | 1.5 | 3.6 | 3.6 | 1 |
| TextInput + JS formatting | 19.1 | 21.8 | 20.3 | 1 |
| react-native-currency-input | 21.0 | 30.7 | 30.7 | 1 |
| react-native-mask-input (number mask) | 20.8 | 31.9 | 31.9 | 1 |
| **NitroInput (number)** | 1.4 | 4.5 | 4.5 | 1 |
| **NitroInput reflow (number)** | 1.6 | 4.5 | 3.6 | 1 |
| react-native-advanced-input-mask | 21.4 | 29.8 | 29.8 | 1 |
| **NitroInput (mask)** | 1.4 | 5.1 | 5.1 | 1 |
| Expo UI TextField | 23.0 | 28.3 | 14.6 | 1 |

### Mounting 20 fields

#### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | mount ms | min | max | unmount ms | main-thread ms | JS-thread ms | runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TextInput (text) | 25.6 | 10.2 | 67.5 | 30.9 | 13.4 | 15.2 | 1 |
| **NitroInput (text)** | 67.5 | 27.4 | 87.4 | 30.7 | 51.1 | 19.1 | 1 |
| **NitroInput reflow (text)** | 36.7 | 29.4 | 81.8 | 31.0 | 13.6 | 34.9 | 1 |
| TextInput + JS formatting | 24.8 | 23.1 | 32.7 | 31.0 | 12.4 | 15.9 | 1 |
| react-native-currency-input | 24.2 | 12.4 | 30.4 | 30.9 | 12.6 | 15.5 | 1 |
| react-native-mask-input (number mask) | 26.1 | 24.7 | 80.2 | 30.8 | 14.3 | 15.4 | 1 |
| **NitroInput (number)** | 72.6 | 29.9 | 75.7 | 30.8 | 55.7 | 19.0 | 1 |
| **NitroInput reflow (number)** | 34.7 | 29.1 | 76.4 | 31.2 | 23.8 | 37.3 | 1 |
| **NitroInput (mask)** | 68.6 | 28.3 | 90.5 | 30.9 | 53.2 | 18.8 | 1 |
| Expo UI TextField | 220.7 | 10.5 | 238.5 | 30.7 | 209.9 | 14.8 | 1 |

#### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | mount ms | min | max | unmount ms | main-thread ms | JS-thread ms | runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TextInput (text) | 143.6 | 47.6 | 247.4 | 164.8 | 190.0 | 90.0 | 1 |
| **NitroInput (text)** | 213.1 | 85.9 | 271.7 | 175.4 | 210.0 | 210.0 | 1 |
| **NitroInput reflow (text)** | 267.5 | 96.8 | 803.1 | 144.5 | 220.0 | 260.0 | 1 |
| TextInput + JS formatting | 236.4 | 96.0 | 344.2 | 170.0 | 210.0 | 190.0 | 1 |
| react-native-currency-input | 82.7 | 25.4 | 267.8 | 154.2 | 190.0 | 100.0 | 1 |
| react-native-mask-input (number mask) | 94.2 | 66.4 | 177.4 | 175.0 | 200.0 | 110.0 | 1 |
| **NitroInput (number)** | 296.4 | 177.5 | 353.0 | 155.8 | 240.0 | 250.0 | 1 |
| **NitroInput reflow (number)** | 260.9 | 104.1 | 320.3 | 155.9 | 210.0 | 260.0 | 1 |
| react-native-advanced-input-mask | 204.7 | 90.6 | 399.5 | 175.2 | 210.0 | 130.0 | 1 |
| **NitroInput (mask)** | 269.3 | 118.2 | 304.4 | 149.3 | 220.0 | 220.0 | 1 |
| Expo UI TextField | 140.1 | 77.1 | 370.1 | 120.1 | 380.0 | 150.0 | 1 |

### Memory over 40 mount/unmount cycles of 20 fields

#### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | footprint, start | footprint, end | peak | growth per cycle | malloc heap, start → end | runs |
| --- | --- | --- | --- | --- | --- | --- |
| TextInput (text) | 243.6 MB | 246.9 MB | 246.9 MB | +39.1 KB | 108.4 → 112.9 MB | 1 |
| **NitroInput (text)** | 244.5 MB | 261.0 MB | 261.0 MB | +346.9 KB | 113.3 → 108.6 MB | 1 |
| **NitroInput reflow (text)** | 258.4 MB | 264.7 MB | 268.0 MB | +143.6 KB | 106.9 → 119.1 MB | 1 |
| TextInput + JS formatting | 262.0 MB | 265.1 MB | 265.1 MB | +31.8 KB | 119.4 → 122.0 MB | 1 |
| react-native-currency-input | 265.6 MB | 268.8 MB | 268.8 MB | +35.0 KB | 119.1 → 123.3 MB | 1 |
| react-native-mask-input (number mask) | 265.7 MB | 272.5 MB | 272.5 MB | +75.3 KB | 123.8 → 126.0 MB | 1 |
| **NitroInput (number)** | 266.1 MB | 272.4 MB | 273.4 MB | +135.5 KB | 123.7 → 129.4 MB | 1 |
| **NitroInput reflow (number)** | 270.6 MB | 282.9 MB | 282.9 MB | +271.8 KB | 127.8 → 135.5 MB | 1 |
| **NitroInput (mask)** | 279.4 MB | 291.8 MB | 291.8 MB | +286.5 KB | 136.0 → 143.6 MB | 1 |
| Expo UI TextField | 288.3 MB | 286.7 MB | 290.7 MB | -50.2 KB | 140.1 → 149.1 MB | 1 |

#### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | footprint, start | footprint, end | peak | growth per cycle | malloc heap, start → end | live Views, start → end | runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TextInput (text) | 1303.4 MB | 1353.1 MB | 1354.5 MB | +830.2 KB | 864.4 → 879.2 MB | 117 → 118 | 1 |
| **NitroInput (text)** | 1329.0 MB | 1392.8 MB | 1392.8 MB | +1452.9 KB | 868.1 → 924.0 MB | 118 → 119 | 1 |
| **NitroInput reflow (text)** | 1370.8 MB | 1315.9 MB | 1383.9 MB | -987.3 KB | 913.0 → 788.6 MB | 119 → 120 | 1 |
| TextInput + JS formatting | 1296.7 MB | 1313.6 MB | 1324.5 MB | +120.5 KB | 778.6 → 788.5 MB | 120 → 121 | 1 |
| react-native-currency-input | 1299.1 MB | 1333.4 MB | 1333.4 MB | +672.7 KB | 783.1 → 801.9 MB | 121 → 122 | 1 |
| react-native-mask-input (number mask) | 1301.4 MB | 1335.2 MB | 1335.2 MB | +712.4 KB | 788.7 → 808.7 MB | 122 → 123 | 1 |
| **NitroInput (number)** | 1302.8 MB | 1306.6 MB | 1338.5 MB | +22.4 KB | 793.8 → 766.4 MB | 123 → 124 | 1 |
| **NitroInput reflow (number)** | 1290.5 MB | 1327.0 MB | 1335.2 MB | +889.5 KB | 761.0 → 817.4 MB | 124 → 125 | 1 |
| react-native-advanced-input-mask | 1300.5 MB | 1264.5 MB | 1312.2 MB | -1349.5 KB | 811.7 → 830.4 MB | 125 → 126 | 1 |
| **NitroInput (mask)** | 1235.8 MB | 1196.9 MB | 1235.8 MB | -360.1 KB | 816.9 → 787.5 MB | 126 → 127 | 1 |
| Expo UI TextField | 1166.4 MB | 1215.4 MB | 1228.7 MB | +228.6 KB | 773.6 → 791.2 MB | 127 → 330 | 1 |

### What one field costs

#### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

| Implementation | footprint per copy | malloc per copy | left behind per copy | runs |
| --- | --- | --- | --- | --- |
| TextInput (text) | 95.4 KB | 118.7 KB | 74.6 KB | 1 |
| **NitroInput (text)** | 141.1 KB | 126.1 KB | 141.4 KB | 1 |
| **NitroInput reflow (text)** | 90.9 KB | 60.3 KB | 91.5 KB | 1 |

#### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

| Implementation | footprint per copy | malloc per copy | Java heap per copy | left behind per copy | runs |
| --- | --- | --- | --- | --- | --- |
| TextInput (text) | 53.5 KB | 63.7 KB | 17.3 KB | 29.3 KB | 3 |
| **NitroInput (text)** | 36.4 KB | 56.1 KB | 27.4 KB | 10.9 KB | 3 |
| **NitroInput reflow (text)** | 137.4 KB | 168.7 KB | 23.9 KB | 120.5 KB | 3 |

## Number formatting

Measured on 2026‑09‑25, Release builds: `NumberFormat` against Hermes'
`Intl.NumberFormat`, per call on the JS thread, cycling through six locale
and currency setups (en-US USD, en-PH PHP, de-DE EUR, en-IN INR, ja-JP JPY,
fr-FR decimal) and a fixed set of 512 amounts. Each row is the median of
seven 120 ms batches, three runs; *first call* is the scenario's first call
in a fresh process. `--plan format` runs it.

Building an `Intl.NumberFormat` is Hermes' expensive step: 44 µs on the
iPhone 11 Pro and 3.5 ms on the Galaxy A22, where every call also crosses
JNI into ICU. `NumberFormat` asks the platform once per locale and currency
and hands out cached, immutable formatters after that (3.3 µs and 9.3 µs,
most of it reading the options object), and formats in C++: 1.0 µs and
2.7 µs against Hermes' 1.6 µs and 10.5 µs. Hermes has no `formatToParts` on
iOS.

### iPhone 11 Pro (iPhone12,3, iOS 26.6.1, 60 Hz)

#### building a formatter

| Implementation | µs per call | fastest batch | slowest batch | first call ms | runs |
| --- | --- | --- | --- | --- | --- |
| Intl.NumberFormat (Hermes) | 44.25 | 43.86 | 62.88 | 0.5 | 3 |
| **NumberFormat (native)** | 3.32 | 3.32 | 4.55 | 0.1 | 3 |

#### format() with a built formatter

| Implementation | µs per call | fastest batch | slowest batch | first call ms | runs |
| --- | --- | --- | --- | --- | --- |
| Intl.NumberFormat (Hermes) | 1.61 | 1.60 | 2.14 | 1.6 | 3 |
| **NumberFormat (native)** | 1.02 | 1.01 | 1.38 | 0.2 | 3 |

#### formatToParts() with a built formatter

| Implementation | µs per call | fastest batch | slowest batch | first call ms | runs |
| --- | --- | --- | --- | --- | --- |
| Intl.NumberFormat (Hermes) | failed: formatToParts is not implemented | | | | |
| **NumberFormat (native)** | 2.78 | 2.78 | 3.77 | 0.2 | 3 |

#### toLocaleString(), a formatter per call

| Implementation | µs per call | fastest batch | slowest batch | first call ms | runs |
| --- | --- | --- | --- | --- | --- |
| Intl.NumberFormat (Hermes) | 90.32 | 90.16 | 126 | 0.9 | 3 |
| **NumberFormat (native)** | 3.96 | 3.96 | 5.50 | 0.1 | 3 |


### Samsung Galaxy A22 (SM-A225F, Android 13 (API 33), 90 Hz)

#### building a formatter

| Implementation | µs per call | fastest batch | slowest batch | first call ms | runs |
| --- | --- | --- | --- | --- | --- |
| Intl.NumberFormat (Hermes) | 3476 | 2528 | 5168 | 6.2 | 3 |
| **NumberFormat (native)** | 9.27 | 9.11 | 12.66 | 0.1 | 3 |

#### format() with a built formatter

| Implementation | µs per call | fastest batch | slowest batch | first call ms | runs |
| --- | --- | --- | --- | --- | --- |
| Intl.NumberFormat (Hermes) | 10.46 | 10.15 | 11.66 | 13.3 | 3 |
| **NumberFormat (native)** | 2.73 | 2.70 | 3.19 | 0.2 | 3 |

#### formatToParts() with a built formatter

| Implementation | µs per call | fastest batch | slowest batch | first call ms | runs |
| --- | --- | --- | --- | --- | --- |
| Intl.NumberFormat (Hermes) | 99.22 | 90.37 | 117 | 15.1 | 3 |
| **NumberFormat (native)** | 7.60 | 7.48 | 8.98 | 0.2 | 3 |

#### toLocaleString(), a formatter per call

| Implementation | µs per call | fastest batch | slowest batch | first call ms | runs |
| --- | --- | --- | --- | --- | --- |
| Intl.NumberFormat (Hermes) | 1983 | 1911 | 2684 | 2.9 | 3 |
| **NumberFormat (native)** | 11.13 | 11.02 | 11.91 | 0.1 | 3 |

## Earlier measurements

The tables this file carried before 2026‑09‑22 (an iPhone 17 Pro simulator,
a Pixel 10, a Moto G emulator, measured with a Reanimated frame callback and
10 s windows, without thermal control) are in the git history of this file.
They are not comparable with the ones above: the simulator and emulator
numbers say more about the host than about the libraries, the Pixel run had no
cool-down, and the iPhone 13 Pro Max ran at 120 Hz there only because the
Reanimated meter itself asked for it. A Pixel 10 run with this method needs
the phone attached: `node scripts/bench/run.mjs --android <serial>`.

## Reproducing

```sh
# every phone at once; --build makes the release builds first
node scripts/bench/run.mjs --ios <CoreDevice id> --android <adb serial> --build

# a subset, or a quick look
node scripts/bench/run.mjs --android <serial> --plan quick --impls text,nitro-prop,nitro-jump

# the tables, from whatever is in scripts/bench/results/; --json is the same groups as data
node scripts/bench/report.mjs

# everything derived from the results at once: the docs' chart data (docs/src/data/benchmarks.json),
# the README's SVG, every table in this file and the README's two tables (the prose is by hand)
node scripts/bench/assemble.mjs

# the other plans: the fields, mount and unmount, the scrolling list, memory, what one copy costs, or everything
node scripts/bench/run.mjs --ios <CoreDevice id> --android <adb serial> --plan inputs   # mount | list | leak | footprint | all

# number formatting: NumberFormat against Hermes' Intl.NumberFormat
node scripts/bench/run.mjs --ios <CoreDevice id> --android <adb serial> --plan format --build

# a simulator or an emulator works too, for comparing on one Mac; those results go to results/local/
node scripts/bench/run.mjs --ios <simulator UDID> --android emulator-5554 --plan format --build

# the Instruments cross-check (iOS)
node scripts/bench/hitches.mjs --ios <CoreDevice id> --impls nitro-prop,nitro-jump,rnna,arn,nf-view

# the recycling check: the example's "Recycle check" screen driven through argent,
# every visible row compared with what it reports and what it painted, mid-roll frames included
node scripts/ui/recycle-check.mjs --udid <simulator UDID, adb serial or phone>
```

`xcrun devicectl list devices` gives the iOS ids (pair a cabled phone once
with `xcrun devicectl manage pair --device <id>`), `adb devices` the serial.
The same screen is in the app under **Rolling number → Benchmark vs other
libraries**, with a *Full matrix* button, for a run by hand; it prints the
same lines to the console and to `bench-results.ndjson` in the app's files.
