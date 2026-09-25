//
//  NitroTextView.swift
//  NitroInput
//
//  A single line of text that morphs to the next (NitroText). The C++
//  `ReflowEngine` decides where every character is while a morph runs, and
//  this view draws every character at its own position, opacity and scale,
//  frame by frame. At rest the line is one draw of cached glyphs, and the
//  engine is not involved: a label that never changes never pays for it. There is no text field and no layer per character,
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
    /// Each character's glyph in this font, shaped alone so the font's
    /// features (tabular digits) apply; 0 when it is not one glyph of this
    /// font (a fallback font, a cluster), and the line is drawn as a string.
    fileprivate var glyphs: [UInt32: CGGlyph] = [:]
    /**
     * The same for the first `direct` scalars, read without the lock: every
     * commit and every frame looks characters up, and on the main thread the
     * lock cost more than the lookup. Fixed buffers written under the lock;
     * an aligned 8- or 4-byte store is atomic on arm64, so a reader sees the
     * sentinel (and takes the locked path) or the whole value.
     */
    fileprivate let directAdvances: UnsafeMutablePointer<CGFloat>
    fileprivate let directGlyphs: UnsafeMutablePointer<UInt32>

    init(font: UIFont) {
      self.font = font
      lineHeight = ceil(font.lineHeight)
      directAdvances = .allocate(capacity: NitroTextFonts.direct)
      directAdvances.initialize(repeating: .nan, count: NitroTextFonts.direct)
      directGlyphs = .allocate(capacity: NitroTextFonts.direct)
      directGlyphs.initialize(repeating: NitroTextFonts.unknownGlyph, count: NitroTextFonts.direct)
    }

    deinit {
      directAdvances.deallocate()
      directGlyphs.deallocate()
    }
  }

  /// Scalars below this (Latin, Greek, Cyrillic) have lock-free slots.
  fileprivate static let direct = 0x530
  fileprivate static let unknownGlyph = UInt32.max

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
    let v = Int(scalar.value)
    if v < Self.direct {
      let width = entry.directAdvances[v]
      if !width.isNaN { return width }
    }
    lock.lock()
    if let width = entry.advances[scalar.value] {
      lock.unlock()
      return width
    }
    lock.unlock()
    let width = NSAttributedString(string: String(Character(scalar)), attributes: [.font: entry.font]).size().width
    lock.lock()
    entry.advances[scalar.value] = width
    if v < Self.direct { entry.directAdvances[v] = width }
    lock.unlock()
    return width
  }

  /// One character's glyph, or 0 when it has to be drawn as a string: a
  /// script that shapes by context (joining, combining marks, clusters) or a
  /// character this font lacks.
  func glyph(of scalar: Unicode.Scalar, in entry: Entry) -> CGGlyph {
    guard Self.drawsAlone(scalar) else { return 0 }
    let v = Int(scalar.value)
    if v < Self.direct {
      let glyph = entry.directGlyphs[v]
      if glyph != Self.unknownGlyph { return CGGlyph(glyph) }
    }
    lock.lock()
    if let glyph = entry.glyphs[scalar.value] {
      lock.unlock()
      return glyph
    }
    lock.unlock()
    var glyph: CGGlyph = 0
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: String(Character(scalar)), attributes: [.font: entry.font]))
    if let runs = CTLineGetGlyphRuns(line) as? [CTRun], runs.count == 1, CTRunGetGlyphCount(runs[0]) == 1 {
      let attributes = CTRunGetAttributes(runs[0]) as NSDictionary
      let runFont = attributes[kCTFontAttributeName as String].map { $0 as! CTFont }
      if let runFont, CTFontCopyPostScriptName(runFont) as String == CTFontCopyPostScriptName(entry.font as CTFont) as String {
        CTRunGetGlyphs(runs[0], CFRange(location: 0, length: 1), &glyph)
      }
    }
    lock.lock()
    entry.glyphs[scalar.value] = glyph
    if v < Self.direct { entry.directGlyphs[v] = UInt32(glyph) }
    lock.unlock()
    return glyph
  }

  /// Scripts whose characters look the same alone as in a word.
  private static func drawsAlone(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x20..<0x300, 0x370..<0x590, 0x1E00..<0x2000, 0x2010..<0x2028, 0x202F, 0x2030..<0x205F, 0x20A0..<0x20D0, 0x2100..<0x2300:
      return true
    default:
      return false
    }
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
      restLayout = nil
      // New advances: the engine lays the line out again when it next morphs.
      engineText = nil
      updateDisplayLink()
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
      // Shown even when unchanged: a recycled view handed its own text again.
      defer { shown = true }
      guard text != oldValue else { return }
      restString = nil
      restLayout = nil
      if shown && morphs {
        // Hand the engine what is on screen first if it doesn't hold it: it
        // only learns a line when that line has to morph.
        if engineText != oldValue { commit(oldValue, animated: false) }
        commit(text, animated: true)
      } else {
        engineText = nil
      }
      updateDisplayLink()
      setNeedsDisplay()
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
  /// The line the engine holds (its target, while it morphs); nil when it is
  /// out of date and the view draws `text` on its own.
  private var engineText: String?
  /// A line has been shown: the next one morphs from it.
  private var shown = false
  /// The line at rest: each glyph and where it starts; nil glyphs when a
  /// character has to be drawn as a string.
  private var restLayout: (glyphs: [CGGlyph]?, xs: [CGFloat], width: CGFloat)?
  private var fonts = NitroTextFonts.shared.entry(size: 17, weight: 400, family: "")
  /// The line at rest, as one attributed string (kerning off, so it lands where the engine put each character).
  private var restString: NSAttributedString?
  private var displayLink: CADisplayLink?
  /// Frames went undrawn while the view was out of sight.
  private var framesSkipped = false
  private var loadingProgress: CGFloat = 0
  private var loadingFrom: CGFloat = 0
  private var loadingStart: CFTimeInterval = 0
  private static let loadingFade: CFTimeInterval = 0.25
  private var explicitAccessibilityLabel: String?

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

  /// Fabric is about to reuse this view: forget every animation, and that a
  /// line was shown, so the next element's text appears instead of morphing.
  /// The text and what is drawn stay, as a label's do: an element with the
  /// same text and style (a list scrolled back, a screen mounted again) draws
  /// nothing.
  func resetForRecycle() {
    let settled = !moving && loadingProgress == 0
    loadingProgress = 0
    loading = false
    displayLink?.invalidate()
    displayLink = nil
    framesSkipped = false
    engine.reset()
    engine.setTiming(timing.duration, timing.easing, timing.bounce)
    engine.setEffect(timing.effect)
    engine.setRightToLeft(rightToLeft)
    engineText = nil
    shown = false
    explicitAccessibilityLabel = nil
    // Caught mid-morph or loading: the next draw is the line at rest.
    if !settled { setNeedsDisplay() }
  }

  // MARK: - Text

  /// Hands the engine the text, one glyph per character with its advance;
  /// digits match by place and separators travel with their digits, the rest
  /// by the longest common run.
  private func commit(_ line: String, animated: Bool) {
    engine.setReduceMotion(!animated)
    engine.beginText()
    let scalars = Array(line.unicodeScalars)
    for (i, scalar) in scalars.enumerated() {
      let width = NitroTextFonts.shared.advance(of: scalar, in: fonts) + style.letterSpacing
      engine.addGlyph(scalar.value, Self.body, Self.kind(scalars, i), Double(width), false)
    }
    engine.commitText(-1, CACurrentMediaTime())
    engineText = line
  }

  /// A change morphs unless it can't be seen to: no duration, or Reduce Motion.
  private var morphs: Bool {
    timing.duration > 0 && !(timing.respectReduceMotion && UIAccessibility.isReduceMotionEnabled)
  }

  private var moving: Bool { engineText != nil && engine.needsFrames() }

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

  private var needsFrames: Bool { moving || loading || loadingProgress > 0 }

  private func updateDisplayLink() {
    if needsFrames {
      guard displayLink == nil else { return }
      let link = CADisplayLink(target: DisplayLinkProxy(self), selector: #selector(DisplayLinkProxy.tick(_:)))
      link.add(to: .main, forMode: .common)
      displayLink = link
    } else {
      displayLink?.invalidate()
      displayLink = nil
    }
  }

  private final class DisplayLinkProxy: NSObject {
    weak var view: NitroTextView?
    init(_ view: NitroTextView) { self.view = view }
    @objc func tick(_ link: CADisplayLink) {
      guard let view, !view.frameTick() else { return }
      view.updateDisplayLink()
    }
  }

  /// One frame: the morph and the loading fade advance; `false` once nothing moves.
  private func frameTick() -> Bool {
    let now = CACurrentMediaTime()
    if engineText != nil { _ = engine.tick(now) }
    let target: CGFloat = loading ? 1 : 0
    if loadingProgress != target {
      let t = CGFloat(min(1, (now - loadingStart) / Self.loadingFade))
      loadingProgress = loadingFrom + (target - loadingFrom) * t
    }
    let more = needsFrames
    // A view scrolled out of sight is not drawn every frame (Core Animation
    // redraws every layer marked, on screen or not): once when it settles,
    // and every frame again as soon as it is in sight.
    if onScreen {
      setNeedsDisplay()
      framesSkipped = false
    } else {
      framesSkipped = true
    }
    if !more, framesSkipped {
      framesSkipped = false
      setNeedsDisplay()
    }
    return more
  }

  private var onScreen: Bool {
    guard let window, !isHidden else { return false }
    return convert(bounds, to: window).intersects(window.bounds)
  }

  // MARK: - Drawing

  override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let moving = self.moving
    guard moving || !text.isEmpty else { return }
    let lineHeight = fonts.lineHeight
    let rest = moving ? nil : self.rest()
    let content = rest?.width ?? CGFloat(engine.contentWidth())
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
    if moving {
      drawMoving(ctx, origin: CGPoint(x: originX, y: originY), lineHeight: lineHeight)
    } else if let rest, let glyphs = rest.glyphs {
      // At rest: the whole line in one draw of its glyphs, each at its advance.
      drawGlyphs(ctx, glyphs, rest.xs.map { originX + $0 }, top: originY)
    } else {
      restLine().draw(at: CGPoint(x: originX, y: originY))
    }
    if dim > 0 {
      drawShimmer(ctx, left: originX, width: content, lineHeight: lineHeight, top: originY, dim: dim)
      ctx.endTransparencyLayer()
    }
  }

  private func rest() -> (glyphs: [CGGlyph]?, xs: [CGFloat], width: CGFloat) {
    if let restLayout { return restLayout }
    let fontSet = NitroTextFonts.shared
    var glyphs: [CGGlyph]? = []
    var xs: [CGFloat] = []
    var x: CGFloat = 0
    for scalar in text.unicodeScalars {
      if glyphs != nil {
        let glyph = fontSet.glyph(of: scalar, in: fonts)
        if glyph == 0 { glyphs = nil } else { glyphs!.append(glyph) }
      }
      xs.append(x)
      x += fontSet.advance(of: scalar, in: fonts) + style.letterSpacing
    }
    let layout = (glyphs: glyphs, xs: xs, width: x)
    restLayout = layout
    return layout
  }

  /// Glyphs of the view's font with the top of their line box at `top`, as a
  /// string drawn at that point would sit.
  private func drawGlyphs(_ ctx: CGContext, _ glyphs: [CGGlyph], _ xs: [CGFloat], top: CGFloat) {
    ctx.saveGState()
    ctx.textMatrix = .identity
    ctx.translateBy(x: 0, y: top + fonts.font.ascender)
    ctx.scaleBy(x: 1, y: -1)
    ctx.setFillColor(style.color.resolvedColor(with: traitCollection).cgColor)
    let positions = xs.map { CGPoint(x: $0, y: 0) }
    CTFontDrawGlyphs(fonts.font as CTFont, glyphs, positions, glyphs.count, ctx)
    ctx.restoreGState()
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
    let count = Int(engine.glyphCount())
    for i in 0..<count {
      let g = engine.glyphAt(Int32(i))
      let opacity = CGFloat(min(1, max(0, g.opacity)))
      guard opacity > 0.002, let scalar = Unicode.Scalar(g.character) else { continue }
      let x = origin.x + CGFloat(g.x)
      let y = origin.y + CGFloat(g.y) * lineHeight
      ctx.saveGState()
      ctx.setAlpha(opacity)
      let scale = CGFloat(g.scale)
      var at = CGPoint(x: x, y: y)
      if abs(scale - 1) > 0.0001 {
        let width = CGFloat(g.width)
        ctx.translateBy(x: x + width / 2, y: y + lineHeight / 2)
        ctx.scaleBy(x: scale, y: scale)
        at = CGPoint(x: -width / 2, y: -lineHeight / 2)
      }
      // The same glyph the line at rest draws, so a morph lands without a shift.
      let glyph = NitroTextFonts.shared.glyph(of: scalar, in: fonts)
      if glyph != 0 {
        drawGlyphs(ctx, [glyph], [at.x], top: at.y)
      } else {
        NSAttributedString(string: String(Character(scalar)), attributes: self.attributes).draw(at: at)
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
