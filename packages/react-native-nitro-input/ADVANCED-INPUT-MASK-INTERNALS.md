# How `react-native-advanced-input-mask` works

Notes from reading the source of
[IvanIhnatsiuk/react-native-advanced-input-mask](https://github.com/IvanIhnatsiuk/react-native-advanced-input-mask)
at **v1.4.6**. It solves the same problem NitroInput's `MorphInput` solves —
reformat text synchronously as the user types, without a JS round trip and without
flicker — by a completely different route, so it is worth understanding as a design
alternative.

Companion to [RN-TEXTINPUT-INTERNALS.md](./RN-TEXTINPUT-INTERNALS.md), which explains
the RN machinery this library hooks into.

## What it does

A declarative mask language applied to text as it is typed:

```tsx
<MaskedTextInput
  mask="+1 ([000]) [000]-[0000]"
  onChangeText={(formatted, extracted, tailPlaceholder, complete) => …}
/>
```

Notation: `[0]` mandatory digit, `[9]` optional digit, `[A]` mandatory letter,
`[a]` optional letter, `[_]` mandatory alphanumeric, `[-]` optional alphanumeric,
`[…]` ellipsis (unbounded run), `{…}` a fixed literal block, plus user-supplied
`customNotations` (`character` + `characterSet` + `isOptional`).

Every change reports four values: `formatted` (with the mask), `extracted` (raw),
`tailPlaceholder` (what is still missing, computed from the state machine), and
`complete` (all mandatory slots filled).

Beyond plain masking it has `affinityFormat` (a list of candidate masks, best one
chosen per keystroke), `allowedKeys` (character whitelist), `validationRegex`
(reject-the-change predicate), `autocomplete` / `autocompleteOnFocus` (insert constant
characters ahead of the caret), `autoSkip` (erase trailing constants on backspace),
`isRTL`, and `customTransformation`.

## The architectural trick: it is a decorator, not an input

This is the whole design and it is genuinely clever. The library **does not implement
a text input**. It renders RN's real `TextInput` and, next to it, an invisible native
sibling view that reaches over and hijacks the input's native delegate.

`src/native/views/MaskedTextInput/index.tsx`:

```tsx
<>
  <InputComponent {...rest} ref={inputRef} autoCapitalize={autoCapitalize} />
  <AdvancedTextInputMaskDecoratorViewNativeComponent
    ref={maskedViewDecoratorRef}
    primaryMaskFormat={mask}
    value={value}
    style={IS_FABRIC ? styles.farAway : styles.displayNone}
    onAdvancedMaskTextChange={onAdvancedMaskTextChangeCallback}
    …
  />
</>
```

Two details in that snippet carry a lot of weight:

- **`styles.farAway` is `{position: 'absolute', top: 1e8, left: 1e8}`** on Fabric,
  and `display: none` on Paper. On Fabric the decorator must actually be mounted in
  the view hierarchy — it needs a live `superview` to walk — so it cannot be
  `display: none`. It is parked off-screen instead. It is a real, laid-out view.
- **`value` and `defaultValue` go to the decorator, never to the `TextInput`.** The
  decorator writes into the native field directly, so routing `value` through RN as
  well would mean two writers fighting over the same text. See "the consequence"
  below.

### Finding the input: previous-sibling walk

iOS (`ios/AdvancedTextInputMaskDecoratorView.swift`):

```swift
private func findTextField() {
  #if ADVANCE_INPUT_MASK_NEW_ARCH_ENABLED
    if let parent = superview?.superview {
      for i in 1 ..< parent.subviews.count where parent.subviews[i] == superview {
        textField = findFirstTextField(in: parent.subviews[i - 1])
        break
      }
    }
  #else
    // same, one level shallower
  #endif
}
```

Android does the identical thing in `onAttachedToWindow`, checking
`previousSibling is ReactEditText`.

So the contract is: **the decorator must be the immediately-following sibling of the
input**, and on iOS the input must be the *first* `UITextField` one level inside that
sibling. Wrap the `TextInput` in a `View` and the whole thing silently does nothing.
That is the main fragility of the approach.

Discovery runs in `didMoveToWindow` (iOS) / `onAttachedToWindow` (Android), and is
undone in `cleanup` (called from `prepareForRecycle`) / `onDetachedFromWindow` —
which is the right place, given Fabric recycles views.

## iOS: delegate hijack plus a forged change notification

Once the `UITextField` is found:

1. The original delegate (RN's `RCTBackedTextFieldDelegateAdapter`) is saved.
2. It is wrapped in `AdvancedInputMaskDelegateWrapper`, an `NSObject` that proxies
   everything it does not implement via Objective-C message forwarding
   (`responds(to:)` + `forwardingTarget(for:)`).
3. `textField.delegate` is then set to `NotifyingAdvancedTexInputMaskListener`
   (a subclass of `ForkInputMask`'s `MaskedTextInputListener`), with the wrapper
   installed as *its* downstream delegate.

The load-bearing override is `shouldChangeCharactersIn`:

```swift
override func textField(_ textField: UITextField,
                        shouldChangeCharactersIn range: NSRange,
                        replacementString string: String) -> Bool {
  let newText = allowedKeys.isEmpty ? string
              : String(string.filter { allowedKeys.contains($0) })
  let nextTextFieldText = ((textField.text ?? "") as NSString)
      .replacingCharacters(in: range, with: newText)

  if !isValid(nextTextFieldText) { return false }

  defer {
    NotificationCenter.default.post(name: UITextField.textDidChangeNotification,
                                    object: textField)
    textField.sendActions(for: .editingChanged)
  }

  return super.textField(textField, shouldChangeCharactersIn: range,
                         replacementString: newText)
}
```

That `defer` block is the key to the whole library. The mask listener rewrites
`textField.text` itself and returns `false`, which means UIKit fires **no**
`UIControlEventEditingChanged` — and RN's adapter listens for exactly that
(`RCTBackedTextInputDelegateAdapter.mm`, `addTarget:action:@selector(textFieldDidChange)
forControlEvents:UIControlEventEditingChanged`). So the library **forges the event**,
which makes RN's `textInputDidChange` → `_updateState` → `mostRecentEventCount++` →
`onChange` chain run as if the user had typed normally. RN's controlled-input protocol
stays intact on top of text RN did not write.

The pipeline, in order, is: `allowedKeys` filter → `validationRegex` gate → mask apply.
Failing validation returns `false` and the keystroke is dropped entirely.

iOS depends on `ForkInputMask ~> 7.3.2`, the author's fork of RedMadRobot's
`input-mask-ios`.

## Android: TextWatcher plus focus-listener chain

`ReactMaskedTextChangeListener.installOn` subclasses RedMadRobot's
`MaskedTextChangedListener` and does:

```kotlin
field.addTextChangedListener(listener)
field.onFocusChangeListener = listener   // previous one captured and forwarded to
```

Capturing the old focus listener matters, because RN installs its own in
`ReactTextInputManager.addEventEmitters` — that is what dispatches `onFocus` / `onBlur`
/ `onEndEditing`. The library chains rather than replaces.

Validation is handled differently from iOS: there is no pre-edit veto on Android, so
`afterTextChanged` **rolls the field back** on failure:

```kotlin
if (!isValidText(stringText)) {
  field.setText(prevText)
  field.setSelection(cursorPosition)
  return
}
```

The `prevText == field.text.toString()` guards at the top of both `onTextChanged` and
`afterTextChanged` are the reentrancy brake — without them the rollback and the mask's
own writes would recurse.

`isSettingFromJS` suppresses the change event when the `value` prop drives the write,
so a controlled update does not echo back to JS.

Android depends on `com.github.IvanIhnatsiuk:input-mask-android:7.2.5`.

## Web: a full TypeScript port of the engine

`src/index.web.tsx` swaps in a completely separate implementation — roughly 1500 lines
under `src/web/` reimplementing the mask engine in TS, driven by a
`useMaskedTextInputListener` hook on a plain controlled `TextInput`. No sibling-view
trick; on web it is ordinary JS formatting in the change handler.

That TS port is the most readable copy of the algorithm, which is why the notes below
cite it rather than the Swift/Kotlin originals.

## The mask engine itself

**Compile once, then walk a state machine.** `Compiler.compile(format)` sanitizes the
format string and builds a singly-linked chain of `State` nodes, one per mask position:

| state | meaning |
| --- | --- |
| `ValueState` | a mandatory slot (`[0]`, `[A]`, `[_]`, a custom notation, or an ellipsis) |
| `OptionalValueState` | an optional slot (`[9]`, `[a]`, `[-]`) |
| `FixedState` | a literal inside `{}` |
| `FreeState` | a literal outside brackets |
| `EOLState` | terminator |

Masks are cached by format string (`Mask.getOrCreate`), so compilation happens once
per distinct pattern.

**`apply()` is a single left-to-right walk** over the input, in
`src/web/helper/Mask.ts`. Each `state.accept(char)` returns a `Next` describing what to
do — `{state, insert, value, pass}` — where `insert` goes into the formatted string,
`value` into the extracted string, and `pass` says whether the input character was
consumed. A `ValueState` for an ellipsis returns *itself* as `nextState()`, which is
how unbounded runs work.

Three things ride along with that walk:

- **Caret tracking.** `insertionAffectsCaret` / `deletionAffectsCaret` come from the
  iterator, and the caret is nudged as characters are inserted or rejected, so the
  cursor lands where the user expects after the mask rewrites the string. This is the
  part everyone gets wrong when hand-rolling a mask.
- **Autocomplete.** After the input is exhausted, if `caretGravity.autocomplete` the
  walk keeps calling `state.autocomplete()` to emit constant characters ahead of the
  caret (typing `1` into `+1 ([000])` gives you the `(` for free).
- **Autoskip.** Every autocompleted step is pushed onto an `AutocompletionStack`;
  on backspace the stack is popped to strip the trailing constants back off.

Whatever state the walk ends in, `appendPlaceholder(tailState, tail)` runs the chain to
the end to produce `tailPlaceholder`, and `noMandatoryCharactersLeftAfterState(state)`
gives `complete`.

**Affinity** is how multiple candidate masks are ranked (`affinityFormat`). Each
candidate is scored by one of four strategies (`src/web/helper/affinityCalculationStrategy.ts`):

| strategy | score |
| --- | --- |
| `WHOLE_STRING` | the walk's own `affinity` counter (+1 per accepted char, −1 per rejected) |
| `PREFIX` | length of the common prefix between input and formatted output |
| `CAPACITY` | `text.length - mask.totalTextLength()`, or `MIN_SAFE_INTEGER` if it overflows |
| `EXTRACTED_VALUE_CAPACITY` | same, against `totalValueLength()` |

That is what lets `[00]{/}[00]{/}[00]` and `[00]{/}[00]{/}[0000]` coexist and swap as
the user keeps typing a year.

## The consequence: it opts out of RN's controlled-text protocol

Worth stating plainly, because it is the real trade-off and it connects straight to
[RN-TEXTINPUT-INTERNALS.md](./RN-TEXTINPUT-INTERNALS.md).

RN's `mostRecentEventCount` handshake exists so JS-originated writes that raced against
typing get dropped. This library sidesteps it: `value` is a decorator prop, the
decorator writes the native field directly, and the forged `editingChanged` then makes
RN observe the result as if it were user input. RN's counter still advances correctly —
but RN is never the *author* of the text, only a witness to it.

That is why `value` is deliberately kept off the inner `TextInput`. Pass it to both and
you get two writers and a fight. It also means `TextInput`'s own `value`-vs-`lastNativeText`
reconciliation never runs, so the usual "controlled input lags on a janky JS thread"
behaviour does not apply here — the formatting is genuinely synchronous and native.

## How this compares to NitroInput

| | advanced-input-mask | NitroInput |
| --- | --- | --- |
| Owns an input? | No — decorates RN's `TextInput` | Yes — own hidden `UITextField` / `AppCompatEditText` |
| Formatting hook | Hijacks the field's delegate / TextWatcher | Owns the delegate outright |
| Sync formatting | Yes (`shouldChangeCharactersIn` / `TextWatcher`) | Yes (same hooks) |
| RN prop/callback parity | Inherited for free — it *is* a `TextInput` | Reimplemented prop by prop (see TEXTINPUT-PARITY.md) |
| Rendering | RN's own glyphs | Custom overlay, morph animation |
| Mount cost | RN `TextInput` + one extra native view | One Nitro hybrid view |
| Fragility | Sibling-position coupling; delegate-chain ordering | None of that, but must re-earn every RN behaviour |
| Web | Separate 1500-line TS engine | n/a |

The decorator approach buys ecosystem parity for free and pays for it in coupling: it
depends on the decorator sitting at a specific tree position, on `RCTUITextField` being
one level inside the previous sibling, and on being able to slot into a delegate chain
that keyboard-controller and others also mutate. Owning the field, as NitroInput does,
inverts both sides of that trade.

## Things worth taking from it

1. **The forged `editingChanged`** is the cleanest trick here. If NitroInput ever needs
   to coexist with something that expects RN's change plumbing, the pattern is:
   `NotificationCenter.post(.textDidChangeNotification)` +
   `sendActions(for: .editingChanged)` after writing the text.
2. **`forwardingTarget(for:)` proxying** is a nicer way to wrap a delegate than
   re-implementing the whole protocol — worth remembering for the keyboard-controller
   composite-delegate interaction already documented in TEXTINPUT-PARITY.md.
3. **The state-machine mask engine** (compile once, cache by format, one walk that
   simultaneously produces formatted text, extracted value, caret position, tail
   placeholder and completeness) is a much better structure than regex-per-keystroke,
   and `AmountFormatter` covers only a special case of it. If NitroInput ever wants
   general masks rather than amount formatting, this is the algorithm to port — it is
   MIT and readable in `src/web/`.
4. **Affinity scoring** is the right answer to "which of these formats is the user
   typing", and is not obvious to invent.

## Local checkout

Cloned shallow to the session scratchpad; re-clone with:

```bash
git clone --depth 1 https://github.com/IvanIhnatsiuk/react-native-advanced-input-mask.git
```

Layout: `packages/react-native-advanced-input-mask/{src,ios,android}`,
example apps under `apps/`, e2e under `e2e/`. Both Paper and Fabric are supported
(`android/src/{oldarch,newarch}`, `#ifdef RCT_NEW_ARCH_ENABLED` on iOS).
