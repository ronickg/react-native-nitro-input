//
//  RollingNumberView.swift
//  NitroRollingNumber
//
//  Draws the rolling number. All behaviour (wheel positions, rolls, stagger,
//  easing, loading fade, shimmer phase) lives in the shared C++ `RollingEngine`
//  (cpp/RollingEngine.hpp); this view owns fonts, layout, fit-to-width and
//  rendering, and drives the engine from a display link.
//
//  Rendering has two modes:
//  - Layers (default): every glyph and wheel is a CALayer whose contents is a
//    pre-rasterized image (a wheel is a clipped strip of the digits 0–9); a
//    frame only moves layers, so the render server composites the roll and
//    the main thread never redraws a bitmap. Profiling 24 rolling views showed
//    two thirds of the main thread inside Core Animation's backing-store work
//    for `draw(_:)` views, which this avoids entirely.
//  - Bitmap (`draw(_:)`): used only while the loading glint is visible, because
//    the source-atop sweep needs a Core Graphics transparency layer.
//

import CoreText
import UIKit

final class RollingNumberView: UIView {

  private typealias Engine = margelo.nitro.nitrorollingnumber.RollingEngine
  private typealias GlyphMorph = margelo.nitro.nitrorollingnumber.GlyphMorph

  // MARK: - Configuration

  struct Format: Equatable {
    var fractionDigits: Int = 0
    var minimumIntegerDigits: Int = 1
    var groupingSeparator: String = ""
    var decimalSeparator: String = "."
    var prefix: String = ""
    var suffix: String = ""
  }

  enum AffixAlign {
    case baseline, center, top, bottom
  }

  struct Typography: Equatable {
    var fontSize: CGFloat = 32
    var prefixFontSize: CGFloat? = nil
    var suffixFontSize: CGFloat? = nil
    var fontWeight: CGFloat = 400
    var fontFamily: String? = nil
    var color: UIColor = .label
    var prefixAlign: AffixAlign = .baseline
    var suffixAlign: AffixAlign = .baseline
    var adjustsFontSizeToFit: Bool = false
    var minimumFontScale: CGFloat = 0.5
    var allowFontScaling: Bool = false
    var maxFontSizeMultiplier: CGFloat = 0
  }

  enum Easing: Int32 {
    case linear = 0, easeIn = 1, easeOut = 2, easeInOut = 3, spring = 4
  }

  enum Direction: Int32 {
    case auto = 0, up = 1, down = 2
  }

  struct Timing: Equatable {
    /// The odometer roll, or one of the glyph-swap transitions.
    var transition: Transition = .roll
    /// A punch of the whole figure on every change, peak overshoot 0 (none) to 1.
    var popOnChange: Double = 0
    var duration: TimeInterval = 0.5
    var easing: Easing = .easeInOut
    var bounce: Double = 0.15
    /// Delay between the start of each wheel's roll, least significant first.
    var stagger: TimeInterval = 0
    var direction: Direction = .auto
    /// Length of a jackpot reveal (the count, or until the last reel locks).
    var revealDuration: TimeInterval = 2.2
    /// Peak overshoot of the reveal's landing pop (0 = none).
    var revealBounce: Double = 0.12
    /// Count style: how much smaller the figure opens, growing to full size over the count.
    var revealGrow: Double = 0.2
    /// The reveal's presentation.
    var revealStyle: RevealStyle = .count
    /// Spin style: delay between reel stops, from the left.
    var revealStagger: TimeInterval = 0.2
    /// Count style: how long the count pauses on each milestone.
    var revealMilestoneHold: TimeInterval = 0
  }

  enum RevealStyle: Int32 {
    case count = 0, spin = 1
  }

  enum Transition: Int32 {
    case roll = 0, numeric = 1, flip = 2, scramble = 3, morph = 4
  }

  /// The change flash: the colours a changed digit lights up in (nil = off) and how long the light lasts.
  struct Flash: Equatable {
    var upColor: UIColor?
    var downColor: UIColor?
    var duration: TimeInterval = 0.6
  }

  struct Shimmer: Equatable {
    /// Color of the glint's core; `nil` uses a light neutral (dark neutral in dark mode).
    var color: UIColor? = nil
    /// Duration of one sweep across the number.
    var duration: TimeInterval = 0.95
  }

  enum Alignment {
    /// The start edge of the layout direction: left in a left-to-right app,
    /// right in a right-to-left one. What `Text` does with no `textAlign`.
    case auto
    /// Absolute, whatever the layout direction.
    case left, center, right
  }

  var format = Format() {
    didSet {
      guard format != oldValue else { return }
      engine.setFormat(Int32(format.fractionDigits), Int32(format.minimumIntegerDigits))
      if engine.hasShownValue() {
        reportIntrinsicSize()
      }
      render()
    }
  }

  var typography = Typography() {
    didSet {
      guard typography != oldValue else { return }
      rebuildFonts()
    }
  }

  var timing = Timing() {
    didSet {
      engine.setTiming(timing.duration, timing.easing.rawValue, timing.bounce, timing.stagger, timing.direction.rawValue)
      engine.setTransition(timing.transition.rawValue)
      engine.setPopOnChange(timing.popOnChange)
      engine.setRevealTiming(timing.revealDuration, timing.revealBounce, timing.revealStyle.rawValue, timing.revealStagger)
      engine.setRevealGrow(timing.revealGrow)
      engine.setRevealMilestoneHold(timing.revealMilestoneHold)
    }
  }

  /// Win tiers of a count-style reveal, in the figure's units.
  var revealMilestones: [Double] = [] {
    didSet {
      guard revealMilestones != oldValue else { return }
      engine.clearRevealMilestones()
      for milestone in revealMilestones {
        engine.addRevealMilestone(milestone)
      }
    }
  }

  var shimmer = Shimmer() {
    didSet { render() }
  }

  var flash = Flash() {
    didSet {
      guard flash != oldValue else { return }
      engine.setFlash(flash.upColor != nil || flash.downColor != nil ? flash.duration : 0)
      // The tinted glyph images are per colour; a new flash colour means new ones.
      if flash.upColor != oldValue.upColor || flash.downColor != oldValue.downColor { render() }
    }
  }

  /// Loading glint: full-color ink with a light band sweeping through it.
  var loading = false {
    didSet {
      guard loading != oldValue else { return }
      engine.setReduceMotion(UIAccessibility.isReduceMotionEnabled)
      engine.setLoading(loading, CACurrentMediaTime())
      updateDisplayLinkNeed()
      render()
    }
  }

  var alignment: Alignment = .auto {
    didSet { render() }
  }

  /// Called with the settled (target) intrinsic size whenever it changes.
  var onIntrinsicSizeChange: ((CGSize) -> Void)?
  /// Called once a jackpot reveal has landed (count finished, pop rung out).
  var onRevealEnd: (() -> Void)?
  /// Called when a count-style reveal reaches a milestone (its index and value).
  var onRevealMilestone: ((Int, Double) -> Void)?

  /// The value currently shown or being rolled towards.
  var targetValue: Double { engine.targetValue() }
  /// True while a jackpot reveal counts or its landing pop rings out.
  var isRevealing: Bool { engine.isRevealing() }

  // MARK: - Shimmer geometry (matches the Uno "shine" variant)

  private static let defaultShimmerColor = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0x2B / 255, green: 0x2E / 255, blue: 0x37 / 255, alpha: 1)
      : UIColor(red: 0xD6 / 255, green: 0xD9 / 255, blue: 0xE1 / 255, alpha: 1)
  }
  /// The core starts at the glyphs' left edge instead of parked off-screen.
  private static let shimmerSeed: CGFloat = 0.25
  /// How far the top of the band leads the bottom, as a fraction of the height ("/" slant).
  private static let shimmerSlant: CGFloat = 0.6

  // MARK: - Fonts

  private enum GlyphRole {
    case digit, prefix, suffix
  }

  private struct GlyphKey: Hashable {
    let text: String
    let role: GlyphRole
  }

  /// Digit / prefix / suffix fonts with per-glyph caches.
  private final class FontSet {
    let digit: UIFont
    let prefix: UIFont
    let suffix: UIFont
    /// The text color resolved for the view's traits: the glyph images bake it
    /// in, and `.label` is dynamic (see `traitCollectionDidChange`).
    let color: UIColor
    let prefixAlign: AffixAlign
    let suffixAlign: AffixAlign
    /// Height of the line box (the digit font's line height).
    let lineHeight: CGFloat
    /// Width of the widest digit glyph.
    private(set) var digitWidth: CGFloat = 0
    // Keyed by a value type rather than a concatenated string: a lookup on the
    // frame path must not allocate.
    private var glyphCache: [GlyphKey: NSAttributedString] = [:]
    private var widthCache: [GlyphKey: CGFloat] = [:]
    private var inkDescentCache: [GlyphKey: CGFloat] = [:]

    /// The rasterized glyphs and strips are shared by every rolling number
    /// drawn with the same font, colour and density. A view lives on after
    /// Fabric drops it until the JS side's handle to it is collected, which is
    /// Hermes's decision; twenty-four dropped views must not each hold a strip
    /// (a 3× strip is most of a megabyte) meanwhile. Bounded: when the cache
    /// grows past its capacity it starts over, which costs one re-rasterization.
    private struct ImageKey: Hashable {
      let font: String
      let color: UInt32
      let scale: CGFloat
      let text: String
      let role: GlyphRole
    }
    private struct StripKey: Hashable {
      let font: String
      let color: UInt32
      let scale: CGFloat
      let blankZero: Bool
    }
    private static var sharedImages: [ImageKey: UIImage] = [:]
    private static var sharedBlurred: [ImageKey: UIImage] = [:]
    /// Glyphs in the change flash's colours, keyed like the sharp ones plus the tint.
    private struct TintKey: Hashable {
      let image: ImageKey
      let tint: UInt32
    }
    private static var sharedTinted: [TintKey: UIImage] = [:]
    /// The digits' outlines for the morph transition, normalized (see GlyphMorph.hpp), per font and density.
    private struct OutlineKey: Hashable {
      let font: String
      let digit: Int
    }
    private static var sharedOutlines: [OutlineKey: [Double]] = [:]
    private static var sharedStrips: [StripKey: UIImage] = [:]
    private static let sharedCapacity = 512
    private static let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private let colorKey: UInt32
    private func fontTag(_ role: GlyphRole) -> String {
      let font = self.font(for: role)
      return "\(font.fontName)|\(font.pointSize)"
    }
    /// Pixel density the glyph images are rendered at.
    let renderScale: CGFloat
    /// Slots in a wheel strip: index -1 (blank) through 10 (the 0 after 9).
    static let stripSlots = 12

    init(_ t: Typography, traits: UITraitCollection) {
      // The view's own display, not the main screen's (deprecated, and absent on visionOS).
      renderScale = max(1, traits.displayScale)
      let scale = RollingNumberView.systemFontMultiplier(t)
      digit = RollingNumberView.makeFont(size: t.fontSize * scale, weight: t.fontWeight, family: t.fontFamily)
      prefix = RollingNumberView.makeFont(size: (t.prefixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily)
      suffix = RollingNumberView.makeFont(size: (t.suffixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily)
      color = t.color.resolvedColor(with: traits)
      var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
      color.getRed(&r, green: &g, blue: &b, alpha: &a)
      colorKey = (UInt32(max(0, min(1, a)) * 255) << 24) | (UInt32(max(0, min(1, r)) * 255) << 16) | (UInt32(max(0, min(1, g)) * 255) << 8) | UInt32(max(0, min(1, b)) * 255)
      prefixAlign = t.prefixAlign
      suffixAlign = t.suffixAlign
      lineHeight = ceil(digit.lineHeight)
      digitWidth = (0...9).map { width(of: String($0), role: .digit) }.max() ?? 0
    }

    func font(for role: GlyphRole) -> UIFont {
      switch role {
      case .digit: return digit
      case .prefix: return prefix
      case .suffix: return suffix
      }
    }

    func attributed(_ text: String, role: GlyphRole) -> NSAttributedString {
      let key = GlyphKey(text: text, role: role)
      if let cached = glyphCache[key] { return cached }
      let string = NSAttributedString(string: text, attributes: [
        .font: font(for: role),
        .foregroundColor: color,
      ])
      glyphCache[key] = string
      return string
    }

    func width(of text: String, role: GlyphRole) -> CGFloat {
      let key = GlyphKey(text: text, role: role)
      if let cached = widthCache[key] { return cached }
      let width = attributed(text, role: role).size().width
      widthCache[key] = width
      return width
    }

    /// The glyph rasterized once (text color baked in, at screen density) so a
    /// frame is a handful of image blits instead of a Core Text layout and
    /// rasterization pass per glyph. Profiling 24 rolling views showed the
    /// per-glyph `NSAttributedString.draw` dominating the main thread.
    func image(_ text: String, role: GlyphRole) -> UIImage? {
      let key = ImageKey(font: fontTag(role), color: colorKey, scale: renderScale, text: text, role: role)
      if let cached = Self.sharedImages[key] { return cached }
      let string = attributed(text, role: role)
      let size = string.size()
      guard size.width > 0, size.height > 0 else { return nil }
      let format = UIGraphicsImageRendererFormat()
      format.scale = renderScale
      format.opaque = false
      let bounds = CGSize(width: ceil(size.width), height: ceil(size.height))
      let image = UIGraphicsImageRenderer(size: bounds, format: format).image { _ in
        string.draw(at: .zero)
      }
      if Self.sharedImages.count >= Self.sharedCapacity { Self.sharedImages.removeAll(keepingCapacity: true) }
      Self.sharedImages[key] = image
      return image
    }

    /// The digit out of focus, for the numeric transition: the sharp glyph
    /// blurred by `numericBlur` line heights, padded so nothing is cut off,
    /// rendered once per font, colour and density and shared like the sharp
    /// one. A transitioning glyph is its sharp and its blurred image
    /// cross-faded, which is a fixed cost per frame instead of a blur pass.
    func blurredImage(_ text: String) -> UIImage? {
      let key = ImageKey(font: fontTag(.digit), color: colorKey, scale: renderScale, text: text, role: .digit)
      if let cached = Self.sharedBlurred[key] { return cached }
      guard let sharp = image(text, role: .digit), let cg = sharp.cgImage else { return nil }
      let sigma = lineHeight * RollingNumberView.numericBlur * renderScale
      let pad = ceil(sigma * 3)
      let input = CIImage(cgImage: cg)
      let output = input.clampedToExtent().applyingGaussianBlur(sigma: sigma).cropped(to: input.extent.insetBy(dx: -pad, dy: -pad))
      guard let blurred = Self.ciContext.createCGImage(output, from: output.extent) else { return nil }
      let image = UIImage(cgImage: blurred, scale: renderScale, orientation: .up)
      if Self.sharedBlurred.count >= 64 { Self.sharedBlurred.removeAll(keepingCapacity: true) }
      Self.sharedBlurred[key] = image
      return image
    }

    /// The glyph in another colour, for the change flash: the same raster as
    /// `image` with the tint baked in, composited over the glyph at the flash's
    /// opacity. Made once per font, density and tint.
    func tintedImage(_ text: String, tint: UIColor) -> UIImage? {
      var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
      tint.getRed(&r, green: &g, blue: &b, alpha: &a)
      let tintKey = (UInt32(max(0, min(1, a)) * 255) << 24) | (UInt32(max(0, min(1, r)) * 255) << 16) | (UInt32(max(0, min(1, g)) * 255) << 8) | UInt32(max(0, min(1, b)) * 255)
      let key = TintKey(image: ImageKey(font: fontTag(.digit), color: colorKey, scale: renderScale, text: text, role: .digit), tint: tintKey)
      if let cached = Self.sharedTinted[key] { return cached }
      let string = NSAttributedString(string: text, attributes: [.font: digit, .foregroundColor: tint])
      let size = string.size()
      guard size.width > 0, size.height > 0 else { return nil }
      let format = UIGraphicsImageRendererFormat()
      format.scale = renderScale
      format.opaque = false
      let image = UIGraphicsImageRenderer(size: CGSize(width: ceil(size.width), height: ceil(size.height)), format: format).image { _ in
        string.draw(at: .zero)
      }
      if Self.sharedTinted.count >= 128 { Self.sharedTinted.removeAll(keepingCapacity: true) }
      Self.sharedTinted[key] = image
      return image
    }

    /// A digit's outline for the morph transition: CoreText's glyph path,
    /// flattened, in the line box's coordinates (y down, the glyph centred in
    /// `digitWidth`, its baseline at the font's ascender), normalized once by
    /// `GlyphMorph` so two digits interpolate point to point.
    func outline(of digit: Int) -> [Double] {
      let key = OutlineKey(font: fontTag(.digit) + "|\(renderScale)", digit: digit)
      if let cached = Self.sharedOutlines[key] { return cached }
      var points: [Double] = []
      var sizes: [Int32] = []
      let text = String(digit)
      let ctFont = self.digit as CTFont
      var unichars = Array(text.utf16)
      var glyphs = [CGGlyph](repeating: 0, count: unichars.count)
      let offsetX = Double((digitWidth - width(of: text, role: .digit)) / 2)
      let baseline = Double(self.digit.ascender)
      if CTFontGetGlyphsForCharacters(ctFont, &unichars, &glyphs, unichars.count), let path = CTFontCreatePathForGlyph(ctFont, glyphs[0], nil) {
        var current = CGPoint.zero
        var start = CGPoint.zero
        var contour = 0
        func add(_ p: CGPoint) {
          points.append(Double(p.x) + offsetX)
          points.append(baseline - Double(p.y))
          contour += 1
        }
        func flush() {
          if contour > 0 { sizes.append(Int32(contour)) }
          contour = 0
        }
        path.applyWithBlock { element in
          let e = element.pointee
          switch e.type {
          case .moveToPoint:
            flush()
            current = e.points[0]
            start = current
            add(current)
          case .addLineToPoint:
            current = e.points[0]
            add(current)
          case .addQuadCurveToPoint:
            let c = e.points[0], p = e.points[1]
            for i in 1...8 {
              let t = CGFloat(i) / 8
              let x = (1 - t) * (1 - t) * current.x + 2 * (1 - t) * t * c.x + t * t * p.x
              let y = (1 - t) * (1 - t) * current.y + 2 * (1 - t) * t * c.y + t * t * p.y
              add(CGPoint(x: x, y: y))
            }
            current = p
          case .addCurveToPoint:
            let c1 = e.points[0], c2 = e.points[1], p = e.points[2]
            for i in 1...8 {
              let t = CGFloat(i) / 8
              let u = 1 - t
              let x = u * u * u * current.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p.x
              let y = u * u * u * current.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p.y
              add(CGPoint(x: x, y: y))
            }
            current = p
          case .closeSubpath:
            current = start
            flush()
          @unknown default:
            break
          }
        }
        flush()
      }
      var out = [Double](repeating: 0, count: sizes.count * RollingNumberView.morphContourDoubles)
      let contours = points.withUnsafeBufferPointer { p in
        sizes.withUnsafeBufferPointer { z in
          out.withUnsafeMutableBufferPointer { o in
            Int(GlyphMorph.normalize(p.baseAddress, z.baseAddress, Int32(sizes.count), o.baseAddress))
          }
        }
      }
      out.removeLast(out.count - contours * RollingNumberView.morphContourDoubles)
      if Self.sharedOutlines.count >= 64 { Self.sharedOutlines.removeAll(keepingCapacity: true) }
      Self.sharedOutlines[key] = out
      return out
    }

    /// A wheel's whole digit strip as one image: slots for index -1 (blank) to
    /// 10 (the 0 that follows 9 on a wrap), each `lineHeight` tall with the
    /// digit centred in `digitWidth`. A wheel layer shows one slot-high window
    /// of it and just moves the strip, so a roll is a position change.
    func strip(blankZero: Bool) -> UIImage? {
      let key = StripKey(font: fontTag(.digit), color: colorKey, scale: renderScale, blankZero: blankZero)
      if let cached = Self.sharedStrips[key] { return cached }
      guard digitWidth > 0, lineHeight > 0 else { return nil }
      let format = UIGraphicsImageRendererFormat()
      format.scale = renderScale
      format.opaque = false
      let size = CGSize(width: ceil(digitWidth), height: lineHeight * CGFloat(Self.stripSlots))
      let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
        for slot in 0..<Self.stripSlots {
          let index = slot - 1
          if index < 0 || (blankZero && index == 0) { continue }
          let text = String(index % 10)
          let w = width(of: text, role: .digit)
          attributed(text, role: .digit).draw(at: CGPoint(x: (digitWidth - w) / 2, y: CGFloat(slot) * lineHeight))
        }
      }
      if Self.sharedStrips.count >= 64 { Self.sharedStrips.removeAll(keepingCapacity: true) }
      Self.sharedStrips[key] = image
      return image
    }

    /// How far `text`'s ink hangs below the baseline (0 for digits and capitals).
    func inkDescent(_ text: String, role: GlyphRole) -> CGFloat {
      let key = GlyphKey(text: text, role: role)
      if let cached = inkDescentCache[key] { return cached }
      let line = CTLineCreateWithAttributedString(attributed(text, role: role))
      let bounds = CTLineGetImageBounds(line, nil)
      let descent = bounds.isNull ? 0 : max(0, -bounds.minY)
      inkDescentCache[key] = descent
      return descent
    }

    /// Top of the glyph's line box for `role` drawing `text`, given the top of the digit line box.
    func top(for role: GlyphRole, text: String, lineTop: CGFloat) -> CGFloat {
      guard role != .digit else { return lineTop }
      let f = font(for: role)
      switch role == .prefix ? prefixAlign : suffixAlign {
      case .baseline:
        return lineTop + (digit.ascender - f.ascender)
      case .center:
        return lineTop + (digit.lineHeight - f.lineHeight) / 2
      case .top:
        return lineTop + (digit.ascender - digit.capHeight) - (f.ascender - f.capHeight)
      case .bottom:
        // Pin the bottom of the ink, not of the line boxes: the digits' ink ends
        // on the baseline, so "USD" sits on it too instead of hanging down to
        // where a comma's tail reaches.
        let affixBaseline = lineTop + digit.ascender + inkDescent("0123456789", role: .digit) - inkDescent(text, role: role)
        return affixBaseline - f.ascender
      }
    }
  }

  // MARK: - State

  private var engine = Engine()
  private lazy var fonts = FontSet(Typography(), traits: traitCollection)
  private var fontScale: CGFloat = 1
  /// Reused every frame so the render path stops allocating once warm.
  private var wheelBuffer: [Engine.Wheel] = []
  private var elementBuffer: [Element] = []
  private var settledWheels: [Engine.Wheel] = []
  private var settledBuffer: [Element] = []
  /// The affixes split from the space they keep against the digits (RTL only),
  /// recomputed when the format or the direction changes.
  private var affixBlocks = AffixBlocks(prefix: "", suffix: "", rtl: false)
  private var displayLink: CADisplayLink?
  private var lastReportedSize: CGSize = .zero

  /// Scaled and aligned container for the element layers.
  private let contentLayer = CALayer()
  /// One entry per laid-out element, in drawing order.
  private var slots: [ElementLayer] = []
  /// True while the loading glint is visible and frames go through `draw(_:)`.
  private var usesBitmap = false

  private enum LayerKind: Equatable {
    case wheel
    case glyph(String, GlyphRole)
  }

  /// The numeric transition's layers of one wheel: the leaving glyph and the
  /// arriving one, each as its sharp and its blurred image (the blurred copy
  /// fades in as a glyph goes out of focus). Made the first time the wheel
  /// swaps, hidden whenever it is settled.
  private final class SwapLayers {
    let outSharp = CALayer()
    let outBlur = CALayer()
    let inSharp = CALayer()
    let inBlur = CALayer()
    var outGlyph = -2
    var inGlyph = -2
    var hidden = true
    var all: [CALayer] { [outBlur, outSharp, inBlur, inSharp] }

    init(scale: CGFloat) {
      for layer in all {
        layer.contentsScale = scale
        layer.isHidden = true
      }
    }
  }

  /// The split-flap's layers of one wheel: the next card's top half and the
  /// current card's bottom half, static, and the flap (the current card's top
  /// on its front, the next card's bottom on its back) turning about the
  /// centre line with perspective. Each half is a clipped container holding
  /// the whole glyph image.
  private final class FlipLayers {
    let topNext = CALayer()
    let bottomCurrent = CALayer()
    let flapFront = CALayer()
    let flapBack = CALayer()
    let hinge = CALayer()
    let images: [CALayer] = [CALayer(), CALayer(), CALayer(), CALayer()]
    var glyphs = [-2, -2, -2, -2]
    var hidden = true
    var halves: [CALayer] { [topNext, bottomCurrent, flapFront, flapBack] }

    init(scale: CGFloat) {
      for (half, image) in zip(halves, images) {
        half.masksToBounds = true
        image.contentsScale = scale
        half.addSublayer(image)
        half.isHidden = true
      }
      hinge.isHidden = true
    }
  }

  /// The morph transition's layer of one wheel: the interpolated outline, filled even-odd.
  private final class MorphLayer {
    let shape = CAShapeLayer()
    var buffer: [Double] = []
    var hidden = true
    init() {
      shape.fillRule = .evenOdd
      shape.isHidden = true
    }
  }

  private struct ElementLayer {
    var kind: LayerKind
    var layer: CALayer
    /// Wheels only: which strip variant the layer currently shows.
    var blankZero: Bool
    /// Wheels only: the numeric transition's layers, once the wheel has swapped.
    var swap: SwapLayers?
    /// Wheels only: the split-flap's layers, once the wheel has flipped.
    var flip: FlipLayers?
    /// Wheels only: the morph's layer, once the wheel has morphed.
    var morph: MorphLayer?
    /// Wheels only: the change flash, a tinted glyph over the one showing.
    var flashLayer: CALayer?
    var flashGlyph = -2
    var flashTint: UInt32 = 0
    /// Glyphs only: the image's top within the line box, fixed for the font set.
    var glyphTop: CGFloat
    /// What the layers were last given, so a frame only touches what moved:
    /// every Core Animation setter costs a transaction entry and a KVO round
    /// trip even when the value is the same, and most of a number's layers
    /// (affixes, separators, wheels that are not rolling) do not move.
    var frame = CGRect.null
    var innerFrame = CGRect.null
    var opacity: Float = -1
  }

  private struct AffixBlocks {
    let prefix: String
    let suffix: String
    let rtl: Bool
    let prefixInk: String
    let prefixGap: String
    let suffixInk: String
    let suffixGap: String

    init(prefix: String, suffix: String, rtl: Bool) {
      self.prefix = prefix
      self.suffix = suffix
      self.rtl = rtl
      let p = rtl ? RollingNumberView.splitAffix(prefix, spaceAtEnd: true) : (ink: prefix, gap: "")
      let s = rtl ? RollingNumberView.splitAffix(suffix, spaceAtEnd: false) : (ink: suffix, gap: "")
      prefixInk = p.ink
      prefixGap = p.gap
      suffixInk = s.ink
      suffixGap = s.gap
    }
  }

  // MARK: - Lifecycle

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    contentMode = .redraw
    contentLayer.anchorPoint = .zero
    contentLayer.contentsScale = fonts.renderScale
    layer.addSublayer(contentLayer)
    // Not clipped: in auto-size mode a new leading digit can draw past the old
    // frame for the one render it takes JS to apply the reported size, instead
    // of being cut off. Nothing else about the roll touches the JS thread.
    clipsToBounds = false
    isAccessibilityElement = true
    accessibilityTraits = .staticText
    NotificationCenter.default.addObserver(
      self, selector: #selector(contentSizeCategoryDidChange),
      name: UIContentSizeCategory.didChangeNotification, object: nil
    )
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    displayLink?.invalidate()
    NotificationCenter.default.removeObserver(self)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // The shrink-to-fit scale and alignment depend on the bounds.
    render()
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    // The glyph images bake the resolved text color and the pixel density in:
    // a light/dark switch (`.label` is dynamic) or a move to another display
    // re-rasterizes them.
    let resolved = typography.color.resolvedColor(with: traitCollection)
    if resolved != fonts.color || max(1, traitCollection.displayScale) != fonts.renderScale {
      rebuildFonts()
    }
  }

  @objc private func contentSizeCategoryDidChange() {
    guard typography.allowFontScaling else { return }
    rebuildFonts()
  }

  func stopAnimation() {
    stopDisplayLink()
  }

  /// Fabric dropped the view. Its component view goes to Fabric's recycle
  /// pool and the hybrid lives on until the JS handle to it is collected, so
  /// everything that could outlive the drop stops here and everything
  /// sizeable is let go of: the display link, the element layers, the engine's
  /// wheels and the buffers. The glyph images are shared and stay cached. The
  /// view stays usable: `resetForRecycle` and a new element's props may follow.
  func release() {
    stopDisplayLink()
    engine.reset()
    clearSlots()
    wheelBuffer = []
    elementBuffer = []
    settledWheels = []
    settledBuffer = []
    usesBitmap = false
    layer.contents = nil
  }

  /// What one mounted rolling number costs, for the JS garbage collector
  /// (Nitro's `memorySize`). Measured, not estimated: the example's
  /// `footprint` benchmark mounts 100 copies, asks malloc to return freed
  /// pages before and with them, and divides the difference, on the first
  /// mount (Fabric hands later mounts the pooled views of earlier ones).
  /// iPhone 11 Pro and 13 Pro Max, 2026-09-22: 60–80 KB of malloc (layers,
  /// engine, buffers) and a 70–90 KB physical footprint per copy; a plain
  /// `Text` is 28 KB of malloc and 120–130 KB of footprint, its backing
  /// store. The layers' render-server side is not in this process and not
  /// counted. A constant, because Nitro reads it from the JS thread.
  static let memoryEstimateBytes = 64 * 1024

  /// Returns the view to its pristine state so Fabric can reuse it for a new
  /// element (`RecyclableView`). Props are re-applied by Nitro afterwards.
  func resetForRecycle() {
    stopDisplayLink()
    engine.reset()
    fontScale = 1
    lastReportedSize = .zero
    pendingSizeReport = false
    format = Format()
    typography = Typography()
    timing = Timing()
    shimmer = Shimmer()
    alignment = .auto
    revealMilestones = []
    // `onIntrinsicSizeChange`, `onRevealEnd` and `onRevealMilestone` are the
    // hybrid's wiring, not the element's props: they stay across recycling
    // (the hybrid clears its own callback props).
    clearSlots()
    layer.contents = nil
    usesBitmap = false
    contentLayer.isHidden = false
  }

  // MARK: - Public API

  /// Shows `value` immediately with continuously positioned wheels (odometer
  /// style). Cancels any running roll. Intended to be called every frame.
  func setValue(_ value: Double) {
    engine.setValue(value)
    reportIntrinsicSize()
    updateDisplayLinkNeed()
    render()
  }

  /// Rolls every wheel to `value` (snaps on first show, duration 0 or Reduce Motion).
  func animate(to value: Double) {
    engine.setReduceMotion(UIAccessibility.isReduceMotionEnabled)
    engine.animateTo(value, CACurrentMediaTime())
    reportIntrinsicSize()
    updateDisplayLinkNeed()
    // A roll is rendered by the display link's next tick, within a frame; a
    // value that snapped (duration 0, Reduce Motion, nothing shown yet) has
    // no tick coming and is rendered now. Rendering here as well doubled the
    // main-thread work of a value stream (24 views fed every frame: two layer
    // passes per view per frame).
    if displayLink == nil { render() }
  }

  /// Shows the opening frame of a jackpot reveal for `value` ("$0.00" in the
  /// target's layout), waiting for `reveal(to:)`.
  func holdReveal(_ value: Double) {
    engine.holdReveal(value)
    reportIntrinsicSize()
    updateDisplayLinkNeed()
    render()
  }

  /// Counts up from 0 to `value` and lands with a pop (snaps under Reduce Motion).
  func reveal(to value: Double) {
    engine.setReduceMotion(UIAccessibility.isReduceMotionEnabled)
    engine.reveal(value, CACurrentMediaTime())
    reportIntrinsicSize()
    updateDisplayLinkNeed()
    render()
    reportMilestones(reachedBefore: 0)
    if !engine.isRevealing() {
      // Snapped (Reduce Motion / duration 0): the reveal is over before it began.
      onRevealEnd?()
    }
  }

  /// Fires `onRevealMilestone` for every milestone reached since `reachedBefore`.
  private func reportMilestones(reachedBefore: Int) {
    let reached = Int(engine.revealMilestonesReached())
    guard reached > reachedBefore, let onRevealMilestone else { return }
    for index in reachedBefore..<reached {
      onRevealMilestone(index, engine.revealMilestoneValue(Int32(index)))
    }
  }

  /// Re-sends the last reported intrinsic size (e.g. after a listener was attached).
  func resendIntrinsicSize() {
    guard lastReportedSize != .zero else { return }
    onIntrinsicSizeChange?(lastReportedSize)
  }

  // MARK: - Display link

  fileprivate func step(_ link: CADisplayLink) {
    let wasRevealing = engine.isRevealing()
    let reachedBefore = Int(engine.revealMilestonesReached())
    _ = engine.tick(CACurrentMediaTime())
    if pendingSizeReport, !engine.isRolling() {
      reportIntrinsicSize()
    }
    updateDisplayLinkNeed()
    render()
    if wasRevealing {
      reportMilestones(reachedBefore: reachedBefore)
      if !engine.isRevealing() {
        onRevealEnd?()
      }
    }
  }

  /// Keeps the display link alive only while the engine says something moves.
  private func updateDisplayLinkNeed() {
    if engine.needsFrames() {
      startDisplayLink()
    } else {
      stopDisplayLink()
    }
  }

  private func startDisplayLink() {
    guard displayLink == nil else { return }
    let proxy = DisplayLinkProxy(target: self)
    let link = CADisplayLink(target: proxy, selector: #selector(DisplayLinkProxy.tick(_:)))
    // A ProMotion panel runs at 120 Hz only while something asks for it; a
    // display link left at its default gets 60 there, and so did the roll.
    // Ask for the panel's maximum (like a Reanimated animation does) so a roll
    // is as smooth as the screen allows; the link only lives while wheels move.
    if #available(iOS 15.0, *) {
      let maxFps = (window?.screen ?? UIScreen.main).maximumFramesPerSecond
      if maxFps > 60 {
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: Float(maxFps), preferred: Float(maxFps))
      }
    }
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func stopDisplayLink() {
    displayLink?.invalidate()
    displayLink = nil
  }

  private final class DisplayLinkProxy: NSObject {
    weak var target: RollingNumberView?
    init(target: RollingNumberView) { self.target = target }
    @objc func tick(_ link: CADisplayLink) { target?.step(link) }
  }

  // MARK: - Typography

  private func rebuildFonts() {
    fonts = FontSet(typography, traits: traitCollection)
    contentLayer.contentsScale = fonts.renderScale
    fontScale = 1
    // Every cached glyph image belongs to the old font set.
    clearSlots()
    if engine.hasShownValue() {
      reportIntrinsicSize()
    }
    render()
  }

  /// Shrink-to-fit scale for the current bounds and the content as it is drawn
  /// *right now* (including half-appeared wheels): the amount shrinks and grows
  /// continuously in step with the roll and never overflows.
  private func updateFontScale(contentWidth: CGFloat) {
    var scale: CGFloat = 1
    if typography.adjustsFontSizeToFit, bounds.width > 0, contentWidth > bounds.width {
      scale = max(min(1, typography.minimumFontScale), bounds.width / contentWidth)
    }
    fontScale = scale
  }

  /// Dynamic Type multiplier for `allowFontScaling`, capped by `maxFontSizeMultiplier`.
  private static func systemFontMultiplier(_ t: Typography) -> CGFloat {
    guard t.allowFontScaling else { return 1 }
    let multiplier = UIFontMetrics(forTextStyle: .body).scaledValue(for: 100) / 100
    if t.maxFontSizeMultiplier > 0 {
      return min(multiplier, t.maxFontSizeMultiplier)
    }
    return multiplier
  }

  private static func makeFont(size: CGFloat, weight: CGFloat, family: String?) -> UIFont {
    let uiWeight = uiWeight(weight)
    let traits: [UIFontDescriptor.TraitKey: Any] = [.weight: uiWeight]
    var base: UIFont
    if let family, !family.isEmpty, let named = UIFont(name: family, size: size) {
      // A face name ("Inter-Bold") or a family UIKit resolves directly; pick the face for `weight`.
      let descriptor = named.fontDescriptor.addingAttributes([.traits: traits])
      base = UIFont(descriptor: descriptor, size: size)
    } else if let family, !family.isEmpty, !UIFont.fontNames(forFamilyName: family).isEmpty {
      // A family name registered through UIAppFonts (e.g. via expo-font): match by weight like <Text>.
      let descriptor = UIFontDescriptor(fontAttributes: [.family: family, .traits: traits])
      base = UIFont(descriptor: descriptor, size: size)
    } else {
      base = UIFont.systemFont(ofSize: size, weight: uiWeight)
    }
    // Tabular (monospaced) digits so every column has the same width.
    let feature: [UIFontDescriptor.FeatureKey: Int]
    if #available(iOS 15.0, *) {
      feature = [.type: kNumberSpacingType, .selector: kMonospacedNumbersSelector]
    } else {
      feature = [.featureIdentifier: kNumberSpacingType, .typeIdentifier: kMonospacedNumbersSelector]
    }
    let descriptor = base.fontDescriptor.addingAttributes([.featureSettings: [feature]])
    return UIFont(descriptor: descriptor, size: size)
  }

  private static func uiWeight(_ w: CGFloat) -> UIFont.Weight {
    switch w {
    case ..<150: return .ultraLight
    case ..<250: return .thin
    case ..<350: return .light
    case ..<450: return .regular
    case ..<550: return .medium
    case ..<650: return .semibold
    case ..<750: return .bold
    case ..<850: return .heavy
    default: return .black
    }
  }

  // MARK: - Layout

  private enum ElementKind {
    case wheel(Int)
    case glyph(String, GlyphRole)
  }

  private struct Element {
    var kind: ElementKind
    var width: CGFloat
    var fullWidth: CGFloat
    var factor: Double
  }

  /// Pulls the engine's wheels into `wheelBuffer`.
  private func syncWheels() {
    wheelBuffer.removeAll(keepingCapacity: true)
    let count = Int(engine.wheelCount())
    for index in 0..<count {
      wheelBuffer.append(engine.wheelAt(Int32(index)))
    }
  }

  /// Lays the run out into `elements` (emptied first, capacity kept).
  private func buildElements(into elements: inout [Element], wheels: [Engine.Wheel], signFactor: Double) {
    elements.removeAll(keepingCapacity: true)
    let fonts = self.fonts
    let fd = format.fractionDigits

    func addGlyph(_ text: String, role: GlyphRole, factor: Double) {
      guard !text.isEmpty, factor > 0 else { return }
      let width = fonts.width(of: text, role: role)
      elements.append(Element(kind: .glyph(text, role), width: width * CGFloat(factor), fullWidth: width, factor: factor))
    }

    // Under a right-to-left layout the prefix belongs at the start edge - the
    // right - and the suffix at the end, while the digits stay a left-to-right
    // run: a number reads the same way in every script. So the run is laid out
    // block by block in mirror order, each block keeping its own order, and the
    // space an affix keeps against the digits stays against them: " USD" after
    // the number is "USD " before it.
    let rtl = isRTL
    if affixBlocks.rtl != rtl || affixBlocks.prefix != format.prefix || affixBlocks.suffix != format.suffix {
      affixBlocks = AffixBlocks(prefix: format.prefix, suffix: format.suffix, rtl: rtl)
    }
    let affixes = affixBlocks
    if rtl {
      addGlyph(affixes.suffixInk, role: .suffix, factor: 1)
      addGlyph(affixes.suffixGap, role: .suffix, factor: 1)
    } else {
      // Sign first, then the currency prefix: "-$1,234.50".
      addGlyph("-", role: .digit, factor: signFactor)
      addGlyph(affixes.prefixInk, role: .prefix, factor: 1)
    }
    var power = wheels.count - 1
    while power >= 0 {
      let wheel = wheels[power]
      if wheel.width > 0 {
        elements.append(Element(kind: .wheel(power), width: fonts.digitWidth * CGFloat(wheel.width), fullWidth: fonts.digitWidth, factor: wheel.width))
      }
      if power > fd, (power - fd) % 3 == 0 {
        addGlyph(format.groupingSeparator, role: .digit, factor: wheel.width)
      }
      if fd > 0, power == fd {
        addGlyph(format.decimalSeparator, role: .digit, factor: 1)
      }
      power -= 1
    }
    if rtl {
      addGlyph(affixes.prefixGap, role: .prefix, factor: 1)
      addGlyph(affixes.prefixInk, role: .prefix, factor: 1)
      addGlyph("-", role: .digit, factor: signFactor)
    } else {
      addGlyph(affixes.suffixInk, role: .suffix, factor: 1)
    }
  }

  /// The layout direction this view is in. The hybrid sets
  /// `semanticContentAttribute` from the `rightToLeft` prop, since Fabric
  /// never hands a Hybrid View its resolved direction.
  var isRTL: Bool { effectiveUserInterfaceLayoutDirection == .rightToLeft }

  /// `.auto` resolved against the layout direction; the rest are already absolute.
  private var resolvedAlignment: Alignment {
    alignment == .auto ? (isRTL ? .right : .left) : alignment
  }

  private static let affixSpaces: Set<Unicode.Scalar> = [" ", "\u{A0}", "\u{2009}", "\u{202F}"]

  /// Splits an affix from the space it keeps against the digits: a prefix's
  /// trailing run, a suffix's leading one. An affix that is all space is one
  /// block.
  private static func splitAffix(_ text: String, spaceAtEnd: Bool) -> (ink: String, gap: String) {
    let scalars = Array(text.unicodeScalars)
    var n = 0
    while n < scalars.count, affixSpaces.contains(spaceAtEnd ? scalars[scalars.count - 1 - n] : scalars[n]) {
      n += 1
    }
    guard n > 0, n < scalars.count else { return (text, "") }
    let cut = spaceAtEnd ? scalars.count - n : n
    let head = String(String.UnicodeScalarView(scalars[0..<cut]))
    let tail = String(String.UnicodeScalarView(scalars[cut...]))
    return spaceAtEnd ? (ink: head, gap: tail) : (ink: tail, gap: head)
  }

  private func settledWidth() -> CGFloat {
    let count = Int(engine.settledPowerCount())
    settledWheels.removeAll(keepingCapacity: true)
    for _ in 0..<count {
      settledWheels.append(Engine.Wheel(position: 0, width: 1, linear: false, blankZero: false, fromGlyph: -1, toGlyph: -1, blend: 1, fromAbove: true, flash: 0, flashUp: true))
    }
    buildElements(into: &settledBuffer, wheels: settledWheels, signFactor: engine.settledNegative() ? 1 : 0)
    return settledBuffer.reduce(CGFloat(0)) { $0 + $1.width }
  }

  /// Formats the target the way it is displayed, for VoiceOver.
  private func accessibleText() -> String {
    let fd = format.fractionDigits
    var digits = ""
    var power = Int(engine.settledPowerCount()) - 1
    while power >= 0 {
      digits += String(engine.targetDigit(Int32(power)))
      if power > fd, (power - fd) % 3 == 0 {
        digits += format.groupingSeparator
      }
      if fd > 0, power == fd {
        digits += format.decimalSeparator
      }
      power -= 1
    }
    return (engine.settledNegative() ? "-" : "") + format.prefix + digits + format.suffix
  }

  // VoiceOver reads the settled figure when it asks for it, so a value update
  // (which can come every frame) formats nothing.
  override var accessibilityLabel: String? {
    get { engine.hasShownValue() ? accessibleText() : nil }
    set {}
  }

  override var accessibilityValue: String? {
    get { loading ? "Loading" : nil }
    set {}
  }

  /// A narrower settled size waiting for the current roll to finish before it is reported.
  private var pendingSizeReport = false

  private func reportIntrinsicSize() {
    // The reported size is always the full-size one: with shrink-to-fit the view
    // keeps its height and the scaled number is centred inside it when drawing.
    let size = CGSize(width: ceil(settledWidth()), height: fonts.lineHeight)
    guard abs(size.width - lastReportedSize.width) > 0.01 || abs(size.height - lastReportedSize.height) > 0.01 else {
      pendingSizeReport = false
      return
    }
    // Growing: report right away so React widens the box before the new digit has
    // fully appeared (the view is not clipped meanwhile). Shrinking mid-roll: keep
    // the wider box until the roll has finished, otherwise adjustsFontSizeToFit
    // would squeeze the still-rolling digits into the smaller box and the whole
    // amount would visibly shrink and grow back.
    if lastReportedSize != .zero, size.width < lastReportedSize.width, engine.isRolling() {
      pendingSizeReport = true
      return
    }
    pendingSizeReport = false
    lastReportedSize = size
    onIntrinsicSizeChange?(size)
  }

  // MARK: - Rendering (layers)

  /// Renders the current engine state: layers normally, `draw(_:)` while the
  /// loading glint is showing.
  private func render() {
    guard engine.hasShownValue() else {
      clearSlots()
      return
    }
    let wantBitmap = engine.loadingProgress() > 0
    if wantBitmap != usesBitmap {
      usesBitmap = wantBitmap
      contentLayer.isHidden = wantBitmap
      if !wantBitmap {
        layer.contents = nil
      }
    }
    if usesBitmap {
      setNeedsDisplay()
    } else {
      renderLayers()
    }
  }

  private func clearSlots() {
    for slot in slots {
      slot.layer.removeFromSuperlayer()
    }
    slots = []
  }

  private func renderLayers() {
    let fonts = self.fonts
    syncWheels()
    buildElements(into: &elementBuffer, wheels: wheelBuffer, signFactor: engine.signFactor())
    let wheels = wheelBuffer
    let elements = elementBuffer
    let total = elements.reduce(CGFloat(0)) { $0 + $1.width }
    updateFontScale(contentWidth: total)
    let placement = contentPlacement(total: total, lineHeight: fonts.lineHeight)

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }

    let contentBounds = CGRect(x: 0, y: 0, width: max(total, 1), height: fonts.lineHeight)
    if contentLayer.bounds != contentBounds { contentLayer.bounds = contentBounds }
    if contentLayer.position != placement.origin { contentLayer.position = placement.origin }
    let contentTransform = placement.scale == 1 ? CATransform3DIdentity : CATransform3DMakeScale(placement.scale, placement.scale, 1)
    if !CATransform3DEqualToTransform(contentLayer.transform, contentTransform) { contentLayer.transform = contentTransform }

    syncSlots(with: elements, wheels: wheels, fonts: fonts)

    var x: CGFloat = 0
    for (i, element) in elements.enumerated() {
      let slot = slots[i]
      let frame = CGRect(x: x, y: 0, width: element.width, height: fonts.lineHeight)
      if slot.frame != frame {
        slot.layer.frame = frame
        slots[i].frame = frame
      }
      switch element.kind {
      case .wheel(let index):
        let wheel = wheels[index]
        let opacity = Float(wheel.width)
        if slot.opacity != opacity {
          slot.layer.opacity = opacity
          slots[i].opacity = opacity
        }
        let strip = slot.layer.sublayers?.first
        let style = timing.transition
        let swapping = wheel.blend < 1
        // Whichever swap style is drawing, the strip stays put underneath, hidden.
        if swapping && style == .flip {
          let flip: FlipLayers
          if let existing = slot.flip {
            flip = existing
          } else {
            flip = FlipLayers(scale: fonts.renderScale)
            for layer in flip.halves { slot.layer.addSublayer(layer) }
            slot.layer.addSublayer(flip.hinge)
            slots[i].flip = flip
          }
          layoutFlip(flip, wheel: wheel, fonts: fonts, cellWidth: element.width)
        } else if let flip = slot.flip, !flip.hidden {
          for layer in flip.halves { layer.isHidden = true }
          flip.hinge.isHidden = true
          flip.hidden = true
        }
        if swapping && style == .morph {
          let morph: MorphLayer
          if let existing = slot.morph {
            morph = existing
          } else {
            morph = MorphLayer()
            slot.layer.addSublayer(morph.shape)
            slots[i].morph = morph
          }
          layoutMorph(morph, wheel: wheel, fonts: fonts, cellWidth: element.width)
        } else if let morph = slot.morph, !morph.hidden {
          morph.shape.isHidden = true
          morph.hidden = true
        }
        if swapping && style != .flip && style != .morph {
          let swap: SwapLayers
          if let existing = slot.swap {
            swap = existing
          } else {
            swap = SwapLayers(scale: fonts.renderScale)
            for layer in swap.all { slot.layer.addSublayer(layer) }
            slots[i].swap = swap
          }
          layoutSwap(swap, wheel: wheel, fonts: fonts, cellWidth: element.width)
        } else if let swap = slot.swap, !swap.hidden {
          for layer in swap.all { layer.isHidden = true }
          swap.hidden = true
        }
        if let strip, strip.isHidden != swapping { strip.isHidden = swapping }
        layoutFlash(slotIndex: i, wheel: wheel, fonts: fonts, cellWidth: element.width)
        if let strip {
          if slot.blankZero != wheel.blankZero {
            strip.contents = fonts.strip(blankZero: wheel.blankZero)?.cgImage
            slots[i].blankZero = wheel.blankZero
          }
          // Linear strips run from -1 (blank) to 9; a roll can be any real, so wrap it onto 0..<10.
          let position = wheel.linear ? wheel.position : Self.wrap10(wheel.position)
          let stripFrame = CGRect(
            x: element.width - fonts.digitWidth,
            y: -(position + 1) * fonts.lineHeight,
            width: strip.bounds.width,
            height: strip.bounds.height
          )
          if slot.innerFrame != stripFrame {
            strip.frame = stripFrame
            slots[i].innerFrame = stripFrame
          }
        }
      case .glyph:
        let opacity = Float(element.factor)
        if slot.opacity != opacity {
          slot.layer.opacity = opacity
          slots[i].opacity = opacity
        }
        if let image = slot.layer.sublayers?.first {
          let imageFrame = CGRect(
            x: element.width - element.fullWidth,
            y: slot.glyphTop,
            width: image.bounds.width,
            height: image.bounds.height
          )
          if slot.innerFrame != imageFrame {
            image.frame = imageFrame
            slots[i].innerFrame = imageFrame
          }
        }
      }
      x += element.width
    }
  }

  // The numeric transition's geometry, in line heights; mirrors
  // `RollingEngine::kNumeric*`, where the effect is described.
  static let numericOffset: CGFloat = 0.4
  static let numericScale: CGFloat = 0.6
  static let numericBlur: CGFloat = 0.16

  /// Places the leaving and the arriving glyph of a swapping wheel for this
  /// frame: each scaled about its centre, offset along the axis, faded, and
  /// cross-faded with its blurred image as it goes out of, or comes into, focus.
  private func layoutSwap(_ swap: SwapLayers, wheel: Engine.Wheel, fonts: FontSet, cellWidth: CGFloat) {
    let b = CGFloat(wheel.blend)
    let d: CGFloat = wheel.fromAbove ? 1 : -1
    let offset = fonts.lineHeight * Self.numericOffset
    // The digit column is right-aligned in its cell (the cell shrinks and grows from the left).
    let center = CGPoint(x: cellWidth - fonts.digitWidth / 2, y: fonts.lineHeight / 2)
    placeSwapGlyph(sharp: swap.outSharp, blur: swap.outBlur, glyph: Int(wheel.fromGlyph), shown: &swap.outGlyph, fonts: fonts,
                   center: CGPoint(x: center.x, y: center.y + d * offset * b),
                   scale: 1 - (1 - Self.numericScale) * b, alpha: 1 - b, blur: min(1, 2 * b))
    placeSwapGlyph(sharp: swap.inSharp, blur: swap.inBlur, glyph: Int(wheel.toGlyph), shown: &swap.inGlyph, fonts: fonts,
                   center: CGPoint(x: center.x, y: center.y - d * offset * (1 - b)),
                   scale: Self.numericScale + (1 - Self.numericScale) * b, alpha: b, blur: 1 - b)
    swap.hidden = false
  }

  private func placeSwapGlyph(sharp: CALayer, blur: CALayer, glyph: Int, shown: inout Int, fonts: FontSet, center: CGPoint, scale: CGFloat, alpha: CGFloat, blur amount: CGFloat) {
    guard glyph >= 0, alpha > 0.002 else {
      sharp.isHidden = true
      blur.isHidden = true
      return
    }
    if shown != glyph {
      let text = Self.digitStrings[glyph % 10]
      if let image = fonts.image(text, role: .digit) {
        sharp.contents = image.cgImage
        sharp.bounds = CGRect(origin: .zero, size: image.size)
      }
      if let image = fonts.blurredImage(text) {
        blur.contents = image.cgImage
        blur.bounds = CGRect(origin: .zero, size: image.size)
      }
      shown = glyph
    }
    let transform = CATransform3DMakeScale(scale, scale, 1)
    for (layer, layerAlpha) in [(sharp, alpha * (1 - amount)), (blur, alpha * amount)] {
      let hidden = layerAlpha <= 0.002
      if layer.isHidden != hidden { layer.isHidden = hidden }
      if hidden { continue }
      layer.position = center
      layer.transform = transform
      layer.opacity = Float(layerAlpha)
    }
  }

  /// The split-flap for this frame. `blend` is the flap's fall, 0 hanging to
  /// 1 landed; the angle eases in (the flap drops) and out (it lands).
  private func layoutFlip(_ flip: FlipLayers, wheel: Engine.Wheel, fonts: FontSet, cellWidth: CGFloat) {
    let lh = fonts.lineHeight
    let mid = lh / 2
    let b = CGFloat(wheel.blend)
    let angle = b < 0.5 ? 2 * b * b : 1 - 2 * (1 - b) * (1 - b)
    let current = Int(wheel.fromGlyph)
    let next = Int(wheel.toGlyph)
    let topRect = CGRect(x: 0, y: 0, width: cellWidth, height: mid - 0.5)
    let bottomRect = CGRect(x: 0, y: mid + 0.5, width: cellWidth, height: lh - mid - 0.5)
    // Each half shows the whole glyph image, offset so the right half of it is in view.
    func show(_ index: Int, glyph: Int, frame: CGRect, hidden: Bool) {
      let half = flip.halves[index]
      let image = flip.images[index]
      let visible = glyph >= 0 && !hidden
      if half.isHidden != !visible { half.isHidden = !visible }
      guard visible else { return }
      if flip.glyphs[index] != glyph, let img = fonts.image(Self.digitStrings[glyph % 10], role: .digit) {
        image.contents = img.cgImage
        image.bounds = CGRect(origin: .zero, size: img.size)
        flip.glyphs[index] = glyph
      }
      if half.bounds.size != frame.size { half.bounds = CGRect(origin: .zero, size: frame.size) }
      // The image sits at the column in cell space; the half's own origin is subtracted.
      let column = cellWidth - fonts.digitWidth / 2
      image.position = CGPoint(x: column - frame.origin.x, y: lh / 2 - frame.origin.y)
    }
    show(0, glyph: next, frame: topRect, hidden: false)
    show(1, glyph: current, frame: bottomRect, hidden: false)
    show(2, glyph: current, frame: topRect, hidden: angle >= 0.5)
    show(3, glyph: next, frame: bottomRect, hidden: angle < 0.5)
    // Statics sit at their frames; the flap turns about the centre line with a little perspective.
    flip.topNext.anchorPoint = CGPoint(x: 0.5, y: 0)
    flip.topNext.position = CGPoint(x: cellWidth / 2, y: 0)
    flip.bottomCurrent.anchorPoint = CGPoint(x: 0.5, y: 0)
    flip.bottomCurrent.position = CGPoint(x: cellWidth / 2, y: bottomRect.origin.y)
    var perspective = CATransform3DIdentity
    perspective.m34 = -1 / (lh * 2.5)
    flip.flapFront.anchorPoint = CGPoint(x: 0.5, y: 1)
    flip.flapFront.position = CGPoint(x: cellWidth / 2, y: mid)
    flip.flapFront.transform = CATransform3DRotate(perspective, -angle * .pi, 1, 0, 0)
    flip.flapBack.anchorPoint = CGPoint(x: 0.5, y: 0)
    flip.flapBack.position = CGPoint(x: cellWidth / 2, y: mid)
    flip.flapBack.transform = CATransform3DRotate(perspective, (1 - angle) * .pi, 1, 0, 0)
    // The moving half darkens a little as it turns away from the light.
    flip.flapFront.opacity = Float(1 - angle * 0.5)
    flip.flapBack.opacity = Float(1 - (1 - angle) * 0.5)
    for half in [flip.topNext, flip.bottomCurrent] { half.opacity = 1 }
    if flip.hinge.isHidden { flip.hinge.isHidden = false }
    flip.hinge.frame = CGRect(x: 0, y: mid - 0.5, width: cellWidth, height: 1)
    flip.hinge.backgroundColor = backgroundColor?.cgColor ?? UIColor.clear.cgColor
    flip.hidden = false
  }

  private static func mix(_ a: UIColor, _ b: UIColor, _ t: CGFloat) -> UIColor {
    var ar: CGFloat = 0, ag: CGFloat = 0, ab: CGFloat = 0, aa: CGFloat = 0
    var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 0
    a.getRed(&ar, green: &ag, blue: &ab, alpha: &aa)
    b.getRed(&br, green: &bg, blue: &bb, alpha: &ba)
    return UIColor(red: ar + (br - ar) * t, green: ag + (bg - ag) * t, blue: ab + (bb - ab) * t, alpha: aa + (ba - aa) * t)
  }

  // The morph's contour size, mirroring `GlyphMorph::kContourDoubles`.
  static let morphContourDoubles = 128

  /// The morph for this frame: the outline between the two digits, as a path.
  private func layoutMorph(_ morph: MorphLayer, wheel: Engine.Wheel, fonts: FontSet, cellWidth: CGFloat) {
    let from = Int(wheel.fromGlyph)
    let to = Int(wheel.toGlyph)
    // A blank turning into a digit (or back) is the numeric look; the morph needs two shapes.
    let a = from >= 0 ? fonts.outline(of: from) : []
    let b = to >= 0 ? fonts.outline(of: to) : []
    let ca = a.count / Self.morphContourDoubles
    let cb = b.count / Self.morphContourDoubles
    let count = max(ca, cb)
    if morph.buffer.count < count * Self.morphContourDoubles {
      morph.buffer = [Double](repeating: 0, count: count * Self.morphContourDoubles)
    }
    let t = CGFloat(wheel.blend)
    var contours = 0
    if ca > 0 && cb > 0 {
      contours = a.withUnsafeBufferPointer { pa in
        b.withUnsafeBufferPointer { pb in
          morph.buffer.withUnsafeMutableBufferPointer { o in
            Int(GlyphMorph.interpolate(pa.baseAddress, Int32(ca), pb.baseAddress, Int32(cb), Double(t), o.baseAddress))
          }
        }
      }
    } else if ca > 0 || cb > 0 {
      // One side blank: the other shape grows from, or shrinks to, its centre.
      let src = ca > 0 ? a : b
      let scale = ca > 0 ? 1 - t : t
      contours = src.count / Self.morphContourDoubles
      for c in 0..<contours {
        var cx = 0.0, cy = 0.0
        for i in 0..<64 {
          cx += src[c * Self.morphContourDoubles + 2 * i]
          cy += src[c * Self.morphContourDoubles + 2 * i + 1]
        }
        cx /= 64
        cy /= 64
        for i in 0..<64 {
          morph.buffer[c * Self.morphContourDoubles + 2 * i] = cx + (src[c * Self.morphContourDoubles + 2 * i] - cx) * Double(scale)
          morph.buffer[c * Self.morphContourDoubles + 2 * i + 1] = cy + (src[c * Self.morphContourDoubles + 2 * i + 1] - cy) * Double(scale)
        }
      }
    }
    let path = CGMutablePath()
    let columnLeft = cellWidth - fonts.digitWidth
    for c in 0..<contours {
      let base = c * Self.morphContourDoubles
      path.move(to: CGPoint(x: columnLeft + CGFloat(morph.buffer[base]), y: CGFloat(morph.buffer[base + 1])))
      for i in 1..<64 {
        path.addLine(to: CGPoint(x: columnLeft + CGFloat(morph.buffer[base + 2 * i]), y: CGFloat(morph.buffer[base + 2 * i + 1])))
      }
      path.closeSubpath()
    }
    morph.shape.path = path
    var fill = fonts.color
    if wheel.flash > 0.002, let tint = wheel.flashUp ? flash.upColor : flash.downColor {
      fill = Self.mix(fonts.color, tint, CGFloat(wheel.flash))
    }
    morph.shape.fillColor = fill.cgColor
    morph.shape.opacity = Float(wheel.width)
    if morph.shape.isHidden { morph.shape.isHidden = false }
    morph.hidden = false
  }

  /// The change flash for this frame: the glyph showing (or arriving), in the
  /// up or down colour, composited over it at the flash's opacity.
  private func layoutFlash(slotIndex i: Int, wheel: Engine.Wheel, fonts: FontSet, cellWidth: CGFloat) {
    let tint = wheel.flash > 0.002 ? (wheel.flashUp ? flash.upColor : flash.downColor) : nil
    // A flipping or morphing glyph is not a whole glyph to overlay: the morph tints its own fill, the flip lights up as it lands.
    let midway = wheel.blend < 1 && (timing.transition == .flip || timing.transition == .morph)
    guard let tint, !midway else {
      if let layer = slots[i].flashLayer, !layer.isHidden { layer.isHidden = true }
      return
    }
    let layer: CALayer
    if let existing = slots[i].flashLayer {
      layer = existing
    } else {
      layer = CALayer()
      layer.contentsScale = fonts.renderScale
      slots[i].layer.addSublayer(layer)
      slots[i].flashLayer = layer
    }
    // The glyph the flash lights: the one arriving during a swap, the one at rest otherwise.
    let glyph = wheel.blend < 1 ? Int(wheel.toGlyph) : Int((wheel.position.rounded(.toNearestOrEven)).truncatingRemainder(dividingBy: 10) + 10) % 10
    guard glyph >= 0, !(wheel.blankZero && glyph == 0) else {
      if !layer.isHidden { layer.isHidden = true }
      return
    }
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    tint.getRed(&r, green: &g, blue: &b, alpha: &a)
    let tintKey = (UInt32(max(0, min(1, a)) * 255) << 24) | (UInt32(max(0, min(1, r)) * 255) << 16) | (UInt32(max(0, min(1, g)) * 255) << 8) | UInt32(max(0, min(1, b)) * 255)
    if slots[i].flashGlyph != glyph || slots[i].flashTint != tintKey, let image = fonts.tintedImage(Self.digitStrings[glyph], tint: tint) {
      layer.contents = image.cgImage
      layer.bounds = CGRect(origin: .zero, size: image.size)
      slots[i].flashGlyph = glyph
      slots[i].flashTint = tintKey
    }
    // Over the arriving glyph's place during a swap; the flash follows the swap's own fade.
    let d: CGFloat = wheel.fromAbove ? 1 : -1
    let blend = CGFloat(wheel.blend)
    let swapping = wheel.blend < 1 && timing.transition != .flip
    let offset = swapping ? -d * fonts.lineHeight * Self.numericOffset * (1 - blend) : 0
    let scale = swapping ? Self.numericScale + (1 - Self.numericScale) * blend : 1
    layer.position = CGPoint(x: cellWidth - fonts.digitWidth / 2, y: fonts.lineHeight / 2 + offset)
    layer.transform = CATransform3DMakeScale(scale, scale, 1)
    layer.opacity = Float(CGFloat(wheel.flash) * (swapping ? blend : 1) * CGFloat(wheel.width))
    if layer.isHidden { layer.isHidden = false }
  }

  /// Makes `slots` match `elements` one to one; layers are only rebuilt when
  /// the element kinds change (a wheel appearing or disappearing).
  private func syncSlots(with elements: [Element], wheels: [Engine.Wheel], fonts: FontSet) {
    if slotsMatch(elements) { return }
    clearSlots()
    slots.reserveCapacity(elements.count)
    for element in elements {
      let container = CALayer()
      container.masksToBounds = true
      let inner = CALayer()
      inner.contentsScale = fonts.renderScale
      switch element.kind {
      case .wheel(let index):
        let blankZero = wheels[index].blankZero
        if let strip = fonts.strip(blankZero: blankZero) {
          inner.contents = strip.cgImage
          inner.bounds = CGRect(origin: .zero, size: strip.size)
        }
        container.addSublayer(inner)
        contentLayer.addSublayer(container)
        slots.append(ElementLayer(kind: .wheel, layer: container, blankZero: blankZero, swap: nil, flip: nil, morph: nil, flashLayer: nil, glyphTop: 0))
      case .glyph(let text, let role):
        if let image = fonts.image(text, role: role) {
          inner.contents = image.cgImage
          inner.bounds = CGRect(origin: .zero, size: image.size)
        }
        container.addSublayer(inner)
        contentLayer.addSublayer(container)
        slots.append(ElementLayer(kind: .glyph(text, role), layer: container, blankZero: false, swap: nil, flip: nil, morph: nil, flashLayer: nil, glyphTop: fonts.top(for: role, text: text, lineTop: 0)))
      }
    }
  }

  /// Whether the layers already match `elements` one to one. Compared in
  /// place: this runs every frame, so it builds nothing to compare.
  private func slotsMatch(_ elements: [Element]) -> Bool {
    guard elements.count == slots.count else { return false }
    for index in elements.indices {
      switch (elements[index].kind, slots[index].kind) {
      case (.wheel, .wheel):
        continue
      case (.glyph(let text, let role), .glyph(let slotText, let slotRole)) where text == slotText && role == slotRole:
        continue
      default:
        return false
      }
    }
    return true
  }

  private static func wrap10(_ position: Double) -> Double {
    let r = fmod(position, 10)
    return r < 0 ? r + 10 : r
  }

  /// Where the content box (`total` × `lineHeight`, in font space) goes and how
  /// it is scaled: the shrink-to-fit scale, aligned in the bounds, times the
  /// reveal's landing pop about the content's centre.
  private func contentPlacement(total: CGFloat, lineHeight: CGFloat) -> (origin: CGPoint, scale: CGFloat) {
    let fit = fontScale
    let originX: CGFloat
    switch resolvedAlignment {
    case .auto, .left: originX = 0
    case .center: originX = (bounds.width - total * fit) / 2
    case .right: originX = bounds.width - total * fit
    }
    let originY = (bounds.height - lineHeight * fit) / 2
    let pop = CGFloat(engine.revealScale())
    guard pop != 1 else { return (CGPoint(x: originX, y: originY), fit) }
    return (
      CGPoint(x: originX + total * fit * (1 - pop) / 2, y: originY + lineHeight * fit * (1 - pop) / 2),
      fit * pop
    )
  }

  // MARK: - Drawing (bitmap, loading glint only)

  override func draw(_ rect: CGRect) {
    guard usesBitmap, engine.hasShownValue(), let ctx = UIGraphicsGetCurrentContext() else { return }
    let fonts = self.fonts
    syncWheels()
    buildElements(into: &elementBuffer, wheels: wheelBuffer, signFactor: engine.signFactor())
    let wheels = wheelBuffer
    let elements = elementBuffer
    let total = elements.reduce(CGFloat(0)) { $0 + $1.width }
    updateFontScale(contentWidth: total)
    let placement = contentPlacement(total: total, lineHeight: fonts.lineHeight)

    // Position the (scaled) content, then draw everything in unscaled font space.
    ctx.saveGState()
    ctx.translateBy(x: placement.origin.x, y: placement.origin.y)
    ctx.scaleBy(x: placement.scale, y: placement.scale)

    let dim = CGFloat(min(1, max(0, engine.loadingProgress())))
    if dim > 0 {
      // Everything drawn in this layer is what the sweep gets composited onto.
      ctx.beginTransparencyLayer(auxiliaryInfo: nil)
    }
    var x: CGFloat = 0
    for element in elements {
      switch element.kind {
      case .wheel(let index):
        drawWheel(wheels[index], fonts: fonts, x: x, width: element.width, ctx: ctx)
      case .glyph(let text, let role):
        drawGlyph(text, role: role, fonts: fonts, x: x, width: element.width, fullWidth: element.fullWidth, alpha: element.factor, ctx: ctx)
      }
      x += element.width
    }
    if dim > 0 {
      drawShimmer(contentWidth: total, dim: dim, ctx: ctx)
      ctx.endTransparencyLayer()
    }
    ctx.restoreGState()
  }

  /// A "shine" glint: a text-wide, slanted band that recolors the ink from the
  /// text color to the highlight and back (`[base, highlight, base]` at
  /// 10/50/90 %), composited source-atop so only the glyphs light up.
  private func drawShimmer(contentWidth: CGFloat, dim: CGFloat, ctx: CGContext) {
    guard contentWidth > 0 else { return }
    var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 1
    typography.color.getRed(&br, green: &bg, blue: &bb, alpha: &ba)
    var hr: CGFloat = 0, hg: CGFloat = 0, hb: CGFloat = 0, ha: CGFloat = 1
    (shimmer.color ?? Self.defaultShimmerColor).getRed(&hr, green: &hg, blue: &hb, alpha: &ha)
    let base = CGColor(red: br, green: bg, blue: bb, alpha: ba)
    let colors = [base, CGColor(red: hr, green: hg, blue: hb, alpha: ha), base] as CFArray
    guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0.1, 0.5, 0.9]) else { return }
    let phase = CGFloat(engine.shimmerPhase(CACurrentMediaTime(), shimmer.duration))
    let progress = Self.shimmerSeed + (1 - Self.shimmerSeed) * phase
    // Core at width * (2p - 0.5): enters at the left edge, exits past the right.
    let startX = contentWidth * (2 * progress - 1)
    ctx.saveGState()
    ctx.setBlendMode(.sourceAtop)
    ctx.setAlpha(dim)
    ctx.drawLinearGradient(
      gradient,
      start: CGPoint(x: startX, y: 0),
      end: CGPoint(x: startX + contentWidth, y: Self.shimmerSlant * contentWidth),
      options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
    )
    ctx.restoreGState()
  }

  private func drawGlyph(_ text: String, role: GlyphRole, fonts: FontSet, x: CGFloat, width: CGFloat, fullWidth: CGFloat, alpha: Double, ctx: CGContext) {
    guard width > 0 else { return }
    ctx.saveGState()
    ctx.clip(to: CGRect(x: x, y: 0, width: width, height: fonts.lineHeight))
    ctx.setAlpha(CGFloat(alpha))
    fonts.image(text, role: role)?.draw(at: CGPoint(x: x + width - fullWidth, y: fonts.top(for: role, text: text, lineTop: 0)))
    ctx.restoreGState()
  }

  private func drawWheel(_ wheel: Engine.Wheel, fonts: FontSet, x: CGFloat, width: CGFloat, ctx: CGContext) {
    guard width > 0 else { return }
    let lineHeight = fonts.lineHeight
    ctx.saveGState()
    ctx.clip(to: CGRect(x: x, y: 0, width: width, height: lineHeight))
    ctx.setAlpha(CGFloat(wheel.width))
    if wheel.blend < 1 {
      // The numeric transition under the glint: the pair, without the blur.
      let b = CGFloat(wheel.blend)
      let d: CGFloat = wheel.fromAbove ? 1 : -1
      let offset = lineHeight * Self.numericOffset
      let cx = x + width - fonts.digitWidth / 2
      let pair: [(glyph: Int, dy: CGFloat, scale: CGFloat, alpha: CGFloat)] = [
        (Int(wheel.fromGlyph), d * offset * b, 1 - (1 - Self.numericScale) * b, 1 - b),
        (Int(wheel.toGlyph), -d * offset * (1 - b), Self.numericScale + (1 - Self.numericScale) * b, b),
      ]
      for item in pair where item.glyph >= 0 && item.alpha > 0.002 {
        guard let image = fonts.image(Self.digitStrings[item.glyph % 10], role: .digit) else { continue }
        ctx.saveGState()
        ctx.setAlpha(CGFloat(wheel.width) * item.alpha)
        ctx.translateBy(x: cx, y: lineHeight / 2 + item.dy)
        ctx.scaleBy(x: item.scale, y: item.scale)
        image.draw(at: CGPoint(x: -image.size.width / 2, y: -image.size.height / 2))
        ctx.restoreGState()
      }
      ctx.restoreGState()
      return
    }
    let base = wheel.position.rounded(.down)
    let fraction = CGFloat(wheel.position - base)
    let index = Int(base)
    let columnLeft = x + width - fonts.digitWidth
    if let text = digitText(at: index, in: wheel), let image = fonts.image(text, role: .digit) {
      image.draw(at: CGPoint(x: columnLeft + (fonts.digitWidth - fonts.width(of: text, role: .digit)) / 2, y: -fraction * lineHeight))
    }
    if fraction > 0.0001, let text = digitText(at: index + 1, in: wheel), let image = fonts.image(text, role: .digit) {
      image.draw(at: CGPoint(x: columnLeft + (fonts.digitWidth - fonts.width(of: text, role: .digit)) / 2, y: (1 - fraction) * lineHeight))
    }
    ctx.restoreGState()
  }

  private static let digitStrings = (0...9).map { String($0) }

  private func digitText(at index: Int, in wheel: Engine.Wheel) -> String? {
    if wheel.linear && index < 0 { return nil }
    if wheel.blankZero && index == 0 { return nil }
    return Self.digitStrings[((index % 10) + 10) % 10]
  }
}
