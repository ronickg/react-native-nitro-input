//
//  JMorphEngine.hpp
//  NitroInput
//
//  fbjni bridge that lets the Kotlin view drive the shared C++ MorphEngine.
//

#pragma once

#include "MorphEngine.hpp"
#include <fbjni/fbjni.h>
#include <vector>

namespace margelo::nitro::nitroinput {

using namespace facebook;

class JMorphEngine final : public jni::HybridClass<JMorphEngine> {
public:
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/nitroinput/MorphEngine;";

  static jni::local_ref<jhybriddata> initHybrid(jni::alias_ref<jhybridobject>);
  static void registerNatives();

  void setTiming(double durationSeconds, int easing, double bounce);
  void setEffect(int effect);
  void setReduceMotion(bool reduceMotion);
  void setRightToLeft(bool rightToLeft);
  void beginText();
  void addGlyph(int character, int role, int kind, double width, bool placeholder);
  void commitText(int caret, double now);
  bool tick(double now);
  bool needsFrames();
  bool isAnimating();
  int glyphCount();
  double contentWidth();
  double targetWidth();
  int bodyCount();
  double caretX(int index);
  void reset();
  /// Writes `[count, contentWidth, targetWidth, then per glyph: id, character,
  /// role, kind, width, placeholder, x, y, opacity, scale, exiting]` into `out`
  /// without allocating once warm; returns the number of doubles written, or
  /// -1 if `out` is too small.
  int frameInto(jni::alias_ref<jni::JArrayDouble> out);

private:
  friend HybridBase;
  JMorphEngine() = default;
  MorphEngine engine_;
  std::vector<double> scratch_;
};

} // namespace margelo::nitro::nitroinput
