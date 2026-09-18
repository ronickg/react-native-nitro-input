//
//  JRollingEngine.cpp
//  NitroRollingNumber
//

#include "JRollingEngine.hpp"

namespace margelo::nitro::nitrorollingnumber {

jni::local_ref<JRollingEngine::jhybriddata> JRollingEngine::initHybrid(jni::alias_ref<jhybridobject>) {
  return makeCxxInstance();
}

void JRollingEngine::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", JRollingEngine::initHybrid),
      makeNativeMethod("setFormat", JRollingEngine::setFormat),
      makeNativeMethod("setTiming", JRollingEngine::setTiming),
      makeNativeMethod("setReduceMotion", JRollingEngine::setReduceMotion),
      makeNativeMethod("setValue", JRollingEngine::setValue),
      makeNativeMethod("animateTo", JRollingEngine::animateTo),
      makeNativeMethod("setLoading", JRollingEngine::setLoading),
      makeNativeMethod("tick", JRollingEngine::tick),
      makeNativeMethod("needsFrames", JRollingEngine::needsFrames),
      makeNativeMethod("isRolling", JRollingEngine::isRolling),
      makeNativeMethod("reset", JRollingEngine::reset),
      makeNativeMethod("setRevealTiming", JRollingEngine::setRevealTiming),
      makeNativeMethod("holdReveal", JRollingEngine::holdReveal),
      makeNativeMethod("reveal", JRollingEngine::reveal),
      makeNativeMethod("isRevealing", JRollingEngine::isRevealing),
      makeNativeMethod("clearRevealMilestones", JRollingEngine::clearRevealMilestones),
      makeNativeMethod("addRevealMilestone", JRollingEngine::addRevealMilestone),
      makeNativeMethod("setRevealMilestoneHold", JRollingEngine::setRevealMilestoneHold),
      makeNativeMethod("revealMilestonesReached", JRollingEngine::revealMilestonesReached),
      makeNativeMethod("revealMilestoneValue", JRollingEngine::revealMilestoneValue),
      makeNativeMethod("frame", JRollingEngine::frame),
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

void JRollingEngine::setReduceMotion(bool reduceMotion) {
  engine_.setReduceMotion(reduceMotion);
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

jni::local_ref<jni::JArrayDouble> JRollingEngine::frame() {
  const auto& wheels = engine_.wheels();
  const size_t count = wheels.size();
  std::vector<double> data;
  data.reserve(4 + count * 4);
  data.push_back(engine_.signFactor());
  data.push_back(engine_.loadingProgress());
  data.push_back(engine_.revealScale());
  data.push_back(static_cast<double>(count));
  for (const auto& w : wheels) {
    data.push_back(w.position);
    data.push_back(w.width);
    data.push_back(w.linear ? 1.0 : 0.0);
    data.push_back(w.blankZero ? 1.0 : 0.0);
  }
  auto array = jni::JArrayDouble::newArray(data.size());
  array->setRegion(0, data.size(), data.data());
  return array;
}

int JRollingEngine::frameInto(jni::alias_ref<jni::JArrayDouble> out) {
  const auto& wheels = engine_.wheels();
  const size_t count = wheels.size();
  constexpr size_t kMaxWheels = 32;
  double data[4 + kMaxWheels * 4];
  const size_t needed = 4 + count * 4;
  if (count > kMaxWheels || static_cast<size_t>(out->size()) < needed) {
    return -1;
  }
  data[0] = engine_.signFactor();
  data[1] = engine_.loadingProgress();
  data[2] = engine_.revealScale();
  data[3] = static_cast<double>(count);
  size_t i = 4;
  for (const auto& w : wheels) {
    data[i++] = w.position;
    data[i++] = w.width;
    data[i++] = w.linear ? 1.0 : 0.0;
    data[i++] = w.blankZero ? 1.0 : 0.0;
  }
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

} // namespace margelo::nitro::nitrorollingnumber
