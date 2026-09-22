# NitroInput vs. React Native's TextInput

Measured on an iPhone 17 Pro simulator (iOS 26.4) and a Pixel 9 Pro emulator
(API 37), React Native 0.87, `react-native-keyboard-controller` 1.22.5,
`@react-navigation/native-stack` 7.19.2. The harness is the example app's
**Input parity** screens (`example/src/screens/`), which render a `NitroInput`
and a `TextInput` side by side under identical props and log every callback.

Everything here that can be checked without a device is also checked by
`src/__tests__/TextInputParity.test.tsx`, which renders both components under
the same props and asserts they agree. It un-mocks React Native's `TextInput`
first - the jest preset replaces it with a stub, and asserting against that
would prove nothing - and it reads the prop list out of RN's own `TextInput.d.ts`,
so a prop added upstream fails the suite rather than going unnoticed.

## Summary

NitroInput now behaves like `TextInput` for focus, routing, form sheets and
keyboard-controller, and adds native morphing and synchronous amount
formatting on top. The differences that remain are listed at the end.

## Scenarios, both components, both platforms

| Scenario | NitroInput | TextInput |
| --- | --- | --- |
| Typing, `autoCapitalize`, `maxLength`, `placeholder` | ✅ | ✅ |
| `focus()` / `blur()` / `clear()` / `isFocused()` | ✅ | ✅ |
| `onFocus` → `onKeyPress` → `onSelectionChange` → `onChangeText` order | ✅ | ✅ |
| `onSubmitEditing`, `onEndEditing` | ✅ | ✅ |
| `submitBehavior: 'submit'` keeps focus | ✅ | ✅ |
| `autoFocus` on mount | ✅ | ✅ |
| `autoFocus` on a pushed native-stack screen | ✅ (onFocus +46 ms) | ✅ |
| `autoFocus` inside `presentation: 'formSheet'` | ✅ (sheet lifts, caret visible) | ✅ |
| `TextInput.State.currentlyFocusedInput()` | ✅ | ✅ |
| `Keyboard.dismiss()` | ✅ | ✅ |
| `TextInput.State.blurTextInput()` / `focusTextInput()` | ✅ iOS (via the Fabric view command) · ✗ Android — see difference 6 | ✅ |
| ScrollView `keyboardShouldPersistTaps` auto-blur | ✅ | ✅ |
| testID / a11y label / placeholder on the real input element | ✅ | ✅ |
| `secureTextEntry` | ✅ (bullets drawn; real text kept for autofill) | ✅ |

### keyboard-controller

| | NitroInput | TextInput |
| --- | --- | --- |
| Focused-input observer sees it | ✅ `target 332 · parentScroll 604 · y 448 · h 50` | ✅ |
| Reported layout matches the visible field | ✅ | ✅ |
| `KeyboardAwareScrollView` scrolls it into view | ✅ | ✅ |
| `KeyboardToolbar` next/prev traverses in and out of it | ✅ | ✅ |
| Keyboard height/duration events | ✅ | ✅ |
| Typing still formats with KC's delegate installed | ✅ | n/a |

KC works because its `TextInput` protocol is extended onto plain `UITextField`
(iOS) and it matches any `EditText` (Android) — NitroInput's hidden system
field is both. Its composite delegate forwards `shouldChangeCharactersIn`, so
the synchronous formatting survives.

## Performance

Measured by the **Mount / focus benchmark** screen, Release builds, simulator
and emulator. Mount is the wall time from the state update that renders 20
fields to the last one's `onLayout`, over 5 cold passes. Focus is `focus()` →
`onFocus`, 12 runs.

### iPhone 13 Pro Max (device), n=15 mount / n=12 focus

| | NitroInput | NitroInput | TextInput | `@expo/ui` TextField |
| --- | --- | --- | --- | --- |
| mount 20 fields | 12.9 ms | 12.6 ms | **9.7 ms** | 91.4 ms |
| focus → onFocus | 10.6 ms | **4.5 ms** | 53.7 ms | 107.4 ms |

`@expo/ui`'s SwiftUI field is ~7x our mount and ~24x `NitroInput`'s focus. It
is also invisible to `react-native-keyboard-controller`, which matches
`UITextField` / `EditText`.

### Other targets (medians, before the font fix)

| target | mount: morph | mount: RN | focus: morph | focus: RN |
| --- | --- | --- | --- | --- |
| iPhone 17 Pro **simulator** | 17.2 ms | **8.8 ms** | **4.1 ms** | 29.3 ms |
| Pixel 9 Pro **emulator** | **24.8 ms** | 62.6 ms | **2.0 ms** | 18.4 ms |
| Pixel 10 (**device**) | **30.3 ms** | 41.7 ms | **2.5 ms** | 21.9 ms |
| Galaxy A22 (**device**, slow) | **76.4 ms** | 90.8 ms | **14.1 ms** | 24.8 ms |
| iPhone 13 Pro Max (**device**) | 35.9 ms → **12.6 ms** | 6.9 ms | **4.5 ms** | 53.7 ms |

## Mount: what was wrong, and where the rest of the cost actually lives

The first iPhone measurement had NitroInput mounting **3.6x slower** than
`TextInput`. Two causes, both in `FontSet`:

1. **Every view built its own.** `glyphCache`, `widthCache`, `imageCache` and
   `inkDescentCache` were instance properties, so 20 identical fields each
   constructed three `UIFont`s and re-rasterized the same glyphs through
   `UIGraphicsImageRenderer` — an offscreen draw per glyph, 20 times over.
2. **Every view built it twice.** `init` made a `FontSet` from *default*
   `Typography`, then the first prop flush assigned the real typography, whose
   `didSet` called `rebuildFonts()` and threw the first one away.

Font sets are now shared through a keyed cache (`FontSet.shared(for:)`), since
they are immutable for a given `Typography` and their caches are pure functions
of it.

### The remainder is the Nitro view layer, not this component

iPhone 13 Pro Max, 20 views, **n=15** cold passes (n=5 was under-powered: RN's
own median moved between 6.9 and 12.2 ms across runs, wider than the difference
being measured):

| what is mounted | median | mean | per view |
| --- | --- | --- | --- |
| bare React Native `View` | **4.1 ms** | 4.8 | 0.21 ms |
| React Native `TextInput` | **9.7 ms** | 9.7 | 0.49 ms |
| `RollingNumber` — a *different* Nitro view, no text input, 40 props | **12.2 ms** | 13.5 | 0.61 ms |
| `NitroInput` (full overlay) | **12.6 ms** | 12.8 | 0.63 ms |
| `NitroInput` (plain, no overlay) | **12.9 ms** | 14.0 | 0.65 ms |
| `@expo/ui` SwiftUI `TextField` | **91.4 ms** | 101.8 | 4.6 ms |

(Android, Pixel 9 Pro emulator: `@expo/ui` Jetpack Compose `TextField`
**108.4 ms** for 20, against `NitroInput` 24.8 ms and `TextInput` 62.6 ms.)

An unrelated Nitro view with no `UITextField`, no input handling and 40 props
instead of 65 mounts at the same cost as both of ours. So:

- It is **not the overlay** — `NitroInput` builds none and matches `NitroInput`.
- It is **not the prop count** — 40 props and 65 props cost the same.
- It is the **per-view floor of a Nitro `HybridView`**: creating the hybrid
  object, the Swift/C++ bridge and the component view, about **0.6 ms per view**
  against 0.21 ms for a plain RN `View`.

### Where the Nitro floor comes from

Instruments (iOS simulator, Release, mounting 20 `NitroInput`s) shows **no
Nitro or Swift frame anywhere in the CPU hotspots**. The named main-thread work
is React Native's own: `RCTMountingManager performTransaction` →
`RCTViewComponentView finalizeUpdates` / `mountChildComponentView`, and
`RCTGetBorderImage` (25 of 541 main-thread samples — that one is an artifact of
the benchmark's `borderRadius` + `borderWidth` box, and it applies to every
variant equally). So the Nitro cost is **diffuse** — many small operations, no
single hot function — which matches ~0.4 ms per view spread thin.

Reading `react-native-nitro-modules` alongside that, the parts that run **per
view instance** are:

| per-instance work | note |
| --- | --- |
| `std::dynamic_pointer_cast` in the generated component's `init` | RTTI; the concrete type is known at codegen time, so `static_pointer_cast` would do |
| `_prototypeChain.extendPrototype<Derived>()` | walks the chain doing `typeid` comparisons before hitting the cache |
| `any HybridXSpec` existential in the Swift bridge class | every property access is dynamic dispatch through a witness table rather than a direct, inlinable call; a generic `<T: HybridSpec>` would not be |
| one C++→Swift call per prop, strings converting `std::string` ⇄ `String` | a heap allocation per string prop; could be one batched struct between `beforeUpdate` / `afterUpdate` |
| `Unmanaged.passRetained(view)` + `setContentView:` | a Nitro view is component view **+** content view, one more `UIView` than RN's own components |

What Nitro already does well: the JS prototype is cached both per type
(`if (!prototype->hasHybrids())`) and per runtime (`_prototypeCache`), so none
of the method/property registration repeats per instance.

**Could Nitro improve it?** Probably yes, and the `dynamic_pointer_cast` is a
one-line codegen change. But the evidence says the wins are small and spread
out rather than one hot spot — nothing here suggests a large factor is sitting
on the table. Caveat: the simulator trace aggregates most main-thread work
under `UIApplicationDelegate.main()`, so attribution is limited; pinning these
down properly needs signposts around hybrid creation, or a device trace with
full symbolication.

That floor is not something this package can fix; it would take a change in
`react-native-nitro-modules`. Against `TextInput` it costs roughly **0.15 ms
per field** — about 3 ms for a 20-field screen, and nothing at all for a normal
form. Worth knowing before rendering hundreds.

For scale, `@expo/ui`'s native field costs **4.6 ms per field** on iOS
(SwiftUI) — about 7x either of ours and 9x `TextInput` — and **5.4 ms** on
Android (Jetpack Compose, 108.4 ms for 20 on the Pixel 9 Pro emulator, against
NitroInput's 24.8 ms and `TextInput`'s 62.6 ms). (Its number carries one wrapper `View`
per item — `Host` has no `onLayout` — so subtract ~0.2 ms of the 4.6.) Hosting
SwiftUI inside a UIKit hierarchy is simply expensive; that is the trade for the
declarative API.

## Focus

**Why focus is faster:**

| | NitroInput | TextInput |
| --- | --- | --- |
| JS → native | JSI call straight into the hybrid, then `DispatchQueue.main.async` — the **next main-runloop turn** | `TextInputState` → a Fabric **view command**, applied with the mounting transaction |
| native focus | `becomeFirstResponder` / `requestFocus` | same |
| native → JS | the field's own delegate fires inline and invokes the Nitro callback | the component view emits through the **batched event emitter** |

So the win is scheduling, not raw work: NitroInput waits for a runloop turn
where `TextInput` waits for a commit and an event batch. The numbers line up
with that reading — RN's 29.3 ms on the iOS simulator is about two 60 Hz frames
and 53.7 ms on the iPhone is more, its ~18–25 ms on Android is about one, and
NitroInput's 2–4 ms on fast hardware is sub-frame.

**Both are asynchronous**, which the benchmark checks rather than assumes: the
ordering probe reports `call focus() → focus() returned → onFocus` for *both*
components, so this is the same event measured the same way, not one component
answering earlier because it answers synchronously.

**Where it does and does not matter.** Tapping a field is unaffected — the OS
gives it first responder directly and no JS is in the loop. The gap only shows
up on *programmatic* focus: auto-advancing to the next field, focusing after a
state change, `autoFocus` on a newly pushed screen. There, ~25 ms is about a
frame and a half of dead time before the keyboard starts animating.

**Mount is not a wash, and it goes different ways per platform.** On iOS
NitroInput costs about twice a `TextInput` (it builds a `UITextField`, the
overlay layers and the engine, where RN builds one `RCTUITextField`). On
Android it is about 2.5× *cheaper*, because RN's `ReactEditText` is the heavier
of the two. Neither is likely to matter below a few dozen fields on a screen;
if you are rendering a very long iOS form, the difference is roughly
0.4 ms per field.

Caveats: **Release builds** throughout. Two of the four targets are real
hardware; the iOS number is simulator-only. n=5 mount passes and n=12 focus
runs, so read the medians and treat the means (which the
first, cold pass skews) as an upper bound. Keystroke latency was profiled
separately in an earlier session and is not re-measured here.

## What was broken, and what fixed it

| Was | Fix |
| --- | --- |
| `currentlyFocusedInput()` returned `null`; `Keyboard.dismiss()` was a no-op, so was `keyboardShouldPersistTaps` | `NitroInput` registers in RN's text-input registry and routes the registry's `focusTextInput`/`blurTextInput` to its own native focus/blur (`src/NitroInput.tsx`). RN reaches an input through a codegen **view command**, which a Nitro view does not implement — on iOS a category now handles it (`ios/NitroInputCommands.mm`), and the JS routing covers both platforms. |
| testID never reached the field; an empty field had no accessibility element at all | `testID` and `accessibilityLabel` are forwarded as explicit props (`fieldTestID`, `fieldAccessibilityLabel`) onto the hidden field, and the `placeholder` is exposed as its accessibility value. The label is no longer left on the host view as well, so there is one element, not two. |
| keyboard-controller reported `target 0` | The react tag is copied onto the view KC reads (`firstResponder.superview.tag`). |
| Return always dismissed the keyboard | `submitBehavior` (`'submit'` / `'blurAndSubmit'` / `'newline'`), with the `blurOnSubmit` alias resolved the way `TextInput` resolves it: `'blurAndSubmit'` on a single-line field, `'newline'` on a multiline one. |
| No `onEndEditing`, `onSelectionChange`, `onKeyPress` | Added on both platforms. |
| Android fired a spurious `onKeyPress`/`onSelectionChange` on mount | `onKeyPress` only for real key events; the initial `0-0` caret is not a move. |

## Events

Every callback is handed a superset of what `TextInput` passes. `nativeEvent`
is there with the same fields under the same names, so a handler written
against a `TextInput` keeps working when the component is swapped:

```tsx
onSubmitEditing={e => search(e.nativeEvent.text)}   // unchanged from TextInput
```

and the same fields are repeated at the top level, so new code can destructure
rather than reach through it:

```tsx
onSubmitEditing={({ text }) => search(text)}
onSelectionChange={({ start, end }) => …}           // `nativeEvent.selection` also works
```

That applies to `onChange`, `onFocus`, `onBlur`, `onSubmitEditing`,
`onEndEditing`, `onSelectionChange` and `onKeyPress`. `onChangeText` takes the
text directly, as it does on a `TextInput`.

## Props added

`submitBehavior` (+ `blurOnSubmit`), `secureTextEntry`, `keyboardAppearance`,
`textContentType` / `autoComplete` (iOS content types and Android autofill
hints), `enablesReturnKeyAutomatically`, `showSoftInputOnFocus`,
`selectTextOnFocus`, `clearTextOnFocus`, `contextMenuHidden`, `spellCheck`,
`readOnly`, `selection`, `inputMode` / `enterKeyHint` (React Native's
HTML-flavoured aliases, resolved with the same tables and the same precedence),
`id`, `aria-label`, the `aria-busy` / `-checked` / `-disabled` / `-expanded` / `-selected` state, `aria-hidden` and `aria-labelledby` (which a Nitro view receives unresolved, so this component
resolves them itself); callbacks `onEndEditing`, `onSelectionChange`,
`onKeyPress`.

## Keyboard across a navigation

Pushing from a focused field to a screen that autofocuses a *different* keyboard
type (email → decimal pad) is where keyboard handling usually shows its seams.
Measured on an iPhone 13 Pro Max with `useKeyboardHandler`, the **Keyboard
across navigation** screens.

**What was wrong.** `autoFocus` claimed first responder from a
`DispatchQueue.main.async`, one runloop turn after the view reached its window.
By then the outgoing screen's field had already resigned, so iOS had started
dismissing the keyboard:

```
field  A email onBlur
kb     onStart  h=0    dur=350   <- keyboard animating out
field  B number onFocus
kb     onStart  h=318  dur=350   <- and back in
```

A full hide plus a full show, about 580 ms of visible churn. React Native's own
`TextInput` never does this — it focuses during the mount commit, so the
keyboard stays up and only changes type (`dur=0`, height never leaves 318).

**The fix** is `maybeAutoFocus()` in `ios/NitroInputView.swift`: claim first
responder **synchronously**, from whichever of `didMoveToWindow` /
`applyTraits` happens last, with the async path kept only as a fallback if
UIKit declines. After:

```
field  A email onBlur
field  B number onFocus          <- 6 ms later, was 57 ms
kb     onStart  h=318 dur=0      <- stays up, swaps in place
kb     onEnd    h=318
```

~80 ms of zero-duration events, matching `TextInput`.

**Going back** is a single clean dismiss (`h=0 dur=383`, one animation, no
flicker) and the focus is not restored to the previous field. `TextInput` in
the same scenario logs exactly the same `h=0 dur=383` — `autoFocus` fires on
mount, and popping back to a screen that was never unmounted does not re-arm
it, for either component.

### Verified frame by frame

Event logs only prove the keyboard was *asked* to do the right thing. These
were checked against 30 fps screen recordings of the transition (simulator,
Release), stepping the frames around the swap.

| Direction | Heights | Ours | `TextInput` |
| --- | --- | --- | --- |
| push, keyboard **shrinks** (email 335 → decimal pad 308) | `dur=0`, never 0 | one-frame crossfade, no gap | one-frame crossfade, no gap |
| push, keyboard **grows** (decimal pad 308 → email 335) | `dur=0`, never 0 | 2 blank frames (~66 ms) | 2 blank frames (~66 ms) |
| pop, keyboard dismisses | `h=0 dur=383` | single slide, no bounce | single slide, no bounce |
| chained push A→B→A | 335 → 308 → 335, all `dur=0` | no dismiss at any step | — |

Shrinking swaps cleanly: the numeric pad is already drawn while the outgoing
screen is still fully visible, then the push animation runs over a keyboard
that never moves.

Growing shows **two frames of an empty keyboard panel** before the QWERTY keys
appear (and the predictions bar fades in two frames after that). This is
UIKit rebuilding the keyboard plane for a taller input view — `TextInput`
produces an identical two-frame gap in the same test, so there is nothing for
this component to fix. It is not a bounce: the keyboard's frame never moves and
the sticky footer never drops.

Timing from the push tap to the first keyboard event: **66 ms ours, 88 ms
`TextInput`** (the field's `onFocus` lands at +37 ms vs. +204 ms).

**Sticky footer.** The test screens use `KeyboardStickyView` with a CTA pinned
to the bottom, which is how keyboard-controller is usually used: it rides up
with the keyboard on both screens and drops back on the way out. It is also the
clearest way to *see* the bug above — before the fix the button slid down and
back up on every push.

## Which native input is underneath

NitroInput uses the **classic native inputs**, not the declarative ones:
`UITextField` (UIKit) on iOS and `AppCompatEditText` (Android View) on Android.
Expo UI's `TextField` wraps SwiftUI's `TextField` on iOS and a Compose
`BasicTextField` on Android.

That is deliberate. The overlay needs three things the declarative inputs do
not expose: a synchronous pre-edit hook (`shouldChangeCharactersIn` /
`TextWatcher`) so an amount can be reformatted before a frame is drawn,
per-position caret geometry (`caretRect(for:)` / `Layout.getPrimaryHorizontal`)
so the drawn glyphs and the real selection line up, and a first-responder the
hidden field owns so system autofill, dictation and the edit menu keep working.
It is also what makes NitroInput compatible with keyboard-controller out of the
box — KC matches `UITextField` / `EditText`, and would not see a SwiftUI or
Compose field.

## Differences that remain

1. **Layout, for `MorphInput` only.** `NitroInput` takes its width from its
   parent the way a `TextInput` does: `autoWidth` defaults to `false`, so it
   has no width of its own and flexbox stretches it. `MorphInput` sets
   `autoWidth="auto"` and sizes itself to its content unless `style` sets
   `width` or `flex`; in a plain column it measured 39 pt wide where a
   `TextInput` filled 340 pt. Give it a width to make it fill its parent.
   (`alignSelf: 'stretch'` is not enough — the inference only looks at
   `width`/`flex`.)
2. **The morph is single line.** `multiline`, `numberOfLines`, `rows`,
   `scrollEnabled` and `textAlignVertical` are all supported, but a wrapping
   field is drawn by the platform rather than by the glyph engine, which lays
   one run out on one baseline. Setting `multiline` therefore forces plain
   drawing, and `morph`, a non-text `mode` (and with it `mask`) and the
   `prefix` / `suffix` affixes - all single-line ideas - warn once in
   development and are ignored. `inlineImage*`, `dataDetectorTypes` and
   `clearButtonMode` do not apply at all.
3. **A plain field always puts a negative sign after a `prefix`.**
   The morph takes `signPlacement`: `'beforeAffix'` (the default) draws
   `-$1,234.56`, `'afterAffix'` draws `$-1,234.56`. A plain field cannot
   choose - its affixes are real accessory views (`leftView` / a `TextView`),
   which by construction sit outside the text - so it is always `'afterAffix'`.
   `NitroInput` is plain unless asked for `morph`, so that is the default.
4. **Two narrower keyboard enums.** `inputMode="search"` gives the default
   keyboard rather than iOS's `web-search`, and `enterKeyHint="previous"` the
   default return key rather than Android's `previous`: neither value exists in
   this component's `keyboardType` / `returnKeyType`. Both fall back rather
   than fail.
5. **Still missing:** `inputAccessoryViewID`, `passwordRules`,
   `smartInsertDelete`, `rejectResponderTermination`, `lineBreakStrategyIOS`,
   `disableFullscreenUI`, `underlineColorAndroid`, `selectionHandleColor`,
   `disableKeyboardShortcuts`, `onPress`/`onPressIn`/`onPressOut`, `onScroll`,
   and `onContentSizeChange` (the field reports its own intrinsic size and
   sizes itself instead). The parity test keeps a reason for each.
6. **`TextInput.State.focusTextInput` / `blurTextInput` bypass the JS routing.**
   `TextInput.js` copies those two function references by value at module-eval
   time (`TextInput.State = { focusTextInput: TextInputState.focusTextInput, … }`),
   long before `patchRegistryOnce()` runs, so the patch is invisible to them.
   `ref.focus()`, `Keyboard.dismiss()` and a ScrollView's auto-blur are
   unaffected - they read `TextInputState.*` live. On iOS the view-command
   category (`ios/NitroInputCommands.mm`) covers the gap, so both entry points
   work there; on Android they do not reach a `NitroInput`.
7. **keyboard-controller `target`** is the react tag of the host view. That is
   the right view to measure and scroll, but it is not the same tag a
   `TextInput` reports for itself.
8. **`onKeyPress` with autocorrect** reports the whole replacement string (e.g.
   `"An"` when the keyboard corrects `"Ab"`), where RN reports single keys.
9. **Not yet checked:** iOS edit-menu placement in an overflowed
   right-aligned field, and Android selection highlight when the field
   overflows. Everything else here is simulator and emulator except the
   performance numbers above, which include an iPhone 13 Pro Max.
10. **Right-to-left.** The direction is resolved on the JS side, from the
    field's `style.direction` else `I18nManager.isRTL`, and handed to native
    as a prop: Fabric does not give a Hybrid View its resolved layout
    direction (the iOS component view never sets `semanticContentAttribute`
    on it), so the view sets its own. `textAlign` defaults to `'auto'`, the
    start edge of the layout direction, as `TextInput` with no `textAlign`; `'left'` and
    `'right'` are absolute on both platforms (Android used to resolve
    `'left'` as start). A `prefix` sits at the start edge and a `suffix` at
    the end: the plain field swaps its accessory views on iOS and uses
    start / end gravity on Android, and the morph has the engine mirror the
    run block by block - prefix, body and suffix each move to their mirror
    image and keep their own order, so the digits still read left to right,
    and a sign laid out ahead of the prefix lands at the far right. The
    frame's label and its notch sit at the start edge. What a `TextInput`
    has that the morph does not: shaped bidi text. The overlay draws one
    layer per character with no contextual shaping, so a word in an Arabic
    or Hebrew script morphs as disconnected letters; a plain field, which
    the system draws, shapes it. Checked on the iOS simulator and the Android emulator under
    `I18nManager.forceRTL`: alignment, plain and morphed affixes, the
    negative, the floated label and its notch, on both.

## Re-running the comparison

`bun run test` in this package runs the side-by-side suite; the sections below
are the parts that need a device.


Open the example app → **Parity / all callbacks**, **Two-screen routing**,
**In-screen state change**, **keyboard-controller**, **Mount / focus
benchmark**, or a **Form sheet** entry.
Every control has a testID (`parity-*`, `navA-*`, `navB-*`, `sheet-*`,
`state-*`, `kc-*`).
