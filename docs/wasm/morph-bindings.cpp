//
//  morph-bindings.cpp
//  Emscripten bindings for the docs site: the very MorphEngine and
//  AmountFormatter that run inside the iOS and Android input views, compiled
//  to WebAssembly so the live demo morphs and formats exactly like the app.
//
//  Build with `bun run build:wasm:morph` from the docs folder (see docs/package.json).
//

#include <emscripten/bind.h>

#include "AmountFormatter.hpp"
#include "MorphEngine.hpp"

using namespace emscripten;
using margelo::nitro::nitroinput::AmountFormatter;
using margelo::nitro::nitroinput::MorphEngine;

namespace {

/// `MorphEngine::Glyph` with the 64-bit id as a double (embind value objects
/// don't carry int64 without BigInt).
struct GlyphJS {
  double id;
  unsigned character;
  int role;
  int kind;
  double width;
  bool placeholder;
  double x;
  double y;
  double opacity;
  double scale;
  bool exiting;
};

GlyphJS glyphAt(const MorphEngine& engine, int index) {
  const auto g = engine.glyphAt(index);
  return GlyphJS{static_cast<double>(g.id), g.character, g.role, g.kind, g.width, g.placeholder,
                 g.x, g.y, g.opacity, g.scale, g.exiting};
}

} // namespace

EMSCRIPTEN_BINDINGS(morph_engine) {
  value_object<GlyphJS>("Glyph")
      .field("id", &GlyphJS::id)
      .field("character", &GlyphJS::character)
      .field("role", &GlyphJS::role)
      .field("kind", &GlyphJS::kind)
      .field("width", &GlyphJS::width)
      .field("placeholder", &GlyphJS::placeholder)
      .field("x", &GlyphJS::x)
      .field("y", &GlyphJS::y)
      .field("opacity", &GlyphJS::opacity)
      .field("scale", &GlyphJS::scale)
      .field("exiting", &GlyphJS::exiting);

  class_<MorphEngine>("MorphEngine")
      .constructor<>()
      .function("setTiming", &MorphEngine::setTiming)
      .function("setEffect", &MorphEngine::setEffect)
      .function("setReduceMotion", &MorphEngine::setReduceMotion)
      .function("beginText", &MorphEngine::beginText)
      .function("addGlyph", &MorphEngine::addGlyph)
      .function("commitText", &MorphEngine::commitText)
      .function("tick", &MorphEngine::tick)
      .function("needsFrames", &MorphEngine::needsFrames)
      .function("isAnimating", &MorphEngine::isAnimating)
      .function("glyphCount", &MorphEngine::glyphCount)
      .function("glyphAt", &glyphAt)
      .function("contentWidth", &MorphEngine::contentWidth)
      .function("targetWidth", &MorphEngine::targetWidth)
      .function("bodyCount", &MorphEngine::bodyCount)
      .function("caretX", &MorphEngine::caretX)
      .function("hasText", &MorphEngine::hasText)
      .function("reset", &MorphEngine::reset);

  value_object<AmountFormatter::Edit>("Edit")
      .field("text", &AmountFormatter::Edit::text)
      .field("caret", &AmountFormatter::Edit::caret)
      .field("accepted", &AmountFormatter::Edit::accepted);

  class_<AmountFormatter>("AmountFormatter")
      .constructor<>()
      .function("setFormat", &AmountFormatter::setFormat)
      .function("applyEdit", &AmountFormatter::applyEdit)
      .function("normalize", &AmountFormatter::normalize)
      .function("format", &AmountFormatter::format)
      .function("value", &AmountFormatter::value)
      .function("kindOf", &AmountFormatter::kindOf)
      .class_function("codePointCount", &AmountFormatter::codePointCount);
}
