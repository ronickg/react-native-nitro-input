//
//  JMorphWorklets.cpp
//  NitroMorphInput
//

#include "JMorphWorklets.hpp"

#include "MorphWorkletsBridge.hpp"

namespace margelo::nitro::nitromorphinput {

namespace {
// The Kotlin side reads these right after `runTransform` on the same (main) thread.
int gLastSelectionStart = 0;
int gLastSelectionEnd = 0;
} // namespace

void JMorphWorklets::registerNatives() {
  javaClassStatic()->registerNatives({
      makeNativeMethod("isReady", JMorphWorklets::isReady),
      makeNativeMethod("runTransform", JMorphWorklets::runTransform),
      makeNativeMethod("lastSelectionStart", JMorphWorklets::lastSelectionStart),
      makeNativeMethod("lastSelectionEnd", JMorphWorklets::lastSelectionEnd),
      makeNativeMethod("runChangeText", JMorphWorklets::runChangeText),
      makeNativeMethod("runChangeValue", JMorphWorklets::runChangeValue),
  });
}

jboolean JMorphWorklets::isReady(jni::alias_ref<jni::JClass>) {
  return morphworklets::isReady();
}

jni::local_ref<jni::JString> JMorphWorklets::runTransform(jni::alias_ref<jni::JClass>, jint id,
                                                          jni::alias_ref<jni::JString> text,
                                                          jni::alias_ref<jni::JString> previousText, jint selectionStart,
                                                          jint selectionEnd, jint previousSelectionStart,
                                                          jint previousSelectionEnd) {
  const auto result = morphworklets::runTransform(id, text->toStdString(), previousText->toStdString(), selectionStart,
                                                  selectionEnd, previousSelectionStart, previousSelectionEnd);
  if (!result.applied) return nullptr;
  gLastSelectionStart = result.selectionStart;
  gLastSelectionEnd = result.selectionEnd;
  return jni::make_jstring(result.text);
}

jint JMorphWorklets::lastSelectionStart(jni::alias_ref<jni::JClass>) {
  return gLastSelectionStart;
}

jint JMorphWorklets::lastSelectionEnd(jni::alias_ref<jni::JClass>) {
  return gLastSelectionEnd;
}

void JMorphWorklets::runChangeText(jni::alias_ref<jni::JClass>, jint id, jni::alias_ref<jni::JString> text) {
  morphworklets::runChangeText(id, text->toStdString());
}

void JMorphWorklets::runChangeValue(jni::alias_ref<jni::JClass>, jint id, jdouble value) {
  morphworklets::runChangeValue(id, value);
}

} // namespace margelo::nitro::nitromorphinput
