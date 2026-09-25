//
//  NitroTextView.swift
//  NitroInput
//
//  A single line of text that morphs to the next (NitroText). The C++
//  `ReflowEngine` decides where every character is; this view draws them in
//  one pass: at rest the whole line as one Core Text draw, like a label, and
//  while a morph runs every character at its own position, opacity and
//  scale, frame by frame. There is no text field and no layer per character,
//  so mounting a thousand of them costs about what a thousand labels do.
//  `NitroTextMeasure` measures a line the same way (`NitroTextFonts`), so the
//  JS side gives the view its size in the commit that mounts it.
//

import UIKit

/// The fonts NitroText draws with, shared by every view and the measurer:
/// a font per size, weight and family, and each character's advance in it.
/// Measured on the JS thread and drawn on the main thread, so it locks.
final class NitroTextFonts {
  final class Entry {
    let font: UIFont
    let lineHeight: CGFloat
    fileprivate var advances: [UInt32: CGFloat] = [:]

    init(font: UIFont) {
      self.font = font
      lineHeight = ceil(font.lineHeight)
    }
  }

  static let shared = NitroTextFonts()
  private var entries: [String: Entry] = [:]
  private let lock = NSLock()

  func entry(size: CGFloat, weight: CGFloat, family: String) -> Entry {
    let key = "\(size)|\(weight)|\(family)"
    lock.lock()
    defer { lock.unlock() }
    if let entry = entries[key] { return entry }
    let entry = Entry(font: Self.makeFont(size: size, weight: weight, family: family))
    if entries.count > 64 { entries.removeAll(keepingCapacity: true) }
    entries[key] = entry
    return entry
  }

  /// One character's advance, as the view lays it out (no kerning with its neighbours).
  func advance(of scalar: Unicode.Scalar, in entry: Entry) -> CGFloat {
    lock.lock()
    if let width = entry.advances[scalar.value] {
      lock.unlock()
      return width
    }
    lock.unlock()
    let width = NSAttributedString(string: String(Character(scalar)), attributes: [.font: entry.font]).size().width
    lock.lock()
    entry.advances[scalar.value] = width
    lock.unlock()
    return width
  }

  /// The line's width: every character's advance and the letter spacing after it.
  func width(of text: String, in entry: Entry, letterSpacing: CGFloat) -> CGFloat {
    var total: CGFloat = 0
    for scalar in text.unicodeScalars {
      total += advance(of: scalar, in: entry) + letterSpacing
    }
    return total
  }

  static func makeFont(size: CGFloat, weight: CGFloat, family: String) -> UIFont {
    let uiWeight: UIFont.Weight
    switch weight {
    case ..<150: uiWeight = .ultraLight
    case ..<250: uiWeight = .thin
    case ..<350: uiWeight = .light
    case ..<450: uiWeight = .regular
    case ..<550: uiWeight = .medium
    case ..<650: uiWeight = .semibold
    case ..<750: uiWeight = .bold
    case ..<850: uiWeight = .heavy
    default: uiWeight = .black
    }
    let traits: [UIFontDescriptor.TraitKey: Any] = [.weight: uiWeight]
    let base: UIFont
    if !family.isEmpty, let named = UIFont(name: family, size: size) {
      base = UIFont(descriptor: named.fontDescriptor.addingAttributes([.traits: traits]), size: size)
    } else if !family.isEmpty, !UIFont.fontNames(forFamilyName: family).isEmpty {
      base = UIFont(descriptor: UIFontDescriptor(fontAttributes: [.family: family, .traits: traits]), size: size)
    } else {
      base = UIFont.systemFont(ofSize: size, weight: uiWeight)
    }
    // Tabular digits: a column keeps its width while its digit morphs.
    let feature: [UIFontDescriptor.FeatureKey: Int] = [.type: kNumberSpacingType, .selector: kMonospacedNumbersSelector]
    return UIFont(descriptor: base.fontDescriptor.addingAttributes([.featureSettings: [feature]]), size: size)
  }
}

final class NitroTextView: UIView {
  private typealias Engine = margelo.nitro.nitroinput.ReflowEngine
  private enum Kind { static let text: Int32 = 0, digit: Int32 = 1, separator: Int32 = 2, decimal: Int32 = 3 }
  private static let body: Int32 = 1

  struct Style: Equatable {
    var fontSize: CGFloat = 17
    var fontWeight: CGFloat = 400
    var fontFamily = ""
    var color: UIColor = .label
    var letterSpacing: CGFloat = 0
    var textAlign: NitroNumberView.Alignment = .auto
  }

  struct Timing: Equatable {
    var duration: TimeInterval = 0.4
    var easing: Int32 = 0
    var bounce: Double = 0.15
    var effect: Int32 = 0
    var respectReduceMotion = true
  }

  var style = Style() {
    didSet {
      guard style != oldValue else { return }
      fonts = NitroTextFonts.shared.entry(size: style.fontSize, weight: style.fontWeight, family: style.fontFamily)
      restString = nil
      // New advances: lay the same text out again, at once.
      if engine.hasText() { commit(animated: false) }
      setNeedsDisplay()
    }
  }

  var timing = Timing() {
    didSet {
      engine.setTiming(timing.duration, timing.easing, timing.bounce)
      engine.setEffect(timing.effect)
    }
  }

  var shimmer = NitroNumberView.Shimmer() {
    didSet { if loading { setNeedsDisplay() } }
  }

  var text = "" {
    didSet {
      guard text != oldValue, !recycling else { return }
      restString = nil
      commit(animated: engine.hasText())
      updateAccessibility()
    }
  }

  var loading = false {
    didSet {
      guard loading != oldValue else { return }
      loadingFrom = loadingProgress
      loadingStart = CACurrentMediaTime()
      updateDisplayLink()
    }
  }

  var rightToLeft = false {
    didSet {
      guard rightToLeft != oldValue else { return }
      engine.setRightToLeft(rightToLeft)
      setNeedsDisplay()
    }
  }

  private var engine = Engine()
  private var fonts = NitroTextFonts.shared.entry(size: 17, weight: 400, family: "")
  /// The line at rest, as one attributed string (kerning off, so it lands where the engine put each character).
  private var restString: NSAttributedString?
  private var displayLink: CADisplayLink?
  private var loadingProgress: CGFloat = 0
  private var loadingFrom: CGFloat = 0
  private var loadingStart: CFTimeInterval = 0
  private static let loadingFade: CFTimeInterval = 0.25
  private var explicitAccessibilityLabel: String?
  /// Set while `resetForRecycle` clears the text, so the clearing is not
  /// committed: an empty line would count as text, and the next element's
  /// text would morph in from it instead of appearing.
  private var recycling = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    contentMode = .redraw
    clipsToBounds = false
    isAccessibilityElement = true
    accessibilityTraits = .staticText
    engine.setTiming(timing.duration, timing.easing, timing.bounce)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    displayLink?.invalidate()
  }

  override var accessibilityLabel: String? {
    get { explicitAccessibilityLabel.flatMap { $0.isEmpty ? nil : $0 } ?? text }
    set { explicitAccessibilityLabel = newValue }
  }

  override var accessibilityValue: String? {
    get { loading ? "Loading" : nil }
    set {}
  }

  private func updateAccessibility() {
    if isAccessibilityElement, UIAccessibility.isVoiceOverRunning {
      UIAccessibility.post(notification: .layoutChanged, argument: nil)
    }
  }

  /// Fabric is about to reuse this view: forget the text and every animation.
  func resetForRecycle() {
    loadingProgress = 0
    loading = false
    displayLink?.invalidate()
    displayLink = nil
    engine.reset()
    engine.setTiming(timing.duration, timing.easing, timing.bounce)
    engine.setEffect(timing.effect)
    engine.setRightToLeft(rightToLeft)
    recycling = true
    text = ""
    recycling = false
    restString = nil
    explicitAccessibilityLabel = nil
    setNeedsDisplay()
  }

  // MARK: - Text

  /// Hands the engine the text, one glyph per character with its advance;
  /// digits match by place and separators travel with their digits, the rest
  /// by the longest common run.
  private func commit(animated: Bool) {
    engine.setReduceMotion(!animated || (timing.respectReduceMotion && UIAccessibility.isReduceMotionEnabled))
    engine.beginText()
    let scalars = Array(text.unicodeScalars)
    for (i, scalar) in scalars.enumerated() {
      let width = NitroTextFonts.shared.advance(of: scalar, in: fonts) + style.letterSpacing
      engine.addGlyph(scalar.value, Self.body, Self.kind(scalars, i), Double(width), false)
    }
    engine.commitText(-1, CACurrentMediaTime())
    updateDisplayLink()
    setNeedsDisplay()
  }

  private static func isDigit(_ s: Unicode.Scalar) -> Bool { s.value >= 48 && s.value <= 57 }

  private static func kind(_ scalars: [Unicode.Scalar], _ i: Int) -> Int32 {
    let s = scalars[i]
    if isDigit(s) { return Kind.digit }
    // A comma or a point between two digits belongs to the number.
    guard i > 0, i + 1 < scalars.count, isDigit(scalars[i - 1]), isDigit(scalars[i + 1]) else { return Kind.text }
    if s == "," || s == "\u{202F}" || s == "\u{00A0}" || s == "'" { return Kind.separator }
    if s == "." { return Kind.decimal }
    return Kind.text
  }

  // MARK: - Frames

  private func updateDisplayLink() {
    let loadingMoves = loading || loadingProgress > 0
    if engine.needsFrames() || loadingMoves {
      guard displayLink == nil else { return }
      let link = CADisplayLink(target: DisplayLinkProxy(self), selector: #selector(DisplayLinkProxy.tick(_:)))
      link.add(to: .main, forMode: .common)
      displayLink = link
    } else {
      displayLink?.invalidate()
      displayLink = nil
    }
  }

  fileprivate func step() {
    let now = CACurrentMediaTime()
    _ = engine.tick(now)
    let target: CGFloat = loading ? 1 : 0
    if loadingProgress != target {
      let t = CGFloat(min(1, (now - loadingStart) / Self.loadingFade))
      loadingProgress = loadingFrom + (target - loadingFrom) * t
    }
    updateDisplayLink()
    setNeedsDisplay()
  }

  private final class DisplayLinkProxy: NSObject {
    weak var view: NitroTextView?
    init(_ view: NitroTextView) { self.view = view }
    @objc func tick(_ link: CADisplayLink) { view?.step() }
  }

  // MARK: - Drawing

  override func draw(_ rect: CGRect) {
    guard engine.hasText(), let ctx = UIGraphicsGetCurrentContext() else { return }
    let lineHeight = fonts.lineHeight
    let content = CGFloat(engine.contentWidth())
    let rtl = rightToLeft
    let originX: CGFloat
    switch style.textAlign {
    case .left: originX = 0
    case .right: originX = bounds.width - content
    case .center: originX = (bounds.width - content) / 2
    case .auto: originX = rtl ? bounds.width - content : 0
    }
    let originY = (bounds.height - lineHeight) / 2
    let dim = loadingProgress
    if dim > 0 { ctx.beginTransparencyLayer(auxiliaryInfo: nil) }
    if engine.needsFrames() {
      drawMoving(ctx, origin: CGPoint(x: originX, y: originY), lineHeight: lineHeight)
    } else {
      // At rest: the whole line in one draw, where the engine laid it out.
      restLine().draw(at: CGPoint(x: originX, y: originY))
    }
    if dim > 0 {
      drawShimmer(ctx, left: originX, width: content, lineHeight: lineHeight, top: originY, dim: dim)
      ctx.endTransparencyLayer()
    }
  }

  private func restLine() -> NSAttributedString {
    if let restString { return restString }
    let string = NSAttributedString(string: text, attributes: attributes)
    restString = string
    return string
  }

  /// Kerning off (a kern of the letter spacing replaces the font's pairs) and
  /// no ligatures, so the line's characters sit where their advances put them.
  private var attributes: [NSAttributedString.Key: Any] {
    [.font: fonts.font, .foregroundColor: style.color.resolvedColor(with: traitCollection), .kern: style.letterSpacing, .ligature: 0]
  }

  private func drawMoving(_ ctx: CGContext, origin: CGPoint, lineHeight: CGFloat) {
    let attributes = self.attributes
    let count = Int(engine.glyphCount())
    for i in 0..<count {
      let g = engine.glyphAt(Int32(i))
      let opacity = CGFloat(min(1, max(0, g.opacity)))
      guard opacity > 0.002, let scalar = Unicode.Scalar(g.character) else { continue }
      let string = NSAttributedString(string: String(Character(scalar)), attributes: attributes)
      let x = origin.x + CGFloat(g.x)
      let y = origin.y + CGFloat(g.y) * lineHeight
      ctx.saveGState()
      ctx.setAlpha(opacity)
      let scale = CGFloat(g.scale)
      if abs(scale - 1) > 0.0001 {
        let width = CGFloat(g.width)
        ctx.translateBy(x: x + width / 2, y: y + lineHeight / 2)
        ctx.scaleBy(x: scale, y: scale)
        string.draw(at: CGPoint(x: -width / 2, y: -lineHeight / 2))
      } else {
        string.draw(at: CGPoint(x: x, y: y))
      }
      ctx.restoreGState()
    }
  }

  /// The loading glint, as NitroNumber draws it: a slanted band recolouring
  /// the ink, composited source-atop so only the glyphs light up.
  private func drawShimmer(_ ctx: CGContext, left: CGFloat, width: CGFloat, lineHeight: CGFloat, top: CGFloat, dim: CGFloat) {
    guard width > 0 else { return }
    var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 1
    (shimmer.baseColor ?? style.color).resolvedColor(with: traitCollection).getRed(&br, green: &bg, blue: &bb, alpha: &ba)
    var hr: CGFloat = 0, hg: CGFloat = 0, hb: CGFloat = 0, ha: CGFloat = 1
    (shimmer.color ?? Self.defaultShimmerColor).resolvedColor(with: traitCollection).getRed(&hr, green: &hg, blue: &hb, alpha: &ha)
    let base = CGColor(red: br, green: bg, blue: bb, alpha: ba)
    let colors = [base, CGColor(red: hr, green: hg, blue: hb, alpha: ha), base] as CFArray
    guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0.1, 0.5, 0.9]) else { return }
    let cycle = shimmer.duration + shimmer.delay
    let reduceMotion = timing.respectReduceMotion && UIAccessibility.isReduceMotionEnabled
    let elapsed = reduceMotion ? 0 : CACurrentMediaTime().truncatingRemainder(dividingBy: cycle)
    let phase = min(1, CGFloat(elapsed / shimmer.duration))
    let seeded = 0.25 + 0.75 * phase
    let ltr = shimmer.leftToRight ?? !rightToLeft
    let progress = ltr ? seeded : 1 - seeded
    let length = width * max(0.05, shimmer.width)
    let startX = left + (width + length) * progress - length
    let slant = tan(max(-75, min(75, shimmer.angle)) * .pi / 180) * (ltr ? 1 : -1)
    ctx.saveGState()
    ctx.setBlendMode(.sourceAtop)
    ctx.setAlpha(dim)
    ctx.drawLinearGradient(
      gradient,
      start: CGPoint(x: startX, y: top),
      end: CGPoint(x: startX + length, y: top + slant * length),
      options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
    )
    ctx.restoreGState()
  }

  private static let defaultShimmerColor = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0x2B / 255, green: 0x2E / 255, blue: 0x37 / 255, alpha: 1)
      : UIColor(red: 0xD6 / 255, green: 0xD9 / 255, blue: 0xE1 / 255, alpha: 1)
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) {
      restString = nil
      setNeedsDisplay()
    }
  }
}
