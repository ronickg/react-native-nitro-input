//
//  JRollingEngine.hpp
//  NitroRollingNumber
//
//  fbjni bridge that lets the Kotlin view drive the shared C++ RollingEngine.
//  This is the only hand-written JNI in the library.
//

#pragma once

#include "RollingEngine.hpp"
#include <fbjni/fbjni.h>

namespace margelo::nitro::nitrorollingnumber {

using namespace facebook;

class JRollingEngine final : public jni::HybridClass<JRollingEngine> {
public:
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/nitrorollingnumber/RollingEngine;";

  static jni::local_ref<jhybriddata> initHybrid(jni::alias_ref<jhybridobject>);
  static void registerNatives();

  void setFormat(int fractionDigits, int minimumIntegerDigits);
  void setTiming(double durationSeconds, int easing, double bounce, double staggerSeconds, int direction);
  void setReduceMotion(bool reduceMotion);
  void setValue(double value);
  void animateTo(double value, double now);
  void setLoading(bool loading, double now);
  bool tick(double now);
  bool needsFrames();
  void reset();
  /// [signFactor, loadingProgress, wheelCount, then (position, width, linear, blankZero) per wheel]
  jni::local_ref<jni::JArrayDouble> frame();
  double shimmerPhase(double now, double periodSeconds);
  double targetValue();
  bool hasShownValue();
  int settledPowerCount();
  bool settledNegative();
  int targetDigit(int power);

private:
  friend HybridBase;
  JRollingEngine() = default;
  RollingEngine engine_;
};

} // namespace margelo::nitro::nitrorollingnumber
