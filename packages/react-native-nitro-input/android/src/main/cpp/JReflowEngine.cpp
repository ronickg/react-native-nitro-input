//
//  JReflowEngine.cpp
//  NitroInput
//

#include "JReflowEngine.hpp"

namespace margelo::nitro::nitroinput {

jni::local_ref<JReflowEngine::jhybriddata> JReflowEngine::initHybrid(jni::alias_ref<jhybridobject>) {
  return makeCxxInstance();
}

void JReflowEngine::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", JReflowEngine::initHybrid),
      makeNativeMethod("setTiming", JReflowEngine::setTiming),
      makeNativeMethod("setEffect", JReflowEngine::setEffect),
      makeNativeMethod("setReduceMotion", JReflowEngine::setReduceMotion),
      makeNativeMethod("setRightToLeft", JReflowEngine::setRightToLeft),
      makeNativeMethod("beginText", JReflowEngine::beginText),
      makeNativeMethod("addGlyph", JReflowEngine::addGlyph),
      makeNativeMethod("commitText", JReflowEngine::commitText),
      makeNativeMethod("tick", JReflowEngine::tick),
      makeNativeMethod("needsFrames", JReflowEngine::needsFrames),
      makeNativeMethod("isAnimating", JReflowEngine::isAnimating),
      makeNativeMethod("glyphCount", JReflowEngine::glyphCount),
      makeNativeMethod("contentWidth", JReflowEngine::contentWidth),
      makeNativeMethod("targetWidth", JReflowEngine::targetWidth),
      makeNativeMethod("bodyCount", JReflowEngine::bodyCount),
      makeNativeMethod("caretX", JReflowEngine::caretX),
      makeNativeMethod("reset", JReflowEngine::reset),
      makeNativeMethod("frameInto", JReflowEngine::frameInto),
  });
}

void JReflowEngine::setTiming(double durationSeconds, int easing, double bounce) {
  engine_.setTiming(durationSeconds, easing, bounce);
}

void JReflowEngine::setEffect(int effect) {
  engine_.setEffect(effect);
}

void JReflowEngine::setReduceMotion(bool reduceMotion) {
  engine_.setReduceMotion(reduceMotion);
}

void JReflowEngine::setRightToLeft(bool rightToLeft) {
  engine_.setRightToLeft(rightToLeft);
}

void JReflowEngine::beginText() {
  engine_.beginText();
}

void JReflowEngine::addGlyph(int character, int role, int kind, double width, bool placeholder) {
  engine_.addGlyph(static_cast<uint32_t>(character), role, kind, width, placeholder);
}

void JReflowEngine::commitText(int caret, double now) {
  engine_.commitText(caret, now);
}

bool JReflowEngine::tick(double now) {
  return engine_.tick(now);
}

bool JReflowEngine::needsFrames() {
  return engine_.needsFrames();
}

bool JReflowEngine::isAnimating() {
  return engine_.isAnimating();
}

int JReflowEngine::glyphCount() {
  return engine_.glyphCount();
}

double JReflowEngine::contentWidth() {
  return engine_.contentWidth();
}

double JReflowEngine::targetWidth() {
  return engine_.targetWidth();
}

int JReflowEngine::bodyCount() {
  return engine_.bodyCount();
}

double JReflowEngine::caretX(int index) {
  return engine_.caretX(index);
}

void JReflowEngine::reset() {
  engine_.reset();
}

int JReflowEngine::frameInto(jni::alias_ref<jni::JArrayDouble> out) {
  const auto& glyphs = engine_.glyphs();
  const size_t count = glyphs.size();
  constexpr size_t kPerGlyph = 11;
  const size_t needed = 3 + count * kPerGlyph;
  if (static_cast<size_t>(out->size()) < needed) {
    return -1;
  }
  scratch_.resize(needed);
  double* data = scratch_.data();
  data[0] = static_cast<double>(count);
  data[1] = engine_.contentWidth();
  data[2] = engine_.targetWidth();
  size_t i = 3;
  for (const auto& g : glyphs) {
    data[i++] = static_cast<double>(g.id);
    data[i++] = static_cast<double>(g.character);
    data[i++] = static_cast<double>(g.role);
    data[i++] = static_cast<double>(g.kind);
    data[i++] = g.width;
    data[i++] = g.placeholder ? 1.0 : 0.0;
    data[i++] = g.x;
    data[i++] = g.y;
    data[i++] = g.opacity;
    data[i++] = g.scale;
    data[i++] = g.exiting ? 1.0 : 0.0;
  }
  out->setRegion(0, needed, data);
  return static_cast<int>(needed);
}

} // namespace margelo::nitro::nitroinput
