//
//  HybridNitroTextView.swift
//  NitroInput
//
//  Nitro glue between NitroText's props and `NitroTextView`: the props land
//  one by one and are applied together once Nitro says the update is done.
//

import Foundation
import NitroModules
import UIKit

final class HybridNitroTextView: HybridNitroTextViewSpec, RecyclableView {
  private let textView = NitroTextView()

  var view: UIView { textView }

  var text: String = ""
  // Unset unless the element set it: the wrapper sends only those.
  var fontSize: Double?
  var fontWeight: Double?
  var fontFamily: String?
  var color: Double?
  var letterSpacing: Double?
  var textAlign: NitroNumberTextAlign?
  var rightToLeft: Bool?
  var duration: Double?
  var easing: NitroInputEasing?
  var bounce: Double?
  var effect: NitroInputEffect?
  var respectReduceMotion: Bool?
  var loading: Bool?
  var shimmerColor: Double?
  var shimmerDuration: Double?
  var shimmerAngle: Double?
  var shimmerWidth: Double?
  var shimmerBaseColor: Double?
  var shimmerDirection: NitroNumberShimmerDirection?
  var shimmerDelay: Double?

  /// Every prop of an update is set before this runs: apply them in one go
  /// (the style first, so the text is laid out in its font).
  func afterUpdate() {
    var style = NitroTextView.Style()
    if let fontSize, fontSize.isFinite, fontSize > 0 { style.fontSize = CGFloat(fontSize) }
    if let fontWeight, fontWeight.isFinite { style.fontWeight = CGFloat(fontWeight) }
    if let fontFamily { style.fontFamily = fontFamily }
    if let color = color.flatMap(Self.color) { style.color = color }
    if let letterSpacing, letterSpacing.isFinite { style.letterSpacing = CGFloat(letterSpacing) }
    switch textAlign {
    case .left: style.textAlign = .left
    case .center: style.textAlign = .center
    case .right: style.textAlign = .right
    default: style.textAlign = .auto
    }
    textView.style = style

    var timing = NitroTextView.Timing()
    if let duration, duration.isFinite { timing.duration = max(0, duration / 1000) }
    switch easing {
    case .easeout: timing.easing = 1
    case .easeinout: timing.easing = 2
    case .linear: timing.easing = 3
    case .spring: timing.easing = 4
    default: timing.easing = 0
    }
    if let bounce, bounce.isFinite { timing.bounce = bounce }
    switch effect {
    case .slide: timing.effect = 1
    case .fade: timing.effect = 2
    default: timing.effect = 0
    }
    timing.respectReduceMotion = respectReduceMotion ?? true
    if timing != textView.timing { textView.timing = timing }

    var shimmer = NitroNumberView.Shimmer()
    shimmer.color = shimmerColor.flatMap(Self.color)
    if let shimmerDuration, shimmerDuration.isFinite { shimmer.duration = max(0.2, shimmerDuration / 1000) }
    if let shimmerAngle, shimmerAngle.isFinite { shimmer.angle = CGFloat(shimmerAngle) }
    if let shimmerWidth, shimmerWidth.isFinite, shimmerWidth > 0 { shimmer.width = CGFloat(shimmerWidth) }
    shimmer.baseColor = shimmerBaseColor.flatMap(Self.color)
    switch shimmerDirection {
    case .ltr: shimmer.leftToRight = true
    case .rtl: shimmer.leftToRight = false
    default: shimmer.leftToRight = nil
    }
    if let shimmerDelay, shimmerDelay.isFinite { shimmer.delay = max(0, shimmerDelay / 1000) }
    if shimmer != textView.shimmer { textView.shimmer = shimmer }

    textView.rightToLeft = rightToLeft ?? false
    textView.text = text
    textView.loading = loading ?? false
  }

  /// Fabric is about to reuse this view for another element.
  /// The next element's props arrive as a first mount's do, only the ones it
  /// set, so forget this one's first.
  func prepareForRecycle() {
    text = ""
    fontSize = nil; fontWeight = nil; fontFamily = nil; color = nil; letterSpacing = nil
    textAlign = nil; rightToLeft = nil
    duration = nil; easing = nil; bounce = nil; effect = nil; respectReduceMotion = nil
    loading = nil
    shimmerColor = nil; shimmerDuration = nil; shimmerAngle = nil; shimmerWidth = nil
    shimmerBaseColor = nil; shimmerDirection = nil; shimmerDelay = nil
    textView.resetForRecycle()
  }

  var memorySize: Int { 8 * 1024 }

  private static func color(_ value: Double) -> UIColor? {
    guard value.isFinite else { return nil }
    let bits = UInt32(truncatingIfNeeded: Int64(value))
    return UIColor(
      red: CGFloat((bits >> 16) & 0xff) / 255,
      green: CGFloat((bits >> 8) & 0xff) / 255,
      blue: CGFloat(bits & 0xff) / 255,
      alpha: CGFloat((bits >> 24) & 0xff) / 255
    )
  }
}

/// Measures a NitroText line on the JS thread, the way the view lays it out.
final class HybridNitroTextMeasure: HybridNitroTextMeasureSpec {
  func measure(text: String, fontSize: Double, fontWeight: Double, fontFamily: String, letterSpacing: Double) throws -> Double {
    let fonts = NitroTextFonts.shared
    let entry = fonts.entry(size: CGFloat(fontSize), weight: CGFloat(fontWeight), family: fontFamily)
    return Double(fonts.width(of: text, in: entry, letterSpacing: CGFloat(letterSpacing.isFinite ? letterSpacing : 0)))
  }

  func lineHeight(fontSize: Double, fontWeight: Double, fontFamily: String) throws -> Double {
    Double(NitroTextFonts.shared.entry(size: CGFloat(fontSize), weight: CGFloat(fontWeight), family: fontFamily).lineHeight)
  }
}
