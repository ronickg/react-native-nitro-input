//
//  JMaskEngine.hpp
//  NitroInput
//
//  fbjni bridge to the shared C++ MaskEngine. Strings cross as UTF-8; offsets
//  count code points (the Kotlin side converts from UTF-16). `applyEdit` and
//  `apply` return the formatted text; the rest of the result is read back with
//  the `last*` accessors, the same shape as JAmountFormatter.
//

#pragma once

#include "MaskEngine.hpp"
#include <fbjni/fbjni.h>

namespace margelo::nitro::nitroinput {

using namespace facebook;

class JMaskEngine final : public jni::HybridClass<JMaskEngine> {
public:
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/nitroinput/MaskEngine;";

  static jni::local_ref<jhybriddata> initHybrid(jni::alias_ref<jhybridobject>);
  static void registerNatives();

  void clearNotations();
  void addNotation(jni::alias_ref<jni::JString> character, jni::alias_ref<jni::JString> characterSet, bool isOptional);
  bool setFormat(jni::alias_ref<jni::JString> format);
  bool isActive();

  /// Replaces code points [start, end) of `current` with `replacement`.
  jni::local_ref<jni::JString> applyEdit(jni::alias_ref<jni::JString> current, int start, int end,
                                         jni::alias_ref<jni::JString> replacement, bool autocomplete, bool autoSkip);
  /// Masks `text` whole. Named `applyAll` because `apply` is a Kotlin scope function.
  jni::local_ref<jni::JString> applyAll(jni::alias_ref<jni::JString> text, int caret, bool caretForward,
                                     bool autocomplete, bool autoSkip);

  int lastCaret();
  jni::local_ref<jni::JString> lastExtracted();
  jni::local_ref<jni::JString> lastTailPlaceholder();
  bool lastComplete();
  jni::local_ref<jni::JString> placeholder();

private:
  friend HybridBase;
  JMaskEngine() = default;
  void remember(const MaskEngine::Result& result);

  MaskEngine engine_;
  MaskEngine::Result last_;
};

} // namespace margelo::nitro::nitroinput
