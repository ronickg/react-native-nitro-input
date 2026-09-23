package com.margelo.nitro.nitroinput

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
  external fun setTransition(transition: Int)
  external fun setFlash(seconds: Double)
  external fun setPopOnChange(overshoot: Double)
  external fun setReduceMotion(reduceMotion: Boolean)
  /** A text slot (0 prefix, 1 suffix, 2 grouping, 3 decimal) changed; see `RollingEngine::changeText`. */
  external fun changeText(slot: Int, now: Double)
  /** `setFormat`, the change played; see `RollingEngine::changeFormat`. */
  external fun changeFormat(fractionDigits: Int, minimumIntegerDigits: Int, now: Double)
  external fun setValue(value: Double)
  external fun animateTo(value: Double, now: Double)
  external fun setLoading(loading: Boolean, now: Double)
  external fun tick(now: Double): Boolean
  external fun needsFrames(): Boolean
  external fun isRolling(): Boolean
  external fun reset()
  external fun setRevealTiming(durationSeconds: Double, bounce: Double, style: Int, staggerSeconds: Double)
  external fun setRevealGrow(grow: Double)
  external fun holdReveal(value: Double)
  external fun reveal(value: Double, now: Double)
  external fun isRevealing(): Boolean
  external fun clearRevealMilestones()
  external fun addRevealMilestone(value: Double)
  external fun setRevealMilestoneHold(holdSeconds: Double)
  external fun revealMilestonesReached(): Int
  external fun revealMilestoneValue(index: Int): Double
  /**
   * Fills [out] with the render state without allocating:
   * `[signFactor, loadingProgress, revealScale, wheelCount, (position, width, linear, blankZero, fromGlyph, toGlyph, blend, fromAbove, flash, flashUp)…]`.
   * Returns the number of doubles written, or -1 if [out] is too small.
   */
  external fun frameInto(out: DoubleArray): Int
  external fun shimmerPhase(now: Double, periodSeconds: Double): Double
  external fun targetValue(): Double
  external fun hasShownValue(): Boolean
  external fun settledPowerCount(): Int
  external fun settledNegative(): Boolean
  external fun targetDigit(power: Int): Int
}
