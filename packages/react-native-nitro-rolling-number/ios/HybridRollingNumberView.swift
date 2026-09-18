//
//  HybridRollingNumberView.swift
//  NitroRollingNumber
//
//  Nitro glue between React props / hybrid methods and `RollingNumberView`.
//

import Foundation
import NitroModules
import UIKit

final class HybridRollingNumberView: HybridRollingNumberViewSpec, RecyclableView {
  private let rollingView = RollingNumberView()

  var view: UIView { rollingView }

  private var isBatching = false
  private var pendingValue: Double?
  private var configDirty = true

  override init() {
    super.init()
    rollingView.onIntrinsicSizeChange = { [weak self] size in
      self?.onSizeChange?(Double(size.width), Double(size.height))
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
  var duration: Double? { didSet { markConfigDirty() } }
  var easing: RollingNumberEasing? { didSet { markConfigDirty() } }
  var bounce: Double? { didSet { markConfigDirty() } }
  var stagger: Double? { didSet { markConfigDirty() } }
  var direction: RollingNumberDirection? { didSet { markConfigDirty() } }
  var loading: Bool? { didSet { markConfigDirty() } }
  var shimmerColor: Double? { didSet { markConfigDirty() } }
  var shimmerDuration: Double? { didSet { markConfigDirty() } }
  var fontSize: Double? { didSet { markConfigDirty() } }
  var prefixFontSize: Double? { didSet { markConfigDirty() } }
  var suffixFontSize: Double? { didSet { markConfigDirty() } }
  var affixAlign: RollingNumberAffixAlign? { didSet { markConfigDirty() } }
  var prefixAlign: RollingNumberAffixAlign? { didSet { markConfigDirty() } }
  var suffixAlign: RollingNumberAffixAlign? { didSet { markConfigDirty() } }
  var adjustsFontSizeToFit: Bool? { didSet { markConfigDirty() } }
  var minimumFontScale: Double? { didSet { markConfigDirty() } }
  var allowFontScaling: Bool? { didSet { markConfigDirty() } }
  var maxFontSizeMultiplier: Double? { didSet { markConfigDirty() } }
  var fontWeight: Double? { didSet { markConfigDirty() } }
  var fontFamily: String? { didSet { markConfigDirty() } }
  var color: Double? { didSet { markConfigDirty() } }
  var textAlign: RollingNumberTextAlign? { didSet { markConfigDirty() } }
  var onSizeChange: ((Double, Double) -> Void)? {
    didSet { onMain { self.rollingView.resendIntrinsicSize() } }
  }

  // MARK: - Methods

  func jumpTo(value: Double) throws {
    onMain {
      self.pendingValue = nil
      self.flushConfigIfNeeded()
      self.rollingView.setValue(value)
    }
  }

  func animateTo(value: Double) throws {
    onMain {
      self.pendingValue = nil
      self.flushConfigIfNeeded()
      self.rollingView.animate(to: value)
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

  func onDropView() {
    onMain { self.rollingView.stopAnimation() }
  }

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
    duration = nil
    easing = nil
    bounce = nil
    stagger = nil
    direction = nil
    loading = nil
    shimmerColor = nil
    shimmerDuration = nil
    fontSize = nil
    prefixFontSize = nil
    suffixFontSize = nil
    affixAlign = nil
    prefixAlign = nil
    suffixAlign = nil
    adjustsFontSizeToFit = nil
    minimumFontScale = nil
    allowFontScaling = nil
    maxFontSizeMultiplier = nil
    fontWeight = nil
    fontFamily = nil
    color = nil
    textAlign = nil
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
      if let value = self.pendingValue {
        self.pendingValue = nil
        self.rollingView.animate(to: value)
      }
    }
  }

  private func flushConfigIfNeeded() {
    guard configDirty else { return }
    configDirty = false

    var format = RollingNumberView.Format()
    format.fractionDigits = Self.clampInt(fractionDigits, 0, 9, fallback: 0)
    format.minimumIntegerDigits = Self.clampInt(minimumIntegerDigits, 1, 15, fallback: 1)
    format.groupingSeparator = groupingSeparator ?? ""
    format.decimalSeparator = decimalSeparator ?? "."
    format.prefix = prefix ?? ""
    format.suffix = suffix ?? ""

    var typography = RollingNumberView.Typography()
    typography.fontSize = CGFloat(fontSize ?? 32)
    typography.prefixFontSize = prefixFontSize.map { CGFloat($0) }
    typography.suffixFontSize = suffixFontSize.map { CGFloat($0) }
    typography.fontWeight = CGFloat(fontWeight ?? 400)
    typography.fontFamily = fontFamily
    typography.color = color.map(Self.color(fromARGB:)) ?? .label
    let sharedAlign = Self.mapAffixAlign(affixAlign)
    typography.prefixAlign = prefixAlign.map { Self.mapAffixAlign($0) } ?? sharedAlign
    typography.suffixAlign = suffixAlign.map { Self.mapAffixAlign($0) } ?? sharedAlign
    typography.adjustsFontSizeToFit = adjustsFontSizeToFit ?? false
    typography.minimumFontScale = CGFloat(min(1, max(0.05, minimumFontScale ?? 0.5)))
    typography.allowFontScaling = allowFontScaling ?? false
    typography.maxFontSizeMultiplier = CGFloat(max(0, maxFontSizeMultiplier ?? 0))

    var timing = RollingNumberView.Timing()
    timing.duration = max(0, (duration ?? 500) / 1000)
    timing.easing = Self.mapEasing(easing)
    timing.bounce = bounce ?? 0.15
    timing.stagger = max(0, (stagger ?? 0) / 1000)
    timing.direction = Self.mapDirection(direction)

    var shimmer = RollingNumberView.Shimmer()
    shimmer.color = shimmerColor.map(Self.color(fromARGB:))
    shimmer.duration = max(0.2, (shimmerDuration ?? 950) / 1000)

    rollingView.typography = typography
    rollingView.format = format
    rollingView.timing = timing
    rollingView.shimmer = shimmer
    rollingView.alignment = Self.mapAlignment(textAlign)
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

  private static func mapEasing(_ easing: RollingNumberEasing?) -> RollingNumberView.Easing {
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

  private static func mapDirection(_ direction: RollingNumberDirection?) -> RollingNumberView.Direction {
    guard let direction else { return .auto }
    switch direction {
    case .auto: return .auto
    case .up: return .up
    case .down: return .down
    default: return .auto
    }
  }

  private static func mapAffixAlign(_ align: RollingNumberAffixAlign?) -> RollingNumberView.AffixAlign {
    guard let align else { return .baseline }
    switch align {
    case .baseline: return .baseline
    case .center: return .center
    case .top: return .top
    case .bottom: return .bottom
    default: return .baseline
    }
  }

  private static func mapAlignment(_ align: RollingNumberTextAlign?) -> RollingNumberView.Alignment {
    guard let align else { return .left }
    switch align {
    case .left: return .left
    case .center: return .center
    case .right: return .right
    default: return .left
    }
  }
}
