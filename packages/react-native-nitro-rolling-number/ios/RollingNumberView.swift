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

  struct Shimmer: Equatable {
    /// Color of the glint's core; `nil` uses a light neutral (dark neutral in dark mode).
    var color: UIColor? = nil
    /// Duration of one sweep across the number.
    var duration: TimeInterval = 0.95
  }

  enum Alignment {
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

  /// Loading glint: full-color ink with a light band sweeping through it.
  var loading = false {
    didSet {
      guard loading != oldValue else { return }
      engine.setReduceMotion(UIAccessibility.isReduceMotionEnabled)
      engine.setLoading(loading, CACurrentMediaTime())
      updateAccessibility()
      updateDisplayLinkNeed()
      render()
    }
  }

  var alignment: Alignment = .left {
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

  /// Digit / prefix / suffix fonts with per-glyph caches.
  private final class FontSet {
    let digit: UIFont
    let prefix: UIFont
    let suffix: UIFont
    let color: UIColor
    let prefixAlign: AffixAlign
    let suffixAlign: AffixAlign
    /// Height of the line box (the digit font's line height).
    let lineHeight: CGFloat
    /// Width of the widest digit glyph.
    private(set) var digitWidth: CGFloat = 0
    private var glyphCache: [String: NSAttributedString] = [:]
    private var widthCache: [String: CGFloat] = [:]
    private var imageCache: [String: UIImage] = [:]
    private var inkDescentCache: [String: CGFloat] = [:]
    /// Pixel density the glyph images are rendered at.
    let renderScale: CGFloat
    /// Slots in a wheel strip: index -1 (blank) through 10 (the 0 after 9).
    static let stripSlots = 12

    init(_ t: Typography) {
      renderScale = max(1, UIScreen.main.scale)
      let scale = RollingNumberView.systemFontMultiplier(t)
      digit = RollingNumberView.makeFont(size: t.fontSize * scale, weight: t.fontWeight, family: t.fontFamily)
      prefix = RollingNumberView.makeFont(size: (t.prefixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily)
      suffix = RollingNumberView.makeFont(size: (t.suffixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily)
      color = t.color
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
      let key = cacheKey(text, role)
      if let cached = glyphCache[key] { return cached }
      let string = NSAttributedString(string: text, attributes: [
        .font: font(for: role),
        .foregroundColor: color,
      ])
      glyphCache[key] = string
      return string
    }

    func width(of text: String, role: GlyphRole) -> CGFloat {
      let key = cacheKey(text, role)
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
      let key = cacheKey(text, role)
      if let cached = imageCache[key] { return cached }
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
      imageCache[key] = image
      return image
    }

    /// A wheel's whole digit strip as one image: slots for index -1 (blank) to
    /// 10 (the 0 that follows 9 on a wrap), each `lineHeight` tall with the
    /// digit centred in `digitWidth`. A wheel layer shows one slot-high window
    /// of it and just moves the strip, so a roll is a position change.
    func strip(blankZero: Bool) -> UIImage? {
      let key = blankZero ? "strip|blank0" : "strip"
      if let cached = imageCache[key] { return cached }
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
      imageCache[key] = image
      return image
    }

    /// How far `text`'s ink hangs below the baseline (0 for digits and capitals).
    func inkDescent(_ text: String, role: GlyphRole) -> CGFloat {
      let key = "ink|" + cacheKey(text, role)
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

    private func cacheKey(_ text: String, _ role: GlyphRole) -> String {
      switch role {
      case .digit: return "d|" + text
      case .prefix: return "p|" + text
      case .suffix: return "s|" + text
      }
    }
  }

  // MARK: - State

  private var engine = Engine()
  private var fonts: FontSet
  private var fontScale: CGFloat = 1
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

  private struct ElementLayer {
    var kind: LayerKind
    var layer: CALayer
    /// Wheels only: which strip variant the layer currently shows.
    var blankZero: Bool
  }

  // MARK: - Lifecycle

  override init(frame: CGRect) {
    fonts = FontSet(Typography())
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

  @objc private func contentSizeCategoryDidChange() {
    guard typography.allowFontScaling else { return }
    rebuildFonts()
  }

  func stopAnimation() {
    stopDisplayLink()
  }

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
    alignment = .left
    revealMilestones = []
    // `onIntrinsicSizeChange`, `onRevealEnd` and `onRevealMilestone` are the
    // hybrid's wiring, not the element's props: they stay across recycling
    // (the hybrid clears its own callback props).
    accessibilityLabel = nil
    accessibilityValue = nil
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
    render()
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
    fonts = FontSet(typography)
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

  private func currentWheels() -> [Engine.Wheel] {
    let count = Int(engine.wheelCount())
    return (0..<count).map { engine.wheelAt(Int32($0)) }
  }

  private func buildElements(wheels: [Engine.Wheel], signFactor: Double) -> [Element] {
    var elements: [Element] = []
    let fd = format.fractionDigits

    func addGlyph(_ text: String, role: GlyphRole, factor: Double) {
      guard !text.isEmpty, factor > 0 else { return }
      let width = fonts.width(of: text, role: role)
      elements.append(Element(kind: .glyph(text, role), width: width * CGFloat(factor), fullWidth: width, factor: factor))
    }

    // Sign first, then the currency prefix: "-$1,234.50".
    addGlyph("-", role: .digit, factor: signFactor)
    addGlyph(format.prefix, role: .prefix, factor: 1)
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
    addGlyph(format.suffix, role: .suffix, factor: 1)
    return elements
  }

  private func settledWidth() -> CGFloat {
    let count = Int(engine.settledPowerCount())
    let settled = (0..<count).map { _ in Engine.Wheel(position: 0, width: 1, linear: false, blankZero: false) }
    return buildElements(wheels: settled, signFactor: engine.settledNegative() ? 1 : 0).reduce(CGFloat(0)) { $0 + $1.width }
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

  private func updateAccessibility() {
    accessibilityLabel = accessibleText()
    accessibilityValue = loading ? "Loading" : nil
  }

  /// A narrower settled size waiting for the current roll to finish before it is reported.
  private var pendingSizeReport = false

  private func reportIntrinsicSize() {
    updateAccessibility()
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
    let wheels = currentWheels()
    let elements = buildElements(wheels: wheels, signFactor: engine.signFactor())
    let total = elements.reduce(CGFloat(0)) { $0 + $1.width }
    updateFontScale(contentWidth: total)
    let placement = contentPlacement(total: total, lineHeight: fonts.lineHeight)

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }

    contentLayer.bounds = CGRect(x: 0, y: 0, width: max(total, 1), height: fonts.lineHeight)
    contentLayer.position = placement.origin
    contentLayer.transform = placement.scale == 1 ? CATransform3DIdentity : CATransform3DMakeScale(placement.scale, placement.scale, 1)

    syncSlots(with: elements, wheels: wheels, fonts: fonts)

    var x: CGFloat = 0
    for (i, element) in elements.enumerated() {
      let slot = slots[i]
      slot.layer.frame = CGRect(x: x, y: 0, width: element.width, height: fonts.lineHeight)
      switch element.kind {
      case .wheel(let index):
        let wheel = wheels[index]
        slot.layer.opacity = Float(wheel.width)
        if let strip = slot.layer.sublayers?.first {
          if slot.blankZero != wheel.blankZero {
            strip.contents = fonts.strip(blankZero: wheel.blankZero)?.cgImage
            slots[i].blankZero = wheel.blankZero
          }
          // Linear strips run from -1 (blank) to 9; a roll can be any real, so wrap it onto 0..<10.
          let position = wheel.linear ? wheel.position : Self.wrap10(wheel.position)
          strip.frame = CGRect(
            x: element.width - fonts.digitWidth,
            y: -(position + 1) * fonts.lineHeight,
            width: strip.bounds.width,
            height: strip.bounds.height
          )
        }
      case .glyph(let text, let role):
        slot.layer.opacity = Float(element.factor)
        if let image = slot.layer.sublayers?.first {
          image.frame = CGRect(
            x: element.width - element.fullWidth,
            y: fonts.top(for: role, text: text, lineTop: 0),
            width: image.bounds.width,
            height: image.bounds.height
          )
        }
      }
      x += element.width
    }
  }

  /// Makes `slots` match `elements` one to one; layers are only rebuilt when
  /// the element kinds change (a wheel appearing or disappearing).
  private func syncSlots(with elements: [Element], wheels: [Engine.Wheel], fonts: FontSet) {
    let kinds: [LayerKind] = elements.map { element in
      switch element.kind {
      case .wheel: return .wheel
      case .glyph(let text, let role): return .glyph(text, role)
      }
    }
    if kinds == slots.map(\.kind) { return }
    clearSlots()
    slots.reserveCapacity(elements.count)
    for (i, element) in elements.enumerated() {
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
        slots.append(ElementLayer(kind: kinds[i], layer: container, blankZero: blankZero))
      case .glyph(let text, let role):
        if let image = fonts.image(text, role: role) {
          inner.contents = image.cgImage
          inner.bounds = CGRect(origin: .zero, size: image.size)
        }
        container.addSublayer(inner)
        contentLayer.addSublayer(container)
        slots.append(ElementLayer(kind: kinds[i], layer: container, blankZero: false))
      }
    }
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
    switch alignment {
    case .left: originX = 0
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
    let wheels = currentWheels()
    let elements = buildElements(wheels: wheels, signFactor: engine.signFactor())
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
