# Benchmarks

Measured on 2026‑09‑18 with the example app's **Benchmark** section
(`example/App.tsx`), release builds, React Native 0.87.1, Reanimated 4.6,
Skia 2.12, number-flow-react-native 0.5.1, react-native-animated-numbers 0.6.3.

## Method

- The harness pushes a new value into the selected implementation for 12 s,
  either on every JS frame (60/s, about seven digits change per frame) or ten
  times a second (a live ticker), into 1 or 24 copies driven by the same stream.
- **UI fps / dropped** come from a Reanimated `useFrameCallback` worklet on the
  UI thread (a gap over 25 ms counts the frames it swallowed). **JS fps** is the
  pacing of the `requestAnimationFrame` loop that pushes the values.
- **CPU** is sampled outside the app (`ps -M` per thread on the simulator,
  `/proc/<pid>/task/*/stat` on the emulator) over the middle 10 s of a run.
- Nothing polls the accessibility tree during a run; the taps are scripted with
  argent and the results read afterwards.

Implementations: plain `<Text>` (re-render, no animation) as the floor,
this library via the `value` prop and via `jumpTo`, NumberFlow's View
renderer, NumberFlow's Skia renderer driven by `value` and by a `sharedValue`,
and AnimatedNumbers (Animated API with the native driver, integer-only so it is
fed cents).

## iOS (iPhone 17 Pro simulator, Apple Silicon host)

The JS thread is never the bottleneck for a single number on a Mac-hosted
simulator, so one copy renders at 60 fps in every library; the cost shows up
as CPU. With 24 copies the differences become dropped frames.

### One copy, new value every frame

| Implementation | UI fps | dropped | JS fps | process CPU | main thread |
|---|---|---|---|---|---|
| Text (no animation) | 60.0 | 0 | 60.0 | 20 % | 10 % |
| **Nitro `value` prop** (bitmap build) | 60.0 | 0 | 60.0 | 20 % | 12 % |
| **Nitro `jumpTo`** (bitmap build) | 60.0 | 0 | 60.0 | 9 % | 7 % |
| NumberFlow View | 60.0 | 0 | 60.0 | 45 % | 21 % |
| NumberFlow Skia | 60.0 | 0 | 60.0 | 54 % | 9 % |
| NumberFlow Skia sharedValue | 59.9 | 1 | 60.0 | 13 % | 9 % |
| AnimatedNumbers | 60.0 | 0 | 60.0 | 40 % | 10 % |

### 24 copies, new value every frame

| Implementation | UI fps | dropped | worst gap | JS fps | process CPU | main thread |
|---|---|---|---|---|---|---|
| Text (no animation) | 60.0 | 0 | 17 ms | 60.0 | 24 % | 16 % |
| **Nitro `value` prop** | 59.4 | 8 | 55 ms | 59.9 | 25 % | 12 % |
| **Nitro `jumpTo`** | 60.0 | 0 | 17 ms | 60.0 | 12 % | 9 % |
| NumberFlow View | 34.0 | 307 | 131 ms | 7.9 | 178 % | 76 % |
| NumberFlow Skia | 42.4 | 239 | 42 ms | 1.5 | 208 % | 78 % |
| NumberFlow Skia sharedValue | 35.3 | 320 | 1036 ms | 41.0 | 127 % | 73 % |
| AnimatedNumbers | 57.1 | 34 | 140 ms | 13.9 | 173 % | 51 % |

How the Nitro rows got there, same scenario, three builds:

| build | prop: UI fps / dropped / main thread | `jumpTo`: UI fps / dropped / main thread |
|---|---|---|
| bitmap `draw(_:)`, Core Text per glyph | 31.3 / 158 / 64 % (worst gap 811 ms) | 32.5 / 329 / 62 % (worst gap 3375 ms) |
| + cached glyph images, coalesced `jumpTo` | 57.2 / 34 / 60 % | 59.3 / 8 / 49 % |
| **+ CALayer wheels (no per-frame bitmap)** | **59.4 / 8 / 12 %** | **60.0 / 0 / 9 %** |

The first profile showed per-glyph Core Text drawing at 27 % of the main
thread plus an unbounded backlog of `jumpTo` dispatches. The second profile
showed that two thirds of what remained was Core Animation's backing-store
work for a `draw(_:)` view (allocate, clear, convert, upload a bitmap for each
of the 24 views every frame), which no drawing optimization can remove. Each
glyph and wheel is now a `CALayer` with a pre-rasterized image, a wheel being
a clipped strip of the ten digits that moves per frame, so the render server
composites the roll and the main thread only sets layer positions.

### 24 copies, ten values a second

| Implementation | UI fps | dropped | JS fps | process CPU | main thread |
|---|---|---|---|---|---|
| Text (no animation) | 59.9 | 1 | 60.0 | 12 % | 8 % |
| **Nitro `value` prop** | 60.0 | 0 | 60.0 | 12 % | 8 % |
| **Nitro `jumpTo`** | 60.0 | 0 | 60.0 | 3 % | 3 % |
| NumberFlow View | 31.3 | 342 | 8.6 | 178 % | 78 % |
| NumberFlow Skia | 45.7 | 204 | 1.4 | 206 % | 80 % |
| NumberFlow Skia sharedValue | 49.8 | 143 | 43.2 | 143 % | 81 % |
| AnimatedNumbers | 57.0 | 36 | 27.2 | 126 % | 43 % |

(With the bitmap renderer the Nitro rows were 59.9 / 1 / 57 % and 53.2 / 83 /
15 %.)

Reading: the prop-driven libraries pay for every update on the JS thread
(React render, formatting, per-digit animation setup) and, for the View and
Skia renderers, again on the main thread; with 24 copies the JS thread falls
to 1–9 fps and the UI thread to 31–46 fps. AnimatedNumbers keeps the UI
thread mostly free (native-driver transforms) but its JS thread still drops to
14–27 fps. This library keeps the JS thread at 60 fps in every scenario
because a value is a single JSI call, and with layer rendering 24 continuously
rolling copies cost about the same main-thread time as 24 plain `<Text>`
updates.

## Real devices

### iPhone 13 Pro Max (iOS 26.6, 120 Hz ProMotion, release build, layer renderer)

"Every frame" here means 120 pushes a second. One copy: every library holds
120 fps on both threads. 24 copies:

| Implementation | UI fps | dropped | JS fps |
|---|---|---|---|
| Text (no animation) | 120.0 | 0 | 120.0 |
| **Nitro `value` prop** | 120.0 | 0 | 120.0 |
| **Nitro `jumpTo`** | 120.0 | 0 | 120.0 |
| NumberFlow View | 35.4 | 358 | 6.3 |
| NumberFlow Skia | 94.5 | 40 | 1.1 |
| NumberFlow Skia sharedValue | 76.6 | 55 | 40.7 |
| AnimatedNumbers | 114.1 | 19 | 12.4 |

(No per-thread CPU on the phone: there is no `ps` access from the host.)

### Pixel 10 (Android 17, 60 Hz, release build)

| Implementation, 24 copies | UI fps | dropped | JS fps | process CPU | main | JS | RenderThread |
|---|---|---|---|---|---|---|---|
| Text (no animation) | 60.0 | 0 | 58.2 | 85 % | 27 % | 35 % | 13 % |
| **Nitro `value` prop** | 60.0 | 0 | 58.7 | 83 % | 22 % | 35 % | 22 % |
| **Nitro `jumpTo`** | 60.0 | 0 | 59.9 | 47 % | 18 % | 6 % | 19 % |
| NumberFlow View | 33.2 | 329 | 1.7 | 141 % | 77 % | 43 % | 11 % |
| NumberFlow Skia | 59.2 | 13 | 27.7 | 191 % | 66 % | 70 % | 11 % |
| NumberFlow Skia sharedValue | 55.6 | 51 | 17.7 | 141 % | 75 % | 36 % | 10 % |
| AnimatedNumbers | 56.4 | 44 | 14.1 | 193 % | 34 % | 88 % | 31 % |

The JS column for the Nitro prop row is the harness re-rendering 24 React
elements per frame, the same 35 % as plain `<Text>`; the library's own
Android cost is the main-thread `onDraw` recording (22 %) plus HWUI's
RenderThread (22 %). With one copy and light JS work the Pixel's
`requestAnimationFrame` settled at ~30 Hz (a scheduling / power-state effect,
identical for every library), so the one-copy rows are not listed.

## Android emulators

The Pixel 9 Pro AVD on this host cannot render even a plain scroll above
~13 fps (its 1280×2856 surface goes through host GPU emulation), so the
emulator series was run on a Moto G AVD (720×1280, Android 14). Even there
the emulator's RenderThread alone costs ~50 % for plain `<Text>`, capping
every library at 30–45 fps; treat the table as relative and prefer the Pixel
10 numbers above.

### 24 copies, new value every frame (Moto G emulator)

| Implementation | UI fps | JS fps | process CPU | main | JS | RenderThread |
|---|---|---|---|---|---|---|
| Text (no animation) | 41.5 | 34.7 | 94 % | 23 % | 35 % | 32 % |
| **Nitro `value` prop** | 29.5 | 26.2 | 111 % | 27 % | 28 % | 52 % |
| **Nitro `jumpTo`** | 37.5 | 35.5 | 72 % | 20 % | 3 % | 46 % |
| NumberFlow View | 17.5 | 0.8 | 159 % | 58 % | 83 % | 4 % |
| NumberFlow Skia | 27.5 | 6.8 | 157 % | 49 % | 66 % | 23 % |
| NumberFlow Skia sharedValue | 8.9 | 2.7 | 124 % | 68 % | 29 % | 20 % |
| AnimatedNumbers | – | – | – | – | – | mounting 24 copies outlasted the run |

One copy at 60/s on the same emulator: Text 39 / 37 fps (UI / JS), Nitro prop
35 / 33, Nitro `jumpTo` 46 / 44, NumberFlow View 32 / 21, NumberFlow Skia
48 / 17, Skia sharedValue 53 / 48, AnimatedNumbers 30 / 19.

## Reproducing

Build release variants (`xcodebuild -configuration Release -sdk
iphonesimulator`, `./gradlew :app:assembleRelease`), open the Benchmark
section, pick an implementation, rate and copy count, and press Run. The
result line is the on-screen UI/JS pacing; sample CPU externally for the
same window.
