//
//  JNitroInputWorklets.cpp
//  NitroInput
//

#include "JNitroInputWorklets.hpp"

#include "NitroInputWorkletsBridge.hpp"

namespace margelo::nitro::nitroinput {

namespace {
// The Kotlin side reads these right after `runTransform` on the same (main) thread.
int gLastSelectionStart = 0;
int gLastSelectionEnd = 0;
} // namespace

void JNitroInputWorklets::registerNatives() {
  javaClassStatic()->registerNatives({
      makeNativeMethod("isReady", JNitroInputWorklets::isReady),
      makeNativeMethod("runTransform", JNitroInputWorklets::runTransform),
      makeNativeMethod("lastSelectionStart", JNitroInputWorklets::lastSelectionStart),
      makeNativeMethod("lastSelectionEnd", JNitroInputWorklets::lastSelectionEnd),
      makeNativeMethod("runChangeText", JNitroInputWorklets::runChangeText),
      makeNativeMethod("runChangeValue", JNitroInputWorklets::runChangeValue),
  });
}

jboolean JNitroInputWorklets::isReady(jni::alias_ref<jni::JClass>) {
  return nitroinputworklets::isReady();
}

jni::local_ref<jni::JString> JNitroInputWorklets::runTransform(jni::alias_ref<jni::JClass>, jint id,
                                                          jni::alias_ref<jni::JString> text,
                                                          jni::alias_ref<jni::JString> previousText, jint selectionStart,
                                                          jint selectionEnd, jint previousSelectionStart,
                                                          jint previousSelectionEnd) {
  const auto result = nitroinputworklets::runTransform(id, text->toStdString(), previousText->toStdString(), selectionStart,
                                                  selectionEnd, previousSelectionStart, previousSelectionEnd);
  if (!result.applied) return nullptr;
  gLastSelectionStart = result.selectionStart;
  gLastSelectionEnd = result.selectionEnd;
  return jni::make_jstring(result.text);
}

jint JNitroInputWorklets::lastSelectionStart(jni::alias_ref<jni::JClass>) {
  return gLastSelectionStart;
}

jint JNitroInputWorklets::lastSelectionEnd(jni::alias_ref<jni::JClass>) {
  return gLastSelectionEnd;
}

void JNitroInputWorklets::runChangeText(jni::alias_ref<jni::JClass>, jint id, jni::alias_ref<jni::JString> text) {
  nitroinputworklets::runChangeText(id, text->toStdString());
}

void JNitroInputWorklets::runChangeValue(jni::alias_ref<jni::JClass>, jint id, jdouble value) {
  nitroinputworklets::runChangeValue(id, value);
}

} // namespace margelo::nitro::nitroinput
