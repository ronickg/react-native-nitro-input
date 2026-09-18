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
| **Nitro `value` prop** | 60.0 | 0 | 60.0 | 20 % | 12 % |
| **Nitro `jumpTo`** | 60.0 | 0 | 60.0 | 9 % | 7 % |
| NumberFlow View | 60.0 | 0 | 60.0 | 45 % | 21 % |
| NumberFlow Skia | 60.0 | 0 | 60.0 | 54 % | 9 % |
| NumberFlow Skia sharedValue | 59.9 | 1 | 60.0 | 13 % | 9 % |
| AnimatedNumbers | 60.0 | 0 | 60.0 | 40 % | 10 % |

### 24 copies, new value every frame

| Implementation | UI fps | dropped | worst gap | JS fps | process CPU | main thread |
|---|---|---|---|---|---|---|
| Text (no animation) | 60.0 | 0 | 17 ms | 60.0 | 24 % | 16 % |
| **Nitro `value` prop** | 57.2 | 34 | 46 ms | 60.0 | 69 % | 60 % |
| **Nitro `jumpTo`** | 59.3 | 8 | 49 ms | 60.0 | 50 % | 49 % |
| NumberFlow View | 34.0 | 307 | 131 ms | 7.9 | 178 % | 76 % |
| NumberFlow Skia | 42.4 | 239 | 42 ms | 1.5 | 208 % | 78 % |
| NumberFlow Skia sharedValue | 35.3 | 320 | 1036 ms | 41.0 | 127 % | 73 % |
| AnimatedNumbers | 57.1 | 34 | 140 ms | 13.9 | 173 % | 51 % |

Before this round's optimizations the same Nitro rows read 31.3 fps / 158
dropped / 811 ms (prop) and 32.5 fps / 329 dropped / 3375 ms (`jumpTo`).
Profiling showed per-glyph Core Text drawing at 27 % of the main thread and
an unbounded backlog of main-thread dispatches from `jumpTo`; glyphs are now
rasterized once and blitted, and `jumpTo`/`animateTo` coalesce to the newest
value per main-thread turn.

### 24 copies, ten values a second

| Implementation | UI fps | dropped | JS fps | process CPU | main thread |
|---|---|---|---|---|---|
| Text (no animation) | 59.9 | 1 | 60.0 | 12 % | 8 % |
| **Nitro `value` prop** | 59.9 | 1 | 60.0 | 59 % | 57 % |
| **Nitro `jumpTo`** | 53.2 | 83 | 60.0 | 16 % | 15 % |
| NumberFlow View | 31.3 | 342 | 8.6 | 178 % | 78 % |
| NumberFlow Skia | 45.7 | 204 | 1.4 | 206 % | 80 % |
| NumberFlow Skia sharedValue | 49.8 | 143 | 43.2 | 143 % | 81 % |
| AnimatedNumbers | 57.0 | 36 | 27.2 | 126 % | 43 % |

Reading: the prop-driven libraries pay for every update on the JS thread
(React render, formatting, per-digit animation setup) and, for the View and
Skia renderers, again on the main thread; with 24 copies the JS thread falls
to 1–9 fps and the UI thread to 31–46 fps. AnimatedNumbers keeps the UI
thread mostly free (native-driver transforms) but its JS thread still drops to
14–27 fps. This library keeps the JS thread at 60 fps in every scenario
because a value is a single JSI call; its remaining cost is the main-thread
redraw of 24 bitmap-backed views (about 0.4 ms per view per frame here).

## Android

The Pixel 9 Pro AVD on this host cannot render even a plain scroll above
~13 fps (its 1280×2856 surface goes through host GPU emulation), so the
series was run on a Moto G AVD (720×1280, Android 14). Even there the
emulator's RenderThread alone costs ~50 % for plain `<Text>`, capping every
library at 30–45 fps; treat the table as relative, and re-run on a device.

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
