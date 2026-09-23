#include "JGlyphMorph.hpp"

#include <vector>

namespace margelo::nitro::nitrorollingnumber {

void JGlyphMorph::registerNatives() {
  javaClassStatic()->registerNatives({
      makeNativeMethod("normalize", JGlyphMorph::normalize),
      makeNativeMethod("align", JGlyphMorph::align),
      makeNativeMethod("interpolate", JGlyphMorph::interpolate),
  });
}

jint JGlyphMorph::normalize(jni::alias_ref<jni::JClass>, jni::alias_ref<jni::JArrayDouble> points, jni::alias_ref<jni::JArrayInt> sizes, jni::alias_ref<jni::JArrayDouble> out) {
  const auto p = points->getRegion(0, points->size());
  const auto z = sizes->getRegion(0, sizes->size());
  const int contourCount = static_cast<int>(sizes->size());
  std::vector<double> buffer(static_cast<size_t>(contourCount) * GlyphMorph::kContourDoubles);
  const int count = GlyphMorph::normalize(p.get(), z.get(), contourCount, buffer.data());
  const size_t needed = static_cast<size_t>(count) * GlyphMorph::kContourDoubles;
  if (static_cast<size_t>(out->size()) < needed) {
    return -1;
  }
  out->setRegion(0, needed, buffer.data());
  return count;
}

jint JGlyphMorph::align(jni::alias_ref<jni::JClass>, jni::alias_ref<jni::JArrayDouble> a, jint contoursA, jni::alias_ref<jni::JArrayDouble> b, jint contoursB, jni::alias_ref<jni::JArrayDouble> out) {
  const auto pa = a->getRegion(0, a->size());
  const auto pb = b->getRegion(0, b->size());
  const size_t needed = static_cast<size_t>(contoursB) * GlyphMorph::kContourDoubles;
  if (static_cast<size_t>(out->size()) < needed || static_cast<size_t>(b->size()) < needed) {
    return -1;
  }
  std::vector<double> buffer(needed);
  const int count = GlyphMorph::align(pa.get(), contoursA, pb.get(), contoursB, buffer.data());
  out->setRegion(0, needed, buffer.data());
  return count;
}

jint JGlyphMorph::interpolate(jni::alias_ref<jni::JClass>, jni::alias_ref<jni::JArrayDouble> a, jint contoursA, jni::alias_ref<jni::JArrayDouble> b, jint contoursB, jdouble t, jni::alias_ref<jni::JArrayDouble> out, jboolean aligned) {
  const auto pa = a->getRegion(0, a->size());
  const auto pb = b->getRegion(0, b->size());
  const int needed = GlyphMorph::outputDoubles(contoursA, contoursB);
  if (out->size() < static_cast<size_t>(needed)) {
    return -1;
  }
  std::vector<double> buffer(static_cast<size_t>(needed));
  const int count = GlyphMorph::interpolate(pa.get(), contoursA, pb.get(), contoursB, t, buffer.data(), aligned != JNI_FALSE);
  out->setRegion(0, static_cast<size_t>(needed), buffer.data());
  return count;
}

} // namespace margelo::nitro::nitrorollingnumber
