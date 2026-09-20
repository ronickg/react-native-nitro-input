//
//  OutlineGeometry.cpp
//  NitroInput
//

#include "OutlineGeometry.hpp"

#include <algorithm>
#include <cmath>

namespace margelo::nitro::nitroinput {

namespace {

double clamp01(double value) {
  if (!(value > 0)) return 0; // also catches NaN
  return value < 1 ? value : 1;
}

double finite(double value, double fallback) {
  return std::isfinite(value) ? value : fallback;
}

} // namespace

OutlineGeometry::Rect OutlineGeometry::lerp(const Rect& from, const Rect& to, double progress) {
  const double t = clamp01(finite(progress, 0));
  return Rect{
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
      from.width + (to.width - from.width) * t,
      from.height + (to.height - from.height) * t,
  };
}

OutlineGeometry::Gap OutlineGeometry::gapFor(const Rect& floatedLabel, double padding) {
  Gap gap;
  gap.left = finite(floatedLabel.x, 0);
  gap.width = std::max(0.0, finite(floatedLabel.width, 0));
  gap.padding = std::max(0.0, finite(padding, 0));
  return gap;
}

std::vector<OutlineGeometry::Segment> OutlineGeometry::outline(const Box& box, const Gap& gap, double progress) {
  std::vector<Segment> path;

  const double width = std::max(0.0, finite(box.width, 0));
  const double height = std::max(0.0, finite(box.height, 0));
  const double stroke = std::max(0.0, finite(box.strokeWidth, 0));
  if (width <= stroke || height <= stroke) return path;

  // The path runs down the middle of the stroke, so it is inset by half of it.
  const double inset = stroke / 2;
  const double left = inset;
  const double top = inset;
  const double right = width - inset;
  const double bottom = height - inset;
  const double maxRadius = std::min(right - left, bottom - top) / 2;
  const double topRadius = std::clamp(finite(box.radius, 0), 0.0, maxRadius);
  // A negative or non-finite bottom radius means "the same as the top".
  const double requestedBottom =
      std::isfinite(box.bottomRadius) && box.bottomRadius >= 0 ? box.bottomRadius : finite(box.radius, 0);
  const double bottomRadius = std::clamp(requestedBottom, 0.0, maxRadius);

  const double t = clamp01(finite(progress, 0));
  const double padded = gap.width > 0 ? gap.width + gap.padding * 2 : 0;
  double gapStart = finite(gap.left, 0) - gap.padding;
  double gapWidth = padded * t;

  // The gap has to sit on the straight part of the top edge, between the two
  // corner arcs. A label too wide for that just closes the gap rather than
  // producing a path that doubles back on itself.
  const double straightStart = left + topRadius;
  const double straightEnd = right - topRadius;
  const double bottomStart = left + bottomRadius;
  const double bottomEnd = right - bottomRadius;
  if (gapWidth > 0) {
    gapStart = std::max(gapStart, straightStart);
    const double gapEnd = gapStart + gapWidth;
    if (gapEnd > straightEnd || straightEnd - straightStart <= 0) {
      gapWidth = 0;
    }
  }

  const auto line = [&](double x, double y) { path.push_back(Segment{Verb::Line, Point{x, y}, 0, 0, 0}); };
  const auto arc = [&](double cx, double cy, double r, double start, double sweep) {
    path.push_back(Segment{Verb::Arc, Point{cx, cy}, r, start, sweep});
  };

  // The gap is always expressed, even when it is zero wide, so the path has the
  // same verbs and the same point count at every progress. That is what lets
  // Core Animation and ValueAnimator interpolate between two of them: a path
  // that changed shape mid-animation could not be tweened, and would need a
  // display link redrawing it every frame instead.
  if (gapWidth <= 0) gapStart = straightStart;
  path.push_back(Segment{Verb::Move, Point{gapStart + gapWidth, top}, 0, 0, 0});
  line(straightEnd, top);

  // Clockwise from the top-right corner. Angles are measured from the positive
  // x axis with y growing downwards, which is what both platforms use.
  if (topRadius > 0) arc(straightEnd, top + topRadius, topRadius, -90, 90);
  line(right, bottom - bottomRadius);
  if (bottomRadius > 0) arc(bottomEnd, bottom - bottomRadius, bottomRadius, 0, 90);
  line(bottomStart, bottom);
  if (bottomRadius > 0) arc(bottomStart, bottom - bottomRadius, bottomRadius, 90, 90);
  line(left, top + topRadius);
  if (topRadius > 0) arc(straightStart, top + topRadius, topRadius, 180, 90);

  // Back to the near edge of the gap - the same point we started from when the
  // gap is closed, so the rectangle reads as unbroken.
  line(gapStart, top);
  return path;
}

} // namespace margelo::nitro::nitroinput
