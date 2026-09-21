package com.margelo.nitro.nitrorollingnumber

import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.views.RecyclableView

/**
 * Nitro glue between React props / hybrid methods and [RollingNumberView].
 */
@Keep
@DoNotStrip
class HybridRollingNumberView(context: ThemedReactContext) : HybridRollingNumberViewSpec(), RecyclableView {
  private val rollingView = RollingNumberView(context)
  private val mainHandler = Handler(Looper.getMainLooper())

  override val view: View
    get() = rollingView

  private var isBatching = false
  private var pendingValue: Double? = null
  private var configDirty = true
  /**
   * The `reveal` prop as last applied: null = normal rolling, false = held at
   * the opening frame, true = the count has been fired.
   */
  private var appliedReveal: Boolean? = null

  init {
    rollingView.onIntrinsicSizeChange = { width, height ->
      onSizeChange?.invoke(width.toDouble(), height.toDouble())
    }
    rollingView.onRevealEnd = { onRevealEnd?.invoke() }
    rollingView.onRevealMilestone = { index, milestone -> onRevealMilestone?.invoke(index.toDouble(), milestone) }
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
  override var rollDirection: RollingNumberDirection? = null
    set(v) { field = v; markConfigDirty() }
  override var revealState: Double? = null
    set(v) { field = v; commitIfNeeded() }
  /** The tri-state `reveal` prop: null = normal rolling, false = hold, true = play. */
  private val reveal: Boolean?
    get() {
      val state = revealState ?: return null
      if (!state.isFinite()) return null
      return when {
        state >= 2 -> true
        state >= 1 -> false
        else -> null
      }
    }
  override var revealStyle: RollingNumberRevealStyle? = null
    set(v) { field = v; markConfigDirty() }
  override var revealDuration: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var revealBounce: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var revealGrow: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var revealStagger: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var revealMilestones: DoubleArray? = null
    set(v) { field = v; markConfigDirty() }
  override var revealMilestoneHold: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var onRevealEnd: (() -> Unit)? = null
  override var onRevealMilestone: ((index: Double, value: Double) -> Unit)? = null
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
  override var allowFontScaling: Boolean? = null
    set(v) { field = v; markConfigDirty() }
  override var maxFontSizeMultiplier: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var fontWeight: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var fontFamily: String? = null
    set(v) { field = v; markConfigDirty() }
  override var color: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var textAlign: RollingNumberTextAlign? = null
    set(v) { field = v; markConfigDirty() }
  override var rightToLeft: Boolean? = null
    set(v) { field = v; markConfigDirty() }
  override var onSizeChange: ((width: Double, height: Double) -> Unit)? = null
    set(v) {
      field = v
      onMain { rollingView.resendIntrinsicSize() }
    }

  // endregion

  // region Methods

  override fun jumpTo(value: Double) = enqueue(Command.Jump(value))

  override fun animateTo(value: Double) = enqueue(Command.Animate(value))

  override fun revealTo(value: Double) = enqueue(Command.Reveal(value))

  private sealed class Command {
    class Jump(val value: Double) : Command()
    class Animate(val value: Double) : Command()
    class Reveal(val value: Double) : Command()
  }

  private val commandLock = Any()
  private var pendingCommand: Command? = null
  private var commandScheduled = false

  /**
   * Coalesces calls from the JS thread: only the latest value is applied per
   * main-thread turn, so a caller pushing a value every frame (scrubbing, live
   * meters, many views at once) can never pile up a backlog of posts that
   * stalls the main thread. A frame only ever shows the newest value anyway.
   */
  private fun enqueue(command: Command) {
    val schedule: Boolean
    synchronized(commandLock) {
      pendingCommand = command
      schedule = !commandScheduled
      commandScheduled = true
    }
    if (schedule) onMain { drainCommand() }
  }

  private fun drainCommand() {
    val command: Command?
    synchronized(commandLock) {
      command = pendingCommand
      pendingCommand = null
      commandScheduled = false
    }
    command ?: return
    pendingValue = null
    flushConfigIfNeeded()
    when (command) {
      is Command.Jump -> rollingView.setValue(command.value)
      is Command.Animate -> rollingView.animateTo(command.value)
      is Command.Reveal -> {
        rollingView.reveal(command.value)
        // The prop machine treats the count as fired, so a later `reveal={true}` doesn't replay it.
        if (reveal != null) appliedReveal = true
      }
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

  /**
   * Fabric is about to reuse this view for another element: forget every prop
   * and all animation state. Nitro re-applies the new element's props next.
   */
  override fun prepareForRecycle() {
    // Batch the resets so the setters don't flush config thirty times.
    isBatching = true
    pendingValue = null
    fractionDigits = null
    minimumIntegerDigits = null
    groupingSeparator = null
    decimalSeparator = null
    prefix = null
    suffix = null
    duration = null
    easing = null
    bounce = null
    stagger = null
    rollDirection = null
    revealState = null
    revealStyle = null
    revealDuration = null
    revealBounce = null
    revealGrow = null
    revealStagger = null
    revealMilestones = null
    revealMilestoneHold = null
    onRevealEnd = null
    onRevealMilestone = null
    appliedReveal = null
    loading = null
    shimmerColor = null
    shimmerDuration = null
    fontSize = null
    prefixFontSize = null
    suffixFontSize = null
    affixAlign = null
    prefixAlign = null
    suffixAlign = null
    adjustsFontSizeToFit = null
    minimumFontScale = null
    allowFontScaling = null
    maxFontSizeMultiplier = null
    fontWeight = null
    fontFamily = null
    color = null
    textAlign = null
    rightToLeft = null
    onSizeChange = null
    configDirty = true
    isBatching = false
    onMain { rollingView.resetForRecycle() }
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
      val changed = pendingValue
      pendingValue = null
      val value = changed ?: rollingView.targetValue
      val reveal = this.reveal
      if (reveal == null) {
        // Normal rolling number (also when leaving reveal mode).
        appliedReveal = null
        if (changed != null) rollingView.animateTo(changed)
        return@onMain
      }
      if (!reveal) {
        // Hold the opening frame; re-hold when the figure or the mode changed.
        if (changed != null || appliedReveal != false) rollingView.holdReveal(value)
      } else if (appliedReveal != true) {
        // `reveal` just turned true (or the view mounted with it true): fire the count.
        rollingView.reveal(value)
      } else if (changed != null) {
        // A new figure after the count was fired: re-target a running count, roll a landed one.
        if (rollingView.isRevealing) rollingView.reveal(changed) else rollingView.animateTo(changed)
      }
      appliedReveal = reveal
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
      allowFontScaling = allowFontScaling ?: false,
      maxFontSizeMultiplier = Math.max(0.0, maxFontSizeMultiplier ?: 0.0).toFloat(),
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
      direction = when (rollDirection) {
        RollingNumberDirection.UP -> RollingNumberView.Direction.UP
        RollingNumberDirection.DOWN -> RollingNumberView.Direction.DOWN
        RollingNumberDirection.AUTO, null -> RollingNumberView.Direction.AUTO
      },
      revealDurationMs = Math.max(0.0, revealDuration ?: 2200.0).toLong(),
      revealBounce = (revealBounce ?: 0.12).coerceIn(0.0, 1.0),
      revealGrow = (revealGrow ?: 0.2).coerceIn(0.0, 1.0),
      revealStyle = when (revealStyle) {
        RollingNumberRevealStyle.SPIN -> RollingNumberView.RevealStyle.SPIN
        RollingNumberRevealStyle.COUNT, null -> RollingNumberView.RevealStyle.COUNT
      },
      revealStaggerMs = Math.max(0.0, revealStagger ?: 200.0).toLong(),
      revealMilestoneHoldMs = Math.max(0.0, revealMilestoneHold ?: 0.0).toLong(),
    )
    rollingView.revealMilestones = revealMilestones ?: DoubleArray(0)
    rollingView.shimmer = RollingNumberView.Shimmer(
      color = shimmerColor?.let { colorFromARGB(it) },
      durationMs = Math.max(200.0, shimmerDuration ?: 950.0).toLong(),
    )
    rollingView.alignment = when (textAlign) {
      RollingNumberTextAlign.CENTER -> RollingNumberView.Alignment.CENTER
      RollingNumberTextAlign.RIGHT -> RollingNumberView.Alignment.RIGHT
      RollingNumberTextAlign.LEFT -> RollingNumberView.Alignment.LEFT
      RollingNumberTextAlign.AUTO, null -> RollingNumberView.Alignment.AUTO
    }
    // Fabric does not hand a Hybrid View its layout direction, so JS resolves
    // it and the view is told outright; the alignment and the affixes read it back.
    val direction = if (rightToLeft == true) android.view.View.LAYOUT_DIRECTION_RTL else android.view.View.LAYOUT_DIRECTION_LTR
    if (rollingView.layoutDirection != direction) rollingView.layoutDirection = direction
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
