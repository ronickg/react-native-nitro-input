#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroMorphInputOnLoad.hpp"
#include "JMorphEngine.hpp"
#include "JAmountFormatter.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::nitromorphinput::registerAllNatives();
    margelo::nitro::nitromorphinput::JMorphEngine::registerNatives();
    margelo::nitro::nitromorphinput::JAmountFormatter::registerNatives();
  });
}
