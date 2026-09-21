// Host-side checks for the notched outline. Build & run with `bun run test:cpp`.
#include "OutlineGeometry.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

using margelo::nitro::nitroinput::OutlineGeometry;
using Verb = OutlineGeometry::Verb;

static int failures = 0;

#define CHECK(cond)                                                               \
  do {                                                                            \
    if (!(cond)) {                                                                \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);                 \
      failures++;                                                                 \
    }                                                                             \
  } while (0)

#define CHECK_NEAR(actual, expected)                                                        \
  do {                                                                                      \
    const double a_ = (actual);                                                             \
    const double e_ = (expected);                                                           \
    if (!(std::fabs(a_ - e_) < 1e-6)) {                                                     \
      std::printf("FAIL %s:%d: %s == %.6f, expected %.6f\n", __FILE__, __LINE__, #actual,   \
                  a_, e_);                                                                  \
      failures++;                                                                           \
    }                                                                                       \
  } while (0)

static OutlineGeometry::Box box(double w = 300, double h = 56, double r = 8, double s = 1) {
  return OutlineGeometry::Box{w, h, r, s};
}

static int countOf(const std::vector<OutlineGeometry::Segment>& path, Verb verb) {
  int n = 0;
  for (const auto& s : path) {
    if (s.verb == verb) n++;
  }
  return n;
}

/// True when the path never jumps: only the first segment may be a Move.
static bool singleSubpath(const std::vector<OutlineGeometry::Segment>& path) {
  for (size_t i = 1; i < path.size(); ++i) {
    if (path[i].verb == Verb::Move) return false;
  }
  return !path.empty() && path[0].verb == Verb::Move;
}

/// Every path has the same verbs in the same order, whatever the progress.
/// Core Animation and ValueAnimator can only tween two paths that match.
static void everyPathHasTheSameShape() {
  const OutlineGeometry::Gap gap{24, 60, 4};
  std::vector<Verb> reference;
  for (const auto& s : OutlineGeometry::outline(box(), gap, 0)) reference.push_back(s.verb);
  CHECK(reference.size() > 0);
  for (double t : {0.0, 0.01, 0.37, 0.5, 0.99, 1.0}) {
    const auto path = OutlineGeometry::outline(box(), gap, t);
    CHECK(path.size() == reference.size());
    for (size_t i = 0; i < path.size() && i < reference.size(); ++i) {
      CHECK(path[i].verb == reference[i]);
    }
  }
  // Including with no label at all, and with a label too wide to fit.
  CHECK(OutlineGeometry::outline(box(), OutlineGeometry::Gap{}, 1).size() == reference.size());
  CHECK(OutlineGeometry::outline(box(), OutlineGeometry::Gap{24, 400, 4}, 1).size() == reference.size());
}

static void closedWhenThereIsNoLabel() {
  const auto path = OutlineGeometry::outline(box(), OutlineGeometry::Gap{}, 1);
  CHECK(singleSubpath(path));
  CHECK_NEAR(countOf(path, Verb::Arc), 4);
  // Starts and ends at the same point: an unbroken rounded rectangle.
  const auto& first = path.front();
  const auto& last = path.back();
  CHECK_NEAR(first.point.x, last.point.x);
  CHECK_NEAR(first.point.y, last.point.y);
}

static void closedAtRest() {
  // progress 0: the label is sitting inside the field, so the outline is whole.
  const OutlineGeometry::Gap gap{24, 60, 4};
  const auto path = OutlineGeometry::outline(box(), gap, 0);
  CHECK_NEAR(path.front().point.x, path.back().point.x);
  CHECK_NEAR(path.front().point.y, path.back().point.y);
}

static void openWhenTheLabelHasFloated() {
  const OutlineGeometry::Gap gap{24, 60, 4};
  const auto path = OutlineGeometry::outline(box(), gap, 1);
  CHECK(singleSubpath(path));
  CHECK_NEAR(countOf(path, Verb::Arc), 4);
  // The two ends are the edges of the hole: 60 wide plus 4 padding each side.
  CHECK_NEAR(path.front().point.x, 24 - 4 + 68);
  CHECK_NEAR(path.back().point.x, 24 - 4);
  CHECK(path.front().point.x > path.back().point.x);
  // Both ends sit on the top edge, half a stroke in.
  CHECK_NEAR(path.front().point.y, 0.5);
  CHECK_NEAR(path.back().point.y, 0.5);
}

static void theGapGrowsWithProgress() {
  const OutlineGeometry::Gap gap{24, 60, 4};
  double previous = 0;
  for (double t : {0.25, 0.5, 0.75, 1.0}) {
    const auto path = OutlineGeometry::outline(box(), gap, t);
    const double width = path.front().point.x - path.back().point.x;
    CHECK(width > previous);
    previous = width;
  }
  CHECK_NEAR(previous, 68);
}

static void theGapStaysOffTheCorners() {
  // A label starting before the corner arc ends is pushed clear of it.
  const OutlineGeometry::Gap gap{0, 40, 4};
  const auto path = OutlineGeometry::outline(box(300, 56, 8, 1), gap, 1);
  // radius 8, stroke 1 -> the straight part of the top edge starts at 0.5 + 8.
  CHECK(path.back().point.x >= 8.5 - 1e-9);
}

static void aLabelTooWideClosesTheGap() {
  // Wider than the straight part of the top edge: a gap would make the path
  // double back, so it is dropped and the rectangle stays whole.
  const OutlineGeometry::Gap gap{24, 400, 4};
  const auto path = OutlineGeometry::outline(box(), gap, 1);
  CHECK_NEAR(path.front().point.x, path.back().point.x);
  CHECK_NEAR(path.front().point.y, path.back().point.y);
}

static void radiusIsClampedAndSquareCornersWork() {
  // A radius past half the height is clamped rather than producing a bow tie.
  const auto rounded = OutlineGeometry::outline(box(300, 56, 999, 1), OutlineGeometry::Gap{}, 0);
  for (const auto& s : rounded) {
    if (s.verb == Verb::Arc) CHECK_NEAR(s.radius, 27.5); // (56 - 1) / 2
  }
  // Zero radius: no arcs at all, just four lines.
  const auto square = OutlineGeometry::outline(box(300, 56, 0, 1), OutlineGeometry::Gap{}, 0);
  CHECK_NEAR(countOf(square, Verb::Arc), 0);
  CHECK(singleSubpath(square));
}

static void degenerateBoxesProduceNothing() {
  CHECK(OutlineGeometry::outline(box(0, 56), OutlineGeometry::Gap{}, 1).empty());
  CHECK(OutlineGeometry::outline(box(300, 0), OutlineGeometry::Gap{}, 1).empty());
  // A box no bigger than its own stroke has no middle to run down.
  CHECK(OutlineGeometry::outline(box(300, 2, 0, 4), OutlineGeometry::Gap{}, 1).empty());
  // Non-finite input must not escape as NaN geometry.
  const auto nan = OutlineGeometry::outline(box(300, 56, std::nan(""), 1),
                                            OutlineGeometry::Gap{std::nan(""), 60, 4}, std::nan(""));
  for (const auto& s : nan) {
    CHECK(std::isfinite(s.point.x) && std::isfinite(s.point.y) && std::isfinite(s.radius));
  }
}

static void arcsTurnTheRightWay() {
  const auto path = OutlineGeometry::outline(box(), OutlineGeometry::Gap{}, 0);
  // Clockwise from the top-right: -90°, 0°, 90°, 180°, each sweeping 90°.
  double expected[] = {-90, 0, 90, 180};
  int i = 0;
  for (const auto& s : path) {
    if (s.verb != Verb::Arc) continue;
    CHECK_NEAR(s.startAngle, expected[i]);
    CHECK_NEAR(s.sweepAngle, 90);
    i++;
  }
  CHECK_NEAR(i, 4);
}

static void labelRectInterpolates() {
  const OutlineGeometry::Rect rest{16, 18, 120, 20};
  const OutlineGeometry::Rect floated{14, -6, 84, 14};
  const auto at0 = OutlineGeometry::lerp(rest, floated, 0);
  CHECK_NEAR(at0.x, 16);
  CHECK_NEAR(at0.y, 18);
  const auto at1 = OutlineGeometry::lerp(rest, floated, 1);
  CHECK_NEAR(at1.x, 14);
  CHECK_NEAR(at1.width, 84);
  const auto half = OutlineGeometry::lerp(rest, floated, 0.5);
  CHECK_NEAR(half.x, 15);
  CHECK_NEAR(half.y, 6);
  CHECK_NEAR(half.width, 102);
  CHECK_NEAR(half.height, 17);
  // Out of range and NaN clamp rather than overshoot.
  CHECK_NEAR(OutlineGeometry::lerp(rest, floated, 5).x, 14);
  CHECK_NEAR(OutlineGeometry::lerp(rest, floated, -5).x, 16);
  CHECK_NEAR(OutlineGeometry::lerp(rest, floated, std::nan("")).x, 16);
}

static void gapFollowsTheFloatedLabel() {
  const OutlineGeometry::Rect floated{14, -6, 84, 14};
  const auto gap = OutlineGeometry::gapFor(floated, 4);
  CHECK_NEAR(gap.left, 14);
  CHECK_NEAR(gap.width, 84);
  CHECK_NEAR(gap.padding, 4);
  // The hole in the path matches it.
  const auto path = OutlineGeometry::outline(box(), gap, 1);
  CHECK_NEAR(path.back().point.x, 10);
  CHECK_NEAR(path.front().point.x, 10 + 92);
}

static void bottomCornersCanBeSquaredOnTheirOwn() {
  // The filled variant squares off only its bottom, so the indicator rule
  // beneath it meets the fill edge to edge instead of overhanging the curve.
  OutlineGeometry::Box b{300, 56, 8, 0};
  b.bottomRadius = 0;
  const auto path = OutlineGeometry::outline(b, OutlineGeometry::Gap{}, 0);
  CHECK(singleSubpath(path));
  CHECK_NEAR(countOf(path, Verb::Arc), 2); // the two top corners only
  for (const auto& s : path) {
    if (s.verb == Verb::Arc) CHECK_NEAR(s.radius, 8);
  }
  // The bottom edge spans the whole width, which is what the rule lines up with.
  double minX = 1e9, maxX = -1e9;
  for (const auto& s : path) {
    if (s.verb == Verb::Line && std::fabs(s.point.y - 56) < 1e-9) {
      minX = std::min(minX, s.point.x);
      maxX = std::max(maxX, s.point.x);
    }
  }
  CHECK_NEAR(minX, 0);
  CHECK_NEAR(maxX, 300);

  // Left negative (the default) the bottom follows the top: four equal corners.
  const auto both = OutlineGeometry::outline(box(300, 56, 8, 1), OutlineGeometry::Gap{}, 0);
  CHECK_NEAR(countOf(both, Verb::Arc), 4);

  // Mixed radii still keep one shape across the whole animation, which is what
  // lets the two paths be tweened.
  const OutlineGeometry::Gap gap{24, 60, 4};
  OutlineGeometry::Box mixed{300, 56, 8, 1};
  mixed.bottomRadius = 0;
  const auto atRest = OutlineGeometry::outline(mixed, gap, 0);
  const auto open = OutlineGeometry::outline(mixed, gap, 1);
  CHECK(atRest.size() == open.size());
  for (size_t i = 0; i < atRest.size() && i < open.size(); ++i) {
    CHECK(atRest[i].verb == open[i].verb);
  }
  // The notch is still held off the *top* corner, which is the one it touches.
  CHECK(open.back().point.x >= 8.5 - 1e-9);
}

int main() {
  everyPathHasTheSameShape();
  closedWhenThereIsNoLabel();
  closedAtRest();
  openWhenTheLabelHasFloated();
  theGapGrowsWithProgress();
  theGapStaysOffTheCorners();
  aLabelTooWideClosesTheGap();
  radiusIsClampedAndSquareCornersWork();
  degenerateBoxesProduceNothing();
  arcsTurnTheRightWay();
  labelRectInterpolates();
  gapFollowsTheFloatedLabel();
  bottomCornersCanBeSquaredOnTheirOwn();
  if (failures == 0) {
    std::printf("OutlineGeometry: all checks passed\n");
    return 0;
  }
  std::printf("OutlineGeometry: %d check(s) failed\n", failures);
  return 1;
}
