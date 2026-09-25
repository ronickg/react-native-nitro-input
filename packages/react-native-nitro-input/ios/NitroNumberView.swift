//
//  NitroNumberView.swift
//  NitroInput
//
//  Draws a NitroNumber. All behaviour (wheel positions, rolls, stagger,
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

import Accelerate
import CoreText
import UIKit

final class NitroNumberView: UIView {

  private typealias Engine = margelo.nitro.nitroinput.RollingEngine

  // MARK: - Configuration

  struct Format: Equatable {
    var fractionDigits: Int = 0
    var minimumIntegerDigits: Int = 1
    var groupingSeparator: String = ""
    var decimalSeparator: String = "."
    var prefix: String = ""
    var suffix: String = ""
    /// ECMA-402's signDisplay (`Engine.setSignDisplay`), and the glyphs drawn for the two signs.
    var signDisplay: Int32 = 0
    var plusSign: String = "+"
    var minusSign: String = "-"
    /// Digit group sizes counted from the decimal point, the first then every
    /// later one (empty: threes). [3, 2] is Indian grouping, [2] a clock's.
    var groupingSizes: [Int] = []
    /// Per integer position, the highest digit its wheel shows before it wraps (a clock's 5).
    var digitMax: [Int] = []
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
    /// Points added after every glyph, as `Text`'s letterSpacing; an affix gets it in proportion to its size.
    var letterSpacing: CGFloat = 0
    /// Points between the prefix and the digits, and between the digits and the suffix, in place of the letter spacing there.
    var prefixSpacing: CGFloat? = nil
    var suffixSpacing: CGFloat? = nil
    /// Points an affix is moved down (negative: up) after its alignment.
    var prefixOffset: CGFloat = 0
    var suffixOffset: CGFloat = 0
    /// Every digit as wide as the widest (tabular figures, the default), or each at its own width.
    var tabularNums: Bool = true
    /// The prefix's, the suffix's and the fraction's colours (nil: `color`).
    var prefixColor: UIColor? = nil
    var suffixColor: UIColor? = nil
    var fractionColor: UIColor? = nil
    /// The fraction digits' and decimal separator's size (nil: `fontSize`) and how they line up.
    var fractionFontSize: CGFloat? = nil
    var fractionAlign: AffixAlign = .baseline
    /// The glyphs drawn for 0…9 (empty: "0"…"9").
    var digitGlyphs: [String] = []
    var adjustsFontSizeToFit: Bool = false
    var minimumFontScale: CGFloat = 0.5
    var allowFontScaling: Bool = false
    var maxFontSizeMultiplier: CGFloat = 0
  }

  enum Easing: Int32 {
    case linear = 0, easeIn = 1, easeOut = 2, easeInOut = 3, spring = 4
  }

  enum Direction: Int32 {
    case auto = 0, up = 1, down = 2, shortest = 3
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
    /// Rolls turn the lower wheels a full turn too (`Engine.setContinuous`).
    var continuous = false
    /// Snap while the system's Reduce Motion is on.
    var respectReduceMotion = true
  }

  enum RevealStyle: Int32 {
    case count = 0, spin = 1
  }

  enum Transition: Int32 {
    case roll = 0, numeric = 1, scramble = 2
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
    /// The band's slant in degrees (0 upright, positive leans like "/").
    var angle: CGFloat = 31
    /// The band's width, a fraction of the number's.
    var width: CGFloat = 1
    /// The glyphs' colour outside the band while loading (nil: the text colour).
    var baseColor: UIColor? = nil
    /// Sweep direction: nil follows the layout direction, true left to right.
    var leftToRight: Bool? = nil
    /// A pause after each sweep.
    var delay: TimeInterval = 0
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
      // A prefix, suffix or separator that changes while a value is shown
      // swaps like a digit (`Engine.changeText`): keep the text that leaves.
      if engine.hasShownValue() {
        let rtl = isRTL
        func prefixInk(_ text: String) -> String { rtl ? Self.splitAffix(text, spaceAtEnd: true).ink : text }
        func suffixInk(_ text: String) -> String { rtl ? Self.splitAffix(text, spaceAtEnd: false).ink : text }
        let now = CACurrentMediaTime()
        func change(_ slot: Int, _ from: String, _ to: String) {
          guard from != to else { return }
          leavingText[slot] = from
          engine.changeText(Int32(slot), now)
        }
        change(Self.prefixText, prefixInk(oldValue.prefix), prefixInk(format.prefix))
        change(Self.suffixText, suffixInk(oldValue.suffix), suffixInk(format.suffix))
        change(Self.groupingText, oldValue.groupingSeparator, format.groupingSeparator)
        change(Self.decimalText, oldValue.decimalSeparator, format.decimalSeparator)
        let positive = engine.signPositive()
        change(Self.signText, positive ? oldValue.plusSign : oldValue.minusSign, positive ? format.plusSign : format.minusSign)
      }
      engine.setSignDisplay(format.signDisplay)
      if format.digitMax != oldValue.digitMax {
        engine.clearDigitMax()
        for (power, max) in format.digitMax.enumerated() where (0...8).contains(max) {
          engine.setDigitMax(Int32(power), Int32(max))
        }
      }
      // Played in a glyph-swap transition; snaps otherwise (see the engine).
      engine.changeFormat(Int32(format.fractionDigits), Int32(format.minimumIntegerDigits), CACurrentMediaTime())
      if engine.hasShownValue() {
        reportIntrinsicSize()
      }
      updateDisplayLinkNeed()
      render()
    }
  }

  // `Engine.TextSlot`, and the text each slot is swapping away from.
  static let prefixText = 0
  static let suffixText = 1
  static let groupingText = 2
  static let decimalText = 3
  static let signText = 4
  private var leavingText: [String?] = [nil, nil, nil, nil, nil]

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
      if timing.transition != oldValue.transition { warmSwapImages() }
      engine.setPopOnChange(timing.popOnChange)
      engine.setRevealTiming(timing.revealDuration, timing.revealBounce, timing.revealStyle.rawValue, timing.revealStagger)
      engine.setRevealGrow(timing.revealGrow)
      engine.setRevealMilestoneHold(timing.revealMilestoneHold)
      engine.setContinuous(timing.continuous)
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
      if flash.upColor != oldValue.upColor || flash.downColor != oldValue.downColor {
        render()
        warmSwapImages()
      }
    }
  }

  /// Loading glint: full-color ink with a light band sweeping through it.
  var loading = false {
    didSet {
      guard loading != oldValue else { return }
      applyReduceMotion()
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
  /// Called when the figure starts moving from rest, and when it comes to rest (with its value).
  var onAnimationStart: (() -> Void)?
  var onAnimationEnd: ((Double) -> Void)?
  /// A roll or a reveal is under way (`onAnimationStart` has fired, `onAnimationEnd` not yet).
  private var moving = false

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

  // MARK: - Fonts

  private enum GlyphRole {
    /// The integer digits, the sign and the grouping separators.
    case digit
    case prefix, suffix
    /// The fraction digits and the decimal separator (`fractionFontSize`, `fractionColor`).
    case fraction
  }

  private struct GlyphKey: Hashable {
    let text: String
    let role: GlyphRole
  }

  /// Images every NitroNumber shares, kept while they are in use. A numeric
  /// transition cycles each digit through every blur level, so a screen of
  /// figures in a few fonts and colours uses hundreds of blurred glyphs a
  /// second; a cache that started over when it reached a fixed count dropped
  /// ones about to be drawn again and re-blurred them (thousands of vImage
  /// passes a second on a trading screen). Past `budget` bytes, what has gone
  /// unused for `idle` seconds is dropped, oldest first; what is still in use
  /// stays unless the cache passes `limit`. A memory warning empties it.
  private final class RecentImageCache<Key: Hashable> {
    private struct Entry {
      let image: UIImage
      let bytes: Int
      var used: CFTimeInterval
    }
    private var entries: [Key: Entry] = [:]
    private(set) var bytes = 0
    private let budget: Int
    private let limit: Int
    private let idle: CFTimeInterval
    private var observer: NSObjectProtocol?

    init(budget: Int = 8 << 20, limit: Int = 64 << 20, idle: CFTimeInterval = 2) {
      self.budget = budget
      self.limit = limit
      self.idle = idle
      observer = NotificationCenter.default.addObserver(
        forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
      ) { [weak self] _ in
        self?.entries.removeAll()
        self?.bytes = 0
      }
    }

    var count: Int { entries.count }

    subscript(key: Key) -> UIImage? {
      guard var entry = entries[key] else { return nil }
      entry.used = CACurrentMediaTime()
      entries[key] = entry
      return entry.image
    }

    func insert(_ image: UIImage, for key: Key) {
      let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
      let now = CACurrentMediaTime()
      if let old = entries.updateValue(Entry(image: image, bytes: cost, used: now), forKey: key) { bytes -= old.bytes }
      bytes += cost
      guard bytes > budget else { return }
      for (key, entry) in entries.sorted(by: { $0.value.used < $1.value.used }) {
        guard bytes > budget, now - entry.used > idle || bytes > limit else { break }
        entries.removeValue(forKey: key)
        bytes -= entry.bytes
      }
    }
  }

  /// Digit / prefix / suffix fonts with per-glyph caches.
  private final class FontSet {
    let digit: UIFont
    let prefix: UIFont
    let suffix: UIFont
    let fraction: UIFont
    /// The text color resolved for the view's traits: the glyph images bake it
    /// in, and `.label` is dynamic (see `traitCollectionDidChange`).
    let color: UIColor
    /// The prefix's, the suffix's and the fraction's colours, resolved (`color` when unset).
    let prefixColor: UIColor
    let suffixColor: UIColor
    let fractionColor: UIColor
    let prefixAlign: AffixAlign
    let suffixAlign: AffixAlign
    let fractionAlign: AffixAlign
    /// The glyphs drawn for 0…9.
    let glyphs: [String]
    private let glyphsKey: String
    /// Letter spacing after a digit / prefix / suffix glyph, and the spacing at the affix seams (nil: the letter spacing), scaled with the fonts.
    let digitSpacing: CGFloat
    let prefixLetterSpacing: CGFloat
    let suffixLetterSpacing: CGFloat
    let fractionLetterSpacing: CGFloat
    let prefixSeam: CGFloat?
    let suffixSeam: CGFloat?
    let prefixOffset: CGFloat
    let suffixOffset: CGFloat
    /// Height of the line box (the digit font's line height).
    let lineHeight: CGFloat
    /// The numeric transition's blur radius at full blur, in line heights.
    let numericBlur: CGFloat = NitroNumberView.numericBlur
    /// Width of the widest digit glyph.
    private(set) var digitWidth: CGFloat = 0
    /// Each digit at its own advance instead of the widest's (`tabularNums={false}`).
    let proportional: Bool
    /// The advance of each digit 0…9.
    private(set) var digitWidths: [CGFloat] = []
    /// The same for the fraction digits, in their own font.
    private(set) var fractionDigitWidth: CGFloat = 0
    private(set) var fractionDigitWidths: [CGFloat] = []
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
      /// Places before the wheel wraps: 10, or fewer on a clock's wheel.
      let modulus: Int
      /// The glyphs' offset in their slot (a smaller fraction aligned to the digits).
      let top: CGFloat
      let glyphs: String
    }
    private static var sharedImages: [ImageKey: UIImage] = [:]
    /// Blurred glyphs, the digit's own colour (tint 0) and the flash's alike.
    private static let sharedBlurred = RecentImageCache<TintKey>()
    /// Glyphs in the change flash's colours, keyed like the sharp ones plus
    /// the tint (0: the digit colour), and blurred ones plus their level.
    private struct TintKey: Hashable {
      let image: ImageKey
      let tint: UInt32
      var level = 0
      /// The blur radius the level is a fraction of, in thousandths of a line height.
      var blur = 0
    }
    private static var sharedTinted: [TintKey: UIImage] = [:]
    private static var sharedStrips: [StripKey: UIImage] = [:]
    private static let sharedCapacity = 512
    private let colorKey: UInt32
    private let prefixColorKey: UInt32
    private let suffixColorKey: UInt32
    private let fractionColorKey: UInt32
    private func colorKey(for role: GlyphRole) -> UInt32 {
      switch role {
      case .digit: return colorKey
      case .prefix: return prefixColorKey
      case .suffix: return suffixColorKey
      case .fraction: return fractionColorKey
      }
    }
    func color(for role: GlyphRole) -> UIColor {
      switch role {
      case .digit: return color
      case .prefix: return prefixColor
      case .suffix: return suffixColor
      case .fraction: return fractionColor
      }
    }
    private func fontTag(_ role: GlyphRole) -> String {
      let font = self.font(for: role)
      return "\(font.fontName)|\(font.pointSize)\(proportional ? "|p" : "")"
    }
    /// Pixel density the glyph images are rendered at.
    let renderScale: CGFloat

    init(_ t: Typography, traits: UITraitCollection) {
      // The view's own display, not the main screen's (deprecated, and absent on visionOS).
      renderScale = max(1, traits.displayScale)
      let scale = NitroNumberView.systemFontMultiplier(t)
      proportional = !t.tabularNums
      digit = NitroNumberView.makeFont(size: t.fontSize * scale, weight: t.fontWeight, family: t.fontFamily, tabular: t.tabularNums)
      prefix = NitroNumberView.makeFont(size: (t.prefixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily, tabular: t.tabularNums)
      suffix = NitroNumberView.makeFont(size: (t.suffixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily, tabular: t.tabularNums)
      fraction = NitroNumberView.makeFont(size: (t.fractionFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily, tabular: t.tabularNums)
      color = t.color.resolvedColor(with: traits)
      prefixColor = (t.prefixColor ?? t.color).resolvedColor(with: traits)
      suffixColor = (t.suffixColor ?? t.color).resolvedColor(with: traits)
      fractionColor = (t.fractionColor ?? t.color).resolvedColor(with: traits)
      colorKey = Self.key(of: color)
      prefixColorKey = Self.key(of: prefixColor)
      suffixColorKey = Self.key(of: suffixColor)
      fractionColorKey = Self.key(of: fractionColor)
      prefixAlign = t.prefixAlign
      suffixAlign = t.suffixAlign
      fractionAlign = t.fractionAlign
      glyphs = t.digitGlyphs.count == 10 && !t.digitGlyphs.contains(where: \.isEmpty) ? t.digitGlyphs : (0...9).map { String($0) }
      glyphsKey = glyphs.joined(separator: "|")
      digitSpacing = t.letterSpacing * scale
      prefixLetterSpacing = t.letterSpacing * scale * (prefix.pointSize / digit.pointSize)
      suffixLetterSpacing = t.letterSpacing * scale * (suffix.pointSize / digit.pointSize)
      fractionLetterSpacing = t.letterSpacing * scale * (fraction.pointSize / digit.pointSize)
      prefixSeam = t.prefixSpacing.map { $0 * scale }
      suffixSeam = t.suffixSpacing.map { $0 * scale }
      prefixOffset = t.prefixOffset * scale
      suffixOffset = t.suffixOffset * scale
      lineHeight = ceil(digit.lineHeight)
      digitWidths = (0...9).map { width(of: glyphs[$0], role: .digit) }
      digitWidth = digitWidths.max() ?? 0
      fractionDigitWidths = (0...9).map { width(of: glyphs[$0], role: .fraction) }
      fractionDigitWidth = fractionDigitWidths.max() ?? 0
    }

    /// The widest digit of `role`'s font (the digits' or the fraction's).
    func digitWidth(for role: GlyphRole) -> CGFloat {
      role == .fraction ? fractionDigitWidth : digitWidth
    }

    func digitWidths(for role: GlyphRole) -> [CGFloat] {
      role == .fraction ? fractionDigitWidths : digitWidths
    }

    /// The vertical centre of a `role` digit in the line box (a swapping glyph's).
    func digitCenterY(for role: GlyphRole) -> CGFloat {
      guard role == .fraction else { return lineHeight / 2 }
      return top(for: .fraction, text: glyphs[0], lineTop: 0) + fraction.lineHeight / 2
    }

    func font(for role: GlyphRole) -> UIFont {
      switch role {
      case .digit: return digit
      case .prefix: return prefix
      case .suffix: return suffix
      case .fraction: return fraction
      }
    }

    func attributed(_ text: String, role: GlyphRole) -> NSAttributedString {
      let key = GlyphKey(text: text, role: role)
      if let cached = glyphCache[key] { return cached }
      let string = NSAttributedString(string: text, attributes: [
        .font: font(for: role),
        .foregroundColor: color(for: role),
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
      let key = ImageKey(font: fontTag(role), color: colorKey(for: role), scale: renderScale, text: text, role: role)
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
    /// The digit at blur `level` of `numericBlurLevels` (level 0 is `image`):
    /// a blurred glyph is not a sharp one cross-faded with a blurred one, which
    /// reads as a sharp digit inside a glow, but the two levels nearest its
    /// blur cross-faded, so it never shows a sharp core.
    func blurredImage(_ text: String, role: GlyphRole = .digit, level: Int) -> UIImage? {
      if level <= 0 || numericBlur <= 0 { return image(text, role: role) }
      let key = TintKey(image: ImageKey(font: fontTag(role), color: colorKey(for: role), scale: renderScale, text: text, role: role), tint: 0, level: level, blur: blurKey)
      if let cached = Self.sharedBlurred[key] { return cached }
      guard let sharp = image(text, role: role), let image = blurred(sharp, level: level) else { return nil }
      Self.sharedBlurred.insert(image, for: key)
      return image
    }

    /// `blurredImage`'s twin for `tintedImage`, so a swapping glyph's change
    /// flash blurs as the glyph does.
    func tintedBlurredImage(_ text: String, role: GlyphRole = .digit, tint: UIColor, level: Int) -> UIImage? {
      if level <= 0 || numericBlur <= 0 { return tintedImage(text, role: role, tint: tint) }
      let key = TintKey(image: ImageKey(font: fontTag(role), color: colorKey(for: role), scale: renderScale, text: text, role: role), tint: Self.key(of: tint), level: level, blur: blurKey)
      if let cached = Self.sharedBlurred[key] { return cached }
      guard let sharp = tintedImage(text, role: role, tint: tint), let image = blurred(sharp, level: level) else { return nil }
      Self.sharedBlurred.insert(image, for: key)
      return image
    }

    /// A swapping glyph's image at a blur level, in its own colour or the flash's.
    func swapImage(_ text: String, role: GlyphRole = .digit, level: Int, tint: UIColor?) -> UIImage? {
      if let tint { return tintedBlurredImage(text, role: role, tint: tint, level: level) }
      return blurredImage(text, role: role, level: level)
    }

    private var blurKey: Int { Int((numericBlur * 1000).rounded()) }

    /// `sharp` blurred by `level / numericBlurLevels` of `numericBlur` line
    /// heights, padded (for the full blur, so every level is the same size) so
    /// nothing is cut off.
    private func blurred(_ sharp: UIImage, level: Int) -> UIImage? {
      guard let cg = sharp.cgImage else { return nil }
      let full = lineHeight * numericBlur * renderScale
      let sigma = full * CGFloat(level) / CGFloat(NitroNumberView.numericBlurLevels)
      guard let blurred = Self.blur(cg, sigma: sigma, pad: Int(ceil(full * 3))) else { return nil }
      return UIImage(cgImage: blurred, scale: renderScale, orientation: .up)
    }

    /// A colour as a cache key: eight bits a channel, alpha first.
    static func key(of color: UIColor) -> UInt32 {
      var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
      color.getRed(&r, green: &g, blue: &b, alpha: &a)
      return (UInt32(max(0, min(1, a)) * 255) << 24) | (UInt32(max(0, min(1, r)) * 255) << 16) | (UInt32(max(0, min(1, g)) * 255) << 8) | UInt32(max(0, min(1, b)) * 255)
    }

    /// `cg` blurred by about `sigma` pixels, with `pad` transparent pixels added
    /// on every side for the blur to spread into: a tent convolution on the CPU
    /// with vImage, which is a box blur run twice and reads as a gaussian at this
    /// size, in well under a millisecond for a glyph. Core Image did this before,
    /// and its first render of a session stalled the main thread for longer than
    /// the swap itself, so the spring had finished behind it.
    private static func blur(_ cg: CGImage, sigma: CGFloat, pad: Int) -> CGImage? {
      var format = vImage_CGImageFormat(
        bitsPerComponent: 8, bitsPerPixel: 32, colorSpace: nil,
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue),
        version: 0, decode: nil, renderingIntent: .defaultIntent)
      var source = vImage_Buffer()
      guard vImageBuffer_InitWithCGImage(&source, &format, nil, cg, vImage_Flags(kvImageNoFlags)) == kvImageNoError else { return nil }
      defer { free(source.data) }
      let width = Int(source.width) + 2 * pad
      let height = Int(source.height) + 2 * pad
      var padded = vImage_Buffer()
      guard vImageBuffer_Init(&padded, vImagePixelCount(height), vImagePixelCount(width), 32, vImage_Flags(kvImageNoFlags)) == kvImageNoError else { return nil }
      defer { free(padded.data) }
      memset(padded.data, 0, padded.rowBytes * height)
      for row in 0..<Int(source.height) {
        memcpy(padded.data.advanced(by: (row + pad) * padded.rowBytes + pad * 4),
               source.data.advanced(by: row * source.rowBytes),
               Int(source.width) * 4)
      }
      var out = vImage_Buffer()
      guard vImageBuffer_Init(&out, vImagePixelCount(height), vImagePixelCount(width), 32, vImage_Flags(kvImageNoFlags)) == kvImageNoError else { return nil }
      defer { free(out.data) }
      // A tent kernel of half-width h has a standard deviation of h / √6; run
      // twice it is four box passes, a gaussian to the eye, of h / √3.
      let half = max(1, Int((sigma * 1.732).rounded()))
      let kernel = UInt32(half * 2 + 1)
      guard vImageTentConvolve_ARGB8888(&padded, &out, nil, 0, 0, kernel, kernel, nil, vImage_Flags(kvImageEdgeExtend)) == kvImageNoError else { return nil }
      guard vImageTentConvolve_ARGB8888(&out, &padded, nil, 0, 0, kernel, kernel, nil, vImage_Flags(kvImageEdgeExtend)) == kvImageNoError else { return nil }
      return vImageCreateCGImageFromBuffer(&padded, &format, nil, nil, vImage_Flags(kvImageNoFlags), nil)?.takeRetainedValue()
    }

    /// The glyph in another colour, for the change flash: the same raster as
    /// `image` with the tint baked in, composited over the glyph at the flash's
    /// opacity. Made once per font, density and tint.
    func tintedImage(_ text: String, role: GlyphRole = .digit, tint: UIColor) -> UIImage? {
      let key = TintKey(image: ImageKey(font: fontTag(role), color: colorKey(for: role), scale: renderScale, text: text, role: role), tint: Self.key(of: tint))
      if let cached = Self.sharedTinted[key] { return cached }
      let string = NSAttributedString(string: text, attributes: [.font: font(for: role), .foregroundColor: tint])
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

    /// The strip in the change flash's colour, for a wheel that flashes while it
    /// rolls: laid over the strip at the same offset, it rides the roll. One per
    /// colour and variant, so two for a trading screen.
    private struct TintedStripKey: Hashable {
      let strip: StripKey
      let tint: UInt32
    }
    private static var sharedTintedStrips: [TintedStripKey: UIImage] = [:]
    func tintedStrip(role: GlyphRole = .digit, blankZero: Bool, modulus: Int = 10, tint: UIColor) -> UIImage? {
      let key = TintedStripKey(strip: stripKey(role: role, blankZero: blankZero, modulus: modulus), tint: Self.key(of: tint))
      if let cached = Self.sharedTintedStrips[key] { return cached }
      guard let image = drawStrip(role: role, blankZero: blankZero, modulus: modulus, color: tint) else { return nil }
      if Self.sharedTintedStrips.count >= 8 { Self.sharedTintedStrips.removeAll(keepingCapacity: true) }
      Self.sharedTintedStrips[key] = image
      return image
    }

    /// A wheel's whole digit strip as one image: slots for index -1 (blank) to
    /// `modulus` (the 0 that follows the last digit on a wrap: 10 on a plain
    /// wheel, 6 on a clock's tens), each `lineHeight` tall with the digit
    /// centred in the role's widest digit. A wheel layer shows one slot-high
    /// window of it and just moves the strip, so a roll is a position change.
    /// A fraction digit set smaller is drawn at its aligned height in the slot.
    func strip(role: GlyphRole = .digit, blankZero: Bool, modulus: Int = 10) -> UIImage? {
      let key = stripKey(role: role, blankZero: blankZero, modulus: modulus)
      if let cached = Self.sharedStrips[key] { return cached }
      guard let image = drawStrip(role: role, blankZero: blankZero, modulus: modulus, color: nil) else { return nil }
      if Self.sharedStrips.count >= 64 { Self.sharedStrips.removeAll(keepingCapacity: true) }
      Self.sharedStrips[key] = image
      return image
    }

    /// Slots in a strip for `modulus`: -1 (blank) through `modulus`.
    static func stripSlots(modulus: Int) -> Int { modulus + 2 }

    private func stripKey(role: GlyphRole, blankZero: Bool, modulus: Int) -> StripKey {
      StripKey(font: fontTag(role), color: colorKey(for: role), scale: renderScale, blankZero: blankZero, modulus: modulus, top: stripTop(role), glyphs: glyphsKey)
    }

    private func stripTop(_ role: GlyphRole) -> CGFloat {
      role == .fraction ? top(for: .fraction, text: glyphs[0], lineTop: 0) : 0
    }

    private func drawStrip(role: GlyphRole, blankZero: Bool, modulus: Int, color tint: UIColor?) -> UIImage? {
      let cell = digitWidth(for: role)
      guard cell > 0, lineHeight > 0 else { return nil }
      let format = UIGraphicsImageRendererFormat()
      format.scale = renderScale
      format.opaque = false
      let slots = Self.stripSlots(modulus: modulus)
      let top = stripTop(role)
      let size = CGSize(width: ceil(cell), height: lineHeight * CGFloat(slots))
      return UIGraphicsImageRenderer(size: size, format: format).image { _ in
        for slot in 0..<slots {
          let index = slot - 1
          if index < 0 || (blankZero && index == 0) { continue }
          let text = glyphs[index % modulus]
          let w = width(of: text, role: role)
          let string = tint.map { NSAttributedString(string: text, attributes: [.font: font(for: role), .foregroundColor: $0]) } ?? attributed(text, role: role)
          string.draw(at: CGPoint(x: (cell - w) / 2, y: CGFloat(slot) * lineHeight + top))
        }
      }
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
      switch role {
      case .digit: return lineTop
      case .fraction: return alignedTop(for: role, text: text, lineTop: lineTop)
      case .prefix: return alignedTop(for: role, text: text, lineTop: lineTop) + prefixOffset
      case .suffix: return alignedTop(for: role, text: text, lineTop: lineTop) + suffixOffset
      }
    }

    /// Letter spacing after a glyph of `role`.
    func spacing(for role: GlyphRole) -> CGFloat {
      switch role {
      case .digit: return digitSpacing
      case .prefix: return prefixLetterSpacing
      case .suffix: return suffixLetterSpacing
      case .fraction: return fractionLetterSpacing
      }
    }

    private func alignedTop(for role: GlyphRole, text: String, lineTop: CGFloat) -> CGFloat {
      let f = font(for: role)
      let align: AffixAlign
      switch role {
      case .prefix: align = prefixAlign
      case .suffix: align = suffixAlign
      case .fraction: align = fractionAlign
      case .digit: align = .baseline
      }
      switch align {
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
        let affixBaseline = lineTop + digit.ascender + inkDescent(glyphs.joined(), role: .digit) - inkDescent(text, role: role)
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
  private let contentLayer = QuietLayer()
  /// One entry per laid-out element, in drawing order.
  private var slots: [ElementLayer] = []
  /// True while the loading glint is visible and frames go through `draw(_:)`.
  private var usesBitmap = false

  private enum LayerKind: Equatable {
    case wheel
    case glyph(String, GlyphRole)
  }

  /// One layer of a swapping glyph and what it holds: a digit at a blur level, in a tint.
  private final class GlyphLayer {
    let layer = QuietLayer()
    var glyph = -2
    var level = -1
    var tint: UInt32 = 0
    /// Text swaps only: the text the layer shows.
    var text: String?
  }

  /// A prefix, suffix or separator changing its text (`Engine.changeText`):
  /// the leaving and the arriving text, each a pair of layers holding the two
  /// blur levels nearest its blur, cross-faded as a swapping digit's are. On
  /// the slot's overlay, unclipped, so the haze stays whole.
  private final class TextSwapLayers {
    let leaving = (GlyphLayer(), GlyphLayer())
    let arriving = (GlyphLayer(), GlyphLayer())
    var hidden = true
    var all: [CALayer] { [leaving.0, leaving.1, arriving.0, arriving.1].map { $0.layer } }

    init(scale: CGFloat) {
      for layer in all {
        layer.contentsScale = scale
        layer.isHidden = true
      }
    }
  }

  /// The numeric transition's layers of one wheel: the leaving glyph and the
  /// arriving one, each a pair of layers holding the two blur levels nearest
  /// the glyph's blur, cross-faded (`placeSwapGlyph`), and the same two pairs
  /// again in the change flash's colour, laid over their twins at the flash's
  /// opacity, which is the ink mixed towards the tint. Made the first time the
  /// wheel swaps, hidden whenever it is settled. They live on the slot's
  /// overlay, not in its clipped container: a blurred glyph's haze reaches
  /// past the digit cell, and cut at the cell it read as a pale box around
  /// the digit.
  private final class SwapLayers {
    let leaving = (GlyphLayer(), GlyphLayer())
    let arriving = (GlyphLayer(), GlyphLayer())
    let leavingTint = (GlyphLayer(), GlyphLayer())
    let arrivingTint = (GlyphLayer(), GlyphLayer())
    var hidden = true
    var all: [CALayer] {
      [leaving.0, leaving.1, arriving.0, arriving.1, leavingTint.0, leavingTint.1, arrivingTint.0, arrivingTint.1].map { $0.layer }
    }

    init(scale: CGFloat) {
      for layer in all {
        layer.contentsScale = scale
        layer.isHidden = true
      }
    }
  }

  /// A class, not a struct: the frame loop reads every slot, and a struct
  /// copy retained and released each of its layers every frame.
  private final class ElementLayer {
    let kind: LayerKind
    var layer: CALayer
    /// The strip (wheels) or the glyph's image (glyphs), inside `layer`.
    var inner: CALayer
    /// Wheels only: which strip the layer currently shows (`stripVariant`).
    var stripVariant: Int
    /// Wheels only: the numeric transition's layers, once the wheel has swapped,
    /// on an unclipped layer of their own over the containers.
    var swap: SwapLayers?
    var overlay: CALayer?
    /// Glyphs only: a text swap's layers, on `overlay`, once the text has changed.
    var textSwap: TextSwapLayers?
    /// Wheels only: the change flash of a wheel that is not swapping, a
    /// tinted copy of the strip over the strip.
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

    init(kind: LayerKind, layer: CALayer, inner: CALayer, stripVariant: Int, glyphTop: CGFloat) {
      self.kind = kind
      self.layer = layer
      self.inner = inner
      self.stripVariant = stripVariant
      self.glyphTop = glyphTop
    }
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
      let p = rtl ? NitroNumberView.splitAffix(prefix, spaceAtEnd: true) : (ink: prefix, gap: "")
      let s = rtl ? NitroNumberView.splitAffix(suffix, spaceAtEnd: false) : (ink: suffix, gap: "")
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
    if awaitingLayout, abs(bounds.width - lastReportedSize.width) <= 1 { awaitingLayout = false }
    learnAnchor()
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
    moving = false
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
    leavingText = [nil, nil, nil, nil, nil]
    moving = false
    autoAnchor = nil
    awaitingLayout = false
    laidFrame = nil
    pendingSizeReport = false
    format = Format()
    typography = Typography()
    timing = Timing()
    shimmer = Shimmer()
    alignment = .auto
    revealMilestones = []
    cellWidths.removeAll()
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
    let sign = signBefore()
    engine.setValue(value)
    swapSignIfChanged(sign)
    reportIntrinsicSize()
    updateDisplayLinkNeed()
    render()
    updateMoving()
  }

  /// Rolls every wheel to `value` (snaps on first show, duration 0 or Reduce Motion).
  func animate(to value: Double) {
    applyReduceMotion()
    let sign = signBefore()
    engine.animateTo(value, CACurrentMediaTime())
    swapSignIfChanged(sign)
    reportIntrinsicSize()
    updateDisplayLinkNeed()
    updateMoving()
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
    let sign = signBefore()
    engine.holdReveal(value)
    swapSignIfChanged(sign)
    reportIntrinsicSize()
    updateDisplayLinkNeed()
    render()
  }

  /// Counts up from 0 to `value` and lands with a pop (snaps under Reduce Motion).
  func reveal(to value: Double) {
    applyReduceMotion()
    let sign = signBefore()
    engine.reveal(value, CACurrentMediaTime())
    swapSignIfChanged(sign)
    reportIntrinsicSize()
    updateDisplayLinkNeed()
    render()
    updateMoving()
    reportMilestones(reachedBefore: 0)
    if !engine.isRevealing() {
      // Snapped (Reduce Motion / duration 0): the reveal is over before it began.
      onRevealEnd?()
    }
  }

  /// Snaps under Reduce Motion unless told not to (`respectReduceMotion`).
  private func applyReduceMotion() {
    engine.setReduceMotion(timing.respectReduceMotion && UIAccessibility.isReduceMotionEnabled)
  }

  /// The sign glyph on screen before a change, if one is.
  private func signBefore() -> String? {
    guard engine.hasShownValue(), engine.signFactor() > 0 else { return nil }
    return engine.signPositive() ? format.plusSign : format.minusSign
  }

  /// A plus that turns into a minus (or back) swaps like any text: the old
  /// one softens away as the new one comes into focus.
  private func swapSignIfChanged(_ before: String?) {
    guard let before else { return }
    let after = engine.signPositive() ? format.plusSign : format.minusSign
    guard after != before else { return }
    leavingText[Self.signText] = before
    engine.changeText(Int32(Self.signText), CACurrentMediaTime())
  }

  /// Fires `onAnimationStart` when a roll or a reveal sets off from rest and
  /// `onAnimationEnd` when the figure is still again, once for a run of changes.
  private func updateMoving() {
    let now = engine.isRolling() || engine.isRevealing()
    guard now != moving else { return }
    moving = now
    if now {
      onAnimationStart?()
    } else {
      onAnimationEnd?(engine.targetValue())
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
    updateMoving()
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
    weak var target: NitroNumberView?
    init(target: NitroNumberView) { self.target = target }
    @objc func tick(_ link: CADisplayLink) { target?.step(link) }
  }

  // MARK: - Typography

  private func rebuildFonts() {
    fonts = FontSet(typography, traits: traitCollection)
    cellWidths.removeAll()
    contentLayer.contentsScale = fonts.renderScale
    fontScale = 1
    // Every cached glyph image belongs to the old font set.
    clearSlots()
    if engine.hasShownValue() {
      reportIntrinsicSize()
    }
    render()
    warmSwapImages()
  }

  /// Renders the ten digits' sharp and blurred images ahead of the first
  /// numeric swap, on the next turn of the main queue so the mount itself
  /// pays nothing. Rendered on demand instead, the first change of a session
  /// spent its opening frames drawing glyphs, and the spring had landed by
  /// the time the second frame was on screen.
  private func warmSwapImages() {
    guard timing.transition == .numeric else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self, self.timing.transition == .numeric else { return }
      let tints = [self.flash.upColor, self.flash.downColor].compactMap { $0 }
      let roles: [GlyphRole] = self.format.fractionDigits > 0 ? [.digit, .fraction] : [.digit]
      for role in roles {
        for digit in self.fonts.glyphs {
          for level in 0...Self.numericBlurLevels {
            _ = self.fonts.blurredImage(digit, role: role, level: level)
            for tint in tints {
              _ = self.fonts.tintedBlurredImage(digit, role: role, tint: tint, level: level)
            }
          }
        }
      }
    }
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

  private static func makeFont(size: CGFloat, weight: CGFloat, family: String?, tabular: Bool) -> UIFont {
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
    // Tabular (monospaced) digits so every column has the same width, or the
    // font's proportional ones when each digit is laid out at its own width.
    let selector = tabular ? kMonospacedNumbersSelector : kProportionalNumbersSelector
    let feature: [UIFontDescriptor.FeatureKey: Int]
    if #available(iOS 15.0, *) {
      feature = [.type: kNumberSpacingType, .selector: selector]
    } else {
      feature = [.featureIdentifier: kNumberSpacingType, .typeIdentifier: selector]
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
    /// A text slot swapping: its slot, the text leaving, and the side it keeps to (-1 left, 0 centre, 1 right).
    var slot = -1
    var fromText: String?
    var anchor = 1
    /// Space after the cell (letter spacing, or an affix seam), scaled with it; not part of the glyph's box.
    var gap: CGFloat = 0
    /// Wheels: whose font draws it, the integer digits' or the fraction's.
    var role: GlyphRole = .digit
    var advance: CGFloat { width + gap }
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
  private func buildElements(into elements: inout [Element], wheels: [Engine.Wheel], signFactor: Double, animated: Bool = true) {
    elements.removeAll(keepingCapacity: true)
    let fonts = self.fonts
    // The decimal columns laid out now: more than the format's while dropped ones close.
    let fd = animated ? Int(engine.displayFractionDigits()) : format.fractionDigits
    let decimal = animated ? engine.decimalFactor() : 1

    func addGlyph(_ text: String, role: GlyphRole, factor: Double, slot: Int = -1, anchor: Int = 1) {
      guard factor > 0 else { return }
      // A slot swapping its text: the width eases from the old text's to the new one's.
      if animated, slot >= 0, let from = leavingText[slot], from != text {
        let change = engine.textChange(Int32(slot))
        if change.active {
          let g = CGFloat(max(0, min(1, change.grow)))
          let fromWidth = fonts.width(of: from, role: role)
          let toWidth = text.isEmpty ? 0 : fonts.width(of: text, role: role)
          elements.append(Element(
            kind: .glyph(text, role),
            width: (fromWidth + (toWidth - fromWidth) * g) * CGFloat(factor),
            fullWidth: max(fromWidth, toWidth),
            factor: factor,
            slot: slot,
            fromText: from,
            anchor: anchor
          ))
          return
        }
      }
      guard !text.isEmpty else { return }
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
    let signGlyph = engine.signPositive() ? format.plusSign : format.minusSign
    // A swapping affix keeps to the digits' side; a separator is centred.
    if rtl {
      addGlyph(affixes.suffixInk, role: .suffix, factor: 1, slot: Self.suffixText, anchor: 1)
      addGlyph(affixes.suffixGap, role: .suffix, factor: 1)
    } else {
      // Sign first, then the currency prefix: "-$1,234.50".
      addGlyph(signGlyph, role: .digit, factor: signFactor, slot: Self.signText, anchor: 1)
      addGlyph(affixes.prefixInk, role: .prefix, factor: 1, slot: Self.prefixText, anchor: 1)
    }
    var power = wheels.count - 1
    while power >= 0 {
      let wheel = wheels[power]
      if wheel.width > 0 {
        let role: GlyphRole = power < fd ? .fraction : .digit
        let advance = digitAdvance(wheel, power: power, role: role, fonts: fonts, settled: !animated)
        elements.append(Element(kind: .wheel(power), width: advance * CGFloat(wheel.width), fullWidth: advance, factor: wheel.width, role: role))
      }
      if power > fd, Self.isGroupBoundary(power - fd, sizes: format.groupingSizes) {
        addGlyph(format.groupingSeparator, role: .digit, factor: wheel.width, slot: Self.groupingText, anchor: 0)
      }
      if fd > 0, power == fd {
        addGlyph(format.decimalSeparator, role: .fraction, factor: decimal, slot: Self.decimalText, anchor: 0)
      }
      power -= 1
    }
    if rtl {
      addGlyph(affixes.prefixGap, role: .prefix, factor: 1)
      addGlyph(affixes.prefixInk, role: .prefix, factor: 1, slot: Self.prefixText, anchor: -1)
      addGlyph(signGlyph, role: .digit, factor: signFactor, slot: Self.signText, anchor: -1)
    } else {
      addGlyph(affixes.suffixInk, role: .suffix, factor: 1, slot: Self.suffixText, anchor: -1)
    }
    applySpacing(to: &elements, fonts: fonts)
  }

  /// Whether a grouping separator follows the `k`th integer digit counted
  /// from the decimal point: every three by default, or `sizes` (the first
  /// group, then each later one: [3, 2] is 12,34,567). A size of 0 is none.
  private static func isGroupBoundary(_ k: Int, sizes: [Int]) -> Bool {
    let primary = sizes.first ?? 3
    guard primary > 0, k >= primary else { return false }
    let secondary = sizes.count > 1 ? sizes[1] : primary
    guard secondary > 0 else { return k == primary }
    return (k - primary) % secondary == 0
  }

  /// A wheel's cell width at full size: the widest digit's with tabular
  /// figures; otherwise its target digit's, eased there once from where the
  /// column was on the wheel's own progress. Following the digits a wheel
  /// rolled past made every column pulse as a narrow 1 went by. Settled, and
  /// throughout a reveal (whose layout is the target's from the first frame),
  /// it is the target digit's.
  private func digitAdvance(_ wheel: Engine.Wheel, power: Int, role: GlyphRole, fonts: FontSet, settled: Bool) -> CGFloat {
    guard fonts.proportional else { return fonts.digitWidth(for: role) }
    let widths = fonts.digitWidths(for: role)
    let digit = max(0, min(9, Int(engine.targetDigit(Int32(power)))))
    let goal = widths[digit]
    if settled || engine.isRevealing() { return goal }
    var cell = cellWidths[power] ?? CellWidth()
    if cell.role != role {
      // A column that became a fraction digit (or stopped being one) starts over in its new font.
      cell = CellWidth()
      cell.role = role
    }
    if cell.digit != digit || wheel.progress < cell.progress {
      // Interrupted mid-change, it carries on from what it showed; from rest,
      // from the digit the wheel is leaving.
      cell.from = cell.digit >= 0 && cell.progress < 1 ? cell.shown : restingWidth(wheel, modulus: Int(engine.wheelModulus(Int32(power))), widths: widths, goal: goal)
      cell.digit = digit
    }
    cell.progress = wheel.progress
    cell.shown = cell.from + (goal - cell.from) * CGFloat(max(0, min(1, wheel.progress)))
    cellWidths[power] = cell
    return cell.shown
  }

  /// The width of the digit a wheel shows at the start of a change (blank takes the target's).
  private func restingWidth(_ wheel: Engine.Wheel, modulus: Int, widths: [CGFloat], goal: CGFloat) -> CGFloat {
    let glyph: Int
    if wheel.blend < 1 {
      glyph = Int(wheel.fromGlyph)
    } else {
      glyph = Int((wheel.linear ? wheel.position : Self.wrap(wheel.position, modulus)).rounded()) % modulus
    }
    return glyph >= 0 ? widths[glyph % 10] : goal
  }

  /// A proportional column's width through a change, by place value.
  private struct CellWidth {
    var from: CGFloat = 0
    var shown: CGFloat = 0
    var digit = -1
    var progress: Double = 1
    var role: GlyphRole = .digit
  }

  private var cellWidths: [Int: CellWidth] = [:]

  /// Letter spacing after every cell, and the affix seams: the space between
  /// the prefix and the digits and between the digits and the suffix.
  private func applySpacing(to elements: inout [Element], fonts: FontSet) {
    guard fonts.digitSpacing != 0 || fonts.prefixSeam != nil || fonts.suffixSeam != nil else { return }
    func role(_ e: Element) -> GlyphRole {
      if case .glyph(_, let r) = e.kind { return r }
      return .digit
    }
    for i in elements.indices {
      elements[i].gap = fonts.spacing(for: role(elements[i])) * CGFloat(elements[i].factor)
    }
    // The seam is the gap at the affix's edge that faces the digits (the far side in RTL).
    let rtl = isRTL
    if let seam = fonts.prefixSeam {
      if !rtl, let last = elements.lastIndex(where: { role($0) == .prefix }) {
        elements[last].gap = seam
      } else if rtl, let first = elements.firstIndex(where: { role($0) == .prefix }), first > 0 {
        elements[first - 1].gap = seam
      }
    }
    if let seam = fonts.suffixSeam {
      if !rtl, let first = elements.firstIndex(where: { role($0) == .suffix }), first > 0 {
        elements[first - 1].gap = seam
      } else if rtl, let last = elements.lastIndex(where: { role($0) == .suffix }) {
        elements[last].gap = seam
      }
    }
  }

  /// The layout direction this view is in. The hybrid sets
  /// `semanticContentAttribute` from the `rightToLeft` prop, since Fabric
  /// never hands a Hybrid View its resolved direction.
  var isRTL: Bool { effectiveUserInterfaceLayoutDirection == .rightToLeft }

  /// `.auto` resolved: in a box that hugs the figure, the edge the box kept
  /// the last time it changed width (`learnAnchor`), else the start edge of
  /// the layout direction. The rest are already absolute.
  private var resolvedAlignment: Alignment {
    guard alignment == .auto else { return alignment }
    if let autoAnchor, hugsFigure { return autoAnchor }
    return isRTL ? .right : .left
  }

  // A box that hugs the figure is as wide as the figure at rest, so its
  // alignment only shows while the figure grows or shrinks: the box takes the
  // new width at once and the digits open or close inside it. Which edge they
  // keep to is the edge the parent keeps the box to: a figure at the end of a
  // row (`justifyContent: 'space-between'`) keeps its right edge, and
  // start-aligned it jumped a digit to the left and then opened a gap after
  // its prefix. So `.auto` follows the box: the edge that stayed put when its
  // width last changed, both for a centred box.
  private var autoAnchor: Alignment?
  private var laidFrame: CGRect?

  /// A size reported and not yet laid out by React: for a frame or two the box
  /// still has the old width. Counted as hugging, or a shrinking figure fell
  /// back to the start edge for those frames and flashed across the box.
  private var awaitingLayout = false

  private var hugsFigure: Bool {
    lastReportedSize.width > 0 && (awaitingLayout || abs(bounds.width - lastReportedSize.width) <= 1)
  }

  /// Where the box sits in the view that lays it out (Fabric wraps a Hybrid
  /// View in its component view, whose parent that is).
  private func learnAnchor() {
    guard let container = superview, let parent = container.superview else { return }
    let frame = convert(bounds, to: parent)
    defer { laidFrame = frame }
    guard let previous = laidFrame, abs(frame.width - previous.width) > 0.5 else { return }
    let dl = frame.minX - previous.minX
    let dr = frame.maxX - previous.maxX
    if abs(dl) <= 0.5 {
      autoAnchor = .left
    } else if abs(dr) <= 0.5 {
      autoAnchor = .right
    } else if abs(dl + dr) <= 1 {
      autoAnchor = .center
    }
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
      settledWheels.append(Engine.Wheel(position: 0, width: 1, linear: false, blankZero: false, fromGlyph: -1, toGlyph: -1, blend: 1, fromAbove: true, focus: 1, grow: 1, blurOut: 1, flash: 0, flashUp: true, progress: 1))
    }
    buildElements(into: &settledBuffer, wheels: settledWheels, signFactor: engine.settledNegative() ? 1 : 0, animated: false)
    return settledBuffer.reduce(CGFloat(0)) { $0 + $1.advance }
  }

  /// Formats the target the way it is displayed, for VoiceOver.
  private func accessibleText() -> String {
    let fd = format.fractionDigits
    var digits = ""
    var power = Int(engine.settledPowerCount()) - 1
    while power >= 0 {
      digits += String(engine.targetDigit(Int32(power)))
      if power > fd, Self.isGroupBoundary(power - fd, sizes: format.groupingSizes) {
        digits += format.groupingSeparator
      }
      if fd > 0, power == fd {
        digits += format.decimalSeparator
      }
      power -= 1
    }
    // `settledNegative` is whether the settled figure carries a sign, a plus included.
    let sign = engine.settledNegative() ? (engine.signPositive() ? format.plusSign : format.minusSign) : ""
    return sign + format.prefix + digits + format.suffix
  }

  /// An `accessibilityLabel` the app set, which VoiceOver reads instead of the figure.
  private var explicitAccessibilityLabel: String?

  // VoiceOver reads the settled figure when it asks for it, so a value update
  // (which can come every frame) formats nothing.
  override var accessibilityLabel: String? {
    get {
      if let explicit = explicitAccessibilityLabel, !explicit.isEmpty { return explicit }
      return engine.hasShownValue() ? accessibleText() : nil
    }
    set { explicitAccessibilityLabel = newValue }
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
    // Only a box that hugged the old size will follow the new one.
    awaitingLayout = lastReportedSize.width > 0 && abs(bounds.width - lastReportedSize.width) <= 1
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
      slot.overlay?.removeFromSuperlayer()
    }
    slots = []
  }

  private func renderLayers() {
    let fonts = self.fonts
    for slot in 0..<leavingText.count where leavingText[slot] != nil && !engine.textChange(Int32(slot)).active {
      leavingText[slot] = nil
    }
    syncWheels()
    buildElements(into: &elementBuffer, wheels: wheelBuffer, signFactor: engine.signFactor())
    let wheels = wheelBuffer
    let elements = elementBuffer
    let total = elements.reduce(CGFloat(0)) { $0 + $1.advance }
    updateFontScale(contentWidth: total)
    let placement = contentPlacement(total: total, lineHeight: fonts.lineHeight)

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
      // The mask: the cell, widened on its far side to the whole glyph. A cell
      // still opening or closing is not cut to its width (the glyph read as a
      // sliver of its right edge, a ")" of a 0 rolling past); the glyph
      // overhangs, faded (`openingOpacity`). Vertically it is the roll's window.
      var mask = CGRect(x: x + element.width - element.fullWidth, y: 0, width: element.fullWidth, height: fonts.lineHeight)
      if case .wheel = element.kind {
        // A digit column is the widest digit wide, centred on the digit's own
        // cell (with tabular figures the two are the same, right-aligned).
        let column = fonts.digitWidth(for: element.role)
        mask = CGRect(x: x + element.width - (element.fullWidth + column) / 2, y: 0, width: column, height: fonts.lineHeight)
      }
      if slot.frame != mask {
        slot.layer.frame = mask
        slot.overlay?.frame = frame
        slots[i].frame = mask
      }
      switch element.kind {
      case .wheel(let index):
        let wheel = wheels[index]
        let opacity = Self.openingOpacity(wheel.width)
        if slot.opacity != opacity {
          slot.layer.opacity = opacity
          slot.overlay?.opacity = Float(wheel.width)
          slots[i].opacity = opacity
        }
        let strip = slot.inner
        let swapping = wheel.blend < 1 || wheel.focus < 1 || wheel.grow < 1
        let tint = wheel.flash > 0.002 ? (wheel.flashUp ? flash.upColor : flash.downColor) : nil
        // While the glyphs swap, the strip stays put underneath, hidden.
        if swapping {
          let swap: SwapLayers
          if let existing = slot.swap {
            swap = existing
          } else {
            swap = SwapLayers(scale: fonts.renderScale)
            // Above every container, unclipped, so the blur's haze stays whole.
            let overlay = QuietLayer()
            overlay.frame = frame
            overlay.opacity = Float(wheel.width)
            for layer in swap.all { overlay.addSublayer(layer) }
            contentLayer.addSublayer(overlay)
            slots[i].overlay = overlay
            slots[i].swap = swap
          }
          layoutSwap(swap, wheel: wheel, role: element.role, fonts: fonts, cellWidth: element.width, advance: element.fullWidth, tint: tint, flash: CGFloat(wheel.flash))
        } else if let swap = slot.swap, !swap.hidden {
          for layer in swap.all { layer.isHidden = true }
          swap.hidden = true
        }
        if strip.isHidden != swapping { strip.isHidden = swapping }
        let modulus = Int(engine.wheelModulus(Int32(index)))
        let variant = Self.stripVariant(role: element.role, blankZero: wheel.blankZero, modulus: modulus)
        if slot.stripVariant != variant {
          if let image = fonts.strip(role: element.role, blankZero: wheel.blankZero, modulus: modulus) {
            strip.contents = image.cgImage
            strip.bounds = CGRect(origin: .zero, size: image.size)
          }
          slots[i].stripVariant = variant
          slots[i].innerFrame = .null
        }
        // Linear strips run from -1 (blank) to 9; a roll can be any real, so wrap it onto the wheel's places.
        let position = wheel.linear ? wheel.position : Self.wrap(wheel.position, modulus)
        let stripFrame = CGRect(
          x: 0,
          y: -(position + 1) * fonts.lineHeight,
          width: strip.bounds.width,
          height: strip.bounds.height
        )
        if slot.innerFrame != stripFrame {
          strip.frame = stripFrame
          slots[i].innerFrame = stripFrame
        }
        layoutFlash(slotIndex: i, wheel: wheel, role: element.role, modulus: modulus, tint: swapping ? nil : tint, fonts: fonts, stripFrame: stripFrame)
      case .glyph(let text, let role):
        if let from = element.fromText {
          // Swapping its text: the overlay's pair of pairs instead of the image.
          if !slot.layer.isHidden { slot.layer.isHidden = true }
          let swap: TextSwapLayers
          if let existing = slot.textSwap {
            swap = existing
          } else {
            swap = TextSwapLayers(scale: fonts.renderScale)
            let overlay = QuietLayer()
            overlay.frame = frame
            for layer in swap.all { overlay.addSublayer(layer) }
            contentLayer.addSublayer(overlay)
            slots[i].overlay = overlay
            slots[i].textSwap = swap
          }
          layoutTextSwap(swap, element: element, from: from, to: text, role: role, fonts: fonts)
          x += element.advance
          continue
        }
        if slot.layer.isHidden { slot.layer.isHidden = false }
        if let swap = slot.textSwap, !swap.hidden {
          for layer in swap.all { layer.isHidden = true }
          swap.hidden = true
        }
        let opacity = Self.openingOpacity(element.factor)
        if slot.opacity != opacity {
          slot.layer.opacity = opacity
          slots[i].opacity = opacity
        }
        let image = slot.inner
        let imageFrame = CGRect(
          x: 0,
          y: slot.glyphTop,
          width: image.bounds.width,
          height: image.bounds.height
        )
        if slot.innerFrame != imageFrame {
          image.frame = imageFrame
          slots[i].innerFrame = imageFrame
        }
      }
      x += element.advance
    }
  }

  /// Opacity of a cell `width` open (0…1). Squared, so while a glyph
  /// overhangs a narrow cell the overlap stays faint.
  static func openingOpacity(_ width: Double) -> Float {
    let w = max(0, min(1, width))
    return Float(w * w)
  }

  // The numeric transition's geometry, in line heights; mirrors
  // `RollingEngine::kNumeric*`, where the effect is described.
  static let numericOffset: CGFloat = 0.34
  static let numericScale: CGFloat = 0.4
  /// The blur radius at full blur, in line heights: SwiftUI's own.
  static let numericBlur: CGFloat = 0.08
  /// Blurred copies per digit, from a touch of blur to the full one.
  static let numericBlurLevels = 6

  /// Places the leaving and the arriving glyph of a swapping wheel for this
  /// frame: each scaled about its centre, offset along the axis, faded, and
  /// cross-faded with its blurred image as it goes out of, or comes into,
  /// focus. With a change flash on (`tint`), the same two again in the tint
  /// at `flash` of their opacity, over them: the ink mixed towards the tint.
  private func layoutSwap(_ swap: SwapLayers, wheel: Engine.Wheel, role: GlyphRole, fonts: FontSet, cellWidth: CGFloat, advance: CGFloat, tint: UIColor?, flash: CGFloat) {
    // The position clock overshoots 1 (a spring); only the offsets follow it there.
    let b = CGFloat(wheel.blend)
    let g = max(0, min(1, CGFloat(wheel.grow)))
    let f = max(0, min(1, CGFloat(wheel.focus)))
    let d: CGFloat = wheel.fromAbove ? 1 : -1
    let offset = fonts.lineHeight * Self.numericOffset
    // The digit sits right-aligned in its cell (the cell shrinks and grows from the left).
    let center = CGPoint(x: cellWidth - advance / 2, y: fonts.digitCenterY(for: role))
    let outGlyph = Int(wheel.fromGlyph)
    let outCenter = CGPoint(x: center.x, y: center.y + d * offset * b)
    let outScale = 1 - (1 - Self.numericScale) * g
    let outAlpha = 1 - g
    let outBlur = max(0, min(1, CGFloat(wheel.blurOut)))
    let inGlyph = Int(wheel.toGlyph)
    let inCenter = CGPoint(x: center.x, y: center.y - d * offset * (1 - b))
    let inScale = Self.numericScale + (1 - Self.numericScale) * g
    let inAlpha = g
    let inBlur = 1 - f
    placeSwapGlyph(swap.leaving, glyph: outGlyph, role: role, fonts: fonts, tint: nil, center: outCenter, scale: outScale, alpha: outAlpha, blur: outBlur)
    placeSwapGlyph(swap.arriving, glyph: inGlyph, role: role, fonts: fonts, tint: nil, center: inCenter, scale: inScale, alpha: inAlpha, blur: inBlur)
    let tintAlpha = tint == nil ? 0 : flash
    placeSwapGlyph(swap.leavingTint, glyph: outGlyph, role: role, fonts: fonts, tint: tint, center: outCenter, scale: outScale, alpha: outAlpha * tintAlpha, blur: outBlur)
    placeSwapGlyph(swap.arrivingTint, glyph: inGlyph, role: role, fonts: fonts, tint: tint, center: inCenter, scale: inScale, alpha: inAlpha * tintAlpha, blur: inBlur)
    swap.hidden = false
  }

  /// A prefix, suffix or separator changing its text, drawn like a swapping
  /// digit without the travel: the old text blurs and fades out as the new
  /// one comes into focus, each kept to the side of the cell that faces the
  /// digits (a separator centred).
  private func layoutTextSwap(_ swap: TextSwapLayers, element: Element, from: String, to: String, role: GlyphRole, fonts: FontSet) {
    let change = engine.textChange(Int32(element.slot))
    let g = CGFloat(max(0, min(1, change.grow)))
    let opening = CGFloat(Self.openingOpacity(element.factor))
    func left(_ text: String) -> CGFloat {
      let width = fonts.width(of: text, role: role)
      switch element.anchor {
      case -1: return 0
      case 0: return (element.width - width) / 2
      default: return element.width - width
      }
    }
    placeTextGlyph(swap.leaving, text: from, role: role, fonts: fonts, left: left(from), alpha: (1 - g) * opening, blur: CGFloat(change.blurOut))
    placeTextGlyph(swap.arriving, text: to, role: role, fonts: fonts, left: left(to), alpha: g * opening, blur: 1 - CGFloat(change.focus))
    swap.hidden = false
  }

  /// One text of a text swap, its left edge at `left` in the cell: the two
  /// blur levels nearest `amount`, cross-faded as `placeSwapGlyph` does.
  private func placeTextGlyph(_ pair: (GlyphLayer, GlyphLayer), text: String, role: GlyphRole, fonts: FontSet, left: CGFloat, alpha: CGFloat, blur amount: CGFloat) {
    guard !text.isEmpty, alpha > 0.002, let sharp = fonts.image(text, role: role) else {
      if !pair.0.layer.isHidden { pair.0.layer.isHidden = true }
      if !pair.1.layer.isHidden { pair.1.layer.isHidden = true }
      return
    }
    let levels = Self.numericBlurLevels
    let x = max(0, min(1, amount)) * CGFloat(levels)
    let lo = min(levels, Int(floor(x)))
    let hi = min(levels, lo + 1)
    let w = lo == levels ? 0 : x - CGFloat(lo)
    let hiAlpha = alpha * w
    let loAlpha = hiAlpha >= 0.999 ? 0 : alpha * (1 - w) / (1 - hiAlpha)
    // Blurred images are padded evenly, so each shares the sharp one's centre.
    let center = CGPoint(x: left + sharp.size.width / 2, y: fonts.top(for: role, text: text, lineTop: 0) + sharp.size.height / 2)
    // A local function, not a loop over an array literal: that allocated an array per call.
    func place(_ slot: GlyphLayer, _ level: Int, _ layerAlpha: CGFloat) {
      let layer = slot.layer
      let hidden = layerAlpha <= 0.002
      if layer.isHidden != hidden { layer.isHidden = hidden }
      if hidden { return }
      if slot.text != text || slot.level != level {
        if let image = fonts.blurredImage(text, role: role, level: level) {
          layer.contents = image.cgImage
          layer.bounds = CGRect(origin: .zero, size: image.size)
        }
        slot.text = text
        slot.level = level
      }
      layer.position = center
      layer.opacity = Float(layerAlpha)
    }
    place(pair.0, lo, loAlpha)
    place(pair.1, hi, hiAlpha)
  }

  /// Places one glyph of a swap: the two blur levels nearest `amount` (of
  /// `numericBlurLevels`, level 0 sharp), cross-faded by where between them
  /// it falls, so a glyph half out of focus is half-blurred rather than a
  /// sharp glyph half-hidden in a fully blurred one.
  private func placeSwapGlyph(_ pair: (GlyphLayer, GlyphLayer), glyph: Int, role: GlyphRole, fonts: FontSet, tint: UIColor?, center: CGPoint, scale: CGFloat, alpha: CGFloat, blur amount: CGFloat) {
    guard glyph >= 0, alpha > 0.002 else {
      if !pair.0.layer.isHidden { pair.0.layer.isHidden = true }
      if !pair.1.layer.isHidden { pair.1.layer.isHidden = true }
      return
    }
    let levels = Self.numericBlurLevels
    let x = max(0, min(1, amount)) * CGFloat(levels)
    let lo = min(levels, Int(floor(x)))
    let hi = min(levels, lo + 1)
    let w = lo == levels ? 0 : x - CGFloat(lo)
    // The two levels composite "over", which is not additive: at (1 - w) and
    // w they came out only 75 % opaque half way between levels, and the
    // digit pulsed paler and darker at every level crossing. The upper one
    // gets its share, w, of the opacity and the lower one whatever makes the
    // pair composite to the whole of it.
    let hiAlpha = alpha * w
    let loAlpha = hiAlpha >= 0.999 ? 0 : alpha * (1 - w) / (1 - hiAlpha)
    let tintKey = tint.map { FontSet.key(of: $0) } ?? 0
    let text = fonts.glyphs[glyph % 10]
    let transform = CATransform3DMakeScale(scale, scale, 1)
    // A local function, not a loop over an array literal: that allocated an array per call.
    func place(_ slot: GlyphLayer, _ level: Int, _ layerAlpha: CGFloat) {
      let layer = slot.layer
      let hidden = layerAlpha <= 0.002
      if layer.isHidden != hidden { layer.isHidden = hidden }
      if hidden { return }
      if slot.glyph != glyph || slot.level != level || slot.tint != tintKey {
        if let image = fonts.swapImage(text, role: role, level: level, tint: tint) {
          layer.contents = image.cgImage
          layer.bounds = CGRect(origin: .zero, size: image.size)
        }
        slot.glyph = glyph
        slot.level = level
        slot.tint = tintKey
      }
      layer.position = center
      layer.transform = transform
      layer.opacity = Float(layerAlpha)
    }
    place(pair.0, lo, loAlpha)
    place(pair.1, hi, hiAlpha)
  }

  /// The change flash of a wheel that is not swapping (at rest, or rolling):
  /// a tinted copy of its strip at the strip's own offset, in the up or the
  /// down colour at the flash's opacity, so the tint rides the roll instead
  /// of hovering over it. A swapping wheel's flash is its swap layers' tinted
  /// twins (`layoutSwap`), so `tint` is nil for it.
  private func layoutFlash(slotIndex i: Int, wheel: Engine.Wheel, role: GlyphRole, modulus: Int, tint: UIColor?, fonts: FontSet, stripFrame: CGRect) {
    guard let tint, !stripFrame.isNull else {
      if let layer = slots[i].flashLayer, !layer.isHidden { layer.isHidden = true }
      return
    }
    let layer: CALayer
    if let existing = slots[i].flashLayer {
      layer = existing
    } else {
      layer = QuietLayer()
      layer.contentsScale = fonts.renderScale
      slots[i].layer.addSublayer(layer)
      slots[i].flashLayer = layer
    }
    let tintKey = FontSet.key(of: tint)
    // The strip's own tinted twin, keyed as a glyph the digits can never be.
    let stripGlyph = 100 + Self.stripVariant(role: role, blankZero: wheel.blankZero, modulus: modulus)
    if slots[i].flashGlyph != stripGlyph || slots[i].flashTint != tintKey {
      guard let image = fonts.tintedStrip(role: role, blankZero: wheel.blankZero, modulus: modulus, tint: tint) else { return }
      layer.contents = image.cgImage
      slots[i].flashGlyph = stripGlyph
      slots[i].flashTint = tintKey
    }
    layer.frame = stripFrame
    layer.opacity = Float(CGFloat(wheel.flash) * CGFloat(wheel.width))
    if layer.isHidden { layer.isHidden = false }
  }

  /// Makes `slots` match `elements` one to one; layers are only rebuilt when
  /// the element kinds change (a wheel appearing or disappearing).
  private func syncSlots(with elements: [Element], wheels: [Engine.Wheel], fonts: FontSet) {
    if slotsMatch(elements) { return }
    clearSlots()
    slots.reserveCapacity(elements.count)
    for element in elements {
      let container = QuietLayer()
      container.masksToBounds = true
      let inner = QuietLayer()
      inner.contentsScale = fonts.renderScale
      switch element.kind {
      case .wheel(let index):
        let blankZero = wheels[index].blankZero
        let modulus = Int(engine.wheelModulus(Int32(index)))
        if let strip = fonts.strip(role: element.role, blankZero: blankZero, modulus: modulus) {
          inner.contents = strip.cgImage
          inner.bounds = CGRect(origin: .zero, size: strip.size)
        }
        container.addSublayer(inner)
        contentLayer.addSublayer(container)
        slots.append(ElementLayer(kind: .wheel, layer: container, inner: inner, stripVariant: Self.stripVariant(role: element.role, blankZero: blankZero, modulus: modulus), glyphTop: 0))
      case .glyph(let text, let role):
        if let image = fonts.image(text, role: role) {
          inner.contents = image.cgImage
          inner.bounds = CGRect(origin: .zero, size: image.size)
        }
        container.addSublayer(inner)
        contentLayer.addSublayer(container)
        slots.append(ElementLayer(kind: .glyph(text, role), layer: container, inner: inner, stripVariant: -1, glyphTop: fonts.top(for: role, text: text, lineTop: 0)))
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

  /// Which strip a wheel draws from, as one comparable number.
  private static func stripVariant(role: GlyphRole, blankZero: Bool, modulus: Int) -> Int {
    (blankZero ? 1 : 0) | (modulus << 1) | (role == .fraction ? 1 << 8 : 0)
  }

  private static func wrap10(_ position: Double) -> Double {
    wrap(position, 10)
  }

  /// `position` wrapped onto 0..<`modulus` (a wheel's places, 10 or a clock's 6).
  private static func wrap(_ position: Double, _ modulus: Int) -> Double {
    let m = Double(modulus)
    let r = fmod(position, m)
    return r < 0 ? r + m : r
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
    let total = elements.reduce(CGFloat(0)) { $0 + $1.advance }
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
        drawWheel(wheels[index], role: element.role, modulus: Int(engine.wheelModulus(Int32(index))), fonts: fonts, x: x, width: element.width, advance: element.fullWidth, ctx: ctx)
      case .glyph(let text, let role):
        drawGlyph(text, role: role, fonts: fonts, x: x, width: element.width, fullWidth: element.fullWidth, alpha: element.factor, ctx: ctx)
      }
      x += element.advance
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
    (shimmer.baseColor ?? typography.color).resolvedColor(with: traitCollection).getRed(&br, green: &bg, blue: &bb, alpha: &ba)
    var hr: CGFloat = 0, hg: CGFloat = 0, hb: CGFloat = 0, ha: CGFloat = 1
    (shimmer.color ?? Self.defaultShimmerColor).resolvedColor(with: traitCollection).getRed(&hr, green: &hg, blue: &hb, alpha: &ha)
    let base = CGColor(red: br, green: bg, blue: bb, alpha: ba)
    let colors = [base, CGColor(red: hr, green: hg, blue: hb, alpha: ha), base] as CFArray
    guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0.1, 0.5, 0.9]) else { return }
    // One sweep takes `duration`; the band then waits off the far edge for `delay`.
    let cycle = shimmer.duration + shimmer.delay
    let phase = min(1, CGFloat(engine.shimmerPhase(CACurrentMediaTime(), cycle)) * CGFloat(cycle / shimmer.duration))
    let seeded = Self.shimmerSeed + (1 - Self.shimmerSeed) * phase
    let ltr = shimmer.leftToRight ?? !isRTL
    let progress = ltr ? seeded : 1 - seeded
    // The gradient runs `length` along x (its slant on top): it enters at the
    // left edge and leaves past the right, or the mirror image.
    let length = contentWidth * max(0.05, shimmer.width)
    let startX = (contentWidth + length) * progress - length
    let slant = tan(max(-75, min(75, shimmer.angle)) * .pi / 180) * (ltr ? 1 : -1)
    ctx.saveGState()
    ctx.setBlendMode(.sourceAtop)
    ctx.setAlpha(dim)
    ctx.drawLinearGradient(
      gradient,
      start: CGPoint(x: startX, y: 0),
      end: CGPoint(x: startX + length, y: slant * length),
      options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
    )
    ctx.restoreGState()
  }

  private func drawGlyph(_ text: String, role: GlyphRole, fonts: FontSet, x: CGFloat, width: CGFloat, fullWidth: CGFloat, alpha: Double, ctx: CGContext) {
    guard width > 0 else { return }
    ctx.saveGState()
    // Whole against the text it joins while its cell opens, faded; see `renderLayers`.
    ctx.clip(to: CGRect(x: x + width - fullWidth, y: 0, width: fullWidth, height: fonts.lineHeight))
    ctx.setAlpha(CGFloat(Self.openingOpacity(alpha)))
    fonts.image(text, role: role)?.draw(at: CGPoint(x: x + width - fullWidth, y: fonts.top(for: role, text: text, lineTop: 0)))
    ctx.restoreGState()
  }

  private func drawWheel(_ wheel: Engine.Wheel, role: GlyphRole, modulus: Int, fonts: FontSet, x: CGFloat, width: CGFloat, advance: CGFloat, ctx: CGContext) {
    guard width > 0 else { return }
    let lineHeight = fonts.lineHeight
    let column = fonts.digitWidth(for: role)
    // The digit column, the widest digit wide, centred on the digit's own cell.
    let columnLeft = x + width - (advance + column) / 2
    let top = role == .fraction ? fonts.top(for: .fraction, text: fonts.glyphs[0], lineTop: 0) : 0
    ctx.saveGState()
    // The roll's window, the whole digit wide (see `renderLayers`).
    ctx.clip(to: CGRect(x: columnLeft, y: 0, width: column, height: lineHeight))
    ctx.setAlpha(CGFloat(Self.openingOpacity(wheel.width)))
    if wheel.blend < 1 || wheel.focus < 1 || wheel.grow < 1 {
      // The numeric transition under the glint: the pair, without the blur.
      let b = CGFloat(wheel.blend)
      let g = max(0, min(1, CGFloat(wheel.grow)))
      let d: CGFloat = wheel.fromAbove ? 1 : -1
      let offset = lineHeight * Self.numericOffset
      let cx = columnLeft + column / 2
      let cy = fonts.digitCenterY(for: role)
      let pair: [(glyph: Int, dy: CGFloat, scale: CGFloat, alpha: CGFloat)] = [
        (Int(wheel.fromGlyph), d * offset * b, 1 - (1 - Self.numericScale) * g, 1 - g),
        (Int(wheel.toGlyph), -d * offset * (1 - b), Self.numericScale + (1 - Self.numericScale) * g, g),
      ]
      for item in pair where item.glyph >= 0 && item.alpha > 0.002 {
        guard let image = fonts.image(fonts.glyphs[item.glyph % 10], role: role) else { continue }
        ctx.saveGState()
        ctx.setAlpha(CGFloat(wheel.width) * item.alpha)
        ctx.translateBy(x: cx, y: cy + item.dy)
        ctx.scaleBy(x: item.scale, y: item.scale)
        image.draw(at: CGPoint(x: -image.size.width / 2, y: -image.size.height / 2))
        ctx.restoreGState()
      }
      ctx.restoreGState()
      return
    }
    let position = wheel.linear ? wheel.position : Self.wrap(wheel.position, modulus)
    let base = position.rounded(.down)
    let fraction = CGFloat(position - base)
    let index = Int(base)
    if let text = digitText(at: index, in: wheel, modulus: modulus, fonts: fonts), let image = fonts.image(text, role: role) {
      image.draw(at: CGPoint(x: columnLeft + (column - fonts.width(of: text, role: role)) / 2, y: top - fraction * lineHeight))
    }
    if fraction > 0.0001, let text = digitText(at: index + 1, in: wheel, modulus: modulus, fonts: fonts), let image = fonts.image(text, role: role) {
      image.draw(at: CGPoint(x: columnLeft + (column - fonts.width(of: text, role: role)) / 2, y: top + (1 - fraction) * lineHeight))
    }
    ctx.restoreGState()
  }

  private func digitText(at index: Int, in wheel: Engine.Wheel, modulus: Int, fonts: FontSet) -> String? {
    if wheel.linear && index < 0 { return nil }
    if wheel.blankZero && index == 0 { return nil }
    return fonts.glyphs[((index % modulus) + modulus) % modulus]
  }
}

/// A layer that never animates a change implicitly: every layer of a
/// NitroNumber, and of a reflowing NitroInput, is placed frame by frame, by
/// the engine. Switching the actions off with an explicit `CATransaction` did
/// the same, but a display link's callback runs outside any transaction, so
/// each view's frame was a commit of its own to the render server, dozens per
/// frame on a busy screen; these changes join the run loop's one implicit
/// transaction instead.
final class QuietLayer: CALayer {
  override func action(forKey event: String) -> CAAction? { nil }
}

/// `QuietLayer`'s gradient: NitroInput's edge fade is re-laid out with the text.
final class QuietGradientLayer: CAGradientLayer {
  override func action(forKey event: String) -> CAAction? { nil }
}
