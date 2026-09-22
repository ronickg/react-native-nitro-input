//
//  NitroInputWorkletsBridge.hpp
//  NitroInput
//
//  Lets the native input run a worklet synchronously on the UI thread while
//  it handles an edit, the way Expo UI's worklet `onTextChange` and
//  react-native-transformer-text-input do: the worklets UI runtime is
//  installed once from JS (`HybridNitroInputWorklets::install`), JS registers its
//  worklets in a map on that runtime, and the views call them by id.
//
//  This header is plain C++ (no JSI, no worklets types) so Swift can import
//  it. Everything compiles to no-ops when `react-native-worklets` is not
//  installed (`MORPH_INPUT_WORKLETS` undefined).
//

#pragma once

#include <string>

namespace margelo::nitro::nitroinput::nitroinputworklets {

/// True when react-native-worklets was available at build time.
bool isAvailable();

struct TransformResult {
  /// False when there is no worklet for `id`, it returned nothing, or it threw.
  bool applied;
  std::string text;
  int selectionStart;
  int selectionEnd;
};

/// Runs the `transform` worklet `id` with the edited text and selections;
/// the registered wrapper always returns the final text and selection.
TransformResult runTransform(int id, const std::string& text, const std::string& previousText, int selectionStart,
                             int selectionEnd, int previousSelectionStart, int previousSelectionEnd);
/// Runs the `onChangeText` worklet `id` with the new text.
void runChangeText(int id, const std::string& text);
/// Runs the `onChangeValue` worklet `id` with the new value.
void runChangeValue(int id, double value);
/// Runs the `onFocus` / `onBlur` worklet `id` with the new focus state.
void runFocusChange(int id, bool focused, const std::string& text);
/// Runs the `onSelectionChange` worklet `id` with the selection, in code points.
void runSelectionChange(int id, int start, int end);
/// Runs the `onSubmitEditing` worklet `id` with the text.
void runSubmitEditing(int id, const std::string& text);
/// Runs the `onEndEditing` worklet `id` with the text.
void runEndEditing(int id, const std::string& text);
/// Runs the `onKeyPress` worklet `id` with the key.
void runKeyPress(int id, const std::string& key);

} // namespace margelo::nitro::nitroinput::nitroinputworklets
