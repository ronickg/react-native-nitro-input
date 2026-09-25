//
//  JRollingEngine.cpp
//  NitroInput
//

#include "JRollingEngine.hpp"

namespace margelo::nitro::nitroinput {

jni::local_ref<JRollingEngine::jhybriddata> JRollingEngine::initHybrid(jni::alias_ref<jhybridobject>) {
  return makeCxxInstance();
}

void JRollingEngine::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", JRollingEngine::initHybrid),
      makeNativeMethod("setFormat", JRollingEngine::setFormat),
      makeNativeMethod("setTiming", JRollingEngine::setTiming),
      makeNativeMethod("setTransition", JRollingEngine::setTransition),
      makeNativeMethod("setFlash", JRollingEngine::setFlash),
      makeNativeMethod("setPopOnChange", JRollingEngine::setPopOnChange),
      makeNativeMethod("setReduceMotion", JRollingEngine::setReduceMotion),
      makeNativeMethod("setContinuous", JRollingEngine::setContinuous),
      makeNativeMethod("setDigitMax", JRollingEngine::setDigitMax),
      makeNativeMethod("clearDigitMax", JRollingEngine::clearDigitMax),
      makeNativeMethod("wheelModulus", JRollingEngine::wheelModulus),
      makeNativeMethod("setSignDisplay", JRollingEngine::setSignDisplay),
      makeNativeMethod("signPositive", JRollingEngine::signPositive),
      makeNativeMethod("signFactor", JRollingEngine::signFactor),
      makeNativeMethod("changeText", JRollingEngine::changeText),
      makeNativeMethod("changeFormat", JRollingEngine::changeFormat),
      makeNativeMethod("setValue", JRollingEngine::setValue),
      makeNativeMethod("animateTo", JRollingEngine::animateTo),
      makeNativeMethod("setLoading", JRollingEngine::setLoading),
      makeNativeMethod("tick", JRollingEngine::tick),
      makeNativeMethod("needsFrames", JRollingEngine::needsFrames),
      makeNativeMethod("isRolling", JRollingEngine::isRolling),
      makeNativeMethod("reset", JRollingEngine::reset),
      makeNativeMethod("setRevealTiming", JRollingEngine::setRevealTiming),
      makeNativeMethod("setRevealGrow", JRollingEngine::setRevealGrow),
      makeNativeMethod("holdReveal", JRollingEngine::holdReveal),
      makeNativeMethod("reveal", JRollingEngine::reveal),
      makeNativeMethod("isRevealing", JRollingEngine::isRevealing),
      makeNativeMethod("clearRevealMilestones", JRollingEngine::clearRevealMilestones),
      makeNativeMethod("addRevealMilestone", JRollingEngine::addRevealMilestone),
      makeNativeMethod("setRevealMilestoneHold", JRollingEngine::setRevealMilestoneHold),
      makeNativeMethod("revealMilestonesReached", JRollingEngine::revealMilestonesReached),
      makeNativeMethod("revealMilestoneValue", JRollingEngine::revealMilestoneValue),
      makeNativeMethod("frameInto", JRollingEngine::frameInto),
      makeNativeMethod("shimmerPhase", JRollingEngine::shimmerPhase),
      makeNativeMethod("targetValue", JRollingEngine::targetValue),
      makeNativeMethod("hasShownValue", JRollingEngine::hasShownValue),
      makeNativeMethod("settledPowerCount", JRollingEngine::settledPowerCount),
      makeNativeMethod("settledNegative", JRollingEngine::settledNegative),
      makeNativeMethod("targetDigit", JRollingEngine::targetDigit),
  });
}

void JRollingEngine::setFormat(int fractionDigits, int minimumIntegerDigits) {
  engine_.setFormat(fractionDigits, minimumIntegerDigits);
}

void JRollingEngine::setTiming(double durationSeconds, int easing, double bounce, double staggerSeconds, int direction) {
  engine_.setTiming(durationSeconds, easing, bounce, staggerSeconds, direction);
}

void JRollingEngine::setTransition(int transition) {
  engine_.setTransition(transition);
}

void JRollingEngine::setFlash(double seconds) {
  engine_.setFlash(seconds);
}

void JRollingEngine::setPopOnChange(double overshoot) {
  engine_.setPopOnChange(overshoot);
}

void JRollingEngine::setReduceMotion(bool reduceMotion) {
  engine_.setReduceMotion(reduceMotion);
}

void JRollingEngine::setContinuous(bool continuous) {
  engine_.setContinuous(continuous);
}

void JRollingEngine::setDigitMax(int power, int max) {
  engine_.setDigitMax(power, max);
}

void JRollingEngine::clearDigitMax() {
  engine_.clearDigitMax();
}

int JRollingEngine::wheelModulus(int index) {
  return engine_.wheelModulus(index);
}

void JRollingEngine::setSignDisplay(int mode) {
  engine_.setSignDisplay(mode);
}

bool JRollingEngine::signPositive() {
  return engine_.signPositive();
}

double JRollingEngine::signFactor() {
  return engine_.signFactor();
}

void JRollingEngine::changeText(int slot, double now) {
  engine_.changeText(slot, now);
}

void JRollingEngine::changeFormat(int fractionDigits, int minimumIntegerDigits, double now) {
  engine_.changeFormat(fractionDigits, minimumIntegerDigits, now);
}

void JRollingEngine::setValue(double value) {
  engine_.setValue(value);
}

void JRollingEngine::animateTo(double value, double now) {
  engine_.animateTo(value, now);
}

void JRollingEngine::setLoading(bool loading, double now) {
  engine_.setLoading(loading, now);
}

bool JRollingEngine::tick(double now) {
  return engine_.tick(now);
}

bool JRollingEngine::isRolling() {
  return engine_.isRolling();
}

bool JRollingEngine::needsFrames() {
  return engine_.needsFrames();
}

void JRollingEngine::reset() {
  engine_.reset();
}

void JRollingEngine::setRevealTiming(double durationSeconds, double bounce, int style, double staggerSeconds) {
  engine_.setRevealTiming(durationSeconds, bounce, style, staggerSeconds);
}

void JRollingEngine::setRevealGrow(double grow) {
  engine_.setRevealGrow(grow);
}

void JRollingEngine::holdReveal(double value) {
  engine_.holdReveal(value);
}

void JRollingEngine::reveal(double value, double now) {
  engine_.reveal(value, now);
}

bool JRollingEngine::isRevealing() {
  return engine_.isRevealing();
}

void JRollingEngine::clearRevealMilestones() {
  engine_.clearRevealMilestones();
}

void JRollingEngine::addRevealMilestone(double value) {
  engine_.addRevealMilestone(value);
}

void JRollingEngine::setRevealMilestoneHold(double holdSeconds) {
  engine_.setRevealMilestoneHold(holdSeconds);
}

int JRollingEngine::revealMilestonesReached() {
  return engine_.revealMilestonesReached();
}

double JRollingEngine::revealMilestoneValue(int index) {
  return engine_.revealMilestoneValue(index);
}

int JRollingEngine::frameInto(jni::alias_ref<jni::JArrayDouble> out) {
  const auto& wheels = engine_.wheels();
  const size_t count = wheels.size();
  constexpr size_t kMaxWheels = 32;
  // Doubles per wheel: the engine's `Wheel`, then the places it wraps after
  // (`wheelModulus`: 10, or fewer on a clock's wheel).
  constexpr size_t kWheelFields = 15;
  // Then each text slot's swap (`RollingEngine::changeText`): grow, focus,
  // blurOut, active.
  // Then the decimal columns laid out and the decimal separator's factor.
  constexpr size_t kText = RollingEngine::kTextSlots * 4 + 2;
  double data[4 + kMaxWheels * kWheelFields + kText];
  const size_t needed = 4 + count * kWheelFields + kText;
  if (count > kMaxWheels || static_cast<size_t>(out->size()) < needed) {
    return -1;
  }
  data[0] = engine_.signFactor();
  data[1] = engine_.loadingProgress();
  data[2] = engine_.revealScale();
  data[3] = static_cast<double>(count);
  size_t i = 4;
  int index = 0;
  for (const auto& w : wheels) {
    data[i++] = w.position;
    data[i++] = w.width;
    data[i++] = w.linear ? 1.0 : 0.0;
    data[i++] = w.blankZero ? 1.0 : 0.0;
    data[i++] = w.fromGlyph;
    data[i++] = w.toGlyph;
    data[i++] = w.blend;
    data[i++] = w.fromAbove ? 1.0 : 0.0;
    data[i++] = w.flash;
    data[i++] = w.flashUp ? 1.0 : 0.0;
    data[i++] = w.focus;
    data[i++] = w.grow;
    data[i++] = w.blurOut;
    data[i++] = w.progress;
    data[i++] = static_cast<double>(engine_.wheelModulus(index++));
  }
  for (int slot = 0; slot < RollingEngine::kTextSlots; slot++) {
    const RollingEngine::TextChange t = engine_.textChange(slot);
    data[i++] = t.grow;
    data[i++] = t.focus;
    data[i++] = t.blurOut;
    data[i++] = t.active ? 1.0 : 0.0;
  }
  data[i++] = static_cast<double>(engine_.displayFractionDigits());
  data[i++] = engine_.decimalFactor();
  out->setRegion(0, needed, data);
  return static_cast<int>(needed);
}

double JRollingEngine::shimmerPhase(double now, double periodSeconds) {
  return engine_.shimmerPhase(now, periodSeconds);
}

double JRollingEngine::targetValue() {
  return engine_.targetValue();
}

bool JRollingEngine::hasShownValue() {
  return engine_.hasShownValue();
}

int JRollingEngine::settledPowerCount() {
  return engine_.settledPowerCount();
}

bool JRollingEngine::settledNegative() {
  return engine_.settledNegative();
}

int JRollingEngine::targetDigit(int power) {
  return engine_.targetDigit(power);
}

} // namespace margelo::nitro::nitroinput
