//
//  JAmountFormatter.cpp
//  NitroMorphInput
//

#include "JAmountFormatter.hpp"

namespace margelo::nitro::nitromorphinput {

jni::local_ref<JAmountFormatter::jhybriddata> JAmountFormatter::initHybrid(jni::alias_ref<jhybridobject>) {
  return makeCxxInstance();
}

void JAmountFormatter::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", JAmountFormatter::initHybrid),
      makeNativeMethod("setFormat", JAmountFormatter::setFormat),
      makeNativeMethod("applyEdit", JAmountFormatter::applyEdit),
      makeNativeMethod("normalize", JAmountFormatter::normalize),
      makeNativeMethod("lastCaret", JAmountFormatter::lastCaret),
      makeNativeMethod("lastAccepted", JAmountFormatter::lastAccepted),
      makeNativeMethod("format", JAmountFormatter::format),
      makeNativeMethod("value", JAmountFormatter::value),
      makeNativeMethod("kindOf", JAmountFormatter::kindOf),
  });
}

void JAmountFormatter::setFormat(int fractionDigits, int maxIntegerDigits, jni::alias_ref<jni::JString> grouping,
                                 jni::alias_ref<jni::JString> decimal) {
  formatter_.setFormat(fractionDigits, maxIntegerDigits, grouping ? grouping->toStdString() : std::string(),
                       decimal ? decimal->toStdString() : std::string("."));
}

jni::local_ref<jni::JString> JAmountFormatter::applyEdit(jni::alias_ref<jni::JString> current, int start, int end,
                                                         jni::alias_ref<jni::JString> replacement) {
  const auto edit = formatter_.applyEdit(current ? current->toStdString() : std::string(), start, end,
                                         replacement ? replacement->toStdString() : std::string());
  lastCaret_ = edit.caret;
  lastAccepted_ = edit.accepted;
  return jni::make_jstring(edit.text);
}

jni::local_ref<jni::JString> JAmountFormatter::normalize(jni::alias_ref<jni::JString> text) {
  const auto edit = formatter_.normalize(text ? text->toStdString() : std::string());
  lastCaret_ = edit.caret;
  lastAccepted_ = edit.accepted;
  return jni::make_jstring(edit.text);
}

int JAmountFormatter::lastCaret() {
  return lastCaret_;
}

bool JAmountFormatter::lastAccepted() {
  return lastAccepted_;
}

jni::local_ref<jni::JString> JAmountFormatter::format(double value) {
  return jni::make_jstring(formatter_.format(value));
}

double JAmountFormatter::value(jni::alias_ref<jni::JString> text) {
  return formatter_.value(text ? text->toStdString() : std::string());
}

int JAmountFormatter::kindOf(int codePoint) {
  return formatter_.kindOf(static_cast<uint32_t>(codePoint));
}

} // namespace margelo::nitro::nitromorphinput
