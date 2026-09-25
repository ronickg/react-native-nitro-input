//
//  HybridNitroNumberView.swift
//  NitroInput
//
//  Nitro glue between React props / hybrid methods and `NitroNumberView`.
//

import Foundation
import NitroModules
import UIKit

final class HybridNitroNumberView: HybridNitroNumberViewSpec, RecyclableView {
  private let rollingView = NitroNumberView()

  var view: UIView { rollingView }

  private var isBatching = false
  private var pendingValue: Double?
  private var configDirty = true
  /// The `reveal` prop as last applied: `nil` = normal rolling, `false` = held
  /// at the opening frame, `true` = the count has been fired.
  private var appliedReveal: Bool?

  override init() {
    super.init()
    rollingView.onIntrinsicSizeChange = { [weak self] size in
      self?.onSizeChange?(Double(size.width), Double(size.height))
    }
    rollingView.onRevealEnd = { [weak self] in
      self?.onRevealEnd?()
    }
    rollingView.onRevealMilestone = { [weak self] index, milestone in
      self?.onRevealMilestone?(Double(index), milestone)
    }
  }

  // MARK: - Props

  var value: Double {
    get { rollingView.targetValue }
    set {
      pendingValue = newValue
      commitIfNeeded()
    }
  }
  var fractionDigits: Double? { didSet { markConfigDirty() } }
  var minimumIntegerDigits: Double? { didSet { markConfigDirty() } }
  var groupingSeparator: String? { didSet { markConfigDirty() } }
  var decimalSeparator: String? { didSet { markConfigDirty() } }
  var prefix: String? { didSet { markConfigDirty() } }
  var suffix: String? { didSet { markConfigDirty() } }
  var transition: NitroNumberTransition? { didSet { markConfigDirty() } }
  var flashUpColor: Double? { didSet { markConfigDirty() } }
  var flashDownColor: Double? { didSet { markConfigDirty() } }
  var flashDuration: Double? { didSet { markConfigDirty() } }
  var popOnChange: Double? { didSet { markConfigDirty() } }
  var duration: Double? { didSet { markConfigDirty() } }
  var easing: NitroNumberEasing? { didSet { markConfigDirty() } }
  var bounce: Double? { didSet { markConfigDirty() } }
  var stagger: Double? { didSet { markConfigDirty() } }
  var rollDirection: NitroNumberDirection? { didSet { markConfigDirty() } }
  var revealState: Double? { didSet { commitIfNeeded() } }
  var revealStyle: NitroNumberRevealStyle? { didSet { markConfigDirty() } }
  /// The tri-state `reveal` prop: nil = normal rolling, false = hold, true = play.
  private var reveal: Bool? {
    guard let revealState, revealState.isFinite else { return nil }
    if revealState >= 2 { return true }
    if revealState >= 1 { return false }
    return nil
  }
  var revealDuration: Double? { didSet { markConfigDirty() } }
  var revealBounce: Double? { didSet { markConfigDirty() } }
  var revealGrow: Double? { didSet { markConfigDirty() } }
  var revealStagger: Double? { didSet { markConfigDirty() } }
  var revealMilestones: [Double]? { didSet { markConfigDirty() } }
  var revealMilestoneHold: Double? { didSet { markConfigDirty() } }
  var onRevealEnd: (() -> Void)?
  var onRevealMilestone: ((Double, Double) -> Void)?
  var loading: Bool? { didSet { markConfigDirty() } }
  var shimmerColor: Double? { didSet { markConfigDirty() } }
  var shimmerDuration: Double? { didSet { markConfigDirty() } }
  var fontSize: Double? { didSet { markConfigDirty() } }
  var prefixFontSize: Double? { didSet { markConfigDirty() } }
  var suffixFontSize: Double? { didSet { markConfigDirty() } }
  var affixAlign: NitroNumberAffixAlign? { didSet { markConfigDirty() } }
  var prefixAlign: NitroNumberAffixAlign? { didSet { markConfigDirty() } }
  var suffixAlign: NitroNumberAffixAlign? { didSet { markConfigDirty() } }
  var letterSpacing: Double? { didSet { markConfigDirty() } }
  var prefixSpacing: Double? { didSet { markConfigDirty() } }
  var suffixSpacing: Double? { didSet { markConfigDirty() } }
  var prefixOffset: Double? { didSet { markConfigDirty() } }
  var suffixOffset: Double? { didSet { markConfigDirty() } }
  var adjustsFontSizeToFit: Bool? { didSet { markConfigDirty() } }
  var minimumFontScale: Double? { didSet { markConfigDirty() } }
  var allowFontScaling: Bool? { didSet { markConfigDirty() } }
  var maxFontSizeMultiplier: Double? { didSet { markConfigDirty() } }
  var fontWeight: Double? { didSet { markConfigDirty() } }
  var fontFamily: String? { didSet { markConfigDirty() } }
  var color: Double? { didSet { markConfigDirty() } }
  var textAlign: NitroNumberTextAlign? { didSet { markConfigDirty() } }
  var rightToLeft: Bool? { didSet { markConfigDirty() } }
  var onSizeChange: ((Double, Double) -> Void)? {
    didSet { onMain { self.rollingView.resendIntrinsicSize() } }
  }

  // MARK: - Methods

  func jumpTo(value: Double) throws {
    enqueue(.jump(value))
  }

  func animateTo(value: Double) throws {
    enqueue(.animate(value))
  }

  func revealTo(value: Double) throws {
    enqueue(.reveal(value))
  }

  private enum Command {
    case jump(Double)
    case animate(Double)
    case reveal(Double)
  }

  private let commandLock = NSLock()
  private var pendingCommand: Command?
  private var commandScheduled = false

  /// Coalesces calls from the JS thread: only the latest value is applied per
  /// main-thread turn, so a caller pushing a value every frame (scrubbing, live
  /// meters, many views at once) can never pile up a backlog of dispatches
  /// that stalls the main thread. A frame only ever shows the newest value anyway.
  private func enqueue(_ command: Command) {
    commandLock.lock()
    pendingCommand = command
    let schedule = !commandScheduled
    commandScheduled = true
    commandLock.unlock()
    guard schedule else { return }
    onMain { [weak self] in self?.drainCommand() }
  }

  private func drainCommand() {
    commandLock.lock()
    let command = pendingCommand
    pendingCommand = nil
    commandScheduled = false
    commandLock.unlock()
    guard let command else { return }
    pendingValue = nil
    flushConfigIfNeeded()
    switch command {
    case .jump(let value): rollingView.setValue(value)
    case .animate(let value): rollingView.animate(to: value)
    case .reveal(let value):
      rollingView.reveal(to: value)
      // The prop machine treats the count as fired, so a later `reveal={true}` doesn't replay it.
      if reveal != nil { appliedReveal = true }
    }
  }

  // MARK: - Lifecycle

  func beforeUpdate() {
    isBatching = true
  }

  func afterUpdate() {
    isBatching = false
    commit()
  }

  /// Fabric dropped the view. The hybrid lives on until the JS handle to it
  /// (`hybridRef`) is garbage-collected, so the view lets go of what is
  /// sizeable now and keeps only itself.
  func onDropView() {
    onMain { self.rollingView.release() }
  }

  /// JS called `dispose()` on the ref: same as a drop.
  func dispose() {
    onMain { self.rollingView.release() }
  }

  /// Reported to the JS garbage collector so a dropped view's handle counts as
  /// the memory it holds rather than as an empty object; that is what makes
  /// Hermes collect the handles, and with them the views, in time.
  var memorySize: Int { NitroNumberView.memoryEstimateBytes }

  /// Fabric is about to reuse this view for another element: forget every prop
  /// and all animation state. Nitro re-applies the new element's props next.
  func prepareForRecycle() {
    // Batch the resets so the setters don't flush config thirty times.
    isBatching = true
    pendingValue = nil
    fractionDigits = nil
    minimumIntegerDigits = nil
    groupingSeparator = nil
    decimalSeparator = nil
    prefix = nil
    suffix = nil
    transition = nil
    flashUpColor = nil
    flashDownColor = nil
    flashDuration = nil
    popOnChange = nil
    duration = nil
    easing = nil
    bounce = nil
    stagger = nil
    rollDirection = nil
    revealState = nil
    revealStyle = nil
    revealDuration = nil
    revealBounce = nil
    revealGrow = nil
    revealStagger = nil
    revealMilestones = nil
    revealMilestoneHold = nil
    onRevealEnd = nil
    onRevealMilestone = nil
    appliedReveal = nil
    loading = nil
    shimmerColor = nil
    shimmerDuration = nil
    fontSize = nil
    prefixFontSize = nil
    suffixFontSize = nil
    affixAlign = nil
    prefixAlign = nil
    suffixAlign = nil
    letterSpacing = nil
    prefixSpacing = nil
    suffixSpacing = nil
    prefixOffset = nil
    suffixOffset = nil
    adjustsFontSizeToFit = nil
    minimumFontScale = nil
    allowFontScaling = nil
    maxFontSizeMultiplier = nil
    fontWeight = nil
    fontFamily = nil
    color = nil
    textAlign = nil
    rightToLeft = nil
    onSizeChange = nil
    configDirty = true
    isBatching = false
    onMain { self.rollingView.resetForRecycle() }
  }

  // MARK: - Batching

  private func markConfigDirty() {
    configDirty = true
    commitIfNeeded()
  }

  private func commitIfNeeded() {
    if !isBatching { commit() }
  }

  private func commit() {
    onMain {
      self.flushConfigIfNeeded()
      let changed = self.pendingValue
      self.pendingValue = nil
      let value = changed ?? self.rollingView.targetValue
      guard let reveal = self.reveal else {
        // A normal NitroNumber (also when leaving reveal mode).
        self.appliedReveal = nil
        if let changed { self.rollingView.animate(to: changed) }
        return
      }
      defer { self.appliedReveal = reveal }
      if !reveal {
        // Hold the opening frame; re-hold when the figure or the mode changed.
        if changed != nil || self.appliedReveal != false {
          self.rollingView.holdReveal(value)
        }
      } else if self.appliedReveal != true {
        // `reveal` just turned true (or the view mounted with it true): fire the count.
        self.rollingView.reveal(to: value)
      } else if let changed {
        // A new figure after the count was fired: re-target a running count, roll a landed one.
        if self.rollingView.isRevealing {
          self.rollingView.reveal(to: changed)
        } else {
          self.rollingView.animate(to: changed)
        }
      }
    }
  }

  private func flushConfigIfNeeded() {
    guard configDirty else { return }
    configDirty = false

    var format = NitroNumberView.Format()
    format.fractionDigits = Self.clampInt(fractionDigits, 0, 9, fallback: 0)
    format.minimumIntegerDigits = Self.clampInt(minimumIntegerDigits, 1, 15, fallback: 1)
    format.groupingSeparator = groupingSeparator ?? ""
    format.decimalSeparator = decimalSeparator ?? "."
    format.prefix = prefix ?? ""
    format.suffix = suffix ?? ""

    var typography = NitroNumberView.Typography()
    typography.fontSize = CGFloat(fontSize ?? 32)
    typography.prefixFontSize = prefixFontSize.map { CGFloat($0) }
    typography.suffixFontSize = suffixFontSize.map { CGFloat($0) }
    typography.fontWeight = CGFloat(fontWeight ?? 400)
    typography.fontFamily = fontFamily
    typography.color = color.map(Self.color(fromARGB:)) ?? .label
    let sharedAlign = Self.mapAffixAlign(affixAlign)
    typography.prefixAlign = prefixAlign.map { Self.mapAffixAlign($0) } ?? sharedAlign
    typography.suffixAlign = suffixAlign.map { Self.mapAffixAlign($0) } ?? sharedAlign
    typography.letterSpacing = CGFloat((letterSpacing ?? 0).isFinite ? letterSpacing ?? 0 : 0)
    typography.prefixSpacing = prefixSpacing.flatMap { $0.isFinite ? CGFloat($0) : nil }
    typography.suffixSpacing = suffixSpacing.flatMap { $0.isFinite ? CGFloat($0) : nil }
    typography.prefixOffset = CGFloat((prefixOffset ?? 0).isFinite ? prefixOffset ?? 0 : 0)
    typography.suffixOffset = CGFloat((suffixOffset ?? 0).isFinite ? suffixOffset ?? 0 : 0)
    typography.adjustsFontSizeToFit = adjustsFontSizeToFit ?? false
    typography.minimumFontScale = CGFloat(min(1, max(0.05, minimumFontScale ?? 0.5)))
    typography.allowFontScaling = allowFontScaling ?? false
    typography.maxFontSizeMultiplier = CGFloat(max(0, maxFontSizeMultiplier ?? 0))

    var timing = NitroNumberView.Timing()
    timing.transition = Self.mapTransition(transition)
    timing.popOnChange = min(1, max(0, popOnChange ?? 0))
    timing.duration = max(0, (duration ?? 500) / 1000)
    timing.easing = Self.mapEasing(easing)
    timing.bounce = bounce ?? 0.15
    timing.stagger = max(0, (stagger ?? 0) / 1000)
    timing.direction = Self.mapDirection(rollDirection)
    timing.revealDuration = max(0, (revealDuration ?? 2200) / 1000)
    timing.revealBounce = min(1, max(0, revealBounce ?? 0.12))
    timing.revealGrow = min(1, max(0, revealGrow ?? 0.2))
    timing.revealStyle = revealStyle == .spin ? .spin : .count
    timing.revealStagger = max(0, (revealStagger ?? 200) / 1000)
    timing.revealMilestoneHold = max(0, (revealMilestoneHold ?? 0) / 1000)

    var shimmer = NitroNumberView.Shimmer()
    shimmer.color = shimmerColor.map(Self.color(fromARGB:))
    shimmer.duration = max(0.2, (shimmerDuration ?? 950) / 1000)

    var flash = NitroNumberView.Flash()
    flash.upColor = flashUpColor.flatMap(Self.optionalColor(fromARGB:))
    flash.downColor = flashDownColor.flatMap(Self.optionalColor(fromARGB:))
    flash.duration = max(0.05, (flashDuration ?? 600) / 1000)
    rollingView.flash = flash

    rollingView.typography = typography
    rollingView.format = format
    rollingView.timing = timing
    rollingView.revealMilestones = revealMilestones ?? []
    rollingView.shimmer = shimmer
    rollingView.alignment = Self.mapAlignment(textAlign)
    // Fabric does not hand a Hybrid View its layout direction, so JS resolves
    // it and the view is told outright; `effectiveUserInterfaceLayoutDirection`
    // then reads it back for the alignment and the affixes.
    let direction: UISemanticContentAttribute = (rightToLeft ?? false) ? .forceRightToLeft : .forceLeftToRight
    if rollingView.semanticContentAttribute != direction {
      rollingView.semanticContentAttribute = direction
      rollingView.setNeedsLayout()
    }
    rollingView.loading = loading ?? false
  }

  // MARK: - Helpers

  private func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
      block()
    } else {
      DispatchQueue.main.async(execute: block)
    }
  }

  private static func clampInt(_ value: Double?, _ lower: Int, _ upper: Int, fallback: Int) -> Int {
    guard let value, value.isFinite else { return fallback }
    return min(upper, max(lower, Int(value.rounded())))
  }

  private static func color(fromARGB value: Double) -> UIColor {
    guard value.isFinite else { return .label }
    let bits = UInt32(truncatingIfNeeded: Int64(value))
    let a = CGFloat((bits >> 24) & 0xff) / 255
    let r = CGFloat((bits >> 16) & 0xff) / 255
    let g = CGFloat((bits >> 8) & 0xff) / 255
    let b = CGFloat(bits & 0xff) / 255
    return UIColor(red: r, green: g, blue: b, alpha: a)
  }

  private static func mapTransition(_ transition: NitroNumberTransition?) -> NitroNumberView.Transition {
    guard let transition else { return .roll }
    switch transition {
    case .roll: return .roll
    case .numeric: return .numeric
    case .scramble: return .scramble
    default: return .roll
    }
  }

  /// A colour prop that may be unset (`Infinity`): nil then, unlike `color(fromARGB:)`'s label fallback.
  private static func optionalColor(fromARGB value: Double) -> UIColor? {
    guard value.isFinite else { return nil }
    return color(fromARGB: value)
  }

  private static func mapEasing(_ easing: NitroNumberEasing?) -> NitroNumberView.Easing {
    guard let easing else { return .easeInOut }
    switch easing {
    case .linear: return .linear
    case .easein: return .easeIn
    case .easeout: return .easeOut
    case .easeinout: return .easeInOut
    case .spring: return .spring
    default: return .easeInOut
    }
  }

  private static func mapDirection(_ direction: NitroNumberDirection?) -> NitroNumberView.Direction {
    guard let direction else { return .auto }
    switch direction {
    case .auto: return .auto
    case .up: return .up
    case .down: return .down
    default: return .auto
    }
  }

  private static func mapAffixAlign(_ align: NitroNumberAffixAlign?) -> NitroNumberView.AffixAlign {
    guard let align else { return .baseline }
    switch align {
    case .baseline: return .baseline
    case .center: return .center
    case .top: return .top
    case .bottom: return .bottom
    default: return .baseline
    }
  }

  private static func mapAlignment(_ align: NitroNumberTextAlign?) -> NitroNumberView.Alignment {
    guard let align else { return .auto }
    switch align {
    case .auto: return .auto
    case .left: return .left
    case .center: return .center
    case .right: return .right
    default: return .auto
    }
  }
}
