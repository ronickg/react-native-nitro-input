//
//  reflow-bindings.cpp
//  Emscripten bindings for the docs site: the very ReflowEngine and
//  AmountFormatter that run inside the iOS and Android input views, compiled
//  to WebAssembly so the live demo reflows and formats exactly like the app.
//
//  Build with `bun run build:wasm:reflow` from the docs folder (see docs/package.json).
//

#include <emscripten/bind.h>

#include "AmountFormatter.hpp"
#include "ReflowEngine.hpp"
#include "OutlineGeometry.hpp"

using namespace emscripten;
using margelo::nitro::nitroinput::AmountFormatter;
using margelo::nitro::nitroinput::ReflowEngine;
using margelo::nitro::nitroinput::OutlineGeometry;

namespace {

/// `ReflowEngine::Glyph` with the 64-bit id as a double (embind value objects
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

GlyphJS glyphAt(const ReflowEngine& engine, int index) {
  const auto g = engine.glyphAt(index);
  return GlyphJS{static_cast<double>(g.id), g.character, g.role, g.kind, g.width, g.placeholder,
                 g.x, g.y, g.opacity, g.scale, g.exiting};
}

/// `OutlineGeometry::Segment` flattened: embind value objects take plain
/// fields, and the arc's centre and the line's destination share `x`/`y` the
/// same way the C++ `point` does.
struct SegmentJS {
  int verb;
  double x;
  double y;
  double radius;
  double startAngle;
  double sweepAngle;
};

std::vector<SegmentJS> outlinePath(double width, double height, double radius, double strokeWidth,
                                   double bottomRadius, double gapLeft, double gapWidth,
                                   double gapPadding, double progress) {
  OutlineGeometry::Box box;
  box.width = width;
  box.height = height;
  box.radius = radius;
  box.strokeWidth = strokeWidth;
  box.bottomRadius = bottomRadius;
  OutlineGeometry::Gap gap;
  gap.left = gapLeft;
  gap.width = gapWidth;
  gap.padding = gapPadding;
  std::vector<SegmentJS> out;
  for (const auto& s : OutlineGeometry::outline(box, gap, progress)) {
    out.push_back(SegmentJS{static_cast<int>(s.verb), s.point.x, s.point.y, s.radius, s.startAngle,
                            s.sweepAngle});
  }
  return out;
}

OutlineGeometry::Rect lerpRect(double fx, double fy, double fw, double fh, double tx, double ty,
                               double tw, double th, double progress) {
  OutlineGeometry::Rect from{fx, fy, fw, fh};
  OutlineGeometry::Rect to{tx, ty, tw, th};
  return OutlineGeometry::lerp(from, to, progress);
}

} // namespace

EMSCRIPTEN_BINDINGS(reflow_engine) {
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

  class_<ReflowEngine>("ReflowEngine")
      .constructor<>()
      .function("setTiming", &ReflowEngine::setTiming)
      .function("setEffect", &ReflowEngine::setEffect)
      .function("setReduceMotion", &ReflowEngine::setReduceMotion)
      .function("beginText", &ReflowEngine::beginText)
      .function("addGlyph", &ReflowEngine::addGlyph)
      .function("commitText", &ReflowEngine::commitText)
      .function("tick", &ReflowEngine::tick)
      .function("needsFrames", &ReflowEngine::needsFrames)
      .function("isAnimating", &ReflowEngine::isAnimating)
      .function("glyphCount", &ReflowEngine::glyphCount)
      .function("glyphAt", &glyphAt)
      .function("contentWidth", &ReflowEngine::contentWidth)
      .function("targetWidth", &ReflowEngine::targetWidth)
      .function("bodyCount", &ReflowEngine::bodyCount)
      .function("caretX", &ReflowEngine::caretX)
      .function("hasText", &ReflowEngine::hasText)
      .function("reset", &ReflowEngine::reset);

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

  // The frame. The gap in the top edge is a real hole in the stroked path, so
  // the docs draw the same geometry the two platforms stroke rather than a
  // look-alike.
  value_object<SegmentJS>("Segment")
      .field("verb", &SegmentJS::verb)
      .field("x", &SegmentJS::x)
      .field("y", &SegmentJS::y)
      .field("radius", &SegmentJS::radius)
      .field("startAngle", &SegmentJS::startAngle)
      .field("sweepAngle", &SegmentJS::sweepAngle);
  register_vector<SegmentJS>("SegmentList");

  value_object<OutlineGeometry::Rect>("Rect")
      .field("x", &OutlineGeometry::Rect::x)
      .field("y", &OutlineGeometry::Rect::y)
      .field("width", &OutlineGeometry::Rect::width)
      .field("height", &OutlineGeometry::Rect::height);

  function("outlinePath", &outlinePath);
  function("lerpRect", &lerpRect);
}
