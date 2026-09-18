package com.margelo.nitro.nitrorollingnumber

import androidx.annotation.Keep
import com.facebook.jni.HybridData
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Kotlin handle to the shared C++ [RollingEngine] (see `cpp/RollingEngine.hpp`).
 * Times are in seconds. See the C++ header for the semantics of each call.
 */
@Keep
@DoNotStrip
class RollingEngine {
  @DoNotStrip
  @Keep
  private val mHybridData: HybridData = initHybrid()

  private external fun initHybrid(): HybridData

  external fun setFormat(fractionDigits: Int, minimumIntegerDigits: Int)
  external fun setTiming(durationSeconds: Double, easing: Int, bounce: Double, staggerSeconds: Double, direction: Int)
  external fun setReduceMotion(reduceMotion: Boolean)
  external fun setValue(value: Double)
  external fun animateTo(value: Double, now: Double)
  external fun setLoading(loading: Boolean, now: Double)
  external fun tick(now: Double): Boolean
  external fun needsFrames(): Boolean
  external fun isRolling(): Boolean
  external fun reset()
  external fun setRevealTiming(durationSeconds: Double, bounce: Double, style: Int, staggerSeconds: Double)
  external fun holdReveal(value: Double)
  external fun reveal(value: Double, now: Double)
  external fun isRevealing(): Boolean
  external fun clearRevealMilestones()
  external fun addRevealMilestone(value: Double)
  external fun setRevealMilestoneHold(holdSeconds: Double)
  external fun revealMilestonesReached(): Int
  external fun revealMilestoneValue(index: Int): Double
  /** `[signFactor, loadingProgress, revealScale, wheelCount, (position, width, linear, blankZero)…]` */
  external fun frame(): DoubleArray
  /** Allocation-free [frame]: fills [out] and returns the number of doubles written, or -1 if it is too small. */
  external fun frameInto(out: DoubleArray): Int
  external fun shimmerPhase(now: Double, periodSeconds: Double): Double
  external fun targetValue(): Double
  external fun hasShownValue(): Boolean
  external fun settledPowerCount(): Int
  external fun settledNegative(): Boolean
  external fun targetDigit(power: Int): Int
}
