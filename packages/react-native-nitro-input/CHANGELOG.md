# Changelog

## 0.3.0

- **`NumberFormat`**: `Intl.NumberFormat`'s API, formatted natively.
  `new NumberFormat(locales, options)` learns the locale's format once from
  the platform's formatter (Foundation / ICU, the data Hermes' `Intl` uses)
  and formats in C++ from then on: `format`, `formatToParts` (on iOS too),
  `formatRange`, `formatRangeToParts`, `resolvedOptions` and
  `supportedLocalesOf`, every option of `Intl.NumberFormatOptions` (compact
  notation, units and currency names printed by the platform formatter),
  numbers, bigints and decimal strings. It passes 242 of test262's 251
  `intl402/NumberFormat` tests on iOS and 244 on Android (Hermes' own `Intl`:
  121 and 101). On a Galaxy A22 a formatter builds in 9 µs instead of 3.3 ms
  and formats in 2.8 µs instead of 10 µs. Where Hermes departs from ECMA-402 (iOS rounds ties to even on
  the binary double, and prints NaN and infinities without the currency;
  Android shows narrow currency symbols in zh-CN) it follows the
  specification, as V8 does.
- **`format`** on `NitroNumber` and `NitroInput`: pass a `NumberFormat`
  and the component takes its prefix and suffix, separators, fraction digits
  (and, for the input, where the sign goes) from it; the individual props
  still override.
- **`letterSpacing`**, **`prefixSpacing` / `suffixSpacing`** and
  **`prefixOffset` / `suffixOffset`** on both components: tracking like
  `Text`'s (affixes in proportion to their size), an exact gap between an
  affix and the digits, and a nudge of an affix after its alignment.
- **`tabularNums={false}`** on `NitroNumber`: each digit at its own width
  (the font's proportional figures) instead of the widest digit's. A
  changing column's width eases once from the old digit's to the new one's,
  on the roll's own easing, and a reveal keeps its target's widths
  throughout. Tabular stays the default.
- **`direction="shortest"`** on `NitroNumber`: each digit rolls its own
  shorter way round (1 → 2 is one step up even when the value falls), which
  keeps a big jump calm; `auto` still follows the sign of the change.
- An `accessibilityLabel` given to `NitroNumber` is what VoiceOver and
  TalkBack read; the figure was read instead.
- **Breaking:** the Android `minSdkVersion` default is 24 (was 23), as
  React Native's: `NumberFormat` reads the platform's formats through
  `android.icu`.

## 0.2.0

- `react-native-nitro-rolling-number` is part of this package now, and its
  `RollingNumber` is called **`NitroNumber`**, next to `NitroInput`: it plays
  more than a roll (the numeric transition, the scramble, the reveal), and
  the name says which package it comes from. The props and the handle are
  the same; the types follow the name (`NitroNumberProps`,
  `NitroNumberHandle`, `NitroNumberTransition`, …). Its engine, views and
  JNI handle build into the `NitroInput` pod and `libNitroInput.so` next to
  the input's, and its JS helpers (font weights, colours) are shared with
  `NitroInput` instead of copied. Replace the import and drop the old
  package: `import { NitroNumber } from 'react-native-nitro-input'`.
- **Breaking:** the morph is called the reflow, which is what it does: the
  characters keep their shapes and move to where the new text puts them.
  `MorphInput` and the `morph` prop are gone; pass `transition="reflow"` to
  `NitroInput` instead (`'none'`, the default, is the plain field). A
  reflowing field sizes itself to its content unless told otherwise, as
  `MorphInput` did: `autoWidth` defaults to `'auto'` with it. The C++ engine
  is `ReflowEngine` (was `MorphEngine`), and the docs page moved to
  `/input/reflow`, with a redirect from `/input/morph`.

### NitroNumber

- A change of `prefix`, `suffix`, `groupingSeparator` or `decimalSeparator`
  plays instead of snapping: the old text softens and fades out while the
  new one comes into focus, on the numeric transition's springs, and its
  width eases from one to the other (`RollingEngine::changeText`). A change
  of `fractionDigits` plays too, in every transition
  (`RollingEngine::changeFormat`): the digits keep their place value, the
  decimal columns that go close, new ones open blank and swap or roll their
  digit in, and the decimal separator fades with them. A currency switch is
  one transition, as SwiftUI's numeric text makes it, even when the next one
  comes before it has finished (it used to show the old amount in the new
  format for a frame, "¥838,712.00").
- `transition="numeric"`: a column opens on the arriving glyph's spring and
  closes on the leaving glyph's blur, instead of the transition's easing,
  which lagged the glyph and left a gap where a digit had just left.
- Android: a glyph fading with its column (a separator, the sign) left the
  shared paint faded, and the next frame's digits were drawn faint or not at
  all; a translucent `color` also turned opaque after the first change.
- A figure that hugs its content no longer jumps when it gains or loses a
  digit at the end of a row. The view takes its new width at once, and with
  the digits kept to its start edge a right-pinned figure (a fee at the end
  of a `space-between` row) jumped a digit to the left and then opened a gap
  after its prefix. `textAlign="auto"` now keeps the digits to whichever edge
  the parent keeps the view to; a view with its own width is unchanged.
- A column opening or closing (a new leading digit, a separator, the sign)
  keeps its glyph whole instead of cutting it to the half-open column, where
  it read as a sliver: the right edge of a "1", a ")" of a 0 rolling past.
  The glyph overhangs the column's far side, faded with it.
- `transition="numeric"`: a value re-targeted while a column was still
  swapping to a glyph it keeps (typing, every keystroke) no longer cuts the
  swap short; the column carries on from where it was, as SwiftUI's does.
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


### Performance

- iOS: Swift called every read-only method of a C++ engine on a copy of
  it, vectors and all, dozens of times a frame per figure. `RollingEngine`,
  `ReflowEngine` and `AmountFormatter` are `SWIFT_NONCOPYABLE` now and Swift
  reads them in place. On an iPhone 11 Pro with 52 figures updating, a
  frame's layout work went from ~45 to ~14 ms a second.
- iOS: every figure wrapped its frame in an explicit `CATransaction` to turn
  implicit animations off, which outside UIKit's own transaction is a
  commit to the render server per figure per frame. The layers never
  animate implicitly now (`QuietLayer`), so a frame's changes join the run
  loop's one transaction; a reflowing `NitroInput`'s layers too. Roll
  render ~235 → ~68 ms a second, main thread ~265 → ~190.
- The numeric transition's blurred glyphs are kept while they are in use.
  A cache that started over at a fixed count dropped glyphs about to be
  drawn again on a screen with a few fonts and colours: on iOS ~2,900
  vImage blurs a second (render ~750 → ~140 ms a second, 52 → 60 fps on
  the 11 Pro); on Android the masks are bounded by size and each font set
  keeps its own (numeric draw 6.9 → 4.4 ms a frame on a Galaxy A22).
  A screen of many styles keeps more memory for them (~14 MB for a
  52-figure dashboard in nine font/colour pairs on iOS), released on a
  memory warning.
- Android: prefixes, suffixes and separators are shaped once and drawn as
  glyphs (`TextRunShaper` + `Canvas.drawGlyphs`, API 31+) instead of
  re-shaped by `drawText` every frame: ~45 → ~5 µs a draw on a Galaxy A22,
  a frame's draw for 52 figures 5.9 → 4.4 ms. A resting wheel is one bitmap
  copy. A reflowing `NitroInput` draws its glyphs the same way: its draw
  per animation frame halved (2.0–2.2 → 1.0–1.1 ms).

## 0.1.0

### NitroInput

- Memory: a dropped field is freed when Fabric drops it. The Nitro hybrid
  behind a view is kept alive by its C++ part until the JS handle from
  `hybridRef` is garbage-collected, and Hermes collects a handle it takes for
  an empty object only when the JS heap fills up. On Android the hybrid held
  the platform view, so in a mount/unmount loop on a Galaxy A22 every dropped
  field stayed allocated (about 60 live `View`s more per cycle, linear). Now
  the Android hybrid lets go of its view on drop (unless Fabric is recycling
  it); iOS pools and reuses the component view. The hybrid reports its
  `memorySize` to Nitro so the handle is collected in time, and `dispose()`
  on the ref stops the animation eagerly, as a drop does.
- An unset colour is sent as `Infinity`, not `NaN`: Nitro only calls a native
  setter when a prop's value changed, and NaN never equals itself, so every
  render of a controlled field (every keystroke) re-set the colours and had
  the whole configuration applied again. Native already read a non-finite
  colour as the platform default.

- Initial release: native single-line text / amount input (iOS + Android) with Torph-style text morphing, built with Nitro Modules.
- One shared C++ engine (`cpp/ReflowEngine`): caret matching for edits (grouping separators paired from the units end), place matching for programmatic sets, longest-common-subsequence for text; digits slide through the line box, separators from below, text fades and scales; entering and leaving characters ride with their nearest persisting neighbour; `expo` / `easeOut` / `easeInOut` / `linear` / `spring` timing; Reduce Motion snaps.
- `mode="number"`: every edit is formatted natively before a frame is drawn (`cpp/AmountFormatter`): grouping, one decimal, `fractionDigits` / `maxIntegerDigits` limits that reject the keystroke, backspace over a separator removes the digit before it, a decimal typed in the integer part moves the decimal point, `prefix` / `suffix` with their own sizes and alignment.
- Controlled `value` with the `text` + `mostRecentEventCount` handshake (a stale value never fights the user); `onChangeText`, `onChangeValue`, `onFocus` / `onBlur`, `onSubmitEditing`; `focus` / `blur` / `clear` / `setText` / `setValue` / `getText` / `getValue` / `isFocused`.
- Worklets (optional, with `react-native-worklets`): a `transform` worklet and `'worklet'`-marked `onChangeText` / `onChangeValue` run synchronously on the UI thread inside the native edit, via a `NitroInputWorklets` bridge that holds the worklets UI runtime; no-ops when the package is not installed.
- `mode="mask"`: a fixed pattern applied natively as you type, from one shared compiled state machine (`cpp/MaskEngine`) — `[…]` editable blocks, `{…}` inserted literals, built-in `0 9 A a _ …` slots plus caller-defined ones via `maskNotations`; `maskAutocomplete` / `maskAutoSkip`; `onChangeMask` reports formatted text, extracted value, the remaining tail and completeness. Autocompletion only runs with the caret at the end, so editing mid-value does not fight you.
- Outlined and filled frames: `variant`, `label`, `labelBehavior`, `labelColor` / `labelFocusedColor` / `labelFontSize`, `strokeColor` / `focusedStrokeColor`, `strokeWidth`, `cornerRadius`, `fillColor`. The outlined notch is a real hole in the stroked path (shared `cpp/OutlineGeometry`, replayed identically on both platforms), so the background shows through it — no Skia. Timings follow Material's: 200 ms label on the standard decelerate curve, notch staggered 50 ms behind opening and 50 ms flat closing, driven entirely inside the view with no React state and nothing crossing into JS per frame. `label` also becomes the field's accessible name when nothing else supplies one.
- `setSelection(start, end)` on the ref (code point offsets).
- `NitroInput` is now the component, and `MorphInput` the thin wrapper over it — the general-purpose field was being defined as a special case of the specific one, which is why its props had to subtract the morph API back out. Both public APIs are unchanged. The `plain` prop is gone, replaced by its inverse `morph` (off by default), because `plain` only meant "no glyph engine" as an accident of the morph case being built first.
- `autoWidth` takes `'auto'` as well as a boolean. `NitroInput` defaults to `false`, so flexbox stretches it to its parent the way a `TextInput` is stretched; `MorphInput` uses `'auto'`, so an amount still grows as digits arrive.
- Fixed: in a plain field (no `morph`) a tap landed the caret at the start of the text wherever it fell, so a filled field tapped to refocus it came up with the caret before its first character. Tap-to-caret went through the morph engine's glyph boundaries on both platforms, which a plain field never feeds; it now defers to the system field's own mapping there.
- Fixed: `autoWidth` on a plain field (no `morph`) collapsed it to a couple of points. The reported width was the morph engine's, which a plain field never feeds; it now measures the text (or the placeholder) and the affixes with the fonts the field draws them in, on both platforms. Covered by an on-device Harness test.
- Fixed: negative amounts lost their sign; number formatting followed `LC_NUMERIC`, so a comma-decimal locale broke parsing; the worklets bridge held the UI runtime by `shared_ptr`.
- Fixed: the frame props were originally `outline*`, which collide with the CSS outline properties React Native 0.76 added to every view — a Hybrid View's props derive from `ViewProps`, so both parsers ran and RN drew a second square outline. A test now fails the build if any declared prop name collides with one React Native parses.
- `TextInput` parity, checked side by side in `src/__tests__/TextInputParity.test.tsx` against React Native's real component and its own `TextInput.d.ts`: every `TextInput` prop is either supported, inherited from `ViewProps`, or listed with a reason. Added `submitBehavior` (with the `blurOnSubmit` alias), `secureTextEntry`, `keyboardAppearance`, `textContentType` / `autoComplete`, `enablesReturnKeyAutomatically`, `showSoftInputOnFocus`, `selectTextOnFocus`, `clearTextOnFocus`, `contextMenuHidden`, `spellCheck`, `readOnly`, `selection`, the HTML-style aliases `inputMode` / `enterKeyHint` / `id` / `aria-label` / `rows` (resolved with React Native's own tables and precedence, since a Nitro view is handed the raw props), and the callbacks `onChange`, `onEndEditing`, `onSelectionChange` and `onKeyPress`.
- The field registers in React Native's text-input registry and routes the registry's `focusTextInput` / `blurTextInput` to its own native focus and blur, so `Keyboard.dismiss()`, `TextInput.State.currentlyFocusedInput()`, a ScrollView's `keyboardShouldPersistTaps` and `react-native-keyboard-controller` treat it as the text input it is. `testID` and `accessibilityLabel` are forwarded to the system field (the element VoiceOver, TalkBack and e2e tools interact with), and the `placeholder` is its accessibility value while it is empty. `TextInput.State.focusTextInput` / `blurTextInput` copy their references when `TextInput.js` loads and so bypass the routing: iOS answers the view command they dispatch, Android drops it.
- Every event is a superset of `TextInput`'s: `nativeEvent` carries React Native's fields under React Native's names, so a handler written against a `TextInput` works unchanged, and the same fields are repeated at the top level (`onSubmitEditing={({ text }) => …}`). `onFocus` / `onBlur` carry `text`, `eventCount` and `target`.
- `multiline`, with `numberOfLines` / `rows`, `textAlignVertical` and `scrollEnabled`. A wrapping field is drawn by the system view (on iOS a `UITextView` built the first time it is asked for), grows with its content unless given a line count, and is always `mode="text"`: `morph`, a non-text `mode` and the `prefix` / `suffix` affixes are ignored alongside it, with one warning each in development. Its return key inserts a line break by default (`submitBehavior="newline"`), as a `TextInput`'s does. `lineHeight` on both platforms, with the CSS meaning (the total height a line occupies), honoured tighter than the font too — the case React Native's own correction skips.
- Every event callback can be a worklet: mark `onChangeText`, `onChangeValue`, `onFocus`, `onBlur`, `onSelectionChange`, `onSubmitEditing`, `onEndEditing` or `onKeyPress` with `'worklet'` and it runs on the UI runtime inside the native edit, and is not also called on the JS thread. `useNitroInputState(useSharedValue)` builds on that: the field's `text`, `value`, `focused` and `selection` as shared values, plus the handlers that keep them current.
- `signPlacement`: where a negative amount's sign sits relative to the `prefix`, `'beforeAffix'` (`-$1,234.56`, the default) or `'afterAffix'` (`$-1,234.56`). Only the morph honours it; a plain field's affixes are accessory views outside the text, so it always reads `$-1,234.56`. Fixed: the morph drew `$-1,234.56` unconditionally.
- Right-to-left. `textAlign` gains `'auto'` and **defaults to it** (it was `'left'`): the start edge of the layout direction, as `TextInput` with no `textAlign`. `'left'` and `'right'` are absolute on both platforms (Android used to resolve `'left'` as start). The direction is resolved on the JS side, from `style.direction` else `I18nManager.isRTL`, and handed to native, because Fabric does not give a Hybrid View its layout direction. A `prefix` sits at the start edge and a `suffix` at the end, plain or morphed, with the digits still reading left to right; the frame's label and its notch sit at the start edge.
- Fixed: from React Native 0.86 a Hybrid View on Android received none of its base view props (`backgroundColor`, `border*`, `transform`, `opacity`, `testID`, accessibility): `react-native-nitro-modules` 0.37.1's `cloneProps` never fills `Props::rawProps`. The monorepo patches it (`patches/react-native-nitro-modules@0.37.1.patch`, filed as margelo/nitro#1656) and `src/__tests__/NitroViewProps.test.tsx` fails if the patch stops being applied.
- Fixed: a framed multiline field grew taller with its `cornerRadius` (the label's side inset was being reused as vertical padding); its label rested at the box's centre rather than on the first line; on Android the frame's padding was computed and then left out of the reported height.
- An uncontrolled or worklet-driven field no longer re-renders on every keystroke: the native edit count is kept in a ref, and only a controlled field (`value` given) takes the state update that forces a render, which is the one case native needs the count for. A field made controlled later still sends the fresh count.
- `submitBehavior` gains `'newline'`, and the defaults are resolved the way `TextInput` resolves them: `'blurAndSubmit'` on a single-line field, `'newline'` on a multiline one; `blurOnSubmit={false}` means `'submit'` on one line, and `blurOnSubmit` means `'blurAndSubmit'` on many.
- `maskNotations` is keyed on its contents, so an inline array literal no longer re-sets the native prop every render; the frame and caret colours, the flattened `style` and the imperative handle are memoised, and the handle is one object for the field's lifetime.
- Exported types: `NitroInputSignPlacement`, `NitroInputTextAlignVertical`, `InputMode` and `EnterKeyHint`; `textAlignVertical` is typed by the spec's `NitroInputTextAlignVertical`, and `NitroInputSelection` is declared once.
- Packaging: a dual build (`lib/module` for `import`, `lib/commonjs` for `require`, `lib/typescript` for the types) with matching `exports`; `react-native-worklets` is declared as an optional peer dependency, since it is loaded at runtime when present.
- Fixed on Android: the `onChangeValue`, `onFocus` / `onBlur`, `onSelectionChange`, `onSubmitEditing` and `onEndEditing` worklets kept running a stale handler after the callback changed (their ids never reached the view).
- `submitBehavior` is honoured natively on a multiline field on both platforms: `'newline'` inserts a line break, `'submit'` fires `onSubmitEditing` and keeps focus, `'blurAndSubmit'` fires it and dismisses the keyboard; on a single-line field `'newline'` does nothing, as with `TextInput`. A wrapping field that submits shows the IME's action key on Android.
- The field follows a light/dark switch without a remount: iOS re-rasterizes its glyphs and re-resolves the frame, label and caret colours on a trait change (and on a move to a display with another scale; the pixel density now comes from the view's traits instead of the deprecated `UIScreen.main`, which visionOS lacks), Android re-reads its theme colours on a configuration change.
- iOS: `focus()` / `blur()`, `Keyboard.dismiss()` and a ScrollView's auto-blur now reach a multiline field (the Fabric command only looked for a `UITextField`). `maxIntegerDigits` accepts up to 30, as on Android. Turning `morph` back on after plain mode no longer leaves the field blank until the next edit.
- Android: toggling `secureTextEntry` at runtime re-feeds the glyphs (the real characters used to stay on screen until the next edit); `maxLength` no longer clips a mask's own punctuation (it applies to `mode="text"` only, as on iOS); `focus()` and `autoFocus` respect `showSoftInputOnFocus={false}`; a `lineHeight` removed at runtime resets the spacing; tabular figures in text mode too, matching iOS.
- Less work per frame and per keystroke: iOS keeps one layer entry per glyph and re-uses it (no per-glyph allocation per frame), positions the caret once per step and caches the right-to-left caret blocks when a frame is published; Android resolves its theme colours once instead of per draw, reads the animator duration scale once (refreshed by a settings observer) instead of querying the settings provider per keystroke below API 33, and the outlined frame's geometry is written into a reused buffer instead of two vectors per draw.
- Removed dead code: `MaskEngine::format` / `totalTextLength` / `totalValueLength` / `placeholder`, the worklets bridge's `uninstallRuntime` and `isReady`, `ReflowEngine::rightToLeft`, the unused JNI bindings behind them, and an unreachable pre-iOS-15 branch.
- Android build: the Android Gradle plugin is only pinned when the library builds on its own, Java 17 source/target, an unused `kotlinVersion` property removed, `cmake_minimum_required` before `project()`.
- Fixed: in a plain (text-mode) field with `morph` on, the decimal point of a number typed by hand dipped and rose again on every keystroke after it, although it never moved. The engine took a lone `.` or `,` for a grouping separator and re-paired it from the units end on each edit; it is the decimal point now, part of the typed sequence like the digits. Repeated punctuation (`192.168.0.1`, `21.09.2026`) is still structure.
- `onChangeMask` reports the same way on both platforms: whenever the text changes, from a keystroke, `setText` / `clear` or the `value` prop. iOS used to report the untouched empty text once at mount, and Android never reported a prop change. Found by the new on-device suite.
- A masked field that is emptied stays empty: `clear()`, `setText('')` and an empty `value` prop used to leave the mask's leading literals (`+1 (`) behind, while deleting everything by hand did not, and Android showed those literals in an untouched field at mount. Found by the new on-device suite.
- Android: a wrapping field grows with text set through `setText` / `defaultValue` / `value`, not only with typing. Found by the new on-device suite.
- The handle queues `focus()`, `blur()`, `clear()`, `setText()`, `setValue()` and `setSelection()` sent before the native view has attached and replays them the moment it does, as React Native queues a `TextInput`'s view commands; `useEffect(() => ref.current?.focus(), [])` and a `focus()` in a ref callback used to be silent no-ops. Found by the on-device suite that mirrors React Native's own `TextInput` tests.
- `aria-busy`, `aria-checked`, `aria-disabled`, `aria-expanded` and `aria-selected` fold into `accessibilityState`, `aria-hidden` hides the element, and `aria-labelledby` reaches the host, the way `TextInput` resolves them (a Nitro view is handed the raw props, which the native parser drops). `NitroInput` and `MorphInput` carry a `displayName`.
- Docs page with a live demo running the same engine and formatter compiled to WebAssembly.

### RollingNumber (react-native-nitro-rolling-number 0.1.0)

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
