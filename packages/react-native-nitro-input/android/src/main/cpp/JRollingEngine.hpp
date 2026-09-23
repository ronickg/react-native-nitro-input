//
//  JRollingEngine.hpp
//  NitroInput
//
//  fbjni bridge that lets the Kotlin view drive the shared C++ RollingEngine.
//  This is the only hand-written JNI in the library.
//

#pragma once

#include "RollingEngine.hpp"
#include <fbjni/fbjni.h>

namespace margelo::nitro::nitroinput {

using namespace facebook;

class JRollingEngine final : public jni::HybridClass<JRollingEngine> {
public:
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/nitroinput/RollingEngine;";

  static jni::local_ref<jhybriddata> initHybrid(jni::alias_ref<jhybridobject>);
  static void registerNatives();

  void setFormat(int fractionDigits, int minimumIntegerDigits);
  void setTiming(double durationSeconds, int easing, double bounce, double staggerSeconds, int direction);
  void setTransition(int transition);
  void setFlash(double seconds);
  void setPopOnChange(double overshoot);
  void setReduceMotion(bool reduceMotion);
  void changeText(int slot, double now);
  void changeFormat(int fractionDigits, int minimumIntegerDigits, double now);
  void setValue(double value);
  void animateTo(double value, double now);
  void setLoading(bool loading, double now);
  bool tick(double now);
  bool needsFrames();
  bool isRolling();
  void reset();
  void setRevealTiming(double durationSeconds, double bounce, int style, double staggerSeconds);
  void setRevealGrow(double grow);
  void holdReveal(double value);
  void reveal(double value, double now);
  bool isRevealing();
  void clearRevealMilestones();
  void addRevealMilestone(double value);
  void setRevealMilestoneHold(double holdSeconds);
  int revealMilestonesReached();
  double revealMilestoneValue(int index);
  /// Writes the render state into `out` without allocating:
  /// `[signFactor, loadingProgress, revealScale, wheelCount, then (position,
  /// width, linear, blankZero) per wheel]`. Returns the number of doubles
  /// written, or -1 if `out` is too small.
  int frameInto(jni::alias_ref<jni::JArrayDouble> out);
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

} // namespace margelo::nitro::nitroinput
