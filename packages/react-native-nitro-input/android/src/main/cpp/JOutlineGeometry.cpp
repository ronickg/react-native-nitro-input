//
//  JOutlineGeometry.cpp
//  NitroInput
//

#include "JOutlineGeometry.hpp"

namespace margelo::nitro::nitroinput {

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

  // Traced straight into the flat form, into a vector this object keeps: once
  // it has grown to fit, a redraw allocates nothing on either side of the JNI.
  const size_t count = OutlineGeometry::outline(box, gap, progress, flat_);
  const size_t needed = count * OutlineGeometry::kFlatStride;
  if (static_cast<size_t>(out->size()) < needed) {
    return -1;
  }
  if (needed > 0) out->setRegion(0, needed, flat_.data());
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
