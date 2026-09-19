//
//  JAmountFormatter.hpp
//  NitroInput
//
//  fbjni bridge to the shared C++ AmountFormatter. Strings cross as UTF-8;
//  offsets count code points (the Kotlin side converts from UTF-16).
//

#pragma once

#include "AmountFormatter.hpp"
#include <fbjni/fbjni.h>

namespace margelo::nitro::nitroinput {

using namespace facebook;

class JAmountFormatter final : public jni::HybridClass<JAmountFormatter> {
public:
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/nitroinput/AmountFormatter;";

  static jni::local_ref<jhybriddata> initHybrid(jni::alias_ref<jhybridobject>);
  static void registerNatives();

  void setFormat(int fractionDigits, int maxIntegerDigits, jni::alias_ref<jni::JString> grouping,
                 jni::alias_ref<jni::JString> decimal);
  /// Returns the next text; `lastCaret()` / `lastAccepted()` carry the rest of the result.
  jni::local_ref<jni::JString> applyEdit(jni::alias_ref<jni::JString> current, int start, int end,
                                         jni::alias_ref<jni::JString> replacement);
  jni::local_ref<jni::JString> normalize(jni::alias_ref<jni::JString> text);
  int lastCaret();
  bool lastAccepted();
  jni::local_ref<jni::JString> format(double value);
  double value(jni::alias_ref<jni::JString> text);
  int kindOf(int codePoint);

private:
  friend HybridBase;
  JAmountFormatter() = default;
  AmountFormatter formatter_;
  int lastCaret_ = 0;
  bool lastAccepted_ = true;
};

} // namespace margelo::nitro::nitroinput
