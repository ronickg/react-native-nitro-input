#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroRollingNumberOnLoad.hpp"
#include "JRollingEngine.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::nitrorollingnumber::registerAllNatives();
    margelo::nitro::nitrorollingnumber::JRollingEngine::registerNatives();
  });
}
