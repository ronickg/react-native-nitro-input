//
//  JReflowEngine.hpp
//  NitroInput
//
//  fbjni bridge that lets the Kotlin view drive the shared C++ ReflowEngine.
//

#pragma once

#include "ReflowEngine.hpp"
#include <fbjni/fbjni.h>
#include <vector>

namespace margelo::nitro::nitroinput {

using namespace facebook;

class JReflowEngine final : public jni::HybridClass<JReflowEngine> {
public:
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/nitroinput/ReflowEngine;";

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
  /// A whole line in one crossing: `setReduceMotion`, `beginText`, an
  /// `addGlyph` per character (in `role`, never a placeholder) and
  /// `commitText`. Returns `needsFrames()`.
  bool commitLine(jni::alias_ref<jni::JArrayInt> characters, jni::alias_ref<jni::JArrayInt> kinds,
                  jni::alias_ref<jni::JArrayDouble> widths, int count, int role, bool reduceMotion, int caret, double now);
  /// `tick` and `frameInto` in one crossing: the number of doubles written
  /// (or -1 if `out` is too small, after ticking), plus `kMoreFrames` while
  /// the engine still needs frames.
  int tickInto(double now, jni::alias_ref<jni::JArrayDouble> out);
  static constexpr int kMoreFrames = 1 << 30;

private:
  friend HybridBase;
  JReflowEngine() = default;
  ReflowEngine engine_;
  std::vector<double> scratch_;
  std::vector<jint> lineChars_;
  std::vector<jint> lineKinds_;
  std::vector<double> lineWidths_;
};

} // namespace margelo::nitro::nitroinput
