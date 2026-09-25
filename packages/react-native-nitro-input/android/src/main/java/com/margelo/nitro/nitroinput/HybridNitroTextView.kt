package com.margelo.nitro.nitroinput

import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.views.RecyclableView

/**
 * Nitro glue between NitroText's props and [NitroTextView]: the props land
 * one by one and are applied together once Nitro says the update is done.
 *
 * Mirrors `HybridNitroTextView.swift` on iOS.
 */
@Keep
@DoNotStrip
class HybridNitroTextView(private val context: ThemedReactContext) : HybridNitroTextViewSpec(), RecyclableView {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val textView = NitroTextView(context)

  override val view: View
    get() = textView

  override var text: String = ""
  // Unset unless the element set it: the wrapper sends only those.
  override var fontSize: Double? = null
  override var fontWeight: Double? = null
  override var fontFamily: String? = null
  override var color: Double? = null
  override var letterSpacing: Double? = null
  override var textAlign: NitroNumberTextAlign? = null
  override var rightToLeft: Boolean? = null
  override var duration: Double? = null
  override var easing: NitroInputEasing? = null
  override var bounce: Double? = null
  override var effect: NitroInputEffect? = null
  override var respectReduceMotion: Boolean? = null
  override var loading: Boolean? = null
  override var shimmerColor: Double? = null
  override var shimmerDuration: Double? = null
  override var shimmerAngle: Double? = null
  override var shimmerWidth: Double? = null
  override var shimmerBaseColor: Double? = null
  override var shimmerDirection: NitroNumberShimmerDirection? = null
  override var shimmerDelay: Double? = null

  /**
   * Every prop of an update is set before this runs: apply them in one go
   * (the style first, so the text is laid out in its font).
   */
  override fun afterUpdate() {
    onMain { apply() }
  }

  private fun apply() {
    textView.style = NitroTextView.Style(
      fontSize = fontSize?.takeIf { it.isFinite() && it > 0 } ?: 17.0,
      fontWeight = fontWeight?.takeIf { it.isFinite() } ?: 400.0,
      fontFamily = fontFamily ?: "",
      color = color?.let(::colorFromARGB),
      letterSpacing = (letterSpacing?.takeIf { it.isFinite() } ?: 0.0).toFloat(),
      textAlign = when (textAlign) {
        NitroNumberTextAlign.LEFT -> NitroNumberView.Alignment.LEFT
        NitroNumberTextAlign.CENTER -> NitroNumberView.Alignment.CENTER
        NitroNumberTextAlign.RIGHT -> NitroNumberView.Alignment.RIGHT
        else -> NitroNumberView.Alignment.AUTO
      },
    )

    textView.timing = NitroTextView.Timing(
      durationSeconds = Math.max(0.0, (duration?.takeIf { it.isFinite() } ?: 400.0) / 1000.0),
      easing = when (easing) {
        NitroInputEasing.EASEOUT -> 1
        NitroInputEasing.EASEINOUT -> 2
        NitroInputEasing.LINEAR -> 3
        NitroInputEasing.SPRING -> 4
        else -> 0
      },
      bounce = bounce?.takeIf { it.isFinite() } ?: 0.15,
      effect = when (effect) {
        NitroInputEffect.SLIDE -> 1
        NitroInputEffect.FADE -> 2
        else -> 0
      },
      respectReduceMotion = respectReduceMotion ?: true,
    )

    textView.shimmer = NitroNumberView.Shimmer(
      color = shimmerColor?.let(::colorFromARGB),
      durationMs = Math.max(200.0, shimmerDuration?.takeIf { it.isFinite() } ?: 950.0).toLong(),
      angle = (shimmerAngle?.takeIf { it.isFinite() } ?: 31.0).toFloat(),
      width = (shimmerWidth?.takeIf { it.isFinite() && it > 0 } ?: 1.0).toFloat(),
      baseColor = shimmerBaseColor?.let(::colorFromARGB),
      leftToRight = when (shimmerDirection) {
        NitroNumberShimmerDirection.LTR -> true
        NitroNumberShimmerDirection.RTL -> false
        else -> null
      },
      delayMs = Math.max(0.0, shimmerDelay?.takeIf { it.isFinite() } ?: 0.0).toLong(),
    )

    textView.rightToLeft = rightToLeft ?: false
    textView.text = text
    textView.loading = loading ?: false
  }

  /** Fabric dropped the view: stop its frame loop (a recycled one is reset next). */
  override fun onDropView() {
    onMain { textView.stopFrames() }
  }

  /** Fabric is about to reuse this view for another element. */
  override fun prepareForRecycle() {
    // The next element's props arrive as a first mount's do, only the ones it set.
    text = ""
    fontSize = null; fontWeight = null; fontFamily = null; color = null; letterSpacing = null
    textAlign = null; rightToLeft = null
    duration = null; easing = null; bounce = null; effect = null; respectReduceMotion = null
    loading = null
    shimmerColor = null; shimmerDuration = null; shimmerAngle = null; shimmerWidth = null
    shimmerBaseColor = null; shimmerDirection = null; shimmerDelay = null
    onMain { textView.resetForRecycle() }
  }

  override val memorySize: Long
    get() = 8L * 1024

  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
  }

  private fun colorFromARGB(value: Double): Int? {
    if (!value.isFinite()) return null
    val bits = value.toLong().toInt()
    return Color.argb((bits ushr 24) and 0xff, (bits ushr 16) and 0xff, (bits ushr 8) and 0xff, bits and 0xff)
  }
}
