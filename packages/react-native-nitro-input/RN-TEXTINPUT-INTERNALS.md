# How React Native's own `TextInput` works

Notes from reading the RN source directly, so NitroInput's design decisions can be
checked against the thing it is replacing. Read at **React Native 0.86.0**
(`node_modules/react-native` in the `monorepo` checkout). Paths below are relative to
the `react-native` package root; in the RN monorepo they live under
`packages/react-native/`. Line numbers are 0.86.0 and will drift — grep the symbol
instead.

Companion to [TEXTINPUT-PARITY.md](./TEXTINPUT-PARITY.md), which measures behaviour.
This one explains mechanism.

## The five layers

| layer | file |
| --- | --- |
| Controlled-component brain (993 lines) | `Libraries/Components/TextInput/TextInput.js` |
| Global focus registry | `Libraries/Components/TextInput/TextInputState.js` |
| Shadow node + state (C++) | `ReactCommon/react/renderer/components/textinput/BaseTextInputShadowNode.h`, `TextInputState.h` |
| iOS view | `React/Fabric/Mounting/ComponentViews/TextInput/RCTTextInputComponentView.mm`, `Libraries/Text/TextInput/RCTBackedTextInputDelegateAdapter.mm` |
| Android view | `ReactAndroid/src/main/java/com/facebook/react/views/textinput/{ReactEditText,ReactTextInputManager}.kt` |

The native surface is small: props, events, and exactly **three commands** —
`focus`, `blur`, `setTextAndSelection` (`TextInputNativeCommands.js:15`).
Everything else is prop diffing.

Backing views are the classic ones — `RCTUITextField` / `RCTUITextView` on iOS,
`AppCompatEditText` on Android. Same choice NitroInput made, for the same reasons.

## The core invariant: `mostRecentEventCount`

This is the entire design. Text is bidirectional and both directions are async, so RN
makes **native the owner of the text while typing**, and JS is always one round trip
behind. Every JS-originated write carries the counter JS last heard about, and native
drops the write if it is stale.

### Native → JS, per user edit

1. Native bumps its counter. iOS: `_mostRecentEventCount += _comingFromJS ? 0 : 1`
   inside `_updateState` (`RCTTextInputComponentView.mm:733`). Android:
   `incrementAndGetEventCounter()`.
2. It pushes the new string **and** the counter into C++ state
   (`_state->updateState`), **and separately** fires `onChange` with `eventCount` in
   the payload (`TextInputEventEmitter.cpp:27`).
3. JS `_onChange` calls `setLastNativeText(text)` **then**
   `setMostRecentEventCount(...)`. The ordering is load-bearing and commented as such
   (`TextInput.js:274` — reordering breaks Android multi-Fragment editing).

### JS → native

`useTextInputStateSynchronization` (`TextInput.js:200`) runs a layout effect that
compares `props.value` with `lastNativeText`; on a difference it issues
`setTextAndSelection(ref, mostRecentEventCount, text, start, end)`.

### The guard, which differs per platform

```objc
// iOS — exact equality
if (_mostRecentEventCount != eventCount) { return; }
```

```kotlin
// Android — greater-or-equal
fun canUpdateWithEventCount(eventCounter: Int) = eventCounter >= nativeEventCount
```

Type while JS is busy and the in-flight `value` write is silently discarded. That is
why a controlled `TextInput` never fights the keyboard, and also why `value` visibly
lags on a janky JS thread.

### Two details that are easy to miss

- **Android bumps the counter twice per keystroke.**
  `ReactTextInputTextWatcher.onTextChanged` calls `incrementAndGetEventCounter()` once
  for the state update and again for the event, so the counter jumps by 2. It only
  works because the Android check is `>=` and not `==`.
- **There are two independent downstream channels.** Besides the command,
  `updateState:` applies the attributed string only when
  `_mostRecentEventCount == state.mostRecentEventCount`. Upstream, the shadow node
  only produces new state when the *React-tree* string changed
  (`reactTreeAttributedString.isContentEqual`, `BaseTextInputShadowNode.h:157`) —
  that is the "wipe the field and replace it" path, distinct from the native echo.

## Focus is a JS registry, not a native concept

`TextInputState` is a module-level `currentlyFocusedInputRef` plus a `Set` of
registered inputs. The payoff is in
`src/private/webapis/dom/nodes/ReactNativeElement.js:155`:

```js
focus() {
  if (TextInputState.isTextInput(this)) {
    TextInputState.focusTextInput(this);
  } else if (ReactNativeFeatureFlags.enableImperativeFocus()) {
    ViewCommands.focus(this);
  }
}
```

Every `ref.focus()` on any host element routes through that registry. So NitroInput
registering there is not a workaround — it is *the* mechanism. Same for
`Keyboard.dismiss()` and `keyboardShouldPersistTaps`.

`TextInput` registers **twice**, deliberately: in the ref callback (so `focus()` works
from a ref callback) and again in a layout effect. Safe because it is a Set
(`TextInput.js:454`).

`focus` / `blur` are **not** among the methods TextInput assigns onto the instance —
it only adds `clear`, `getNativeRef`, `isFocused`, `setSelection`. `focus` comes from
the host element.

## Ordering quirks, and the flags that exist to fight the OS

iOS carries three pieces of mutable state purely to paper over UIKit:

- **`_ignoreNextTextInputCall`** — UITextField fires change→selection, UITextView
  fires selection→change. JS requires change first, so for multiline the selection
  handler calls `textInputDidChange` itself and suppresses the next real one
  (`RCTTextInputComponentView.mm:52-59`).
- **`_comingFromJS`** — setting `attributedText` programmatically fires the delegates;
  this suppresses echoing them back as user events and stops the counter incrementing.
- **`_textOf:equals:`** — falls back to bare string comparison during dictation,
  Korean input, an active `markedTextRange`, secure entry, or when the system injected
  `NSOriginalFont` for an emoji. Touching `attributedText` mid-dictation kills
  dictation.

### A genuine cross-platform inconsistency

iOS `textInputDidEndEditing` fires `onEndEditing` **then** `onBlur`.
Android's `onFocusChangeListener` fires `BlurEvent` **then**
`ReactTextInputEndEditingEvent`. Opposite order. Worth deciding which one the parity
screens should assert.

### `onKeyPress` is structurally different per platform

iOS gets it from `textInputShouldChangeText:inRange:` — *before* the edit — plus a
private `keyboardInputShouldDelete:` hook to catch backspace on an empty field.

Android has no pre-edit hook and reconstructs the key by **diffing cursor positions
across `setComposingText`** in an `InputConnectionWrapper`
(`ReactEditTextInputConnectionWrapper.kt:71`). That heuristic is why parity item #5
(autocorrect reporting `"An"` rather than a single key) is hard to fix properly: RN
gets it right on iOS by accident of having a pre-edit hook, and only approximates it
on Android.

`maxLength` is enforced in that same iOS pre-edit hook, and is
composed-character-sequence aware so emoji are not sliced in half
(`RCTTextInputComponentView.mm:461`).

## Measurement

`BaseTextInputShadowNode` is a **leaf, measurable, baseline-capable** Yoga node.
`measureContent` runs the real `TextLayoutManager`, measuring the *placeholder* when
the value is empty. Single-line inputs are measured at **infinite width** and then
clamped — "a horizontal scroller of infinitely expandable text"
(`BaseTextInputShadowNode.h:128`).

So RN never auto-sizes to content the way NitroInput does; it measures intrinsic text
size and lets Yoga's default cross-axis `stretch` fill the parent. That is the
mechanism behind parity difference #1.

## Corrections this reading produced for TEXTINPUT-PARITY.md

### 1. The focus-latency explanation is wrong on the outbound leg

The parity table says RN's `focus()` is "a Fabric view command, applied with the
mounting transaction". It is not. The path is `UIManager::dispatchCommand` → delegate
→ `RCTSurfacePresenter` → `RCTMountingManager dispatchCommand`, which is:

```objc
if (RCTIsMainQueue()) { [self synchronouslyDispatch...]; return; }
RCTExecuteOnMainQueue(^{ [self synchronouslyDispatch...]; });
```

One thread hop — the same scheduling as NitroInput's `DispatchQueue.main.async`, not
a commit. The measured 29–54 ms gap is therefore almost entirely the **return** leg:
RN's `onFocus` goes through the batched EventDispatcher, NitroInput calls the JS
callback inline. That is a stronger claim than the doc currently makes, and it is the
one the numbers actually support.

### 2. RN's `autoFocus` never goes through JS

It is `props.autoFocus` read natively in `didMoveToWindow` with a **synchronous**
`becomeFirstResponder` (`RCTTextInputComponentView.mm:121`), and
`onAttachedToWindow` + `requestFocusProgrammatically()` on Android
(`ReactEditText.kt:941`). `maybeAutoFocus()` in `ios/NitroInputView.swift` converged
on exactly RN's design — the doc should say so, because it explains *why* the keyboard
stops churning, not just that it does.

## Open item for NitroInput

`prepareForRecycle` resets `_mostRecentEventCount = 0` and clears the text
(`RCTTextInputComponentView.mm:378`). Fabric recycles component views aggressively,
and a stale counter surviving a recycle would silently swallow the first JS write to
the reused view. Worth checking NitroInput's recycle path.
