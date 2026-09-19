//
//  HybridNitroInputWorklets.hpp
//  NitroInput
//
//  The `NitroInputWorklets` hybrid object: JS hands it the worklets UI runtime
//  (`install(getUIRuntimeHolder())`, a raw JSI method because the holder is
//  an opaque object) and the native views run registered worklets through
//  `NitroInputWorkletsBridge`.
//

#pragma once

#include "HybridNitroInputWorkletsSpec.hpp"

namespace margelo::nitro::nitroinput {

class HybridNitroInputWorklets final : public HybridNitroInputWorkletsSpec {
public:
  HybridNitroInputWorklets() : HybridObject(TAG) {}

  bool getIsAvailable() override;

protected:
  void loadHybridMethods() override;

private:
  jsi::Value install(jsi::Runtime& runtime, const jsi::Value& thisValue, const jsi::Value* args, size_t count);
};

} // namespace margelo::nitro::nitroinput
