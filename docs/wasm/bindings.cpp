//
//  bindings.cpp
//  Emscripten bindings for the docs site: the very RollingEngine that runs on
//  iOS and Android, compiled to WebAssembly so the live demos use the real
//  curves, stagger, carry rule and reveal instead of a re-implementation.
//
//  Build with `bun run build:wasm` from the docs folder (see docs/package.json).
//

#include <emscripten/bind.h>

#include "RollingEngine.hpp"

using namespace emscripten;
using margelo::nitro::nitrorollingnumber::RollingEngine;

EMSCRIPTEN_BINDINGS(rolling_engine) {
  value_object<RollingEngine::Wheel>("Wheel")
      .field("position", &RollingEngine::Wheel::position)
      .field("width", &RollingEngine::Wheel::width)
      .field("linear", &RollingEngine::Wheel::linear)
      .field("blankZero", &RollingEngine::Wheel::blankZero)
      .field("fromGlyph", &RollingEngine::Wheel::fromGlyph)
      .field("toGlyph", &RollingEngine::Wheel::toGlyph)
      .field("blend", &RollingEngine::Wheel::blend)
      .field("fromAbove", &RollingEngine::Wheel::fromAbove)
      .field("flash", &RollingEngine::Wheel::flash)
      .field("flashUp", &RollingEngine::Wheel::flashUp)
      .field("focus", &RollingEngine::Wheel::focus);

  class_<RollingEngine>("RollingEngine")
      .constructor<>()
      .function("setFormat", &RollingEngine::setFormat)
      .function("setTiming", &RollingEngine::setTiming)
      .function("setTransition", &RollingEngine::setTransition)
      .function("setFlash", &RollingEngine::setFlash)
      .function("setPopOnChange", &RollingEngine::setPopOnChange)
      .function("setReduceMotion", &RollingEngine::setReduceMotion)
      .function("setValue", &RollingEngine::setValue)
      .function("animateTo", &RollingEngine::animateTo)
      .function("setLoading", &RollingEngine::setLoading)
      .function("tick", &RollingEngine::tick)
      .function("reset", &RollingEngine::reset)
      .function("setRevealTiming", &RollingEngine::setRevealTiming)
      .function("setRevealGrow", &RollingEngine::setRevealGrow)
      .function("holdReveal", &RollingEngine::holdReveal)
      .function("reveal", &RollingEngine::reveal)
      .function("isRevealing", &RollingEngine::isRevealing)
      .function("revealScale", &RollingEngine::revealScale)
      .function("revealTotalSeconds", &RollingEngine::revealTotalSeconds)
      .function("clearRevealMilestones", &RollingEngine::clearRevealMilestones)
      .function("addRevealMilestone", &RollingEngine::addRevealMilestone)
      .function("setRevealMilestoneHold", &RollingEngine::setRevealMilestoneHold)
      .function("revealMilestonesReached", &RollingEngine::revealMilestonesReached)
      .function("revealMilestoneValue", &RollingEngine::revealMilestoneValue)
      .function("wheelCount", &RollingEngine::wheelCount)
      .function("wheelAt", &RollingEngine::wheelAt)
      .function("signFactor", &RollingEngine::signFactor)
      .function("loadingProgress", &RollingEngine::loadingProgress)
      .function("loading", &RollingEngine::loading)
      .function("shimmerPhase", &RollingEngine::shimmerPhase)
      .function("needsFrames", &RollingEngine::needsFrames)
      .function("isRolling", &RollingEngine::isRolling)
      .function("targetValue", &RollingEngine::targetValue)
      .function("hasShownValue", &RollingEngine::hasShownValue)
      .function("settledPowerCount", &RollingEngine::settledPowerCount)
      .function("settledNegative", &RollingEngine::settledNegative)
      .function("targetDigit", &RollingEngine::targetDigit)
      .function("fractionDigits", &RollingEngine::fractionDigits)
      .function("minimumIntegerDigits", &RollingEngine::minimumIntegerDigits);
}
