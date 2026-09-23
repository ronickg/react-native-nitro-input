package com.margelo.nitro.nitrorollingnumber

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Kotlin handle to the shared C++ [GlyphMorph] (see `cpp/GlyphMorph.hpp`): the
 * morph transition's geometry. Outlines are double arrays of `CONTOUR_DOUBLES`
 * per normalized contour.
 */
@Keep
@DoNotStrip
object GlyphMorph {
  /** Points per normalized contour, and doubles per contour (x, y pairs). */
  const val SAMPLES = 192
  const val CONTOUR_DOUBLES = SAMPLES * 2

  /**
   * Normalizes flattened contours ([points] x y x y…, [sizes] vertices per
   * contour) into [out] (`sizes.size * CONTOUR_DOUBLES` doubles at most).
   * Returns the contour count, or -1 if [out] is too small.
   */
  @JvmStatic
  external fun normalize(points: DoubleArray, sizes: IntArray, out: DoubleArray): Int

  /**
   * [b] with every contour paired with one of [a]'s rotated to its best
   * alignment, written to [out] (`contoursB * CONTOUR_DOUBLES` doubles);
   * done once per pair of glyphs. Returns [contoursB], or -1 if [out] is too small.
   */
  @JvmStatic
  external fun align(a: DoubleArray, contoursA: Int, b: DoubleArray, contoursB: Int, out: DoubleArray): Int

  /**
   * The outline between two normalized ones at [t] 0…1, written to [out]
   * (`max(contoursA, contoursB) * CONTOUR_DOUBLES` doubles). With [aligned]
   * true, [b] came from [align] and no search is needed. Returns the contour
   * count, or -1 if [out] is too small.
   */
  @JvmStatic
  external fun interpolate(a: DoubleArray, contoursA: Int, b: DoubleArray, contoursB: Int, t: Double, out: DoubleArray, aligned: Boolean): Int
}
