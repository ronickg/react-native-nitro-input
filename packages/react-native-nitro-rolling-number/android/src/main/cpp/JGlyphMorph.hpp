//
//  JGlyphMorph.hpp
//  NitroRollingNumber
//
//  fbjni bridge for the morph transition's geometry: the Kotlin view hands
//  over flattened glyph outlines and gets normalized and interpolated ones
//  back, as double arrays (see GlyphMorph.hpp).
//

#pragma once

#include "GlyphMorph.hpp"
#include <fbjni/fbjni.h>

namespace margelo::nitro::nitrorollingnumber {

using namespace facebook;

struct JGlyphMorph final : jni::JavaClass<JGlyphMorph> {
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/nitrorollingnumber/GlyphMorph;";

  static void registerNatives();
  /// Normalizes `points` (`sizes` vertices per contour) into `out`; returns the contour count.
  static jint normalize(jni::alias_ref<jni::JClass>, jni::alias_ref<jni::JArrayDouble> points, jni::alias_ref<jni::JArrayInt> sizes, jni::alias_ref<jni::JArrayDouble> out);
  /// Rotates `b`'s paired contours to their best alignment with `a`'s, into `out`; returns `contoursB`.
  static jint align(jni::alias_ref<jni::JClass>, jni::alias_ref<jni::JArrayDouble> a, jint contoursA, jni::alias_ref<jni::JArrayDouble> b, jint contoursB, jni::alias_ref<jni::JArrayDouble> out);
  /// Interpolates two normalized outlines into `out`; returns the contour count.
  static jint interpolate(jni::alias_ref<jni::JClass>, jni::alias_ref<jni::JArrayDouble> a, jint contoursA, jni::alias_ref<jni::JArrayDouble> b, jint contoursB, jdouble t, jni::alias_ref<jni::JArrayDouble> out, jboolean aligned);
};

} // namespace margelo::nitro::nitrorollingnumber
