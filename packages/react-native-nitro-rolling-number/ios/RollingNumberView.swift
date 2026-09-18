//
//  RollingNumberView.swift
//  NitroRollingNumber
//
//  A UIView that renders a number as vertically rolling digit columns.
//
//  Every digit is a "column" with a continuous position on a 0–9 strip.
//  The view can either be *driven* (`setValue`: positions are derived directly
//  from a continuous value, odometer style, so a UI-thread animation driver can
//  push a new value every frame) or *rolled* (`animate(to:)`: every column
//  animates independently from its current glyph to the target glyph, like
//  SwiftUI's `.contentTransition(.numericText())`).
//

import CoreText
import UIKit

final class RollingNumberView: UIView {

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
  }

  enum Easing {
    case linear, easeIn, easeOut, easeInOut, spring
  }

  enum Direction {
    case auto, up, down
  }

  struct Timing: Equatable {
    var duration: TimeInterval = 0.5
    var easing: Easing = .easeInOut
    var bounce: Double = 0.15
    /// Delay between the start of each column's roll, least significant first.
    var stagger: TimeInterval = 0
    var direction: Direction = .auto
  }

  struct Shimmer: Equatable {
    /// Color of the glint's core; `nil` uses a light neutral (dark neutral in dark mode).
    var color: UIColor? = nil
    /// Duration of one sweep across the number.
    var duration: TimeInterval = 0.95
  }

  /// Default glint color: a near-background neutral so the ink "lights up".
  private static let defaultShimmerColor = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0x2B / 255, green: 0x2E / 255, blue: 0x37 / 255, alpha: 1)
      : UIColor(red: 0xD6 / 255, green: 0xD9 / 255, blue: 0xE1 / 255, alpha: 1)
  }
  /// The core starts at the glyphs' left edge instead of parked off-screen.
  private static let shimmerSeed: CGFloat = 0.25
  /// How far the top of the band leads the bottom, as a fraction of the height ("/" slant).
  private static let shimmerSlant: CGFloat = 0.6

  enum Alignment {
    case left, center, right
  }

  var format = Format() {
    didSet {
      guard format != oldValue else { return }
      formatDidChange()
    }
  }

  var typography = Typography() {
    didSet {
      guard typography != oldValue else { return }
      rebuildFonts()
    }
  }

  var timing = Timing()

  var shimmer = Shimmer() {
    didSet { setNeedsDisplay() }
  }

  /// Skeleton mode: glyphs are dimmed and a highlight sweeps across them.
  /// Toggling cross-fades over 250 ms.
  var loading = false {
    didSet {
      guard loading != oldValue else { return }
      loadingAnimFrom = loadingProgress
      loadingAnimStart = CACurrentMediaTime()
      if loading { shimmerStart = CACurrentMediaTime() }
      updateDisplayLinkNeed()
      setNeedsDisplay()
    }
  }

  var alignment: Alignment = .left {
    didSet { setNeedsDisplay() }
  }

  /// Called with the settled (target) intrinsic size whenever it changes.
  var onIntrinsicSizeChange: ((CGSize) -> Void)?

  /// The value currently shown or being rolled towards.
  private(set) var targetValue: Double = 0

  // MARK: - Column model

  private struct Column {
    /// Glyph index on the strip. Interior columns wrap modulo 10; linear
    /// columns use `-1` for "blank" and never wrap.
    var position: Double
    /// Horizontal extent, 0…1. Columns appear/disappear by growing/shrinking.
    var width: Double
    /// `true` → the strip is `[blank, 0, 1, …, 9]` (appearing/disappearing columns).
    var linear: Bool
    /// `true` → glyph `0` is drawn blank (the emerging odometer column).
    var blankZero: Bool
  }

  private struct ColumnTransition {
    var from: Column
    var to: Column
  }

  private struct Transition {
    var start: CFTimeInterval
    var duration: TimeInterval
    /// Per-column start delay (least significant first).
    var delays: [TimeInterval]
    var columns: [ColumnTransition]
    var signFrom: Double
    var signTo: Double
    var finalColumns: [Column]
  }

  private struct Target {
    /// `|value| * 10^fractionDigits`, rounded.
    let magnitude: UInt64
    let negative: Bool
    let powerCount: Int

    func digit(at power: Int) -> Int {
      guard power < RollingNumberView.pow10.count else { return 0 }
      return Int((magnitude / RollingNumberView.pow10[power]) % 10)
    }
  }

  private static let pow10: [UInt64] = {
    var table: [UInt64] = [1]
    for _ in 1...19 { table.append(table[table.count - 1] * 10) }
    return table
  }()

  private static let maxPowerCount = 18

  // MARK: - Fonts

  private enum GlyphRole {
    case digit, prefix, suffix
  }

  /// Digit / prefix / suffix fonts at one scale, with per-glyph caches.
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

    init(_ t: Typography, scale: CGFloat) {
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

    /// Top of the glyph's line box for `role`, given the top of the digit line box.
    func top(for role: GlyphRole, lineTop: CGFloat) -> CGFloat {
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
        return lineTop + (digit.lineHeight - f.lineHeight)
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

  private var columns: [Column] = []
  private var signFactor: Double = 0
  private var hasShownValue = false
  private var transition: Transition?
  private var displayLink: CADisplayLink?
  private var settledPowerCount = 1
  private var settledNegative = false
  private var lastReportedSize: CGSize = .zero
  /// 0 = normal, 1 = fully in skeleton mode.
  private var loadingProgress: Double = 0
  private var loadingAnimFrom: Double = 0
  private var loadingAnimStart: CFTimeInterval?
  private var shimmerStart: CFTimeInterval = 0
  private static let loadingFadeDuration: TimeInterval = 0.25

  /// Fonts at the configured size. Shrink-to-fit is a continuous canvas
  /// scale applied at draw time, so glyph metrics never change per frame.
  private var fonts: FontSet
  private var fontScale: CGFloat = 1

  // MARK: - Lifecycle

  override init(frame: CGRect) {
    fonts = FontSet(Typography(), scale: 1)
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    contentMode = .redraw
    // Not clipped: in auto-size mode a new leading digit can draw past the old
    // frame for the one render it takes JS to apply the reported size, instead
    // of being cut off. Nothing else about the roll touches the JS thread.
    clipsToBounds = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    displayLink?.invalidate()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // The shrink-to-fit scale depends on the bounds; it is re-evaluated in draw().
    setNeedsDisplay()
  }

  func stopAnimation() {
    transition = nil
    updateDisplayLinkNeed()
  }

  // MARK: - Public API

  /// Shows `value` immediately with continuously positioned digits (odometer
  /// style). Cancels any running roll. Intended to be called every frame.
  func setValue(_ value: Double) {
    stopAnimation()
    targetValue = value
    hasShownValue = true

    let fd = format.fractionDigits
    var scaled = abs(value) * Double(Self.pow10[fd])
    if !scaled.isFinite { scaled = 0 }
    scaled = min(scaled, 1e15)
    let whole = scaled.rounded(.down)
    let integerPart = UInt64(whole) / Self.pow10[fd]
    let needed = min(Self.maxPowerCount, max(format.minimumIntegerDigits, Self.digitCount(integerPart)) + fd)

    var next: [Column] = []
    next.reserveCapacity(needed + 1)
    for power in 0...needed {
      let p10 = Double(Self.pow10[power])
      let digit = (scaled / p10).rounded(.down).truncatingRemainder(dividingBy: 10)
      let carry: Double
      if power == 0 {
        carry = scaled - whole
      } else {
        // A wheel only turns while every lower wheel is on its way from 9 to 0.
        carry = min(1, max(0, scaled.truncatingRemainder(dividingBy: p10) - (p10 - 1)))
      }
      if power == needed {
        // The next higher column emerges (blank → 1) while the carry is in progress.
        guard carry > 0 else { break }
        next.append(Column(position: carry, width: carry, linear: false, blankZero: true))
      } else {
        next.append(Column(position: digit + carry, width: 1, linear: false, blankZero: false))
      }
    }
    columns = next
    signFactor = value < 0 ? min(1, scaled) : 0
    reportIntrinsicSize(powerCount: next.count, negative: value < 0)
    setNeedsDisplay()
  }

  /// Rolls every digit to `value`. Snaps when `timing.duration` is 0 or when
  /// nothing has been shown yet.
  func animate(to value: Double) {
    let previous = targetValue
    targetValue = value
    let target = makeTarget(value)
    guard hasShownValue, timing.duration > 0 else {
      snap(to: target)
      return
    }

    let increasing: Bool
    switch timing.direction {
    case .auto: increasing = value >= previous
    case .up: increasing = true
    case .down: increasing = false
    }
    let mandatory = format.minimumIntegerDigits + format.fractionDigits
    let count = max(columns.count, target.powerCount)
    var transitions: [ColumnTransition] = []
    var finals: [Column] = []
    transitions.reserveCapacity(count)
    finals.reserveCapacity(target.powerCount)

    for power in 0..<count {
      let current = power < columns.count
        ? columns[power]
        : Column(position: -1, width: 0, linear: true, blankZero: false)
      var from = current
      let to: Column
      if power < target.powerCount {
        let digit = Double(target.digit(at: power))
        let isEdge = power >= mandatory
          && (power >= columns.count || current.width < 1 || current.linear || current.blankZero)
        if isEdge {
          // Appearing (or still appearing) column: linear strip blank → digit.
          if !current.linear { from.position = Self.wrap(current.position) }
          from.linear = true
          to = Column(position: digit, width: 1, linear: true, blankZero: current.blankZero)
        } else {
          // Interior column: shortest roll in the direction of the change.
          let base = Self.wrap(current.position)
          from.position = base
          from.linear = false
          let delta = increasing ? Self.wrap(digit - base) : -Self.wrap(base - digit)
          to = Column(position: base + delta, width: 1, linear: false, blankZero: false)
        }
        finals.append(Column(position: digit, width: 1, linear: false, blankZero: false))
      } else {
        // Disappearing column: roll down to blank while shrinking.
        if !current.linear { from.position = Self.wrap(current.position) }
        from.linear = true
        to = Column(position: -1, width: 0, linear: true, blankZero: current.blankZero)
      }
      transitions.append(ColumnTransition(from: from, to: to))
    }

    // Stagger: column i normally starts `stagger * i` late. When re-targeting
    // mid-roll, a column that hasn't started yet keeps its original start time
    // instead of being pushed back again, so rapid updates can't starve it.
    let now = CACurrentMediaTime()
    let stagger = max(0, timing.stagger)
    var delays: [TimeInterval] = []
    delays.reserveCapacity(count)
    for power in 0..<count {
      var delay = stagger * Double(power)
      if let active = transition, power < active.delays.count {
        let pending = max(0, (active.start + active.delays[power]) - now)
        delay = min(delay, pending)
      }
      delays.append(delay)
    }

    let next = Transition(
      start: now,
      duration: timing.duration,
      delays: delays,
      columns: transitions,
      signFrom: signFactor,
      signTo: target.negative ? 1 : 0,
      finalColumns: finals
    )
    transition = next
    apply(next, elapsed: 0)
    reportIntrinsicSize(powerCount: target.powerCount, negative: target.negative)
    updateDisplayLinkNeed()
    setNeedsDisplay()
  }

  /// Re-sends the last reported intrinsic size (e.g. after a listener was attached).
  func resendIntrinsicSize() {
    guard lastReportedSize != .zero else { return }
    onIntrinsicSizeChange?(lastReportedSize)
  }

  // MARK: - Targets

  private func makeTarget(_ value: Double) -> Target {
    let fd = format.fractionDigits
    var scaled = (abs(value) * Double(Self.pow10[fd])).rounded()
    if !scaled.isFinite { scaled = 0 }
    let magnitude = UInt64(min(scaled, 1e17))
    let integerPart = magnitude / Self.pow10[fd]
    let intDigits = max(format.minimumIntegerDigits, Self.digitCount(integerPart))
    return Target(
      magnitude: magnitude,
      negative: value < 0 && magnitude > 0,
      powerCount: min(Self.maxPowerCount, intDigits + fd)
    )
  }

  private func snap(to target: Target) {
    stopAnimation()
    columns = (0..<target.powerCount).map { power in
      Column(position: Double(target.digit(at: power)), width: 1, linear: false, blankZero: false)
    }
    signFactor = target.negative ? 1 : 0
    hasShownValue = true
    reportIntrinsicSize(powerCount: target.powerCount, negative: target.negative)
    setNeedsDisplay()
  }

  private func formatDidChange() {
    if hasShownValue {
      snap(to: makeTarget(targetValue))
    }
  }

  private static func digitCount(_ n: UInt64) -> Int {
    var n = n
    var count = 1
    while n >= 10 {
      n /= 10
      count += 1
    }
    return count
  }

  private static func wrap(_ x: Double) -> Double {
    let r = x.truncatingRemainder(dividingBy: 10)
    return r < 0 ? r + 10 : r
  }

  // MARK: - Animation

  private func apply(_ tr: Transition, elapsed: CFTimeInterval) {
    if columns.count != tr.columns.count {
      columns = tr.columns.map { $0.from }
    }
    for (i, ct) in tr.columns.enumerated() {
      let delay = i < tr.delays.count ? tr.delays[i] : 0
      let raw = tr.duration > 0 ? min(1, max(0, (elapsed - delay) / tr.duration)) : 1
      let t = ease(raw)
      columns[i].position = ct.from.position + (ct.to.position - ct.from.position) * t
      columns[i].width = min(1, max(0, ct.from.width + (ct.to.width - ct.from.width) * t))
      columns[i].linear = ct.from.linear
      columns[i].blankZero = ct.from.blankZero
    }
    let signRaw = tr.duration > 0 ? min(1, max(0, elapsed / tr.duration)) : 1
    signFactor = min(1, max(0, tr.signFrom + (tr.signTo - tr.signFrom) * ease(signRaw)))
  }

  private func finish(_ tr: Transition) {
    columns = tr.finalColumns
    signFactor = tr.signTo
    transition = nil
  }

  fileprivate func step(_ link: CADisplayLink) {
    let now = CACurrentMediaTime()
    if let tr = transition {
      let elapsed = now - tr.start
      let total = tr.duration + (tr.delays.max() ?? 0)
      if elapsed >= total {
        finish(tr)
      } else {
        apply(tr, elapsed: elapsed)
      }
    }
    if let start = loadingAnimStart {
      let target: Double = loading ? 1 : 0
      let t = min(1, max(0, (now - start) / Self.loadingFadeDuration))
      loadingProgress = loadingAnimFrom + (target - loadingAnimFrom) * t
      if t >= 1 {
        loadingProgress = target
        loadingAnimStart = nil
      }
    }
    updateDisplayLinkNeed()
    setNeedsDisplay()
  }

  /// Keeps the display link alive only while something is moving.
  private func updateDisplayLinkNeed() {
    let needed = transition != nil || loadingAnimStart != nil || loadingProgress > 0
    if needed {
      startDisplayLink()
    } else {
      stopDisplayLink()
    }
  }

  private func ease(_ t: Double) -> Double {
    switch timing.easing {
    case .linear:
      return t
    case .easeIn:
      return t * t * t
    case .easeOut:
      return 1 - pow(1 - t, 3)
    case .easeInOut:
      return t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
    case .spring:
      return Self.spring(t, bounce: timing.bounce)
    }
  }

  /// Step response of a damped spring, normalised so it has settled at `t == 1`.
  /// `bounce` maps to the damping ratio like SwiftUI's `.spring(duration:bounce:)`.
  private static func spring(_ t: Double, bounce: Double) -> Double {
    let zeta = min(1, max(0.05, 1 - min(1, max(0, bounce))))
    let omega = 3 * Double.pi
    let k = zeta * omega
    if zeta >= 0.999 {
      return 1 - (1 + k * t) * exp(-k * t)
    }
    let wd = omega * (1 - zeta * zeta).squareRoot()
    return 1 - exp(-k * t) * (cos(wd * t) + (k / wd) * sin(wd * t))
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
    fonts = FontSet(typography, scale: 1)
    fontScale = 1
    if hasShownValue {
      reportIntrinsicSize(powerCount: settledPowerCount, negative: settledNegative)
    }
    setNeedsDisplay()
  }

  /// Shrink-to-fit scale for the current bounds and the content as it is drawn
  /// *right now* (including half-appeared columns): the amount shrinks and grows
  /// continuously in step with the roll and never overflows.
  private func updateFontScale(contentWidth: CGFloat) {
    var scale: CGFloat = 1
    if typography.adjustsFontSizeToFit, bounds.width > 0, contentWidth > bounds.width {
      scale = max(min(1, typography.minimumFontScale), bounds.width / contentWidth)
    }
    fontScale = scale
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
    case column(Int)
    case glyph(String, GlyphRole)
  }

  private struct Element {
    var kind: ElementKind
    var width: CGFloat
    var fullWidth: CGFloat
    var factor: Double
  }

  private func buildElements(using fonts: FontSet, columns: [Column], signFactor: Double) -> [Element] {
    var elements: [Element] = []
    let fd = format.fractionDigits

    func addGlyph(_ text: String, role: GlyphRole, factor: Double) {
      guard !text.isEmpty, factor > 0 else { return }
      let width = fonts.width(of: text, role: role)
      elements.append(Element(kind: .glyph(text, role), width: width * CGFloat(factor), fullWidth: width, factor: factor))
    }

    addGlyph(format.prefix, role: .prefix, factor: 1)
    addGlyph("-", role: .digit, factor: signFactor)
    var power = columns.count - 1
    while power >= 0 {
      let column = columns[power]
      if column.width > 0 {
        elements.append(Element(kind: .column(power), width: fonts.digitWidth * CGFloat(column.width), fullWidth: fonts.digitWidth, factor: column.width))
      }
      if power > fd, (power - fd) % 3 == 0 {
        addGlyph(format.groupingSeparator, role: .digit, factor: column.width)
      }
      if fd > 0, power == fd {
        addGlyph(format.decimalSeparator, role: .digit, factor: 1)
      }
      power -= 1
    }
    addGlyph(format.suffix, role: .suffix, factor: 1)
    return elements
  }

  private func settledWidth(using fonts: FontSet, powerCount: Int, negative: Bool) -> CGFloat {
    let settled = (0..<powerCount).map { _ in Column(position: 0, width: 1, linear: false, blankZero: false) }
    return buildElements(using: fonts, columns: settled, signFactor: negative ? 1 : 0).reduce(CGFloat(0)) { $0 + $1.width }
  }

  private func reportIntrinsicSize(powerCount: Int, negative: Bool) {
    settledPowerCount = powerCount
    settledNegative = negative
    let width = settledWidth(using: fonts, powerCount: powerCount, negative: negative)
    // The reported size is always the full-size one: with shrink-to-fit the view
    // keeps its height and the scaled number is centred inside it when drawing.
    let size = CGSize(width: ceil(width), height: fonts.lineHeight)
    if abs(size.width - lastReportedSize.width) > 0.01 || abs(size.height - lastReportedSize.height) > 0.01 {
      lastReportedSize = size
      onIntrinsicSizeChange?(size)
    }
  }

  // MARK: - Drawing

  override func draw(_ rect: CGRect) {
    guard hasShownValue, let ctx = UIGraphicsGetCurrentContext() else { return }
    let fonts = self.fonts
    let elements = buildElements(using: fonts, columns: columns, signFactor: signFactor)
    let total = elements.reduce(CGFloat(0)) { $0 + $1.width }
    updateFontScale(contentWidth: total)
    let scale = fontScale

    // Position the (scaled) content, then draw everything in unscaled font space.
    let originX: CGFloat
    switch alignment {
    case .left: originX = 0
    case .center: originX = (bounds.width - total * scale) / 2
    case .right: originX = bounds.width - total * scale
    }
    let originY = (bounds.height - fonts.lineHeight * scale) / 2
    ctx.saveGState()
    ctx.translateBy(x: originX, y: originY)
    ctx.scaleBy(x: scale, y: scale)

    let dim = CGFloat(min(1, max(0, loadingProgress)))
    // The ink keeps its full color; the glint is a band recoloring the glyphs.
    let baseAlpha: CGFloat = 1
    if dim > 0 {
      // Everything drawn in this layer is what the sweep gets composited onto.
      ctx.beginTransparencyLayer(auxiliaryInfo: nil)
    }
    var x: CGFloat = 0
    for element in elements {
      switch element.kind {
      case .column(let index):
        drawColumn(columns[index], fonts: fonts, x: x, width: element.width, lineTop: 0, baseAlpha: baseAlpha, ctx: ctx)
      case .glyph(let text, let role):
        drawGlyph(text, role: role, fonts: fonts, x: x, width: element.width, fullWidth: element.fullWidth, lineTop: 0, alpha: element.factor * Double(baseAlpha), ctx: ctx)
      }
      x += element.width
    }
    if dim > 0 {
      drawShimmer(contentLeft: 0, contentWidth: total, dim: dim, ctx: ctx)
      ctx.endTransparencyLayer()
    }
    ctx.restoreGState()
  }

  /// A "shine" glint: a text-wide, slanted band that recolors the ink from the
  /// text color to the highlight and back (`[base, highlight, base]` at
  /// 10/50/90 %), composited source-atop so only the glyphs light up.
  private func drawShimmer(contentLeft: CGFloat, contentWidth: CGFloat, dim: CGFloat, ctx: CGContext) {
    guard contentWidth > 0 else { return }
    var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 1
    typography.color.getRed(&br, green: &bg, blue: &bb, alpha: &ba)
    var hr: CGFloat = 0, hg: CGFloat = 0, hb: CGFloat = 0, ha: CGFloat = 1
    (shimmer.color ?? Self.defaultShimmerColor).getRed(&hr, green: &hg, blue: &hb, alpha: &ha)
    let base = CGColor(red: br, green: bg, blue: bb, alpha: ba)
    let colors = [base, CGColor(red: hr, green: hg, blue: hb, alpha: ha), base] as CFArray
    guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0.1, 0.5, 0.9]) else { return }
    let period = max(0.2, shimmer.duration)
    let phase = CGFloat(((CACurrentMediaTime() - shimmerStart) / period).truncatingRemainder(dividingBy: 1))
    let progress = Self.shimmerSeed + (1 - Self.shimmerSeed) * phase
    // Core at contentLeft + width * (2p - 0.5): enters at the left edge, exits past the right.
    let startX = contentLeft + contentWidth * (2 * progress - 1)
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

  private func drawGlyph(_ text: String, role: GlyphRole, fonts: FontSet, x: CGFloat, width: CGFloat, fullWidth: CGFloat, lineTop: CGFloat, alpha: Double, ctx: CGContext) {
    guard width > 0 else { return }
    ctx.saveGState()
    ctx.clip(to: CGRect(x: x, y: lineTop, width: width, height: fonts.lineHeight))
    ctx.setAlpha(CGFloat(alpha))
    fonts.attributed(text, role: role).draw(at: CGPoint(x: x + width - fullWidth, y: fonts.top(for: role, lineTop: lineTop)))
    ctx.restoreGState()
  }

  private func drawColumn(_ column: Column, fonts: FontSet, x: CGFloat, width: CGFloat, lineTop: CGFloat, baseAlpha: CGFloat, ctx: CGContext) {
    guard width > 0 else { return }
    let lineHeight = fonts.lineHeight
    ctx.saveGState()
    ctx.clip(to: CGRect(x: x, y: lineTop, width: width, height: lineHeight))
    ctx.setAlpha(CGFloat(column.width) * baseAlpha)
    let base = column.position.rounded(.down)
    let fraction = CGFloat(column.position - base)
    let index = Int(base)
    let columnLeft = x + width - fonts.digitWidth
    if let glyph = glyph(at: index, in: column, fonts: fonts) {
      glyph.draw(at: CGPoint(x: columnLeft + (fonts.digitWidth - glyph.size().width) / 2, y: lineTop - fraction * lineHeight))
    }
    if fraction > 0.0001, let glyph = glyph(at: index + 1, in: column, fonts: fonts) {
      glyph.draw(at: CGPoint(x: columnLeft + (fonts.digitWidth - glyph.size().width) / 2, y: lineTop + (1 - fraction) * lineHeight))
    }
    ctx.restoreGState()
  }

  private func glyph(at index: Int, in column: Column, fonts: FontSet) -> NSAttributedString? {
    if column.linear && index < 0 { return nil }
    if column.blankZero && index == 0 { return nil }
    let digit = ((index % 10) + 10) % 10
    return fonts.attributed(String(digit), role: .digit)
  }
}
