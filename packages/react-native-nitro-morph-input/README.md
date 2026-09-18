# react-native-nitro-morph-input

A native single-line **text and amount input** for React Native whose text
**morphs** as you type, built with [Nitro Modules](https://nitro.margelo.com).
The effect is [Torph](https://torph.lochie.me)'s text continuity, native:
characters that stay glide to their new place, new ones slide or fade in,
removed ones leave alongside their neighbours, and a comma that reflows travels
to where it now belongs instead of blinking into existence.

- **It is a real input.** A system text field (`UITextField` / `EditText`)
  owns the keyboard, editing, selection, paste and accessibility; only its
  glyphs are drawn by the morph layer on top. Focus, blur, return key, keyboard
  types, auto-capitalisation, max length, all the usual.
- **Amounts are formatted natively as you type.** In `mode="number"` every
  keystroke is formatted on the native side before the field shows a frame:
  grouping separators, one decimal separator, at most `fractionDigits`
  decimals, a currency `prefix` / `suffix`, the caret kept where you typed. No
  JS round trip, so none of the flicker, caret jumps or dropped keystrokes of a
  controlled `TextInput` that formats in `onChangeText`.
- **Same formatting model as [`react-native-nitro-rolling-number`](https://www.npmjs.com/package/react-native-nitro-rolling-number)**:
  prefix/suffix at their own font sizes, pinned to the top, bottom, baseline or
  centre of the digits; grouping and decimal separators of your choice.
- **One C++ engine** drives both platforms: the matching (which characters
  persist, enter and leave), the slide/fade/scale curves, the timing. Swift
  and Kotlin only measure glyphs, draw and talk to the keyboard.
- Fabric only (new architecture), React Native ≥ 0.78, Nitro Modules ≥ 0.37.

Docs: **https://ronickg.github.io/react-native-nitro-rolling-number/docs/morph-input**

## Install

```sh
bun add react-native-nitro-morph-input react-native-nitro-modules
cd ios && pod install
```

## Usage

### An amount field

```tsx
import { MorphInput } from 'react-native-nitro-morph-input'

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

### A text field

```tsx
<MorphInput
  placeholder="Your name"
  fontSize={22}
  autoCapitalize="words"
  returnKeyType="done"
  onSubmitEditing={(name) => save(name)}
  style={{ width: '100%', height: 44, paddingHorizontal: 12, backgroundColor: '#F2F2F7', borderRadius: 10 }}
/>
```

In `mode="text"` (the default) characters fade and scale in and out (Torph's
text morph); digits and separators only slide in `mode="number"`, unless you
force one style with `effect="slide"` / `effect="fade"`.

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
| `mode` | `'text' \| 'number'` | `'text'` | `number` formats as you type. |
| `fractionDigits` | `number` | `2` | `number`: most decimals accepted; `0` disables the decimal key. |
| `maxIntegerDigits` | `number` | `15` | `number`: most integer digits accepted; further digits are rejected. |
| `groupingSeparator` | `string` | `','` | `number`: every three integer digits; `''` disables grouping. |
| `decimalSeparator` | `string` | `'.'` | `number`: between integer and fraction digits. |
| `prefix` / `suffix` | `string` | `''` | Static text drawn around the field's text (`$`, ` USD`). Not part of the editable text. |
| `prefixFontSize` / `suffixFontSize` | `number` | `fontSize` | Their own sizes. |
| `affixAlign` | `'baseline' \| 'center' \| 'top' \| 'bottom'` | `'baseline'` | How they line up with the text: `top` pins glyph tops, `bottom` the bottom of the ink (a currency code sits on the digits' baseline). |
| `prefixAlign` / `suffixAlign` | same | `affixAlign` | Per-affix override. |
| `placeholder` | `string` | `''` | Shown while empty; the first character morphs it away. `'0'` reads well for amounts. |
| `placeholderTextColor` | `ColorValue` | platform | Placeholder color. |
| `duration` | `number` | `400` | ms of the morph; `0` snaps. |
| `easing` | `'expo' \| 'easeOut' \| 'easeInOut' \| 'linear' \| 'spring'` | `'expo'` | Timing curve. `expo` is Torph's `cubic-bezier(0.19, 1, 0.22, 1)`. |
| `bounce` | `number` | `0.15` | Overshoot of the `spring` easing (0–1). |
| `effect` | `'auto' \| 'slide' \| 'fade'` | `'auto'` | `auto`: digits and separators slide through the line box (digits from above, separators from below), other characters fade and scale. |
| `fontSize` | `number` | `32` | Points. |
| `fontWeight` | `TextStyle['fontWeight']` | `'normal'` | |
| `fontFamily` | `string` | system | Resolved like `Text`. |
| `color` | `ColorValue` | label color | Text color. |
| `textAlign` | `'left' \| 'center' \| 'right'` | `'left'` | Alignment inside a wider frame. |
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
| `onChangeText` | `(text) => void` | – | After every edit, the formatted text. |
| `onChangeValue` | `(value) => void` | – | `number` mode: the numeric value, `NaN` while empty. |
| `onFocus` / `onBlur` | `() => void` | – | |
| `onSubmitEditing` | `(text) => void` | – | Return key pressed (the field then blurs). |
| `onNativeRef` | `(ref) => void` | – | Receives the Nitro object on mount. |
| `style`, `testID`, … | `ViewProps` | – | Regular view props. Give the field a `width` (or `flex`) in `style`; without one it sizes itself to its text. |

`keyboardType`: `'default' | 'number-pad' | 'decimal-pad' | 'numeric' | 'email-address' | 'phone-pad' | 'url' | 'ascii-capable' | 'numbers-and-punctuation'`.

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

## License

MIT
