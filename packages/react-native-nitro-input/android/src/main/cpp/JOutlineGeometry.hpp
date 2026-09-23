//
//  JOutlineGeometry.hpp
//  NitroInput
//
//  fbjni bridge to the shared C++ OutlineGeometry, so Android traces exactly
//  the same notched outline iOS does.
//
//  Segments come back in a caller-owned `double[]`, six doubles each - verb, x,
//  y, radius, startAngle, sweepAngle - rather than as objects: the view reuses
//  one array, and the geometry is traced into a vector this object keeps (the
//  `std::vector<double>` overload of `OutlineGeometry::outline`), so redrawing
//  the frame allocates nothing on either side, the same trick JReflowEngine
//  uses for its glyphs.
//
//  `gapFor` needs no bridge. It only clamps, and `outline` already treats a
//  non-finite left as 0 and a non-positive width as no gap, so the caller
//  passes the floated label's rect straight in.
//

#pragma once

#include "OutlineGeometry.hpp"
#include <fbjni/fbjni.h>
#include <vector>

namespace margelo::nitro::nitroinput {

using namespace facebook;

class JOutlineGeometry final : public jni::HybridClass<JOutlineGeometry> {
public:
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/nitroinput/OutlineGeometry;";

  static jni::local_ref<jhybriddata> initHybrid(jni::alias_ref<jhybridobject>);
  static void registerNatives();

  /// Writes the outline into `out` and returns how many segments it wrote, or
  /// -1 when `out` is too short to hold them (the caller grows it and retries).
  int outline(double width, double height, double radius, double strokeWidth, double bottomRadius,
              double gapLeft, double gapWidth, double gapPadding, double progress,
              jni::alias_ref<jni::JArrayDouble> out);

  /// Interpolates the label's rect, written into `out` as x, y, width, height.
  void lerp(double fromX, double fromY, double fromWidth, double fromHeight, double toX, double toY,
            double toWidth, double toHeight, double progress, jni::alias_ref<jni::JArrayDouble> out);

private:
  friend HybridBase;
  JOutlineGeometry() = default;

  /// The flat segments, kept between calls so a redraw reallocates nothing.
  std::vector<double> flat_;
};

} // namespace margelo::nitro::nitroinput
