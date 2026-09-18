//
//  JMorphWorklets.hpp
//  NitroMorphInput
//
//  Static JNI entry points for the Kotlin view to run registered worklets
//  synchronously through `MorphWorkletsBridge`.
//

#pragma once

#include <fbjni/fbjni.h>

namespace margelo::nitro::nitromorphinput {

using namespace facebook;

struct JMorphWorklets final : public jni::JavaClass<JMorphWorklets> {
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/nitromorphinput/MorphWorklets;";

  static void registerNatives();

  static jboolean isReady(jni::alias_ref<jni::JClass>);
  /// The transformed text, or null when the worklet did not apply. The
  /// selection it chose is read with `lastSelectionStart` / `lastSelectionEnd`.
  static jni::local_ref<jni::JString> runTransform(jni::alias_ref<jni::JClass>, jint id, jni::alias_ref<jni::JString> text,
                                                   jni::alias_ref<jni::JString> previousText, jint selectionStart,
                                                   jint selectionEnd, jint previousSelectionStart,
                                                   jint previousSelectionEnd);
  static jint lastSelectionStart(jni::alias_ref<jni::JClass>);
  static jint lastSelectionEnd(jni::alias_ref<jni::JClass>);
  static void runChangeText(jni::alias_ref<jni::JClass>, jint id, jni::alias_ref<jni::JString> text);
  static void runChangeValue(jni::alias_ref<jni::JClass>, jint id, jdouble value);
};

} // namespace margelo::nitro::nitromorphinput
