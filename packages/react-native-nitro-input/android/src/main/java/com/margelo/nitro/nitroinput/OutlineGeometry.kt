package com.margelo.nitro.nitroinput

import androidx.annotation.Keep
import com.facebook.jni.HybridData
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Kotlin handle to the shared C++ [OutlineGeometry] (see `cpp/OutlineGeometry.hpp`),
 * so the notched outline Android traces is the one iOS traces.
 *
 * Results are written into a caller-owned `DoubleArray` rather than returned as
 * objects: the view keeps one array and redraws allocate nothing.
 */
@Keep
@DoNotStrip
class OutlineGeometry {
  @DoNotStrip
  @Keep
  private val mHybridData: HybridData = initHybrid()

  private external fun initHybrid(): HybridData

  /**
   * Writes the outline into [out] as `verb, x, y, radius, startAngle, sweepAngle`
   * per segment, and returns the number of segments - or -1 when [out] is too
   * short, so the caller can grow it and retry.
   *
   * `verb` is [MOVE], [LINE] or [ARC]. Move and line carry their destination in
   * x/y; an arc carries its centre, plus the radius and the degrees to sweep
   * clockwise from `startAngle`, which is what `Path.arcTo` takes.
   *
   * A [bottomRadius] below zero means the bottom corners match [radius].
   * [gapWidth] at or below zero closes the notch, as does one too wide to fit
   * between the corners.
   */
  external fun outline(
    width: Double,
    height: Double,
    radius: Double,
    strokeWidth: Double,
    bottomRadius: Double,
    gapLeft: Double,
    gapWidth: Double,
    gapPadding: Double,
    progress: Double,
    out: DoubleArray,
  ): Int

  /** Interpolates the label's rect, written into [out] as x, y, width, height. */
  external fun lerp(
    fromX: Double,
    fromY: Double,
    fromWidth: Double,
    fromHeight: Double,
    toX: Double,
    toY: Double,
    toWidth: Double,
    toHeight: Double,
    progress: Double,
    out: DoubleArray,
  )

  companion object {
    const val MOVE = 0
    const val LINE = 1
    const val ARC = 2

    /** Doubles per segment in the array [outline] fills. */
    const val STRIDE = 6
  }
}
