//
//  JNitroInputWorklets.hpp
//  NitroInput
//
//  Static JNI entry points for the Kotlin view to run registered worklets
//  synchronously through `NitroInputWorkletsBridge`.
//

#pragma once

#include <fbjni/fbjni.h>

namespace margelo::nitro::nitroinput {

using namespace facebook;

struct JNitroInputWorklets final : public jni::JavaClass<JNitroInputWorklets> {
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/nitroinput/NitroInputWorklets;";

  static void registerNatives();

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
  static void runFocusChange(jni::alias_ref<jni::JClass>, jint id, jboolean focused,
                             jni::alias_ref<jni::JString> text);
  static void runSelectionChange(jni::alias_ref<jni::JClass>, jint id, jint start, jint end);
  static void runSubmitEditing(jni::alias_ref<jni::JClass>, jint id, jni::alias_ref<jni::JString> text);
  static void runEndEditing(jni::alias_ref<jni::JClass>, jint id, jni::alias_ref<jni::JString> text);
  static void runKeyPress(jni::alias_ref<jni::JClass>, jint id, jni::alias_ref<jni::JString> key);
};

} // namespace margelo::nitro::nitroinput
