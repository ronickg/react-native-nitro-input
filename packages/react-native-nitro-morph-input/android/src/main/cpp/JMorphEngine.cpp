//
//  JMorphEngine.cpp
//  NitroMorphInput
//

#include "JMorphEngine.hpp"

namespace margelo::nitro::nitromorphinput {

jni::local_ref<JMorphEngine::jhybriddata> JMorphEngine::initHybrid(jni::alias_ref<jhybridobject>) {
  return makeCxxInstance();
}

void JMorphEngine::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", JMorphEngine::initHybrid),
      makeNativeMethod("setTiming", JMorphEngine::setTiming),
      makeNativeMethod("setEffect", JMorphEngine::setEffect),
      makeNativeMethod("setReduceMotion", JMorphEngine::setReduceMotion),
      makeNativeMethod("beginText", JMorphEngine::beginText),
      makeNativeMethod("addGlyph", JMorphEngine::addGlyph),
      makeNativeMethod("commitText", JMorphEngine::commitText),
      makeNativeMethod("tick", JMorphEngine::tick),
      makeNativeMethod("needsFrames", JMorphEngine::needsFrames),
      makeNativeMethod("isAnimating", JMorphEngine::isAnimating),
      makeNativeMethod("glyphCount", JMorphEngine::glyphCount),
      makeNativeMethod("contentWidth", JMorphEngine::contentWidth),
      makeNativeMethod("targetWidth", JMorphEngine::targetWidth),
      makeNativeMethod("bodyCount", JMorphEngine::bodyCount),
      makeNativeMethod("caretX", JMorphEngine::caretX),
      makeNativeMethod("reset", JMorphEngine::reset),
      makeNativeMethod("frameInto", JMorphEngine::frameInto),
  });
}

void JMorphEngine::setTiming(double durationSeconds, int easing, double bounce) {
  engine_.setTiming(durationSeconds, easing, bounce);
}

void JMorphEngine::setEffect(int effect) {
  engine_.setEffect(effect);
}

void JMorphEngine::setReduceMotion(bool reduceMotion) {
  engine_.setReduceMotion(reduceMotion);
}

void JMorphEngine::beginText() {
  engine_.beginText();
}

void JMorphEngine::addGlyph(int character, int role, int kind, double width, bool placeholder) {
  engine_.addGlyph(static_cast<uint32_t>(character), role, kind, width, placeholder);
}

void JMorphEngine::commitText(int caret, double now) {
  engine_.commitText(caret, now);
}

bool JMorphEngine::tick(double now) {
  return engine_.tick(now);
}

bool JMorphEngine::needsFrames() {
  return engine_.needsFrames();
}

bool JMorphEngine::isAnimating() {
  return engine_.isAnimating();
}

int JMorphEngine::glyphCount() {
  return engine_.glyphCount();
}

double JMorphEngine::contentWidth() {
  return engine_.contentWidth();
}

double JMorphEngine::targetWidth() {
  return engine_.targetWidth();
}

int JMorphEngine::bodyCount() {
  return engine_.bodyCount();
}

double JMorphEngine::caretX(int index) {
  return engine_.caretX(index);
}

void JMorphEngine::reset() {
  engine_.reset();
}

int JMorphEngine::frameInto(jni::alias_ref<jni::JArrayDouble> out) {
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

} // namespace margelo::nitro::nitromorphinput
