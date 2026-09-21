//
//  JOutlineGeometry.cpp
//  NitroInput
//

#include "JOutlineGeometry.hpp"

#include <vector>

namespace margelo::nitro::nitroinput {

namespace {
/// verb, x, y, radius, startAngle, sweepAngle.
constexpr size_t kPerSegment = 6;
} // namespace

jni::local_ref<JOutlineGeometry::jhybriddata> JOutlineGeometry::initHybrid(jni::alias_ref<jhybridobject>) {
  return makeCxxInstance();
}

void JOutlineGeometry::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", JOutlineGeometry::initHybrid),
      makeNativeMethod("outline", JOutlineGeometry::outline),
      makeNativeMethod("lerp", JOutlineGeometry::lerp),
  });
}

int JOutlineGeometry::outline(double width, double height, double radius, double strokeWidth, double bottomRadius,
                              double gapLeft, double gapWidth, double gapPadding, double progress,
                              jni::alias_ref<jni::JArrayDouble> out) {
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

  scratch_ = OutlineGeometry::outline(box, gap, progress);
  const size_t count = scratch_.size();
  const size_t needed = count * kPerSegment;
  if (static_cast<size_t>(out->size()) < needed) {
    return -1;
  }

  std::vector<double> flat(needed);
  size_t i = 0;
  for (const auto& segment : scratch_) {
    flat[i++] = static_cast<double>(static_cast<int32_t>(segment.verb));
    flat[i++] = segment.point.x;
    flat[i++] = segment.point.y;
    flat[i++] = segment.radius;
    flat[i++] = segment.startAngle;
    flat[i++] = segment.sweepAngle;
  }
  if (needed > 0) out->setRegion(0, needed, flat.data());
  return static_cast<int>(count);
}

void JOutlineGeometry::lerp(double fromX, double fromY, double fromWidth, double fromHeight, double toX, double toY,
                            double toWidth, double toHeight, double progress, jni::alias_ref<jni::JArrayDouble> out) {
  if (out->size() < 4) return;
  const OutlineGeometry::Rect result = OutlineGeometry::lerp(
      OutlineGeometry::Rect{fromX, fromY, fromWidth, fromHeight},
      OutlineGeometry::Rect{toX, toY, toWidth, toHeight}, progress);
  const double flat[4] = {result.x, result.y, result.width, result.height};
  out->setRegion(0, 4, flat);
}

} // namespace margelo::nitro::nitroinput
