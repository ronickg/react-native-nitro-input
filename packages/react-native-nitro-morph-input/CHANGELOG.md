# Changelog

## 0.1.0 (unreleased)

- Initial release: native single-line text / amount input (iOS + Android) with Torph-style text morphing, built with Nitro Modules.
- One shared C++ engine (`cpp/MorphEngine`): caret matching for edits (grouping separators paired from the units end), place matching for programmatic sets, longest-common-subsequence for text; digits slide through the line box, separators from below, text fades and scales; entering and leaving characters ride with their nearest persisting neighbour; `expo` / `easeOut` / `easeInOut` / `linear` / `spring` timing; Reduce Motion snaps.
- `mode="number"`: every edit is formatted natively before a frame is drawn (`cpp/AmountFormatter`): grouping, one decimal, `fractionDigits` / `maxIntegerDigits` limits that reject the keystroke, backspace over a separator removes the digit before it, a decimal typed in the integer part moves the decimal point, `prefix` / `suffix` with their own sizes and alignment.
- Controlled `value` with the `text` + `mostRecentEventCount` handshake (a stale value never fights the user); `onChangeText`, `onChangeValue`, `onFocus` / `onBlur`, `onSubmitEditing`; `focus` / `blur` / `clear` / `setText` / `setValue` / `getText` / `getValue` / `isFocused`.
- Worklets (optional, with `react-native-worklets`): a `transform` worklet and `'worklet'`-marked `onChangeText` / `onChangeValue` run synchronously on the UI thread inside the native edit, via a `MorphWorklets` bridge that holds the worklets UI runtime; no-ops when the package is not installed.
- Docs page with a live demo running the same engine and formatter compiled to WebAssembly.
