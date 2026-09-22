//
//  JMaskEngine.cpp
//  NitroInput
//

#include "JMaskEngine.hpp"

namespace margelo::nitro::nitroinput {

namespace {
std::string str(jni::alias_ref<jni::JString> value) {
  return value ? value->toStdString() : std::string();
}
} // namespace

jni::local_ref<JMaskEngine::jhybriddata> JMaskEngine::initHybrid(jni::alias_ref<jhybridobject>) {
  return makeCxxInstance();
}

void JMaskEngine::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", JMaskEngine::initHybrid),
      makeNativeMethod("clearNotations", JMaskEngine::clearNotations),
      makeNativeMethod("addNotation", JMaskEngine::addNotation),
      makeNativeMethod("setFormat", JMaskEngine::setFormat),
      makeNativeMethod("applyEdit", JMaskEngine::applyEdit),
      makeNativeMethod("applyAll", JMaskEngine::applyAll),
      makeNativeMethod("lastCaret", JMaskEngine::lastCaret),
      makeNativeMethod("lastExtracted", JMaskEngine::lastExtracted),
      makeNativeMethod("lastTailPlaceholder", JMaskEngine::lastTailPlaceholder),
      makeNativeMethod("lastComplete", JMaskEngine::lastComplete),
  });
}

void JMaskEngine::remember(const MaskEngine::Result& result) {
  last_ = result;
}

void JMaskEngine::clearNotations() {
  engine_.clearNotations();
}

void JMaskEngine::addNotation(jni::alias_ref<jni::JString> character, jni::alias_ref<jni::JString> characterSet,
                              bool isOptional) {
  engine_.addNotation(str(character), str(characterSet), isOptional);
}

bool JMaskEngine::setFormat(jni::alias_ref<jni::JString> format) {
  return engine_.setFormat(str(format));
}

jni::local_ref<jni::JString> JMaskEngine::applyEdit(jni::alias_ref<jni::JString> current, int start, int end,
                                                    jni::alias_ref<jni::JString> replacement, bool autocomplete,
                                                    bool autoSkip) {
  remember(engine_.applyEdit(str(current), start, end, str(replacement), autocomplete, autoSkip));
  return jni::make_jstring(last_.formattedText);
}

jni::local_ref<jni::JString> JMaskEngine::applyAll(jni::alias_ref<jni::JString> text, int caret, bool caretForward,
                                                bool autocomplete, bool autoSkip) {
  remember(engine_.apply(str(text), caret, caretForward, autocomplete, autoSkip));
  return jni::make_jstring(last_.formattedText);
}

int JMaskEngine::lastCaret() {
  return last_.caret;
}

jni::local_ref<jni::JString> JMaskEngine::lastExtracted() {
  return jni::make_jstring(last_.extractedValue);
}

jni::local_ref<jni::JString> JMaskEngine::lastTailPlaceholder() {
  return jni::make_jstring(last_.tailPlaceholder);
}

bool JMaskEngine::lastComplete() {
  return last_.complete;
}

} // namespace margelo::nitro::nitroinput
