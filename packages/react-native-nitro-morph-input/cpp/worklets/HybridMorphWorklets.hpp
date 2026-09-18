//
//  HybridMorphWorklets.hpp
//  NitroMorphInput
//
//  The `MorphWorklets` hybrid object: JS hands it the worklets UI runtime
//  (`install(getUIRuntimeHolder())`, a raw JSI method because the holder is
//  an opaque object) and the native views run registered worklets through
//  `MorphWorkletsBridge`.
//

#pragma once

#include "HybridMorphWorkletsSpec.hpp"

namespace margelo::nitro::nitromorphinput {

class HybridMorphWorklets final : public HybridMorphWorkletsSpec {
public:
  HybridMorphWorklets() : HybridObject(TAG) {}

  bool getIsAvailable() override;

protected:
  void loadHybridMethods() override;

private:
  jsi::Value install(jsi::Runtime& runtime, const jsi::Value& thisValue, const jsi::Value* args, size_t count);
};

} // namespace margelo::nitro::nitromorphinput
