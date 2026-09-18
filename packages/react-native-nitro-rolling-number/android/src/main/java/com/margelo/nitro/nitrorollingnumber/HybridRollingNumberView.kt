package com.margelo.nitro.nitrorollingnumber

import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.uimanager.ThemedReactContext

/**
 * Nitro glue between React props / hybrid methods and [RollingNumberView].
 */
@Keep
@DoNotStrip
class HybridRollingNumberView(context: ThemedReactContext) : HybridRollingNumberViewSpec() {
  private val rollingView = RollingNumberView(context)
  private val mainHandler = Handler(Looper.getMainLooper())

  override val view: View
    get() = rollingView

  private var isBatching = false
  private var pendingValue: Double? = null
  private var configDirty = true

  init {
    rollingView.onIntrinsicSizeChange = { width, height ->
      onSizeChange?.invoke(width.toDouble(), height.toDouble())
    }
  }

  // region Props

  override var value: Double
    get() = rollingView.targetValue
    set(v) {
      pendingValue = v
      commitIfNeeded()
    }
  override var fractionDigits: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var minimumIntegerDigits: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var groupingSeparator: String? = null
    set(v) { field = v; markConfigDirty() }
  override var decimalSeparator: String? = null
    set(v) { field = v; markConfigDirty() }
  override var prefix: String? = null
    set(v) { field = v; markConfigDirty() }
  override var suffix: String? = null
    set(v) { field = v; markConfigDirty() }
  override var duration: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var easing: RollingNumberEasing? = null
    set(v) { field = v; markConfigDirty() }
  override var bounce: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var stagger: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var direction: RollingNumberDirection? = null
    set(v) { field = v; markConfigDirty() }
  override var loading: Boolean? = null
    set(v) { field = v; markConfigDirty() }
  override var shimmerColor: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var shimmerDuration: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var fontSize: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var prefixFontSize: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var suffixFontSize: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var affixAlign: RollingNumberAffixAlign? = null
    set(v) { field = v; markConfigDirty() }
  override var prefixAlign: RollingNumberAffixAlign? = null
    set(v) { field = v; markConfigDirty() }
  override var suffixAlign: RollingNumberAffixAlign? = null
    set(v) { field = v; markConfigDirty() }
  override var adjustsFontSizeToFit: Boolean? = null
    set(v) { field = v; markConfigDirty() }
  override var minimumFontScale: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var fontWeight: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var fontFamily: String? = null
    set(v) { field = v; markConfigDirty() }
  override var color: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var textAlign: RollingNumberTextAlign? = null
    set(v) { field = v; markConfigDirty() }
  override var onSizeChange: ((width: Double, height: Double) -> Unit)? = null
    set(v) {
      field = v
      onMain { rollingView.resendIntrinsicSize() }
    }

  // endregion

  // region Methods

  override fun jumpTo(value: Double) {
    onMain {
      pendingValue = null
      flushConfigIfNeeded()
      rollingView.setValue(value)
    }
  }

  override fun animateTo(value: Double) {
    onMain {
      pendingValue = null
      flushConfigIfNeeded()
      rollingView.animateTo(value)
    }
  }

  // endregion

  // region Lifecycle

  override fun beforeUpdate() {
    isBatching = true
  }

  override fun afterUpdate() {
    isBatching = false
    commit()
  }

  override fun onDropView() {
    onMain { rollingView.stopAnimation() }
  }

  // endregion

  // region Batching

  private fun markConfigDirty() {
    configDirty = true
    commitIfNeeded()
  }

  private fun commitIfNeeded() {
    if (!isBatching) commit()
  }

  private fun commit() {
    onMain {
      flushConfigIfNeeded()
      val value = pendingValue
      if (value != null) {
        pendingValue = null
        rollingView.animateTo(value)
      }
    }
  }

  private fun flushConfigIfNeeded() {
    if (!configDirty) return
    configDirty = false

    rollingView.typography = RollingNumberView.Typography(
      fontSize = (fontSize ?: 32.0).toFloat(),
      prefixFontSize = prefixFontSize?.toFloat(),
      suffixFontSize = suffixFontSize?.toFloat(),
      fontWeight = clampInt(fontWeight, 100, 900, 400),
      fontFamily = fontFamily,
      color = color?.let { colorFromARGB(it) },
      prefixAlign = mapAffixAlign(prefixAlign ?: affixAlign),
      suffixAlign = mapAffixAlign(suffixAlign ?: affixAlign),
      adjustsFontSizeToFit = adjustsFontSizeToFit ?: false,
      minimumFontScale = (minimumFontScale ?: 0.5).coerceIn(0.05, 1.0).toFloat(),
    )
    rollingView.format = RollingNumberView.Format(
      fractionDigits = clampInt(fractionDigits, 0, 9, 0),
      minimumIntegerDigits = clampInt(minimumIntegerDigits, 1, 15, 1),
      groupingSeparator = groupingSeparator ?: "",
      decimalSeparator = decimalSeparator ?: ".",
      prefix = prefix ?: "",
      suffix = suffix ?: "",
    )
    rollingView.timing = RollingNumberView.Timing(
      durationMs = Math.max(0.0, duration ?: 500.0).toLong(),
      easing = when (easing) {
        RollingNumberEasing.LINEAR -> RollingNumberView.Easing.LINEAR
        RollingNumberEasing.EASEIN -> RollingNumberView.Easing.EASE_IN
        RollingNumberEasing.EASEOUT -> RollingNumberView.Easing.EASE_OUT
        RollingNumberEasing.SPRING -> RollingNumberView.Easing.SPRING
        RollingNumberEasing.EASEINOUT, null -> RollingNumberView.Easing.EASE_IN_OUT
      },
      bounce = bounce ?: 0.15,
      staggerMs = Math.max(0.0, stagger ?: 0.0).toLong(),
      direction = when (direction) {
        RollingNumberDirection.UP -> RollingNumberView.Direction.UP
        RollingNumberDirection.DOWN -> RollingNumberView.Direction.DOWN
        RollingNumberDirection.AUTO, null -> RollingNumberView.Direction.AUTO
      },
    )
    rollingView.shimmer = RollingNumberView.Shimmer(
      color = shimmerColor?.let { colorFromARGB(it) },
      durationMs = Math.max(200.0, shimmerDuration ?: 950.0).toLong(),
    )
    rollingView.alignment = when (textAlign) {
      RollingNumberTextAlign.CENTER -> RollingNumberView.Alignment.CENTER
      RollingNumberTextAlign.RIGHT -> RollingNumberView.Alignment.RIGHT
      RollingNumberTextAlign.LEFT, null -> RollingNumberView.Alignment.LEFT
    }
    rollingView.loading = loading ?: false
  }

  // endregion

  private fun mapAffixAlign(align: RollingNumberAffixAlign?): RollingNumberView.AffixAlign = when (align) {
    RollingNumberAffixAlign.CENTER -> RollingNumberView.AffixAlign.CENTER
    RollingNumberAffixAlign.TOP -> RollingNumberView.AffixAlign.TOP
    RollingNumberAffixAlign.BOTTOM -> RollingNumberView.AffixAlign.BOTTOM
    RollingNumberAffixAlign.BASELINE, null -> RollingNumberView.AffixAlign.BASELINE
  }

  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
  }

  private fun clampInt(value: Double?, lower: Int, upper: Int, fallback: Int): Int {
    if (value == null || !value.isFinite()) return fallback
    return Math.rint(value).toInt().coerceIn(lower, upper)
  }

  private fun colorFromARGB(value: Double): Int? {
    if (!value.isFinite()) return null
    val bits = value.toLong().toInt()
    return Color.argb((bits ushr 24) and 0xff, (bits ushr 16) and 0xff, (bits ushr 8) and 0xff, bits and 0xff)
  }
}
