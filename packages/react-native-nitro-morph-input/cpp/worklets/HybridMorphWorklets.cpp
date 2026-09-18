//
//  HybridMorphWorklets.cpp
//  NitroMorphInput
//

#include "HybridMorphWorklets.hpp"

#include "MorphWorkletsBridge.hpp"
#include "MorphWorkletsBridgeJSI.hpp"

namespace margelo::nitro::nitromorphinput {

bool HybridMorphWorklets::getIsAvailable() {
  return morphworklets::isAvailable();
}

void HybridMorphWorklets::loadHybridMethods() {
  HybridMorphWorkletsSpec::loadHybridMethods();
  registerHybrids(this, [](Prototype& prototype) {
    prototype.registerRawHybridMethod("install", 1, &HybridMorphWorklets::install);
  });
}

jsi::Value HybridMorphWorklets::install(jsi::Runtime& runtime, const jsi::Value& /* thisValue */, const jsi::Value* args,
                                        size_t count) {
  if (count < 1) return jsi::Value(false);
  return jsi::Value(morphworklets::installRuntime(runtime, args[0]));
}

} // namespace margelo::nitro::nitromorphinput
