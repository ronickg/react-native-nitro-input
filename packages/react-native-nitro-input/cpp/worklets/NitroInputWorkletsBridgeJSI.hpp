//
//  NitroInputWorkletsBridgeJSI.hpp
//  NitroInput
//
//  The JSI-facing half of the bridge, used by `HybridNitroInputWorklets` only.
//  Forward declarations keep this header importable next to the plain one.
//

#pragma once

namespace facebook::jsi {
class Runtime;
class Value;
} // namespace facebook::jsi

namespace margelo::nitro::nitroinput::nitroinputworklets {

/// Stores the worklets UI runtime found in `holder`, the object returned by
/// `getUIRuntimeHolder()` from react-native-worklets. Returns false when the
/// package was built without worklets or the holder is not one.
bool installRuntime(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& holder);

} // namespace margelo::nitro::nitroinput::nitroinputworklets
