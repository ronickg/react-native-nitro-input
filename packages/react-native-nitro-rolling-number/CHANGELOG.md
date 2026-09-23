# Changelog

## Unreleased

- `transition="numeric"`: a second way a value change can play, after
  SwiftUI's `.contentTransition(.numericText())`. Instead of rolling through
  the digits between, each changed glyph swaps in place: the old one softens,
  shrinks and slides out while the new one slides in from the other side, a
  little small and out of focus, and resolves; the glyphs move up when the
  value grows and down when it shrinks, the change cascades from the leftmost
  digit to the right, and digits that don't change stay put. The engine
  plans it as a blend per wheel (`fromGlyph` → `toGlyph`, `blend`), the same
  `duration` and `stagger` apply (480 ms and, for the numeric transition, a
  150 ms cascade span shared out over the digits that change; `easing` and
  `bounce` are not consulted, as SwiftUI's transition does not consult its
  animation either). A changing digit runs four clocks scaled to the
  duration, each a damped spring's step response: the position (ζ 0.54,
  about 12 % overshoot, which is the wave; the glyph travels 0.34 line
  heights), the size and opacity (critically damped, settled at 65 %; the
  glyph grows from 0.4× as it fades in), the arriving glyph's blur (ζ 0.85,
  settled at 74 %) and the leaving glyph's (critically damped, settled at
  46 %, so the old digit goes soft at once), with 0.08 line heights of blur
  at full blur, SwiftUI's own; the transition runs 1.45 durations so the
  position spring rings out instead of snapping its last pixel. The figures are
  SwiftUI's, fitted to its frames at 60 fps: a model of our renderers was
  rendered from the real glyphs and optimised until it reproduced SwiftUI's
  frames, which cut the pixel error to a twentieth, and the result agrees
  with the constants react-native-numeric-text published. A spring's
  overshoot past the landing used to read as
  settled and snapped the glyph sharp half way through. On iOS and Android
  a glyph part way out of focus is the two nearest of six blurred copies
  cross-faded, not the sharp glyph cross-faded with one fully blurred copy,
  which showed a sharp digit inside a glow and read as a highlight rather
  than a blur. On Android the sharp copy is a mask bitmap like the blurred
  ones, not hardware text: text snaps to whole pixels as it moves and a
  bitmap does not, and cross-faded the two slid in and out of register as
  the spring settled, a bold/pale flicker at low blur; and each glyph's
  bitmap is landed on whole device pixels, since a sharp bitmap drawn
  between pixels is resampled and, creeping along the spring's tail, it
  cycled crisp and soft once per pixel of travel (a shimmer a blurred copy
  hides), and the last swap frame is now pixel for pixel the strip that
  takes over from it. The blurred glyph masks are rendered on a background
  thread as soon as the numeric transition is set, immutable and uploaded
  ahead of their first draw; made on demand, the first change after launch
  blocked the UI thread for 120–145 ms and dropped over 30 frames on a Galaxy
  A22, and now drops none to a few. The two blur levels of a glyph are now weighted so
  that composited one over the other they add up to the glyph's opacity;
  weighted (1 − w) and w they came out only 75 % opaque half way between
  levels, and the digit pulsed at every level crossing. Every renderer
  draws the pair the same way: the
  glyph's sharp and a blurred image cross-faded (Core Image on iOS, a
  software blur once per font on Android, a canvas filter on the web), so a
  frame of the transition costs what a frame of a roll does. The effect is
  our own reading of the SwiftUI one; Giulio Amato's
  [react-native-numeric-text](https://github.com/AmatoGiulio/react-native-numeric-text)
  is a native re-implementation of it for React Native `Text` if a whole
  text should transition rather than a rolling number. Checked frame by
  frame against SwiftUI's own transition (a small reference app on the
  simulator, same font size and colour): the direction had been ours the
  wrong way round, so a value that grows now moves the glyphs up, the way
  SwiftUI and an odometer do; the glyphs come in nearly full size from half
  a line height away; and the arriving glyph comes into focus on its own
  slower clock (`Wheel::focus`, over the whole duration) after the spring
  has landed it, which is what makes the effect read as SwiftUI's rather
  than as a quick fade. On iOS the blurred glyph images are a vImage tent
  convolution now instead of Core Image, whose first render of a session
  stalled the main thread for longer than the swap, and the ten digits'
  sharp and blurred images are rendered a turn after mount, so the first
  change of a session plays whole. On Android the blurred glyph is an
  `ALPHA_8` mask filled with the digit colour at draw time, a quarter of
  the memory of the coloured bitmap it was, and its radius matches iOS's.
  A swapping glyph is no longer clipped to its digit cell, on any platform:
  a blurred glyph's haze reaches well past the cell, and cut off at it the
  haze ended in a hard edge, a pale box around every digit in transit (on
  iOS the swap layers now sit on an unclipped layer above the strip
  containers; on Android and the web the swap is drawn without the cell's
  clip rect).

- `transition="scramble"`, on the same machinery: each changed digit shows
  a different random digit every few frames, never the one it is leaving or
  arriving at, until it locks on its target, the lock running from the left.
  The engine does all of it, a renderer draws its strip as usual. Each swap
  style has its own `duration` / `easing` / `stagger` defaults (scramble
  500 ms, `linear`, 60 ms).

- The change flash and the pop, with any transition. `flashUpColor` /
  `flashDownColor` light every digit whose glyph changes in the up or the
  down colour, keep it lit while it moves, and fade it back over
  `flashDuration` once it has landed; a snap under Reduce Motion lights and
  fades at once, a `jumpTo` never flashes. The tint is the digit's own ink
  mixed towards the colour, whatever it is doing: on a rolling wheel the
  strip itself is drawn again in the flash colour at the strip's own
  offset, so the tint rides the roll (a tinted glyph laid over a moving
  strip read as a doubled digit); on a swapping wheel both glyphs, the
  leaving one and the arriving one, are drawn again in the colour with the
  same blur and fade as their originals (a sharp tinted glyph over a
  blurred one read as a smudge, and a fade that began during the swap
  showed the digit landing already half way back to blue). `popOnChange`
  punches the whole figure on every change, rung out like the reveal's
  landing pop and folded into the same scale the renderers already apply.
  Both are engine state (`Wheel::flash`, `revealScale()`), so every
  renderer reads them the same way.

## 0.1.0

- Android: the digit strip is a software-rendered bitmap inside a layer, and
  it is recorded again when the renderer drops it. Two things were wrong with
  the strip as a layer of GPU-rasterized text. Its digits came out thinner
  and paler than the sign and affixes drawn as glyphs beside them, visibly on
  a small red change value; text the software renderer rasterizes into a
  bitmap has the pixels it should, and the bitmap goes into a layer once
  because drawing it per wheel costs the renderer several milliseconds a
  frame more than a layer does. And HWUI deletes a node's display list the
  moment nothing in the view tree draws it, so once every rolling number on
  screen had been unmounted and new ones mounted (or the app had been in the
  background) the next ones reported their value to accessibility and painted
  blank; the strip is recorded again whenever its display list is gone. At
  rest the window lands on whole device pixels so a small digit is not
  resampled soft. Found by the example's new Recycle check screen and
  `scripts/ui/recycle-check.mjs`, which drive a 400-row list through argent
  and compare what every visible row reports with what it painted, frames
  in the middle of a roll included.

- Memory: a dropped rolling number is freed when Fabric drops it. The Nitro
  hybrid behind a view is kept alive by its C++ part until the JS handle from
  `hybridRef` is garbage-collected, and Hermes collects a handle it takes for
  an empty object only when the JS heap fills up. On Android the hybrid held
  the platform view, so in a mount/unmount loop on a Galaxy A22 every dropped
  view stayed allocated: 24 more live `View`s per cycle, each with a digit-
  strip texture, about 1 MB of resident memory a cycle, linear for as long as
  the loop ran (the same for the fields of `react-native-nitro-input`). Now
  the Android hybrid lets go of its view on drop (unless Fabric is recycling
  it), so what lingers is a shell; iOS, where Fabric pools the component view
  and reuses it, releases the display link, the element layers, the engine's
  wheels and the buffers on drop. The digit strips (Android `RenderNode`s, iOS
  glyph and strip images) are shared by every rolling number drawn with the
  same font, colour and density instead of rasterized per view, and the
  hybrid reports its `memorySize` to Nitro so the handle is collected in
  time. `dispose()` on the ref does the same release eagerly.
- Android draws a settled wheel from a shared digit strip (one layer per
  font and blank-zero variant, recorded once, drawn at an offset) instead of
  two `drawText`s per wheel per frame, the way iOS has moved a `CALayer`
  strip since the layer renderer. On a Galaxy A22 at 90 Hz
  with 24 numbers fed a new value every frame, `onDraw` recording went from
  9.4 ms to 2.6 ms a frame and the `value` prop path from 72 fps with 91
  dropped frames in five seconds to 89 fps with 7; needs Android 10, older
  devices keep the text path (so does a wheel still growing or shrinking).
- A value change no longer re-applies the whole configuration. The wrapper
  sent `NaN` for an unset colour, Nitro only calls a native setter when a
  prop's value changed, and NaN never equals itself, so every render re-set
  the colour, marked the configuration dirty and had the format, timing,
  typography and shimmer applied again on each value. The sentinel is
  `Infinity` now (both platforms already read a non-finite colour as the
  platform default).
- iOS renders a roll from the display link's tick only: `animate(to:)` also
  rendered the layers immediately, so a value stream did two layer passes per
  view per frame. And a frame now sets only the layer properties that moved
  (affixes, separators and wheels at rest were re-set every frame; each Core
  Animation setter costs a transaction entry and a KVO round trip).
- The roll runs at a ProMotion panel's full rate: the display link asks for
  the screen's maximum refresh rate (as a Reanimated animation does); a
  default display link stays at 60 Hz on a 120 Hz iPhone.

- `jumpTo` and `animateTo` now agree on large figures: `jumpTo` clamped the
  scaled magnitude at 10^15 while a roll clamped at 10^17, so with 9 fraction
  digits any value above 10^6 jumped to "1,000,000" but rolled to the right
  digits. Both paths share one limit (10^17, the 18 wheels); a double has no
  exact integers past 2^53 either way.
- The digits follow a light/dark switch again when no `color` is set. iOS
  rasterizes the glyphs with the resolved label color and re-rasterizes on a
  trait change (also when the view moves to a display with another scale, and
  the pixel density now comes from the view's traits instead of the deprecated
  `UIScreen.main`); Android rebuilds its paints on a configuration change.
- Less work per frame: iOS reuses its wheel and element buffers, keys the
  glyph caches by a value type and compares layers in place instead of
  building arrays to compare; Android pools its layout elements, splits the
  affixes once per format and slides one cached shimmer gradient instead of
  allocating one per frame. Both platforms format the accessibility text only
  when VoiceOver / TalkBack asks for it, instead of on every value update.
- Android reads the animator duration scale once (refreshed by a settings
  observer) instead of querying the settings provider on every `animateTo`
  below API 33.
- The `ref` handle is created once per mount; `getValue()` reads the latest
  prop through a ref instead of the handle being rebuilt on every value change.
- Packaging: `lib/` now ships an ES module build (`lib/module`), a CommonJS
  build (`lib/commonjs`) and the declarations (`lib/typescript`), with
  `import` / `require` conditions in `exports`; the previous output was ES
  modules only, which a CommonJS consumer could not load. `@types/node` and
  `@types/react-test-renderer` are declared instead of relying on hoisting.
- Android build: the Android Gradle plugin is only pinned when the library
  builds on its own (an app's root project already provides it), Java 17
  source/target, an unused `kotlinVersion` property removed, and
  `cmake_minimum_required` before `project()`.
- Removed dead code: the engine's unused `revealFraction`, the allocating
  `frame()` JNI method (the view uses `frameInto`).

- The native prop behind `direction` is now `rollDirection`. The public prop is
  unchanged — the wrapper maps it — but `direction` is Yoga's layout property,
  and because a Hybrid View's props derive from `ViewProps` React Native parsed
  ours too, logging `Could not parse yoga::Direction: up` on every update.

- Initial release: native rolling number view (iOS + Android) built with Nitro Modules.
- `value`-driven digit roll with easing/spring, `stagger` and `direction`.
- Formatting: fraction digits, grouping and decimal separators, prefix/suffix with independent font sizes and `top` / `bottom` / `baseline` / `center` pinning, zero padding, negatives.
- `adjustsFontSizeToFit` / `minimumFontScale` with a continuous scale that keeps the box fixed.
- `loading` shine glint (`shimmerColor`, `shimmerDuration`).
- Imperative `animateTo` / `jumpTo` / `getValue` via ref.
- VoiceOver / TalkBack read the formatted amount; Reduce Motion / "remove animations" snap instead of rolling.
- `allowFontScaling` / `maxFontSizeMultiplier` (off by default).
- View recycling (`RecyclableView`) for long lists.
- Rapid updates: a value that arrives mid-roll continues with the ease-out half of the curve instead of restarting from rest, so per-frame `value` updates keep rolling.
- Auto-size: when the settled width shrinks mid-roll the smaller size is reported after the roll finishes, so `adjustsFontSizeToFit` no longer squeezes the still-rolling digits and the amount no longer dips and grows back.
- Android: the per-frame engine bridge fills a reused array instead of allocating one.
- iOS renders with Core Animation layers (a wheel is a clipped strip of pre-rasterized digits that moves per frame) instead of redrawing a bitmap; the Core Graphics path is only used while the loading glint shows. `jumpTo` / `animateTo` coalesce to the newest value per main-thread turn on both platforms. See `BENCHMARKS.md`.
- Jackpot reveal (`reveal`, `revealStyle`, `revealDuration`, `revealBounce`, `revealStagger`, `revealMilestones`, `revealMilestoneHold`, `onRevealMilestone`, `onRevealEnd`, `revealTo()`): the casino win-meter rollup (count from 0, digits swapping in place, leading digits appearing as the count reaches them, tiers that punch and hold with equal time per tier) and the slot-reel reveal (reels spin, then lock from the left with a mechanical bounce), both landing with a spring pop. All in the shared engine; snaps under Reduce Motion.
- `affixAlign="bottom"` now pins the bottom of the glyphs' ink (a currency code sits on the digits' baseline) instead of the line boxes, which hung the affix down to where a comma's tail reaches.
- Docs site (`docs/`) with live demos driven by the engine compiled to WebAssembly.
- The count reveal now tallies like a slot's win counter (after the gaming-machine patents US 9,495,843 and US 9,111,423): a constant rate per tier that winds up out of each milestone and crawls into the next, the figure opening smaller and growing to full size over the count (`revealGrow`, default 0.2), and punches that are a single overshoot settling back without dipping under the resting size (`revealBounce` default 0.12).
- Reveal callbacks survive view recycling: a recycled view (Fabric reuses instances when a screen is swapped) dropped the hybrid's `onRevealEnd` / `onRevealMilestone` wiring, so no reveal reported its end after the first screen change on iOS.
- The wrapper always sends every native prop with an explicit value (defaults, `''` for fonts, `NaN` for "platform default" colors, `[]` for no milestones, a numeric `revealState`): removing an optional prop used to reach native as `null`, which Nitro's parser rejects and React Native turns into a fatal error.
