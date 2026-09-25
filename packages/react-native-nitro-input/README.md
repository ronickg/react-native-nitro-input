# react-native-nitro-input

Native text for React Native, built with [Nitro Modules](https://nitro.margelo.com):
two components that share one formatting model, one set of glyph renderers and
one native module.

- **[`NitroInput`](#nitroinput)**: a text input. The system field owns the
  keyboard, editing, selection and accessibility; amounts are formatted and
  masks applied in C++ before a frame is drawn, and the characters can reflow
  as they change.
- **[`NitroNumber`](#nitronumber)**: a number that animates its changes.
  Every digit is a wheel that rolls to its new glyph, or swaps in place the way
  SwiftUI's `.contentTransition(.numericText())` does.
- **[`NumberFormat`](#numberformat)**: `Intl.NumberFormat`, formatted
  natively. It learns a locale's format once from the platform and formats in
  C++, with Hermes' output and a fraction of its cost.

Fabric only (new architecture), React Native ≥ 0.78, Nitro Modules ≥ 0.37.

Docs, live demos and benchmarks: **https://ronickg.github.io/react-native-nitro-input/**

## Install

```sh
bun add react-native-nitro-input react-native-nitro-modules
cd ios && pod install
```

> **Android and Nitro 0.37:** Nitro never hands a Hybrid View its `backgroundColor`, `border*`, `opacity`, `transform`, `testID` or accessibility props on Android with React Native 0.86+ — the `style` on every example below would be dropped. Fixed upstream in [margelo/nitro#1655](https://github.com/margelo/nitro/pull/1655); until it ships, apply the [patch from this repository](https://github.com/ronickg/react-native-nitro-input/blob/main/patches/react-native-nitro-modules@0.37.1.patch) with `patchedDependencies` (Bun) or patch-package.

## NitroInput

A native **text input**: a
system text field (`UITextField` / `EditText`) that owns the keyboard, editing,
selection, paste and accessibility, with native formatting, native masking and
an outlined or filled frame with a floating label on top of it.

```tsx
import { NitroInput } from 'react-native-nitro-input'

<NitroInput variant="outlined" label="Email address" keyboardType="email-address" />
```

`transition="reflow"` animates the characters as they change, for the one case
where that is the point — an amount. It is not the default, and for an
ordinary form field you do not want it.

- **It is a real input.** Focus, blur, return key, keyboard types,
  auto-capitalisation, max length, selection, the text-input registry, all the
  usual. Not a re-implementation of text editing.
- **Masks are native.** `mode="mask"` compiles the pattern once into a state
  machine in C++ and applies it below the keystroke — no JS round trip, no
  caret fighting.
- **The outlined frame's notch is a real hole** in the stroked path, not
  background paint over the line, so whatever is behind the field shows through
  it. No Skia.
- **Amounts are formatted natively as you type.** In `mode="number"` every
  keystroke is formatted on the native side before the field shows a frame:
  grouping separators, one decimal separator, at most `fractionDigits`
  decimals, a currency `prefix` / `suffix`, the caret kept where you typed. No
  JS round trip, so none of the flicker, caret jumps or dropped keystrokes of a
  controlled `TextInput` that formats in `onChangeText`.
- **Same formatting model as [`NitroNumber`](#nitronumber)**:
  prefix/suffix at their own font sizes, pinned to the top, bottom, baseline or
  centre of the digits; grouping and decimal separators of your choice.
- **One C++ engine per concern** drives both platforms — formatting, masking,
  the frame geometry, and (with `transition="reflow"`) the glyph matching and curves. Swift
  and Kotlin only measure, draw and talk to the keyboard.

Guide: **https://ronickg.github.io/react-native-nitro-input/docs/nitro-input**

### A text field

```tsx
<NitroInput
  placeholder="Your name"
  fontSize={22}
  autoCapitalize="words"
  returnKeyType="done"
  onSubmitEditing={({ text }) => save(text)}
  style={{ width: '100%', height: 44, paddingHorizontal: 12, backgroundColor: '#F2F2F7', borderRadius: 10 }}
/>
```

`NitroInput` does not animate its characters: they appear the instant you type
them, the way a `TextInput` does. Pass `transition="reflow"` to turn the glyph
engine on — see [An amount field](#an-amount-field-the-reflow), which is where
it earns itself.

### A masked field

```tsx
<NitroInput
  mode="mask"
  mask="+1 ([000]) [000]-[0000]"
  placeholder="+1 (000) 000-0000"
  keyboardType="number-pad"
  maskAutoSkip
  onChangeMask={(formatted, extracted, tail, complete) => {
    setPhone(extracted)      // "5551234567" — the characters the user gave
    setDone(complete)        // every mandatory slot filled
  }}
/>
```

The pattern is compiled once into a linked state machine in C++ and shared by
both platforms, so the formatting, the caret and the "what is still missing"
tail all come from one place and cannot drift apart. `[…]` is an editable
block, `{…}` a literal the engine inserts for you. Built-in slots: `0` a
required digit, `9` an optional one, `A`/`a` letters, `_` any character, `…`
repeats the previous slot.

Add your own with `maskNotations`:

```tsx
<NitroInput
  mode="mask"
  mask="#[HHHHHH]"
  maskNotations={[{ character: 'H', characterSet: '0123456789ABCDEFabcdef', isOptional: false }]}
/>
```

`maskAutocomplete` (default `true`) fills in literals as soon as the slot
before them is satisfied; `maskAutoSkip` (default `false`) lets a backspace
step back over them. Autocompletion only runs when the caret is at the end, so
editing in the middle of a value does not fight you.

### Outlined and filled frames

```tsx
<NitroInput
  variant="outlined"
  label="Email address"
  placeholder="you@example.com"
  strokeColor="#94a3b8"
  focusedStrokeColor="#2563eb"
  cornerRadius={10}
  keyboardType="email-address"
  style={{ width: '100%', height: 52 }}
/>
```

The label floats onto the top edge when the field is focused or holds text, and
the outline opens a notch for it. The notch is a **real hole in the stroked
path**, not a patch of background colour painted over the line, so whatever is
behind the field shows through it — no Skia, no masking, and it works over a
photo or a gradient. The geometry is shared C++ (`OutlineGeometry`) that both
platforms replay as the same move / line / arc commands, and every path has the
same verbs at every progress so Core Animation and `ValueAnimator` can
interpolate between them.

`variant="filled"` gives a filled field instead: a `fillColor`
background with a square bottom and an indicator rule along it.

The label runs 200 ms on a decelerate curve, and the notch is staggered 50 ms behind it opening and closes in 50 ms,
so the gap is never open under a label that has not arrived. All of it runs
inside the view, off a native focus callback — there is no React state to
declare and nothing crosses into JS per frame. That is the point of doing it
natively: a floating label built in React Native is an `Animated.Text` over a
`TextInput`, moved from focus and text state that reach JS after the field has
changed, so it lands a frame late and stutters when the JS thread is busy.

### A multiline field

```tsx
<NitroInput
  multiline
  numberOfLines={4}
  placeholder="Tell us what happened"
  style={{ width: '100%' }}
/>
```

`multiline` lets the text wrap. With `numberOfLines` (or `rows`) the field is
that many lines tall and scrolls past it; without it the field grows with its
content, and `scrollEnabled={false}` hands the height to the content entirely.
`textAlignVertical` says where the text sits in a taller box. A multiline field
is always drawn by the system view and is always `mode="text"`: the glyph
engine lays one run out on one baseline, and an amount, a mask and their
affixes are single-line ideas, so `transition="reflow"`, `mode="number"`, `mode="mask"`,
`prefix` and `suffix` are ignored alongside it, with one warning each in
development. Its return key inserts a line break, as a `TextInput`'s does;
`submitBehavior="blurAndSubmit"` (or `blurOnSubmit`) makes it submit instead.

### An amount field (the reflow)

This is the one case the reflow is for, so it passes `transition="reflow"`.
A reflowing field also sizes its box to its content by default
(`autoWidth="auto"`), so it grows as digits arrive.

With the engine running, `mode="text"` fades and scales characters in and out
(Torph's text morph) while digits and separators slide in `mode="number"`,
unless you force one style with `effect="slide"` / `effect="fade"`.

```tsx
import { NitroInput } from 'react-native-nitro-input'

const [amount, setAmount] = useState(NaN)

<NitroInput transition="reflow"
  mode="number"
  prefix="$"
  prefixFontSize={28}
  affixAlign="top"
  placeholder="0"
  fractionDigits={2}
  fontSize={48}
  fontWeight="700"
  textAlign="center"
  style={{ width: '100%' }}
  onChangeValue={setAmount}          // 1234.5, or NaN while empty
  onChangeText={(text) => {}}        // "1,234.5"
/>
```

Type `1234` and the field shows `$1,234`: the `1` slides over to make room as
the comma arrives from below, the `4` drops in from above. Type `.5` and the
decimal point and the `5` follow. Backspace over the comma and it takes the
digit before it with it. A third decimal is rejected without a flicker.

Everything the user sees is formatted on the native side, synchronously, so
the JS thread only ever learns about the result. State the value in whatever
shape suits you (`onChangeValue` for the number, `onChangeText` for the
formatted string) and keep the field uncontrolled, or pass `value` to drive it:

```tsx
const [text, setText] = useState('')

<NitroInput transition="reflow" mode="number" value={text} onChangeText={setText} prefix="$" />
```

A `value` that merely echoes `onChangeText` back never fights the user: native
already shows it. A `value` that differs (a "Max" button, a clamp) is applied
and reflows in.

### Currency layouts

```tsx
// "$" smaller than the amount, aligned to the top of the digits
<NitroInput transition="reflow" mode="number" prefix="$" prefixFontSize={22} affixAlign="top" fontSize={44} />

// currency code after the amount, smaller and sitting on the baseline of the digits' ink
<NitroInput transition="reflow" mode="number" suffix=" USD" suffixFontSize={18} suffixAlign="bottom" />

// European separators: 1.234,56
<NitroInput transition="reflow" mode="number" groupingSeparator="." decimalSeparator="," />

// whole numbers only (no decimal key accepted), at most six digits
<NitroInput transition="reflow" mode="number" fractionDigits={0} maxIntegerDigits={6} />

// a big centred amount that shrinks when it gets long
<NitroInput transition="reflow" mode="number" fontSize={64} adjustsFontSizeToFit minimumFontScale={0.4} textAlign="center" style={{ width: '100%' }} />
```

In a right-to-left layout the prefix sits at the right edge and the suffix at
the left, plain or reflowed; the digits keep reading left to right.

Whatever the keyboard's decimal key produces (`.` or `,`) counts as the
decimal separator; nobody types a grouping separator on purpose. The rules
follow what a well-behaved amount field does: a decimal typed in the integer
part moves the decimal point (`1,234.5` with the caret after the `1` becomes
`1.23`), one typed inside the fraction is ignored, a leading `.5` stays `.5`
while typing (`setValue(0.5)` shows `0.5`), a digit typed in front of a lone
`0` replaces it, and deleting the decimal point merges the fraction into the
integer part (`1,234.56` → `123,456`).

### Worklets: masks in JS and shared values, synchronously

With [`react-native-worklets`](https://docs.swmansion.com/react-native-worklets/)
installed (it comes with Reanimated 4), two things run on the UI thread while
the native input handles the keystroke, before a frame is drawn:

```tsx
import { useSharedValue, useAnimatedStyle } from 'react-native-reanimated'

// A mask written in JS: lowercase, no symbols, always led by "@".
const usernameTransform: NitroInputTransform = ({ text }) => {
  'worklet'
  const cleaned = text.replace(/[^0-9a-zA-Z_]/g, '').toLowerCase()
  return { text: cleaned ? '@' + cleaned : '' }
}

<NitroInput placeholder="@username" autoCapitalize="none" transform={usernameTransform} />

// A shared value fed on every keystroke, no JS thread in between.
const progress = useSharedValue(0)
<NitroInput
  mode="number"
  onChangeValue={(value) => {
    'worklet'
    progress.value = Number.isNaN(value) ? 0 : value / 10
  }}
/>
```

- `transform` receives `{ text, previousText, selection, previousSelection }`
  (code point offsets) and returns `{ text?, selection? }` or `null` to keep
  the edit as is. Without a `selection` the caret keeps its place relative to
  the edit. In `mode="number"` it runs after the native formatter. Create it
  once (module scope or `useCallback`); a new function re-registers the worklet.
- **Every event callback** marked `'worklet'` runs on the UI thread instead of
  the JS thread: `onChangeText`, `onChangeValue`, `onFocus`, `onBlur`,
  `onSelectionChange`, `onSubmitEditing`, `onEndEditing` and `onKeyPress`. A
  worklet handler is not also called on the JS thread. Plain functions keep
  working as before, so this is opt-in per handler.
- Worklet handlers get the same event objects as the JS ones, except `target`
  is always `0` and `eventCount` `0` where native does not send one: both are
  JS-thread bookkeeping with nothing to read on the UI runtime.
- Everything degrades cleanly: without `react-native-worklets` the props are
  ignored with one console warning, and the native code compiles without it.

### The field's state as shared values

`useNitroInputState` wires those worklet callbacks into shared values, so an
animation can read the field on the UI thread without a single re-render.
Reanimated is not a dependency — pass its `useSharedValue` in:

```tsx
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { NitroInput, useNitroInputState } from 'react-native-nitro-input'

function Field() {
  const field = useNitroInputState(useSharedValue)
  const ring = useAnimatedStyle(() => ({
    borderColor: withTiming(field.focused.value ? '#16a34a' : 'transparent'),
  }))
  return (
    <Animated.View style={[styles.ring, ring]}>
      <NitroInput variant="outlined" label="Worklet driven" {...field.handlers} />
    </Animated.View>
  )
}
```

`field.text`, `field.value`, `field.focused` and `field.selection` are shared
values; `field.handlers` are the worklets that keep them current. Typing in
that field runs nothing on the JS thread and re-renders nothing.

A worklet can only reach what it closes over, unless worklets run in
[Bundle Mode](https://docs.swmansion.com/react-native-worklets/docs/bundleMode/),
which gives them the whole bundle. That is what lets a `transform` use a real
library, here libphonenumber-js formatting a number as it is typed:

```tsx
import { AsYouType } from 'libphonenumber-js/min'

const phoneTransform: NitroInputTransform = ({ text }) => {
  'worklet'
  return { text: new AsYouType('US').input(text) }
}

<NitroInput placeholder="(555) 555-5555" keyboardType="phone-pad" transform={phoneTransform} />
```

Bundle Mode is `['react-native-worklets/plugin', { bundleMode: true,
importForwarding: { moduleNames: ['libphonenumber-js/min'] } }]` in
`babel.config.js` (every library a worklet imports has to be listed by its
exact module name, or it is captured as a remote function the UI thread
cannot call), `getBundleModeMetroConfig(config)` from
`react-native-worklets/bundleMode` in `metro.config.js`, and the small Metro
patch Software Mansion publishes next to it (the Babel plugin writes worklet
modules while bundling, and unpatched Metro fails with "Failed to get the
SHA-1"). The example app in this repo has all three (`example/babel.config.js`,
`example/metro.config.js`, `patches/`).

This is the same mechanism as [react-native-transformer-text-input](https://github.com/AppAndFlow/react-native-transformer-text-input):
the worklets UI runtime is handed to native once, the worklet is called with
`runSync` inside the edit, so there is no bridge hop and no caret flicker.

### Imperative

```tsx
const ref = useRef<NitroInputHandle>(null)

<NitroInput transition="reflow" ref={ref} mode="number" />

ref.current?.focus()
ref.current?.blur()
ref.current?.setValue(1234.56)   // shows "1,234.56", reflowing from whatever was there
ref.current?.setText('98,765')   // same, from a string in the field's format
ref.current?.clear()
ref.current?.getText()           // "1,234.56"
ref.current?.getValue()          // 1234.56, NaN when empty
ref.current?.isFocused()
ref.current?.setSelection(4, 7)  // code point offsets; equal values place the caret
```

`setValue` / `setText` / `clear` use **place matching**: `1,204` → `1,318`
keeps the thousands and the comma, swaps the hundreds, tens and units in
place. Typing uses **caret matching**: the characters on either side of the
caret keep their identity, so inserting a `9` into `12|34` slides `34` over
rather than renumbering the columns.

## NitroInput props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | – | Controlled text, applied when it differs from what the field shows and JS has seen every native edit. |
| `defaultValue` | `string` | `''` | Initial text (uncontrolled). |
| `mode` | `'text' \| 'number' \| 'mask'` | `'text'` | `number` formats as you type; `mask` applies a fixed pattern. |
| `fractionDigits` | `number` | `2` | `number`: most decimals accepted; `0` disables the decimal key. |
| `maxIntegerDigits` | `number` | `15` | `number`: most integer digits accepted; further digits are rejected. |
| `groupingSeparator` | `string` | `','` | `number`: every three integer digits; `''` disables grouping. |
| `decimalSeparator` | `string` | `'.'` | `number`: between integer and fraction digits. |
| `mask` | `string` | `''` | `mask`: the pattern. `[…]` an editable block, `{…}` a literal the engine inserts. Slots: `0` required digit, `9` optional digit, `A`/`a` letter, `_` any, `…` repeat. |
| `maskNotations` | `{ character, characterSet, isOptional }[]` | `[]` | `mask`: caller-defined slots beyond the built-ins. |
| `maskAutocomplete` | `boolean` | `true` | `mask`: insert literals as soon as the slot before them is filled. Only while the caret is at the end. |
| `maskAutoSkip` | `boolean` | `false` | `mask`: let a backspace step back over inserted literals. |
| `variant` | `'none' \| 'outlined' \| 'filled'` | `'none'` | Draws a frame for itself. The outlined notch is a real hole in the stroke. |
| `label` | `string` | `''` | Floating label. Also becomes the field's accessible name when nothing else gives it one. |
| `labelBehavior` | `'float' \| 'always'` | `'float'` | `always` keeps it floated even when empty and blurred. |
| `labelColor` / `labelFocusedColor` | `ColorValue` | placeholder / `focusedStrokeColor` | Label colors. |
| `labelFontSize` | `number` | `fontSize * 0.75` | Floated label size. |
| `strokeColor` / `focusedStrokeColor` | `ColorValue` | separator / `strokeColor` | Outline color. Named `stroke*`, not `outline*`: React Native 0.76 added CSS `outlineColor` to every view, and a Hybrid View's props derive from `ViewProps`, so both parsers would run. |
| `strokeWidth` | `number` | `1` | Doubles while focused. |
| `cornerRadius` | `number` | `8` | Clamped to half the shorter side. `filled` squares its bottom so the indicator meets the fill. |
| `fillColor` | `ColorValue` | secondary fill | `filled` background. |
| `prefix` / `suffix` | `string` | `''` | Static text drawn around the field's text (`$`, ` USD`). Not part of the editable text. |
| `prefixFontSize` / `suffixFontSize` | `number` | `fontSize` | Their own sizes. |
| `affixAlign` | `'baseline' \| 'center' \| 'top' \| 'bottom'` | `'baseline'` | How they line up with the text: `top` pins glyph tops, `bottom` the bottom of the ink (a currency code sits on the digits' baseline). |
| `prefixAlign` / `suffixAlign` | same | `affixAlign` | Per-affix override. |
| `letterSpacing` | number | `0` | Points added after every glyph, like `Text`'s; a smaller affix gets it in proportion to its size. |
| `prefixSpacing` / `suffixSpacing` | number | the letter spacing | Points between the prefix and the text, and between the text and the suffix. |
| `prefixOffset` / `suffixOffset` | number | `0` | Points an affix is moved down after its alignment (negative: up). |
| `format` | `NumberFormat` | none | The amount follows it: prefix and suffix, separators, fraction digits, where the sign goes. Sets `mode="number"`; the individual props override it. |
| `placeholder` | `string` | `''` | Shown while empty; the first character reflows it away. `'0'` reads well for amounts. |
| `placeholderTextColor` | `ColorValue` | platform | Placeholder color. |
| `transition` | `'none' \| 'reflow'` | `'none'` | `'reflow'` runs the glyph engine, so characters glide, slide and fade as the text changes. |
| `autoWidth` | `boolean \| 'auto'` | `false`; `'auto'` when reflowing | `false` takes no width, so flexbox stretches it like a `TextInput`; `'auto'` infers it from `style`. |
| `duration` | `number` | `400` | ms of the reflow; `0` snaps. |
| `easing` | `'expo' \| 'easeOut' \| 'easeInOut' \| 'linear' \| 'spring'` | `'expo'` | Timing curve. `expo` is Torph's `cubic-bezier(0.19, 1, 0.22, 1)`. |
| `bounce` | `number` | `0.15` | Overshoot of the `spring` easing (0–1). |
| `effect` | `'auto' \| 'slide' \| 'fade'` | `'auto'` | `auto`: digits and separators slide through the line box (digits from above, separators from below), other characters fade and scale. |
| `fontSize` | `number` | `32` | Points. |
| `fontWeight` | `TextStyle['fontWeight']` | `'normal'` | |
| `fontFamily` | `string` | system | Resolved like `Text`. |
| `color` | `ColorValue` | label color | Text color. |
| `textAlign` | `'auto' \| 'left' \| 'center' \| 'right'` | `'auto'` | Alignment inside a wider frame. `'auto'` is the start edge of the layout direction, as `TextInput`; `'left'` and `'right'` are absolute. |
| `lineHeight` | `number` | the font's own | The CSS meaning: the total height a line occupies. Honoured in both directions, including tighter than the font. |
| `multiline` | `boolean` | `false` | Wraps. Always drawn by the system view and always `'text'` mode; `transition="reflow"`, `'number'`, `'mask'` and the affixes are ignored with it, and the return key inserts a line break unless `submitBehavior` says otherwise. |
| `numberOfLines` / `rows` | `number` | `0` | `multiline`: lines tall before it scrolls; `0` grows with the content. |
| `textAlignVertical` | `'auto' \| 'top' \| 'center' \| 'bottom'` | `'auto'` | `multiline`: where the text sits in a taller box. |
| `scrollEnabled` | `boolean` | `true` | `multiline`: scroll once the text outgrows the field; `false` lets a growing field drive its own height. |
| `cursorColor` | `ColorValue` | platform tint | Caret color. |
| `selectionColor` | `ColorValue` | platform tint | Selection highlight. |
| `caretHidden` | `boolean` | `false` | |
| `adjustsFontSizeToFit` | `boolean` | `false` | Scale the text down when it is wider than the view's fixed `width`. |
| `minimumFontScale` | `number` | `0.5` | Lower bound for `adjustsFontSizeToFit`. |
| `allowFontScaling` | `boolean` | `false` | Follow the system text size like `Text`. |
| `maxFontSizeMultiplier` | `number` | `0` | Cap for `allowFontScaling`; `0` = none. |
| `keyboardType` | see below | mode-dependent | `number` mode defaults to `decimal-pad` (`number-pad` when `fractionDigits` is `0`). |
| `inputMode` | `'none' \| 'text' \| 'decimal' \| 'numeric' \| 'tel' \| 'search' \| 'email' \| 'url'` | – | React Native's HTML-style alias for `keyboardType`, mapped with its table; `keyboardType` wins. `'none'` focuses without a keyboard. `'search'` falls back to the default keyboard. |
| `returnKeyType` | `'default' \| 'done' \| 'go' \| 'next' \| 'search' \| 'send'` | `'default'` | |
| `enterKeyHint` | `'enter' \| 'done' \| 'go' \| 'next' \| 'previous' \| 'search' \| 'send'` | – | HTML-style alias for `returnKeyType`; `returnKeyType` wins. `'previous'` falls back to the default key. |
| `submitBehavior` | `'blurAndSubmit' \| 'submit' \| 'newline'` | `'blurAndSubmit'`, `'newline'` when `multiline` | What the return key does: fire `onSubmitEditing` and dismiss the keyboard, fire it and keep focus (a form moving to its next field), or insert a line break (`multiline` only). Defaults as `TextInput`'s. |
| `blurOnSubmit` | `boolean` | – | Deprecated alias, resolved like `TextInput`'s: `false` means `'submit'` on one line, `true` means `'blurAndSubmit'` on many. `submitBehavior` wins. |
| `enablesReturnKeyAutomatically` | `boolean` | `false` | Disables the return key until the field has text. |
| `autoCapitalize` | `'none' \| 'sentences' \| 'words' \| 'characters'` | `'sentences'` | `text` mode. |
| `autoCorrect` | `boolean` | `true` | `text` mode. |
| `spellCheck` | `boolean` | `autoCorrect` | `text` mode. |
| `secureTextEntry` | `boolean` | `false` | Draws bullets and turns off autocorrect; the field keeps the real text for autofill. |
| `keyboardAppearance` | `'default' \| 'light' \| 'dark'` | `'default'` | iOS: a light or dark keyboard. |
| `textContentType` / `autoComplete` | `string` | `''` | Autofill: iOS content types and Android hints by their React Native names (`'username'`, `'password'`, `'oneTimeCode'`, `'telephoneNumber'`, …). `textContentType` wins. |
| `showSoftInputOnFocus` | `boolean` | `true` | `false` focuses, with the caret, but shows no keyboard. |
| `selectTextOnFocus` | `boolean` | `false` | Select everything when the field gains focus. |
| `clearTextOnFocus` | `boolean` | `false` | Empty the field when it gains focus. |
| `contextMenuHidden` | `boolean` | `false` | Hides the Cut / Copy / Paste menu. |
| `editable` | `boolean` | `true` | |
| `readOnly` | `boolean` | `false` | Alias of `editable={false}`, as on `TextInput`. |
| `autoFocus` | `boolean` | `false` | |
| `selection` | `{ start, end? }` | – | The caret or selection to apply, in code points into the (formatted) text. |
| `maxLength` | `number` | unlimited | `text` mode. |
| `transform` | `NitroInputTransform` | – | A `'worklet'` that rewrites text and selection after every edit, synchronously on the UI thread (needs `react-native-worklets`). |
| `onChangeText` | `(text) => void` | – | After every edit, the formatted text. A `'worklet'` runs on the UI thread. |
| `onChange` | `(event) => void` | – | Fired alongside `onChangeText` with the same text; `nativeEvent.eventCount` is the native edit counter, as on `TextInput`. |
| `onChangeValue` | `(value) => void` | – | `number` mode: the numeric value, `NaN` while empty. A `'worklet'` runs on the UI thread. |
| `onChangeMask` | `(formatted, extracted, tail, complete) => void` | – | `mask` mode: the formatted text, the characters the user contributed, what is still missing, and whether every mandatory slot is filled. |
| `signPlacement` | `'beforeAffix' \| 'afterAffix'` | `'beforeAffix'` | Where a negative amount's sign sits relative to `prefix`: `-$1,234.56` or `$-1,234.56`. Reflow only — a plain field's affixes are accessory views outside the text. |
| `onFocus` / `onBlur` | `(event) => void` | – | Carries `text`, `eventCount` and `target`. |
| `onSubmitEditing` | `(event) => void` | – | Return key pressed; what happens next is `submitBehavior`. |
| `onEndEditing` | `(event) => void` | – | Editing finished. |
| `onSelectionChange` | `(event) => void` | – | The caret or selection moved, in code points. |
| `onKeyPress` | `(event) => void` | – | Before the text changes: the character, `'Backspace'` or `'Enter'`. |
| `onNativeRef` | `(ref) => void` | – | Receives the Nitro object on mount. |
| `id` / `aria-label` | `string` | – | React Native's HTML-style aliases for `nativeID` / `accessibilityLabel`, resolved here because a Nitro view is handed the raw props; each wins over the older spelling. |
| `style`, `testID`, … | `ViewProps` | – | Regular view props. `testID` and the accessibility label are forwarded to the system field, the element VoiceOver, TalkBack and e2e tools interact with. The field takes its width from its parent like a `TextInput`; see `autoWidth`. |

`keyboardType`: `'default' | 'number-pad' | 'decimal-pad' | 'numeric' | 'email-address' | 'phone-pad' | 'url' | 'ascii-capable' | 'numbers-and-punctuation'`.

Every `event` above is a superset of the one `TextInput` passes: `nativeEvent`
is there with the same fields under the same names, so a handler written for a
`TextInput` works unchanged, and those fields are repeated at the top level so
new code can destructure instead of reaching through it.

```tsx
onSubmitEditing={e => search(e.nativeEvent.text)}   // as on a TextInput
onSubmitEditing={({ text }) => search(text)}        // or just this
```

## How the reflow decides what moves

Each update pairs the old characters with the new ones (Torph's rules,
implemented in `cpp/ReflowEngine.cpp`):

- **Typing** (a caret is known): everything before the caret pairs by
  position from the left, everything after it from the right, so the edit is
  exactly the characters that entered or left. Grouping separators are kept out
  of that walk, because a comma reflows with the magnitude rather than with the
  keystroke; they pair from the units end instead, so the thousands comma stays
  the thousands comma and glides.
- **A value set from code** (no caret): digits pair by their column from the
  decimal point, so `1,204 → 1,318` swaps the three low columns in place. When
  the integer part gained or lost columns the digits pair by subsequence from
  the units end and the separators, which would have to cross them, leave.
  Plain text pairs by longest common subsequence (`Continue → Confirm` keeps
  `Con`).

A character that persists eases to its new x. A new digit drops in from above
(a separator rises from below) through the clipped line box, fading in over the
first quarter of the reflow; a leaving digit drops out the same way, fading over
the first 45 %. Text characters fade and scale (0.95×) instead. Characters that
enter or leave ride along with their nearest persisting neighbour, so a word
that grows or shrinks stays one shape. All of it is Reduce Motion aware.

## NitroNumber

A number that animates its changes natively, with the same look on iOS
**and** Android: every digit a wheel that rolls to its new glyph (an odometer /
ticker), or SwiftUI's `.contentTransition(.numericText())`, or a scramble.

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
- A currency switch plays as one change: prefix, suffix and separators blur
  across, decimal columns open and close, the digits swap or roll.
- `animateTo` / `jumpTo` on the Nitro object work from a Reanimated worklet.

Guide: **https://ronickg.github.io/react-native-nitro-input/docs/nitro-number**

```tsx
import { NitroNumber } from 'react-native-nitro-input'

<NitroNumber
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
<NitroNumber value={count} transition="numeric" fontSize={48} fontWeight="700" />
<NitroNumber value={count} transition="scramble" />
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
<NitroNumber value={price} flashUpColor="#16a34a" flashDownColor="#dc2626" popOnChange={0.08} />
```

`flashUpColor` / `flashDownColor` is the change flash of a trading screen:
every digit whose glyph changes lights up in the up colour when the value grew
and the down colour when it shrank, stays lit while it moves, and fades back
over `flashDuration` (600 ms) once it has landed.
`popOnChange` punches the whole figure on every change, its peak overshoot as
a fraction of the size, rung out like the reveal's landing pop.

### Currency layouts and fitting a width

```tsx
// "$" smaller than the amount, aligned to the top of the digits
<NitroNumber value={total} prefix="$" prefixFontSize={22} affixAlign="top" fontSize={44} />

// currency code after the amount, smaller and pinned to the bottom
<NitroNumber value={total} suffix=" USD" suffixFontSize={18} suffixAlign="bottom" fractionDigits={2} />

// both at once: "$" pinned top, "USD" pinned bottom
<NitroNumber value={total} prefix="$" prefixAlign="top" suffix=" USD" suffixAlign="bottom" prefixFontSize={22} suffixFontSize={16} />

// fit the container without a fixed width: full size until it would overflow, then it shrinks
<NitroNumber value={total} fontSize={52} adjustsFontSizeToFit style={{ maxWidth: '100%' }} />

// fixed box: the box never resizes, the amount shrinks (down to 50%) and grows back to fit
<NitroNumber
  value={total}
  fontSize={64}
  adjustsFontSizeToFit
  minimumFontScale={0.5}
  textAlign="center"
  style={{ width: 240 }}
/>
```

A view that sizes itself grows and shrinks from whichever edge its parent
holds it by (`textAlign="auto"`): at the end of a row it grows to the left, in
a centred column from its middle.

Switching currency is a change like any other: set the new `prefix`, `suffix`,
separators and `fractionDigits` with the new `value` and it plays as one
transition. The old mark blurs out as the new one comes into focus, the
digits keep their place value, decimal columns that go close and new ones open
(swapping in, or rolling up from blank), and the decimal separator fades with
them.

```tsx
<NitroNumber
  value={round(usd * c.rate, c.digits)}
  prefix={c.prefix}              // "$" → "" → "¥" → "CHF "
  suffix={c.suffix}              // ""  → " €" …
  groupingSeparator={c.grouping}
  decimalSeparator={c.decimal}
  fractionDigits={c.digits}      // 2 → 2 → 0 → 2
  transition="numeric"
/>
```

### Loading skeleton

```tsx
<NitroNumber value={balance ?? 0} loading={balance === undefined} prefix="$" fractionDigits={2} />
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

<NitroNumber
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
const ref = useRef<NitroNumberHandle>(null)

<NitroNumber ref={ref} value={0} />

ref.current?.animateTo(42)      // rolls, like changing the prop
ref.current?.jumpTo(41.75)      // positions the wheels continuously, no roll (scrubbing)
ref.current?.revealTo(1234.5)   // plays a jackpot reveal
ref.current?.getValue()         // value shown or being rolled towards
```

`jumpTo` positions every wheel from a continuous number (`41.75` shows the units
wheel three quarters of the way from `1` to `2`), which is what you want when a
scroll or drag handler drives the number.

The Nitro object (`onNativeRef`) can be captured by a Reanimated worklet as it
is, so the UI thread can drive the figure while JS is busy:

```tsx
const [price, setPrice] = useState<NitroNumberRef>()

useFrameCallback((frame) => {
  'worklet'
  if (price && tickDue(frame)) price.animateTo(nextPrice())
}, true)

<NitroNumber value={initial} onNativeRef={setPrice} />
```

Hand the final value back to React when the feed stops (`scheduleOnRN`) so the
`value` prop matches the screen; posting every tick queues them up while JS is
busy and replays them afterwards.

## NitroNumber props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | – | The number to display. Shown with at most 18 digits: `|value| × 10^fractionDigits` is clamped at 10^17, and a JS number carries exact integers only up to 2^53. |
| `fractionDigits` | `number` | `0` | Digits after the decimal separator. |
| `minimumIntegerDigits` | `number` | `1` | Zero-pads the integer part. |
| `groupingSeparator` | `string` | `''` | Inserted between digit groups. |
| `groupingSizes` | `number[]` | `[3]` | Group sizes from the decimal point: `[3, 2]` is Indian grouping (12,34,567). |
| `decimalSeparator` | `string` | `'.'` | Between integer and fraction digits. |
| `prefix` / `suffix` | `string` | `''` | Static text around the number. |
| `signDisplay` | `'auto' \| 'always' \| 'exceptZero' \| 'negative' \| 'never'` | `'auto'` | Which values carry a sign; `'exceptZero'` puts a plus on gains, and a plus that turns into a minus swaps. |
| `plusSign` / `minusSign` | `string` | `'+'` / `'-'` | The sign glyphs (e.g. `'−'`, U+2212). |
| `digitGlyphs` | `string[]` | `'0'`…`'9'` | Ten glyphs for native digits (Arabic-Indic, Devanagari…). |
| `digits` | `Record<number, { max }>` | – | The highest digit a position shows before it wraps (a clock's tens: `{ 1: { max: 5 } }`). |
| `continuous` | `boolean` | `false` | Rolls turn the lower wheels a full turn too, so the figure seems to pass through every value. |
| `animated` | `boolean` | `true` | `false` shows every change at once. |
| `respectReduceMotion` | `boolean` | `true` | Snap while the system's Reduce Motion is on. |
| `onAnimationStart` / `onAnimationEnd` | `() => void` / `(value) => void` | – | The figure set off from rest / came to rest, once for a run of changes. |
| `duration` | `number` | `500` | Roll duration in ms; `0` snaps. |
| `easing` | `'linear' \| 'easeIn' \| 'easeOut' \| 'easeInOut' \| 'spring'` | `'easeInOut'` | Roll timing curve. A value that arrives while the wheels are still rolling continues with the ease-out half of the curve, so rapid updates never stall. |
| `bounce` | `number` | `0.15` | Overshoot of the `spring` easing (0–1). |
| `stagger` | `number` | `0` | ms between the start of each digit's roll (least significant first), a cascading carry; in the numeric transition it is the span of the whole cascade, spread over the changed digits from the left, default `150`. |
| `transition` | `'roll' \| 'numeric' \| 'scramble'` | `'roll'` | How a change plays: the odometer roll; the numeric transition (each changed glyph swaps in place, SwiftUI's `numericText`); or a scramble that locks from the left. Each swap style has its own `duration` / `easing` / `stagger` defaults (numeric 480 ms with SwiftUI's own clocks and a 150 ms cascade span, scramble 500 / linear / 60). |
| `flashUpColor`, `flashDownColor` | `ColorValue` | unset | The change flash: digits whose glyph changes light up in the up colour when the value grew, the down colour when it shrank, stay lit while they move, and fade back over `flashDuration` once they have landed. Unset: no flash. |
| `flashDuration` | `number` | `600` | ms a change flash takes to fade, once the digit has landed. |
| `popOnChange` | `number` | `0` | A punch of the whole figure on every change, peak overshoot 0–1, rung out like the reveal's landing pop. |
| `direction` | `'auto' \| 'up' \| 'down' \| 'shortest'` | `'auto'` | Roll direction; `auto` follows the sign of the change. `shortest` rolls each digit its own shorter way round. |
| `reveal` | `boolean` | – | `false` holds the opening frame (`$0.00` in the final layout); `true` plays the reveal to `value`. Unset = a normal NitroNumber. |
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
| `shimmerAngle` | `number` | `31` | The band's slant in degrees (0 upright). |
| `shimmerWidth` | `number` | `1` | The band's width, a fraction of the number's. |
| `shimmerBaseColor` | `ColorValue` | `color` | The glyphs' colour outside the band: a skeleton. |
| `shimmerDirection` | `'auto' \| 'ltr' \| 'rtl'` | `'auto'` | Sweep direction; `'auto'` follows the layout direction. |
| `shimmerDelay` | `number` | `0` | ms of pause after each sweep. |
| `fontSize` | `number` | `32` | Font size of the digits in points. |
| `prefixFontSize` / `suffixFontSize` | `number` | `fontSize` | Smaller (or larger) prefix/suffix, e.g. a currency symbol or code. |
| `affixAlign` | `'baseline' \| 'center' \| 'top' \| 'bottom'` | `'baseline'` | How prefix/suffix line up with the digits: `top` pins the glyph tops (cap height), `bottom` the bottom of the glyphs' ink (a currency code sits on the digits' baseline, not down where a comma's tail reaches). |
| `prefixAlign` / `suffixAlign` | same | `affixAlign` | Per-affix override, e.g. `$` pinned top and `USD` pinned bottom. |
| `letterSpacing` | number | `0` | Points added after every glyph, like `Text`'s; a smaller affix gets it in proportion to its size. |
| `prefixSpacing` / `suffixSpacing` | number | the letter spacing | Points between the prefix and the digits, and between the digits and the suffix. |
| `prefixOffset` / `suffixOffset` | number | `0` | Points an affix is moved down after its alignment (negative: up). |
| `prefixColor` / `suffixColor` | `ColorValue` | `color` | The affixes' colours. |
| `fractionFontSize` / `fractionColor` | `number` / `ColorValue` | `fontSize` / `color` | Smaller, dimmer cents (the decimal separator follows). |
| `fractionAlign` | `'baseline' \| 'center' \| 'top' \| 'bottom'` | `'baseline'` | `'top'`: superscript cents. |
| `format` | `NumberFormat` | none | The number follows it: prefix and suffix, separators and group sizes, fraction and minimum integer digits, sign display, native digits; a compact format rolls its figure and swaps its suffix ("950" → "1.5K"). The individual props override it. |
| `tabularNums` | boolean | `true` | `false` lays each digit out at its own width (proportional figures); a changing column eases once from the old digit's width to the new one's. |
| `adjustsFontSizeToFit` | `boolean` | `false` | Shrink the whole number to fit the view's fixed `width`; the view keeps its full height. |
| `minimumFontScale` | `number` | `0.5` | Lower bound for `adjustsFontSizeToFit`. |
| `allowFontScaling` | `boolean` | `false` | Follow the system text size like `Text` (off by default so amounts keep their design size). |
| `maxFontSizeMultiplier` | `number` | `0` | Cap for `allowFontScaling`; `0` = no cap. |
| `fontWeight` | `TextStyle['fontWeight']` | `'normal'` | Font weight. |
| `fontFamily` | `string` | system | Font family, resolved like `Text` (bundled / expo-font fonts work). |
| `color` | `ColorValue` | label color | Text color. |
| `textAlign` | `'auto' \| 'left' \| 'center' \| 'right'` | `'auto'` | Alignment inside a wider frame. `'auto'` is the start edge of the layout direction, except in a view that hugs the number: there it is the edge the parent keeps the view to, so a figure at the end of a row grows and shrinks from its right edge. `'left'` and `'right'` are absolute. In a right-to-left app the prefix sits at the right edge and the suffix at the left, and the digits keep reading left to right. |
| `onNativeRef` | `(ref) => void` | – | Receives the Nitro object on mount. |
| `style`, `testID`, … | `ViewProps` | – | Regular view props. |

The view reports its intrinsic size from native and sizes itself. Give it an
explicit `width` in `style` plus `textAlign="right"` if you don't want the layout
to reflow while digits appear (e.g. a counter that grows past `999`).

## Accessibility and threading

### NitroInput

- The system field remains the accessibility element, with the formatted text
  (`$1,234.50 USD` reads as such); VoiceOver / TalkBack, autofill, the paste
  menu and selection all work as in a plain input.
- Reduce Motion (iOS) and "Remove animations" (Android) snap.
- The view implements Nitro's `RecyclableView`.
- Every keystroke is handled on the main thread: the formatter runs, the field
  is updated, the reflow starts. `onChangeText` reaches JS afterwards; nothing
  the user sees waits for it. A `value` prop carrying a stale
  `mostRecentEventCount` (the user typed since) is ignored, like React
  Native's own `TextInput`.

### NitroNumber

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

#### Performance

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

## How NitroNumber works

- All behaviour lives in one shared C++ engine (`cpp/RollingEngine.hpp`): each
  digit is a wheel with a continuous position on a `0–9` strip; the engine
  computes rolls (shortest path in the roll direction, blank↔digit for
  appearing/disappearing wheels), stagger, easing/spring curves, the odometer
  carry rule for `jumpTo`, the loading fade, the shimmer phase, the jackpot
  reveals (count curve, tiers, reels, landing pop), the numeric transition's
  springs and the clocks of a prefix, suffix, separator or decimal change.
- The Swift view calls the engine directly through Swift/C++ interop; the
  Kotlin view through a 60-line fbjni handle (the only hand-written JNI). Each
  platform only owns fonts, layout, fit-to-width and text drawing, and drives
  the engine from a `CADisplayLink` / `Choreographer` loop.
- A frame is about a dozen cached glyph draws with Core Graphics / `Canvas`.
- Props are parsed by Nitro from JSI (no Fabric codegen); the view is a Fabric
  component, so `style`, `opacity`, `transform` and friends work as usual.

## NumberFormat

`Intl.NumberFormat`'s API, formatted natively. The first formatter for a
locale and currency learns its format from the platform's own formatter
(Foundation on iOS, ICU on Android, the data Hermes' `Intl` uses); every number
after that is formatted in C++. It behaves as ECMA-402 specifies (callable
without `new`, a bound `format`, options read and checked in the specified
order) and passes test262's `intl402/NumberFormat` suite as far as the
platform's data goes: 242 of 251 tests on iOS and 244 on Android, where Hermes'
own `Intl` passes 121 and 101.

```ts
import { NumberFormat, NitroNumber } from 'react-native-nitro-input'

const php = new NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
php.format(1234.5)                 // "₱1,234.50"
php.formatToParts(-12)             // on iOS too
php.formatRange(3, 5)              // "₱3.00 – ₱5.00"
[1, 2].map(php.format)             // format is bound
php.format('12345678901234567890.125') // exact

<NitroNumber value={balance} format={php} />
```

Building a formatter takes 9 µs on a Galaxy A22 against Hermes' 3.3 ms, and
`format()` 2.8 µs against 10 µs. Every option of `Intl.NumberFormatOptions` is
supported; compact notation, units and currency names are printed by the
platform formatter (iOS has no long compact form). Full guide:
https://ronickg.github.io/react-native-nitro-input/docs/number-format

## Credits

The reflow is based on [Torph](https://torph.lochie.me) by
[Lochie Axon](https://github.com/lochie). Thanks for building it.

## License

MIT
