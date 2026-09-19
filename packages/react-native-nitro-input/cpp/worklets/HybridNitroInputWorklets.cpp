//
//  HybridNitroInputWorklets.cpp
//  NitroInput
//

#include "HybridNitroInputWorklets.hpp"

#include "NitroInputWorkletsBridge.hpp"
#include "NitroInputWorkletsBridgeJSI.hpp"

namespace margelo::nitro::nitroinput {

bool HybridNitroInputWorklets::getIsAvailable() {
  return nitroinputworklets::isAvailable();
}

void HybridNitroInputWorklets::loadHybridMethods() {
  HybridNitroInputWorkletsSpec::loadHybridMethods();
  registerHybrids(this, [](Prototype& prototype) {
    prototype.registerRawHybridMethod("install", 1, &HybridNitroInputWorklets::install);
  });
}

jsi::Value HybridNitroInputWorklets::install(jsi::Runtime& runtime, const jsi::Value& /* thisValue */, const jsi::Value* args,
                                        size_t count) {
  if (count < 1) return jsi::Value(false);
  return jsi::Value(nitroinputworklets::installRuntime(runtime, args[0]));
}

} // namespace margelo::nitro::nitroinput
