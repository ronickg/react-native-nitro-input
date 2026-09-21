#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroInputOnLoad.hpp"
#include "JMorphEngine.hpp"
#include "JAmountFormatter.hpp"
#include "JMaskEngine.hpp"
#include "JOutlineGeometry.hpp"
#include "JNitroInputWorklets.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::nitroinput::registerAllNatives();
    margelo::nitro::nitroinput::JMorphEngine::registerNatives();
    margelo::nitro::nitroinput::JAmountFormatter::registerNatives();
    margelo::nitro::nitroinput::JMaskEngine::registerNatives();
    margelo::nitro::nitroinput::JOutlineGeometry::registerNatives();
    margelo::nitro::nitroinput::JNitroInputWorklets::registerNatives();
  });
}
