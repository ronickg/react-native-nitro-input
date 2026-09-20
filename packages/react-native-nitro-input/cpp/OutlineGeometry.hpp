//
//  OutlineGeometry.hpp
//  NitroInput
//
//  The outlined-field frame: a rounded rectangle whose top edge has a gap cut
//  out of it for a floating label.
//
//  The gap is a real hole in the stroked path, not a patch of background drawn
//  over the line, so whatever is behind the field shows through it. That is the
//  part people reach for Skia to get; it needs nothing more than describing the
//  border as a path instead of a filled box, which both UIBezierPath and
//  android.graphics.Path draw natively.
//
//  This header emits the path as a short list of move / line / arc commands so
//  iOS and Android replay exactly the same geometry. Text measurement stays on
//  the platform side: the caller passes in the label's measured width, and gets
//  back where the gap goes.
//

#pragma once

#include <cstdint>
#include <vector>

namespace margelo::nitro::nitroinput {

class OutlineGeometry final {
public:
  struct Point {
    double x = 0;
    double y = 0;
  };

  /// The field's frame, in points.
  struct Box {
    double width = 0;
    double height = 0;
    /// Corner radius, clamped to half the shorter side.
    double radius = 0;
    /// Stroke width; the path runs down the middle of it, as both platforms stroke.
    double strokeWidth = 1;
    /// The bottom corners, when they differ from the top ones. Negative - the
    /// default - means they match `radius`. A filled field squares them off so
    /// its indicator rule meets the fill edge to edge rather than overhanging
    /// the curve.
    double bottomRadius = -1;
  };

  /// The hole in the top edge. `width` is the label's measured width at its
  /// floated size; `padding` is the breathing room added on each side.
  struct Gap {
    double left = 0;
    double width = 0;
    double padding = 4;
  };

  enum class Verb : int32_t {
    Move = 0,
    Line = 1,
    /// A corner. `center` and `radius` with `startAngle` → `startAngle + sweepAngle`,
    /// degrees, clockwise, 0° pointing right - the convention both platforms take.
    Arc = 2,
  };

  struct Segment {
    Verb verb = Verb::Move;
    /// Move and Line: the destination. Arc: the arc's centre.
    Point point;
    double radius = 0;
    double startAngle = 0;
    double sweepAngle = 0;
  };

  /// The outline. `progress` interpolates the gap: 0 closes it (an unbroken
  /// rounded rectangle, for a resting label sitting inside the field), 1 opens
  /// it fully. A zero-width gap, or one that cannot fit between the corners,
  /// also yields an unbroken rectangle.
  static std::vector<Segment> outline(const Box& box, const Gap& gap, double progress);

  /// Linear interpolation of a rectangle, for animating the label between its
  /// resting place inside the field and its floated place on the outline.
  /// Both rects are measured by the platform.
  struct Rect {
    double x = 0;
    double y = 0;
    double width = 0;
    double height = 0;
  };
  static Rect lerp(const Rect& from, const Rect& to, double progress);

  /// The gap the given floated label rect needs, in the box's coordinates.
  static Gap gapFor(const Rect& floatedLabel, double padding);
};

} // namespace margelo::nitro::nitroinput
