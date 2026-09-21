# react-native-nitro-input

A native **text input** for React Native, built with
[Nitro Modules](https://nitro.margelo.com). `NitroInput` is the component: a
system text field (`UITextField` / `EditText`) that owns the keyboard, editing,
selection, paste and accessibility, with native formatting, native masking and
an outlined or filled frame with a floating label on top of it.

```tsx
import { NitroInput } from 'react-native-nitro-input'

<NitroInput variant="outlined" label="Email address" keyboardType="email-address" />
```

`MorphInput` is the same component with `morph` on, for the one case
where animating the characters is the point — an amount. It is not the default,
and for an ordinary form field you do not want it.

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
- **Same formatting model as [`react-native-nitro-rolling-number`](https://www.npmjs.com/package/react-native-nitro-rolling-number)**:
  prefix/suffix at their own font sizes, pinned to the top, bottom, baseline or
  centre of the digits; grouping and decimal separators of your choice.
- **One C++ engine per concern** drives both platforms — formatting, masking,
  the frame geometry, and (with `morph`) the glyph matching and curves. Swift
  and Kotlin only measure, draw and talk to the keyboard.
- Fabric only (new architecture), React Native ≥ 0.78, Nitro Modules ≥ 0.37.

Docs: **https://ronickg.github.io/react-native-nitro-rolling-number/input**

## Install

```sh
bun add react-native-nitro-input react-native-nitro-modules
cd ios && pod install
```

## Usage

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
them, the way a `TextInput` does. Pass `morph` (or use `MorphInput`, which is
that plus content sizing) to turn the glyph engine on — see
[An amount field](#an-amount-field-the-morph), which is where it earns itself.

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
engine lays one run out on one baseline, so `morph`, `mode="number"` and
`mode="mask"` are ignored alongside it, with one warning in development.

### An amount field (the morph)

This is the one case the morph is for, so it uses `MorphInput` — `NitroInput`
with `morph` on, and with the box sized to its content so it grows as digits
arrive.

With the engine running, `mode="text"` fades and scales characters in and out
(Torph's text morph) while digits and separators slide in `mode="number"`,
unless you force one style with `effect="slide"` / `effect="fade"`.

```tsx
import { MorphInput } from 'react-native-nitro-input'

const [amount, setAmount] = useState(NaN)

<MorphInput
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

<MorphInput mode="number" value={text} onChangeText={setText} prefix="$" />
```

A `value` that merely echoes `onChangeText` back never fights the user: native
already shows it. A `value` that differs (a "Max" button, a clamp) is applied
and morphs in.

### Currency layouts

```tsx
// "$" smaller than the amount, aligned to the top of the digits
<MorphInput mode="number" prefix="$" prefixFontSize={22} affixAlign="top" fontSize={44} />

// currency code after the amount, smaller and sitting on the baseline of the digits' ink
<MorphInput mode="number" suffix=" USD" suffixFontSize={18} suffixAlign="bottom" />

// European separators: 1.234,56
<MorphInput mode="number" groupingSeparator="." decimalSeparator="," />

// whole numbers only (no decimal key accepted), at most six digits
<MorphInput mode="number" fractionDigits={0} maxIntegerDigits={6} />

// a big centred amount that shrinks when it gets long
<MorphInput mode="number" fontSize={64} adjustsFontSizeToFit minimumFontScale={0.4} textAlign="center" style={{ width: '100%' }} />
```

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
const ref = useRef<MorphInputHandle>(null)

<MorphInput ref={ref} mode="number" />

ref.current?.focus()
ref.current?.blur()
ref.current?.setValue(1234.56)   // shows "1,234.56", morphing from whatever was there
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

## Props

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
| `placeholder` | `string` | `''` | Shown while empty; the first character morphs it away. `'0'` reads well for amounts. |
| `placeholderTextColor` | `ColorValue` | platform | Placeholder color. |
| `morph` | `boolean` | `false` | Run the glyph engine, so text morphs as it changes. `MorphInput` is this plus content sizing. |
| `autoWidth` | `boolean \| 'auto'` | `false` | `false` takes no width, so flexbox stretches it like a `TextInput`; `'auto'` infers it from `style` (what `MorphInput` uses). |
| `duration` | `number` | `400` | ms of the morph; `0` snaps. |
| `easing` | `'expo' \| 'easeOut' \| 'easeInOut' \| 'linear' \| 'spring'` | `'expo'` | Timing curve. `expo` is Torph's `cubic-bezier(0.19, 1, 0.22, 1)`. |
| `bounce` | `number` | `0.15` | Overshoot of the `spring` easing (0–1). |
| `effect` | `'auto' \| 'slide' \| 'fade'` | `'auto'` | `auto`: digits and separators slide through the line box (digits from above, separators from below), other characters fade and scale. |
| `fontSize` | `number` | `32` | Points. |
| `fontWeight` | `TextStyle['fontWeight']` | `'normal'` | |
| `fontFamily` | `string` | system | Resolved like `Text`. |
| `color` | `ColorValue` | label color | Text color. |
| `textAlign` | `'left' \| 'center' \| 'right'` | `'left'` | Alignment inside a wider frame. |
| `lineHeight` | `number` | the font's own | The CSS meaning: the total height a line occupies. Honoured in both directions, including tighter than the font. |
| `multiline` | `boolean` | `false` | Wraps. Always drawn by the system view and always `'text'` mode; `morph`, `'number'` and `'mask'` are ignored with it. |
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
| `returnKeyType` | `'default' \| 'done' \| 'go' \| 'next' \| 'search' \| 'send'` | `'default'` | |
| `autoCapitalize` | `'none' \| 'sentences' \| 'words' \| 'characters'` | `'sentences'` | `text` mode. |
| `autoCorrect` | `boolean` | `true` | `text` mode. |
| `editable` | `boolean` | `true` | |
| `autoFocus` | `boolean` | `false` | |
| `maxLength` | `number` | unlimited | `text` mode. |
| `transform` | `NitroInputTransform` | – | A `'worklet'` that rewrites text and selection after every edit, synchronously on the UI thread (needs `react-native-worklets`). |
| `onChangeText` | `(text) => void` | – | After every edit, the formatted text. A `'worklet'` runs on the UI thread. |
| `onChangeValue` | `(value) => void` | – | `number` mode: the numeric value, `NaN` while empty. A `'worklet'` runs on the UI thread. |
| `onChangeMask` | `(formatted, extracted, tail, complete) => void` | – | `mask` mode: the formatted text, the characters the user contributed, what is still missing, and whether every mandatory slot is filled. |
| `signPlacement` | `'beforeAffix' \| 'afterAffix'` | `'beforeAffix'` | Where a negative amount's sign sits relative to `prefix`: `-$1,234.56` or `$-1,234.56`. Morph only — a plain field's affixes are accessory views outside the text. |
| `onFocus` / `onBlur` | `(event) => void` | – | Carries `text`, `eventCount` and `target`. |
| `onSubmitEditing` | `(event) => void` | – | Return key pressed (the field then blurs). |
| `onEndEditing` | `(event) => void` | – | Editing finished. |
| `onSelectionChange` | `(event) => void` | – | The caret or selection moved, in code points. |
| `onKeyPress` | `(event) => void` | – | Before the text changes: the character, `'Backspace'` or `'Enter'`. |
| `onNativeRef` | `(ref) => void` | – | Receives the Nitro object on mount. |
| `style`, `testID`, … | `ViewProps` | – | Regular view props. Give the field a `width` (or `flex`) in `style`; without one it sizes itself to its text. |

`keyboardType`: `'default' | 'number-pad' | 'decimal-pad' | 'numeric' | 'email-address' | 'phone-pad' | 'url' | 'ascii-capable' | 'numbers-and-punctuation'`.

Every `event` above is a superset of the one `TextInput` passes: `nativeEvent`
is there with the same fields under the same names, so a handler written for a
`TextInput` works unchanged, and those fields are repeated at the top level so
new code can destructure instead of reaching through it.

```tsx
onSubmitEditing={e => search(e.nativeEvent.text)}   // as on a TextInput
onSubmitEditing={({ text }) => search(text)}        // or just this
```

## How the morph decides what moves

Each update pairs the old characters with the new ones (Torph's rules,
implemented in `cpp/MorphEngine.cpp`):

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
first quarter of the morph; a leaving digit drops out the same way, fading over
the first 45 %. Text characters fade and scale (0.95×) instead. Characters that
enter or leave ride along with their nearest persisting neighbour, so a word
that grows or shrinks stays one shape. All of it is Reduce Motion aware.

## Accessibility and threading

- The system field remains the accessibility element, with the formatted text
  (`$1,234.50 USD` reads as such); VoiceOver / TalkBack, autofill, the paste
  menu and selection all work as in a plain input.
- Reduce Motion (iOS) and "Remove animations" (Android) snap.
- The view implements Nitro's `RecyclableView`.
- Every keystroke is handled on the main thread: the formatter runs, the field
  is updated, the morph starts. `onChangeText` reaches JS afterwards; nothing
  the user sees waits for it. A `value` prop carrying a stale
  `mostRecentEventCount` (the user typed since) is ignored, like React
  Native's own `TextInput`.

## Credits

The morph is based on [Torph](https://torph.lochie.me) by
[Lochie Axon](https://github.com/lochie). Thanks for building it.

## License

MIT
