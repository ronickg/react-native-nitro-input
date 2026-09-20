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

/// True when the package was built against react-native-worklets and JS has
/// installed the UI runtime.
bool isReady();
/// True when react-native-worklets was available at build time.
bool isAvailable();
/// Forgets the installed runtime. The reference is weak, so this is only
/// needed to drop it eagerly; a torn-down runtime expires on its own.
void uninstallRuntime();

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

} // namespace margelo::nitro::nitroinput::nitroinputworklets
