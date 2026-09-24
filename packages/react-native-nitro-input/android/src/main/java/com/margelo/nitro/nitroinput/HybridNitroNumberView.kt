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
 * Nitro glue between React props / hybrid methods and [NitroNumberView].
 */
@Keep
@DoNotStrip
class HybridNitroNumberView(private val context: ThemedReactContext) : HybridNitroNumberViewSpec(), RecyclableView {
  private val mainHandler = Handler(Looper.getMainLooper())

  /**
   * The platform view, or null once Fabric has dropped it. This hybrid is
   * kept alive by Nitro's C++ part for as long as the JS handle to it (the
   * `hybridRef`) exists, and Hermes collects that handle only when the JS
   * heap fills up; so a dropped hybrid lets go of the view rather than keep a
   * `View`, its display list and engine around meanwhile. A method called on
   * a stale ref gets a fresh, detached view.
   */
  private var attachedView: NitroNumberView? = null
  private val rollingView: NitroNumberView
    get() = attachedView ?: NitroNumberView(context).also {
      wire(it)
      attachedView = it
    }
  /** Set by [prepareForRecycle]: Fabric is keeping the dropped view for reuse. */
  private var recycled = false

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

  private fun wire(rollingView: NitroNumberView) {
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
  override var transition: NitroNumberTransition? = null
    set(v) { field = v; markConfigDirty() }
  override var flashUpColor: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var flashDownColor: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var flashDuration: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var popOnChange: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var duration: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var easing: NitroNumberEasing? = null
    set(v) { field = v; markConfigDirty() }
  override var bounce: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var stagger: Double? = null
    set(v) { field = v; markConfigDirty() }
  override var rollDirection: NitroNumberDirection? = null
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
  override var revealStyle: NitroNumberRevealStyle? = null
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
  override var affixAlign: NitroNumberAffixAlign? = null
    set(v) { field = v; markConfigDirty() }
  override var prefixAlign: NitroNumberAffixAlign? = null
    set(v) { field = v; markConfigDirty() }
  override var suffixAlign: NitroNumberAffixAlign? = null
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
  override var textAlign: NitroNumberTextAlign? = null
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

  /**
   * Fabric dropped the view. The Kotlin object lives on until the JS handle
   * to it (`hybridRef`) is garbage-collected, so the view lets go of what is
   * sizeable now and keeps only itself.
   */
  override fun onDropView() {
    recycled = false
    onMain {
      attachedView?.release()
      // With view recycling on, Fabric asks for prepareForRecycle right after
      // this hook, synchronously; by the next main-thread turn we know whether
      // the view is wanted again or can go.
      mainHandler.post { if (!recycled) attachedView = null }
    }
  }

  /** JS called `dispose()` on the ref: same as a drop. */
  override fun dispose() {
    onMain { attachedView?.release() }
  }

  /**
   * Reported to the JS garbage collector so a dropped view's handle counts as
   * the memory it holds rather than as an empty object; that is what makes
   * Hermes collect the handles, and with them the views, in time.
   */
  override val memorySize: Long
    get() = attachedView?.memoryEstimateBytes() ?: 0L

  /**
   * Fabric is about to reuse this view for another element: forget every prop
   * and all animation state. Nitro re-applies the new element's props next.
   */
  override fun prepareForRecycle() {
    recycled = true
    // Batch the resets so the setters don't flush config thirty times.
    isBatching = true
    pendingValue = null
    fractionDigits = null
    minimumIntegerDigits = null
    groupingSeparator = null
    decimalSeparator = null
    prefix = null
    suffix = null
    transition = null
    flashUpColor = null
    flashDownColor = null
    flashDuration = null
    popOnChange = null
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
        // A normal NitroNumber (also when leaving reveal mode).
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

    rollingView.typography = NitroNumberView.Typography(
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
    rollingView.format = NitroNumberView.Format(
      fractionDigits = clampInt(fractionDigits, 0, 9, 0),
      minimumIntegerDigits = clampInt(minimumIntegerDigits, 1, 15, 1),
      groupingSeparator = groupingSeparator ?: "",
      decimalSeparator = decimalSeparator ?: ".",
      prefix = prefix ?: "",
      suffix = suffix ?: "",
    )
    rollingView.timing = NitroNumberView.Timing(
      transition = when (transition) {
        NitroNumberTransition.NUMERIC -> NitroNumberView.Transition.NUMERIC
        NitroNumberTransition.SCRAMBLE -> NitroNumberView.Transition.SCRAMBLE
        NitroNumberTransition.ROLL, null -> NitroNumberView.Transition.ROLL
      },
      popOnChange = (popOnChange ?: 0.0).coerceIn(0.0, 1.0),
      durationMs = Math.max(0.0, duration ?: 500.0).toLong(),
      easing = when (easing) {
        NitroNumberEasing.LINEAR -> NitroNumberView.Easing.LINEAR
        NitroNumberEasing.EASEIN -> NitroNumberView.Easing.EASE_IN
        NitroNumberEasing.EASEOUT -> NitroNumberView.Easing.EASE_OUT
        NitroNumberEasing.SPRING -> NitroNumberView.Easing.SPRING
        NitroNumberEasing.EASEINOUT, null -> NitroNumberView.Easing.EASE_IN_OUT
      },
      bounce = bounce ?: 0.15,
      staggerMs = Math.max(0.0, stagger ?: 0.0).toLong(),
      direction = when (rollDirection) {
        NitroNumberDirection.UP -> NitroNumberView.Direction.UP
        NitroNumberDirection.DOWN -> NitroNumberView.Direction.DOWN
        NitroNumberDirection.AUTO, null -> NitroNumberView.Direction.AUTO
      },
      revealDurationMs = Math.max(0.0, revealDuration ?: 2200.0).toLong(),
      revealBounce = (revealBounce ?: 0.12).coerceIn(0.0, 1.0),
      revealGrow = (revealGrow ?: 0.2).coerceIn(0.0, 1.0),
      revealStyle = when (revealStyle) {
        NitroNumberRevealStyle.SPIN -> NitroNumberView.RevealStyle.SPIN
        NitroNumberRevealStyle.COUNT, null -> NitroNumberView.RevealStyle.COUNT
      },
      revealStaggerMs = Math.max(0.0, revealStagger ?: 200.0).toLong(),
      revealMilestoneHoldMs = Math.max(0.0, revealMilestoneHold ?: 0.0).toLong(),
    )
    rollingView.revealMilestones = revealMilestones ?: DoubleArray(0)
    rollingView.shimmer = NitroNumberView.Shimmer(
      color = shimmerColor?.let { colorFromARGB(it) },
      durationMs = Math.max(200.0, shimmerDuration ?: 950.0).toLong(),
    )
    rollingView.flash = NitroNumberView.Flash(
      upColor = flashUpColor?.let { colorFromARGB(it) },
      downColor = flashDownColor?.let { colorFromARGB(it) },
      durationMs = Math.max(50.0, flashDuration ?: 600.0).toLong(),
    )
    rollingView.alignment = when (textAlign) {
      NitroNumberTextAlign.CENTER -> NitroNumberView.Alignment.CENTER
      NitroNumberTextAlign.RIGHT -> NitroNumberView.Alignment.RIGHT
      NitroNumberTextAlign.LEFT -> NitroNumberView.Alignment.LEFT
      NitroNumberTextAlign.AUTO, null -> NitroNumberView.Alignment.AUTO
    }
    // Fabric does not hand a Hybrid View its layout direction, so JS resolves
    // it and the view is told outright; the alignment and the affixes read it back.
    val direction = if (rightToLeft == true) android.view.View.LAYOUT_DIRECTION_RTL else android.view.View.LAYOUT_DIRECTION_LTR
    if (rollingView.layoutDirection != direction) rollingView.layoutDirection = direction
    rollingView.loading = loading ?: false
  }

  // endregion

  private fun mapAffixAlign(align: NitroNumberAffixAlign?): NitroNumberView.AffixAlign = when (align) {
    NitroNumberAffixAlign.CENTER -> NitroNumberView.AffixAlign.CENTER
    NitroNumberAffixAlign.TOP -> NitroNumberView.AffixAlign.TOP
    NitroNumberAffixAlign.BOTTOM -> NitroNumberView.AffixAlign.BOTTOM
    NitroNumberAffixAlign.BASELINE, null -> NitroNumberView.AffixAlign.BASELINE
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
