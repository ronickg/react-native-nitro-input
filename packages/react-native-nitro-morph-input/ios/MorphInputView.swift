//
//  MorphInputView.swift
//  NitroMorphInput
//
//  A single-line input whose text morphs as it changes. The behaviour (which
//  glyph is which across an edit, where every glyph is on its way, opacity,
//  slide, scale) lives in the shared C++ `MorphEngine`; the number formatting
//  in `AmountFormatter`. This view owns:
//
//  - a hidden system `UITextField` filling the bounds that provides keyboard,
//    editing, selection, the paste menu and accessibility. Its text is drawn
//    invisible and its caret hidden; its font, insets (prefix / suffix widths)
//    and alignment mirror ours so its selection geometry matches ours at rest,
//    and taps map through the engine's glyph positions (`closestPosition(to:)`).
//  - an overlay of CALayers: one pre-rasterized image per engine glyph, moved
//    by a display link while the engine says something is animating, plus our
//    own blinking caret that follows the engine's caret position.
//

import CoreText
import UIKit

final class MorphInputView: UIView {

  private typealias Engine = margelo.nitro.nitromorphinput.MorphEngine
  private typealias AmountFormatter = margelo.nitro.nitromorphinput.AmountFormatter

  // Engine roles / kinds (plain ints so the unscoped C++ enums need no bridging).
  private enum Role { static let prefix: Int32 = 0, body: Int32 = 1, suffix: Int32 = 2 }
  private enum Kind { static let text: Int32 = 0 }

  // MARK: - Configuration

  enum Mode: Equatable {
    case text, number
  }

  struct Format: Equatable {
    var mode: Mode = .text
    var fractionDigits: Int = 2
    var maxIntegerDigits: Int = 15
    var groupingSeparator: String = ","
    var decimalSeparator: String = "."
    var prefix: String = ""
    var suffix: String = ""
    var placeholder: String = ""
    /// Text mode only; 0 = unlimited.
    var maxLength: Int = 0
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
    var placeholderColor: UIColor = .placeholderText
    var prefixAlign: AffixAlign = .baseline
    var suffixAlign: AffixAlign = .baseline
    var adjustsFontSizeToFit: Bool = false
    var minimumFontScale: CGFloat = 0.5
    var allowFontScaling: Bool = false
    var maxFontSizeMultiplier: CGFloat = 0
  }

  struct Timing: Equatable {
    var duration: TimeInterval = 0.4
    /// 0 expo, 1 easeOut, 2 easeInOut, 3 linear, 4 spring.
    var easing: Int32 = 0
    var bounce: Double = 0.15
    /// 0 auto, 1 slide, 2 fade.
    var effect: Int32 = 0
  }

  /// Everything the hidden system field is configured with.
  struct Traits: Equatable {
    var keyboardType: UIKeyboardType = .default
    var returnKeyType: UIReturnKeyType = .default
    var autocapitalization: UITextAutocapitalizationType = .sentences
    var autocorrect: Bool = true
    var editable: Bool = true
    var autoFocus: Bool = false
    var caretHidden: Bool = false
    var caretColor: UIColor? = nil
    var selectionColor: UIColor? = nil
  }

  enum Alignment {
    case left, center, right
  }

  /// Why the text changed; decides which JS callbacks fire.
  enum ChangeReason {
    /// The user typed, pasted or deleted.
    case user
    /// `clear()`, `setText()`, `setValue()`.
    case method
    /// The `text` prop.
    case prop
  }

  var format = Format() {
    didSet {
      guard format != oldValue else { return }
      applyFormat(previous: oldValue)
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
      guard timing != oldValue else { return }
      engine.setTiming(max(0, timing.duration), timing.easing, timing.bounce)
      engine.setEffect(timing.effect)
    }
  }

  var traits = Traits() {
    didSet {
      guard traits != oldValue else { return }
      applyTraits()
    }
  }

  /// Ids of worklets registered from JS (0 = none), run synchronously on the
  /// UI thread through `MorphWorkletsBridge` while an edit is handled.
  struct Worklets: Equatable {
    var transform = 0
    var onChangeText = 0
    var onChangeValue = 0
  }

  var worklets = Worklets()

  var alignment: Alignment = .left {
    didSet {
      guard alignment != oldValue else { return }
      field.textAlignment = Self.textAlignment(alignment)
      render()
    }
  }

  /// Called after every text change with the text, its numeric value (NaN in
  /// text mode / when empty), the native event count and why it changed.
  var onTextChange: ((String, Double, Int, ChangeReason) -> Void)?
  var onFocusChange: ((Bool) -> Void)?
  var onSubmit: ((String) -> Void)?
  /// Called with the settled (target) intrinsic size whenever it changes.
  var onIntrinsicSizeChange: ((CGSize) -> Void)?

  /// The field's current (formatted) text.
  var text: String { field.text ?? "" }
  /// Numeric value of the text: NaN in text mode or when there are no digits.
  var value: Double {
    guard format.mode == .number else { return .nan }
    return formatter.value(std.string(text))
  }
  var hasFocus: Bool { field.isFirstResponder }
  /// Incremented on every native text change JS has not caused itself.
  private(set) var eventCount = 0

  // MARK: - Fonts

  private enum GlyphRole {
    case body, prefix, suffix
  }

  /// Body / prefix / suffix fonts with per-glyph caches (advance widths, ink
  /// metrics and pre-rasterized images in the text or placeholder colour).
  private final class FontSet {
    let body: UIFont
    let prefix: UIFont
    let suffix: UIFont
    let color: UIColor
    let placeholderColor: UIColor
    let prefixAlign: AffixAlign
    let suffixAlign: AffixAlign
    /// Height of the line box (the body font's line height).
    let lineHeight: CGFloat
    let renderScale: CGFloat
    private var glyphCache: [String: NSAttributedString] = [:]
    private var widthCache: [String: CGFloat] = [:]
    private var imageCache: [String: UIImage] = [:]
    private var inkDescentCache: [String: CGFloat] = [:]

    init(_ t: Typography) {
      renderScale = max(1, UIScreen.main.scale)
      let scale = MorphInputView.systemFontMultiplier(t)
      body = MorphInputView.makeFont(size: t.fontSize * scale, weight: t.fontWeight, family: t.fontFamily)
      prefix = MorphInputView.makeFont(size: (t.prefixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily)
      suffix = MorphInputView.makeFont(size: (t.suffixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily)
      color = t.color
      placeholderColor = t.placeholderColor
      prefixAlign = t.prefixAlign
      suffixAlign = t.suffixAlign
      lineHeight = ceil(body.lineHeight)
    }

    func font(for role: GlyphRole) -> UIFont {
      switch role {
      case .body: return body
      case .prefix: return prefix
      case .suffix: return suffix
      }
    }

    func attributed(_ text: String, role: GlyphRole, placeholder: Bool = false) -> NSAttributedString {
      let key = cacheKey(text, role, placeholder)
      if let cached = glyphCache[key] { return cached }
      let string = NSAttributedString(string: text, attributes: [
        .font: font(for: role),
        .foregroundColor: placeholder ? placeholderColor : color,
        .kern: 0,
      ])
      glyphCache[key] = string
      return string
    }

    /// Advance width of `text` in the role's font, in points.
    func width(of text: String, role: GlyphRole) -> CGFloat {
      let key = cacheKey(text, role, false)
      if let cached = widthCache[key] { return cached }
      let width = attributed(text, role: role).size().width
      widthCache[key] = width
      return width
    }

    /// The glyph rasterized once (colour baked in, at screen density): a frame
    /// only moves layers, the main thread never redraws a bitmap.
    func image(_ text: String, role: GlyphRole, placeholder: Bool) -> UIImage? {
      let key = cacheKey(text, role, placeholder)
      if let cached = imageCache[key] { return cached }
      let string = attributed(text, role: role, placeholder: placeholder)
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

    /// How far `text`'s ink hangs below the baseline (0 for digits and capitals).
    func inkDescent(_ text: String, role: GlyphRole) -> CGFloat {
      let key = "ink|" + cacheKey(text, role, false)
      if let cached = inkDescentCache[key] { return cached }
      let line = CTLineCreateWithAttributedString(attributed(text, role: role))
      let bounds = CTLineGetImageBounds(line, nil)
      let descent = bounds.isNull ? 0 : max(0, -bounds.minY)
      inkDescentCache[key] = descent
      return descent
    }

    /// Top of the glyph's line box for `role` drawing `text`, given the top of the body line box.
    func top(for role: GlyphRole, text: String, lineTop: CGFloat) -> CGFloat {
      guard role != .body else { return lineTop }
      let f = font(for: role)
      switch role == .prefix ? prefixAlign : suffixAlign {
      case .baseline:
        return lineTop + (body.ascender - f.ascender)
      case .center:
        return lineTop + (body.lineHeight - f.lineHeight) / 2
      case .top:
        return lineTop + (body.ascender - body.capHeight) - (f.ascender - f.capHeight)
      case .bottom:
        // Pin the bottom of the ink, not of the line boxes: the digits' ink ends
        // on the baseline, so "USD" sits on it too instead of hanging down to
        // where a comma's tail reaches.
        let affixBaseline = lineTop + body.ascender + inkDescent("0123456789", role: .body) - inkDescent(text, role: role)
        return affixBaseline - f.ascender
      }
    }

    private func cacheKey(_ text: String, _ role: GlyphRole, _ placeholder: Bool) -> String {
      let r: String
      switch role {
      case .body: r = "b|"
      case .prefix: r = "p|"
      case .suffix: r = "s|"
      }
      return (placeholder ? "ph|" : "") + r + text
    }
  }

  // MARK: - State

  private var engine = Engine()
  private var formatter = AmountFormatter()
  private var fonts: FontSet
  private var fontScale: CGFloat = 1
  /// Horizontal offset (in view points) when the content is wider than the
  /// view: it follows the caret like a UITextField's own scrolling does.
  private var scrollX: CGFloat = 0
  private var displayLink: CADisplayLink?
  private var lastReportedSize: CGSize = .zero
  /// A narrower settled size waiting for the current morph to finish before it is reported.
  private var pendingSizeReport = false
  private var didAutoFocus = false
  /// Set while this view writes the field's text itself, so the change handler
  /// can tell a programmatic set from a user edit.
  private var isSettingText = false

  private let field = HiddenTextField()
  /// Scaled and aligned container for the content (font space).
  private let contentLayer = CALayer()
  /// Clips glyphs to the line box, extended sideways so glyphs sliding in the
  /// margins are not cut; its mask fades the top and bottom edges.
  private let clipLayer = CALayer()
  private let edgeMask = CAGradientLayer()
  private let caretLayer = CALayer()
  /// One layer per live engine glyph id.
  private var glyphLayers: [Int64: CALayer] = [:]
  /// Where the content box sits in the bounds, as of the last render.
  private var placement: (origin: CGPoint, scale: CGFloat) = (.zero, 1)

  // MARK: - Lifecycle

  override init(frame: CGRect) {
    fonts = FontSet(Typography())
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    clipsToBounds = false

    field.owner = self
    field.delegate = self
    field.borderStyle = .none
    field.backgroundColor = .clear
    field.textColor = .clear
    field.adjustsFontSizeToFitWidth = false
    field.clearButtonMode = .never
    field.addTarget(self, action: #selector(fieldEditingChanged), for: .editingChanged)
    addSubview(field)

    contentLayer.anchorPoint = .zero
    contentLayer.contentsScale = fonts.renderScale
    layer.addSublayer(contentLayer)

    clipLayer.anchorPoint = .zero
    clipLayer.masksToBounds = true
    edgeMask.startPoint = CGPoint(x: 0.5, y: 0)
    edgeMask.endPoint = CGPoint(x: 0.5, y: 1)
    edgeMask.colors = [UIColor.clear.cgColor, UIColor.black.cgColor, UIColor.black.cgColor, UIColor.clear.cgColor]
    clipLayer.mask = edgeMask
    contentLayer.addSublayer(clipLayer)

    caretLayer.cornerRadius = 1
    caretLayer.isHidden = true
    contentLayer.addSublayer(caretLayer)

    engine.setTiming(timing.duration, timing.easing, timing.bounce)
    engine.setEffect(timing.effect)
    formatter.setFormat(Int32(format.fractionDigits), Int32(format.maxIntegerDigits),
                        std.string(format.groupingSeparator), std.string(format.decimalSeparator))
    applyFonts()
    applyTraits()

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

  /// React Native's `testID` lands on this view; the field is what tools and
  /// VoiceOver interact with, so it carries the identifier.
  override var accessibilityIdentifier: String? {
    didSet { field.accessibilityIdentifier = accessibilityIdentifier }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    field.frame = bounds
    // The shrink-to-fit scale and alignment depend on the bounds.
    render()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, traits.autoFocus, traits.editable, !didAutoFocus {
      didAutoFocus = true
      DispatchQueue.main.async { [weak self] in
        guard let self, self.window != nil else { return }
        self.field.becomeFirstResponder()
      }
    }
  }

  @objc private func contentSizeCategoryDidChange() {
    guard typography.allowFontScaling else { return }
    rebuildFonts()
  }

  func stopAnimation() {
    stopDisplayLink()
    stopBlink()
  }

  /// Returns the view to its pristine state so Fabric can reuse it for a new
  /// element (`RecyclableView`). Props are re-applied by Nitro afterwards.
  func resetForRecycle() {
    worklets = Worklets()
    if field.isFirstResponder { field.resignFirstResponder() }
    stopDisplayLink()
    stopBlink()
    engine.reset()
    fontScale = 1
    lastReportedSize = .zero
    pendingSizeReport = false
    didAutoFocus = false
    eventCount = 0
    isSettingText = true
    field.text = ""
    isSettingText = false
    format = Format()
    typography = Typography()
    timing = Timing()
    traits = Traits()
    alignment = .left
    // `onTextChange`, `onFocusChange`, `onSubmit` and `onIntrinsicSizeChange`
    // are the hybrid's wiring, not the element's props: they stay across
    // recycling (the hybrid clears its own callback props).
    clearGlyphLayers()
    caretLayer.isHidden = true
  }

  // MARK: - Public API

  func focus() {
    guard traits.editable else { return }
    field.becomeFirstResponder()
  }

  func blur() {
    field.resignFirstResponder()
  }

  /// Replaces the text (formatted in number mode, truncated to `maxLength` in
  /// text mode), caret at the end. Returns false when nothing changed.
  @discardableResult
  func setText(_ newText: String, reason: ChangeReason) -> Bool {
    var normalized = normalized(newText)
    if worklets.transform != 0 {
      let count = normalized.unicodeScalars.count
      let (selStart, selEnd) = selectionCodePoints()
      let result = margelo.nitro.nitromorphinput.morphworklets.runTransform(
        Int32(worklets.transform), std.string(normalized), std.string(text), Int32(count), Int32(count), Int32(selStart), Int32(selEnd))
      if result.applied { normalized = String(result.text) }
    }
    // The first application always commits so the engine has the (possibly
    // empty) text and its placeholder to draw.
    guard normalized != text || !engine.hasText() else { return false }
    isSettingText = true
    field.text = normalized
    field.selectedTextRange = field.textRange(from: field.endOfDocument, to: field.endOfDocument)
    isSettingText = false
    textDidChange(caret: -1, reason: reason)
    return true
  }

  func setValue(_ value: Double, reason: ChangeReason) {
    let formatted = value.isFinite ? String(formatter.format(value)) : ""
    setText(formatted, reason: reason)
  }

  func clear(reason: ChangeReason) {
    setText("", reason: reason)
  }

  /// Re-sends the last reported intrinsic size (e.g. after a listener was attached).
  func resendIntrinsicSize() {
    guard lastReportedSize != .zero else { return }
    onIntrinsicSizeChange?(lastReportedSize)
  }

  private func normalized(_ raw: String) -> String {
    switch format.mode {
    case .number:
      return String(formatter.normalize(std.string(raw)).text)
    case .text:
      return Self.truncated(raw, to: format.maxLength)
    }
  }

  private static func truncated(_ text: String, to maxLength: Int) -> String {
    guard maxLength > 0, text.unicodeScalars.count > maxLength else { return text }
    var view = String.UnicodeScalarView()
    view.append(contentsOf: text.unicodeScalars.prefix(maxLength))
    return String(view)
  }

  // MARK: - Configuration application

  private func applyFormat(previous: Format) {
    if format.mode == .number {
      formatter.setFormat(Int32(max(0, format.fractionDigits)), Int32(max(1, format.maxIntegerDigits)),
                          std.string(format.groupingSeparator), std.string(format.decimalSeparator))
    }
    updateFieldInsets()
    // A changed formatter or mode reformats what is in the field.
    let formatChanged = format.mode != previous.mode || format.fractionDigits != previous.fractionDigits
      || format.maxIntegerDigits != previous.maxIntegerDigits || format.groupingSeparator != previous.groupingSeparator
      || format.decimalSeparator != previous.decimalSeparator || format.maxLength != previous.maxLength
    if formatChanged {
      let normalizedText = normalized(text)
      if normalizedText != text {
        isSettingText = true
        field.text = normalizedText
        isSettingText = false
      }
    }
    applyKeyboardTraitsForMode()
    if engine.hasText() {
      feedEngine(caret: -1)
    }
  }

  private func rebuildFonts() {
    fonts = FontSet(typography)
    fontScale = 1
    // Every cached glyph image belongs to the old font set.
    clearGlyphLayers()
    applyFonts()
    if engine.hasText() {
      feedEngine(caret: -1)
    } else {
      render()
    }
  }

  private func applyFonts() {
    field.font = fonts.body
    var attributes = field.defaultTextAttributes
    attributes[.kern] = 0
    attributes[.font] = fonts.body
    attributes[.foregroundColor] = UIColor.clear
    field.defaultTextAttributes = attributes
    updateFieldInsets()
  }

  private func updateFieldInsets() {
    field.leftInset = affixWidth(format.prefix, role: .prefix)
    field.rightInset = affixWidth(format.suffix, role: .suffix)
    field.setNeedsLayout()
  }

  private func affixWidth(_ affix: String, role: GlyphRole) -> CGFloat {
    affix.unicodeScalars.reduce(CGFloat(0)) { $0 + fonts.width(of: String($1), role: role) }
  }

  private func applyTraits() {
    field.keyboardType = traits.keyboardType
    field.returnKeyType = traits.returnKeyType
    field.isEnabled = traits.editable
    field.isUserInteractionEnabled = traits.editable
    field.tintColor = traits.selectionColor
    if !traits.editable, field.isFirstResponder {
      field.resignFirstResponder()
    }
    applyKeyboardTraitsForMode()
    if traits.autoFocus, !didAutoFocus, window != nil, traits.editable {
      didAutoFocus = true
      field.becomeFirstResponder()
    }
    updateCaret()
  }

  private func applyKeyboardTraitsForMode() {
    if format.mode == .number {
      field.autocapitalizationType = .none
      field.autocorrectionType = .no
      field.spellCheckingType = .no
      field.smartInsertDeleteType = .no
      field.smartQuotesType = .no
      field.smartDashesType = .no
    } else {
      field.autocapitalizationType = traits.autocapitalization
      field.autocorrectionType = traits.autocorrect ? .default : .no
      field.spellCheckingType = traits.autocorrect ? .default : .no
      field.smartInsertDeleteType = .default
      field.smartQuotesType = .default
      field.smartDashesType = .default
    }
    if field.isFirstResponder {
      field.reloadInputViews()
    }
  }

  // MARK: - Text flow

  /// Every change to the field's text ends up here: the engine is fed the new
  /// glyph list and the change is reported.
  private func textDidChange(caret: Int, reason: ChangeReason) {
    feedEngine(caret: caret)
    if reason != .prop {
      eventCount += 1
      // Worklet callbacks run synchronously on the UI thread, before JS hears of the change.
      if worklets.onChangeText != 0 {
        margelo.nitro.nitromorphinput.morphworklets.runChangeText(Int32(worklets.onChangeText), std.string(text))
      }
      if worklets.onChangeValue != 0, format.mode == .number {
        margelo.nitro.nitromorphinput.morphworklets.runChangeValue(Int32(worklets.onChangeValue), value)
      }
    }
    onTextChange?(text, value, eventCount, reason)
  }

  /// The current selection as code point offsets.
  private func selectionCodePoints() -> (Int, Int) {
    let count = text.unicodeScalars.count
    guard let range = field.selectedTextRange else { return (count, count) }
    let start = Self.codePointOffset(in: text, utf16: field.offset(from: field.beginningOfDocument, to: range.start))
    let end = Self.codePointOffset(in: text, utf16: field.offset(from: field.beginningOfDocument, to: range.end))
    return (start, end)
  }

  /// Hands the engine the current text as glyphs (prefix, body or placeholder,
  /// suffix) with their advance widths and commits it.
  private func feedEngine(caret: Int) {
    engine.setReduceMotion(UIAccessibility.isReduceMotionEnabled)
    engine.beginText()
    for scalar in format.prefix.unicodeScalars {
      engine.addGlyph(scalar.value, Role.prefix, Kind.text, Double(fonts.width(of: String(scalar), role: .prefix)), false)
    }
    let body = text
    let showPlaceholder = body.isEmpty && !format.placeholder.isEmpty
    let bodyText = showPlaceholder ? format.placeholder : body
    let numberKinds = format.mode == .number
    for scalar in bodyText.unicodeScalars {
      let kind = numberKinds ? formatter.kindOf(scalar.value) : Kind.text
      engine.addGlyph(scalar.value, Role.body, kind, Double(fonts.width(of: String(scalar), role: .body)), showPlaceholder)
    }
    for scalar in format.suffix.unicodeScalars {
      engine.addGlyph(scalar.value, Role.suffix, Kind.text, Double(fonts.width(of: String(scalar), role: .suffix)), false)
    }
    engine.commitText(Int32(caret), CACurrentMediaTime())
    reportIntrinsicSize()
    updateDisplayLinkNeed()
    render()
    updateCaret(restartBlink: true)
  }

  @objc private func fieldEditingChanged() {
    guard !isSettingText else { return }
    // Text mode: the field edited itself; number mode edits never reach here
    // (the delegate applies them and returns false).
    textDidChange(caret: caretCodePointIndex(), reason: .user)
  }

  /// The selection start in code points (the engine's caret index).
  private func caretCodePointIndex() -> Int {
    guard let range = field.selectedTextRange else { return text.unicodeScalars.count }
    let utf16 = field.offset(from: field.beginningOfDocument, to: range.start)
    return Self.codePointOffset(in: text, utf16: utf16)
  }

  // MARK: - Offsets (UTF-16 ↔ code points)

  static func codePointOffset(in string: String, utf16 offset: Int) -> Int {
    let utf16 = string.utf16
    let clamped = min(max(0, offset), utf16.count)
    let index = utf16.index(utf16.startIndex, offsetBy: clamped)
    let scalars = string.unicodeScalars
    let scalarIndex = index.samePosition(in: scalars) ?? scalars.index(before: min(index, scalars.endIndex))
    return scalars.distance(from: scalars.startIndex, to: scalarIndex)
  }

  static func utf16Offset(in string: String, codePoint offset: Int) -> Int {
    let scalars = string.unicodeScalars
    let clamped = min(max(0, offset), scalars.count)
    let index = scalars.index(scalars.startIndex, offsetBy: clamped)
    return string.utf16.distance(from: string.utf16.startIndex, to: index)
  }

  // MARK: - Display link

  fileprivate func step(_ link: CADisplayLink) {
    _ = engine.tick(CACurrentMediaTime())
    if pendingSizeReport, !engine.needsFrames() {
      reportIntrinsicSize()
    }
    updateDisplayLinkNeed()
    // One Core Animation commit per frame: render() and updateCaret() each
    // open a transaction, and inside a display-link callback the outermost
    // explicit transaction commits to the render server immediately.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    render()
    updateCaret()
    CATransaction.commit()
  }

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
    weak var target: MorphInputView?
    init(target: MorphInputView) { self.target = target }
    @objc func tick(_ link: CADisplayLink) { target?.step(link) }
  }

  // MARK: - Typography helpers

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
      let descriptor = named.fontDescriptor.addingAttributes([.traits: traits])
      base = UIFont(descriptor: descriptor, size: size)
    } else if let family, !family.isEmpty, !UIFont.fontNames(forFamilyName: family).isEmpty {
      let descriptor = UIFontDescriptor(fontAttributes: [.family: family, .traits: traits])
      base = UIFont(descriptor: descriptor, size: size)
    } else {
      base = UIFont.systemFont(ofSize: size, weight: uiWeight)
    }
    // Tabular digits: a column keeps its width while its digit morphs.
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

  private static func textAlignment(_ alignment: Alignment) -> NSTextAlignment {
    switch alignment {
    case .left: return .left
    case .center: return .center
    case .right: return .right
    }
  }

  // MARK: - Intrinsic size

  private func reportIntrinsicSize() {
    let size = CGSize(width: ceil(CGFloat(engine.targetWidth()) + 2), height: fonts.lineHeight)
    guard abs(size.width - lastReportedSize.width) > 0.01 || abs(size.height - lastReportedSize.height) > 0.01 else {
      pendingSizeReport = false
      return
    }
    // Growing: report right away so React widens the box before the new glyph
    // has fully arrived (the view is not clipped meanwhile). Shrinking mid-morph:
    // keep the wider box until the morph has finished, otherwise
    // adjustsFontSizeToFit would squeeze the moving glyphs into the smaller box.
    if lastReportedSize != .zero, size.width < lastReportedSize.width, engine.isAnimating() {
      pendingSizeReport = true
      return
    }
    pendingSizeReport = false
    lastReportedSize = size
    onIntrinsicSizeChange?(size)
  }

  // MARK: - Rendering

  private func clearGlyphLayers() {
    for layer in glyphLayers.values {
      layer.removeFromSuperlayer()
    }
    glyphLayers = [:]
  }

  private static func glyphRole(_ role: Int32) -> GlyphRole {
    switch role {
    case Role.prefix: return .prefix
    case Role.suffix: return .suffix
    default: return .body
    }
  }

  private static func glyphText(_ character: UInt32) -> String {
    guard let scalar = Unicode.Scalar(character) else { return " " }
    return String(scalar)
  }

  private func contentPlacement(total: CGFloat, lineHeight: CGFloat) -> (origin: CGPoint, scale: CGFloat) {
    let fit = fontScale
    let shown = total * fit
    let originX: CGFloat
    if bounds.width > 0, shown > bounds.width + 0.5 {
      // Wider than the view (no shrink-to-fit, or its floor reached): scroll
      // horizontally so the caret stays in view while editing; at rest show
      // the start (the end for right-aligned content).
      let maxScroll = shown - bounds.width
      if field.isFirstResponder {
        let margin: CGFloat = 2
        let caretOnScreen = CGFloat(engine.caretX(caretBodyIndex())) * fit - scrollX
        if caretOnScreen > bounds.width - margin {
          scrollX += caretOnScreen - (bounds.width - margin)
        } else if caretOnScreen < margin {
          scrollX -= margin - caretOnScreen
        }
      } else {
        scrollX = alignment == .right ? maxScroll : 0
      }
      scrollX = min(max(0, scrollX), maxScroll)
      originX = -scrollX
    } else {
      scrollX = 0
      switch alignment {
      case .left: originX = 0
      case .center: originX = (bounds.width - shown) / 2
      case .right: originX = bounds.width - shown
      }
    }
    let originY = (bounds.height - lineHeight * fit) / 2
    return (CGPoint(x: originX, y: originY), fit)
  }

  /// Whether the content is wider than the view, so a caret move may need to scroll it.
  private var contentOverflows: Bool {
    bounds.width > 0 && CGFloat(engine.contentWidth()) * fontScale > bounds.width + 0.5
  }

  private func render() {
    let fonts = self.fonts
    let lineHeight = fonts.lineHeight
    let contentWidth = CGFloat(engine.contentWidth())
    updateFontScale(contentWidth: contentWidth)
    placement = contentPlacement(total: contentWidth, lineHeight: lineHeight)

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }

    contentLayer.bounds = CGRect(x: 0, y: 0, width: max(contentWidth, 1), height: lineHeight)
    contentLayer.position = placement.origin
    contentLayer.transform = placement.scale == 1 ? CATransform3DIdentity : CATransform3DMakeScale(placement.scale, placement.scale, 1)

    // The clip box extends one line height to each side so glyphs at the edges
    // are not cut while they slide, and a soft band (0.15 em, Torph's) above and
    // below the line box: the box itself stays fully opaque (a comma's tail
    // reaches its bottom edge), glyphs dissolve in the bands as they pass through.
    // When the content is wider than the view it is clipped to the view's
    // edges instead (scrolled like a UITextField), in content coordinates.
    let band = min(lineHeight / 3, 0.15 * fonts.body.pointSize)
    let clipLeft: CGFloat
    let clipRight: CGFloat
    if scrollX > 0 || (bounds.width > 0 && contentWidth * placement.scale > bounds.width + 0.5) {
      clipLeft = scrollX / max(placement.scale, 0.0001)
      clipRight = (scrollX + bounds.width) / max(placement.scale, 0.0001)
    } else {
      clipLeft = -lineHeight
      clipRight = max(contentWidth, 1) + lineHeight
    }
    let pad = -clipLeft
    clipLayer.frame = CGRect(x: clipLeft, y: -band, width: max(clipRight - clipLeft, 1), height: lineHeight + 2 * band)
    edgeMask.frame = clipLayer.bounds
    let fade = band / max(lineHeight + 2 * band, 1)
    edgeMask.locations = [0, NSNumber(value: Double(fade)), NSNumber(value: Double(1 - fade)), 1]

    var seen = Set<Int64>()
    let count = Int(engine.glyphCount())
    seen.reserveCapacity(count)
    for i in 0..<count {
      let g = engine.glyphAt(Int32(i))
      seen.insert(g.id)
      let role = Self.glyphRole(g.role)
      let text = Self.glyphText(g.character)
      let glyphLayer: CALayer
      if let existing = glyphLayers[g.id] {
        glyphLayer = existing
      } else {
        glyphLayer = CALayer()
        glyphLayer.contentsScale = fonts.renderScale
        if let image = fonts.image(text, role: role, placeholder: g.placeholder) {
          glyphLayer.contents = image.cgImage
          glyphLayer.bounds = CGRect(origin: .zero, size: image.size)
        }
        clipLayer.addSublayer(glyphLayer)
        glyphLayers[g.id] = glyphLayer
      }
      let size = glyphLayer.bounds.size
      let top = fonts.top(for: role, text: text, lineTop: band) + CGFloat(g.y) * lineHeight
      glyphLayer.position = CGPoint(x: pad + CGFloat(g.x) + size.width / 2, y: top + size.height / 2)
      glyphLayer.opacity = Float(min(1, max(0, g.opacity)))
      let scale = CGFloat(g.scale)
      glyphLayer.transform = abs(scale - 1) < 0.0001 ? CATransform3DIdentity : CATransform3DMakeScale(scale, scale, 1)
    }
    if glyphLayers.count != seen.count {
      for (id, glyphLayer) in glyphLayers where !seen.contains(id) {
        glyphLayer.removeFromSuperlayer()
        glyphLayers[id] = nil
      }
    }
    positionCaret()
  }

  // MARK: - Caret

  /// Whether our caret should be drawn: focused, not hidden, empty selection.
  private var wantsCaret: Bool {
    guard field.isFirstResponder, !traits.caretHidden else { return false }
    guard let range = field.selectedTextRange else { return false }
    return range.isEmpty
  }

  private func caretBodyIndex() -> Int32 {
    let index = caretCodePointIndex()
    return Int32(min(max(0, index), Int(engine.bodyCount())))
  }

  private func positionCaret() {
    let lineHeight = fonts.lineHeight
    let height = lineHeight * 0.9
    let x = CGFloat(engine.caretX(caretBodyIndex()))
    caretLayer.bounds = CGRect(x: 0, y: 0, width: 2, height: height)
    caretLayer.position = CGPoint(x: x, y: lineHeight / 2)
  }

  fileprivate func updateCaret(restartBlink: Bool = false) {
    let visible = wantsCaret
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    caretLayer.backgroundColor = (traits.caretColor ?? tintColor ?? .systemBlue).cgColor
    positionCaret()
    caretLayer.isHidden = !visible
    CATransaction.commit()
    if visible {
      if restartBlink || caretLayer.animation(forKey: "blink") == nil {
        startBlink()
      }
    } else {
      stopBlink()
    }
  }

  private func startBlink() {
    caretLayer.removeAnimation(forKey: "blink")
    let blink = CAKeyframeAnimation(keyPath: "opacity")
    blink.values = [1, 1, 0, 0]
    blink.keyTimes = [0, 0.5, 0.5, 1]
    blink.duration = 1
    blink.repeatCount = .infinity
    blink.calculationMode = .discrete
    // Stay solid for a moment after the caret moved, like the system caret.
    blink.beginTime = CACurrentMediaTime() + 0.35
    blink.fillMode = .backwards
    caretLayer.add(blink, forKey: "blink")
  }

  private func stopBlink() {
    caretLayer.removeAnimation(forKey: "blink")
  }

  // MARK: - Tap → caret

  /// The text position nearest to `point` (in this view's coordinates), going
  /// through the engine's glyph boundaries so taps stay right while the content
  /// is scaled or mid-morph.
  fileprivate func closestTextPosition(to point: CGPoint) -> UITextPosition? {
    let bodyCount = Int(engine.bodyCount())
    let textCount = text.unicodeScalars.count
    let contentX = (point.x - placement.origin.x) / max(placement.scale, 0.0001)
    var best = 0
    var bestDistance = CGFloat.greatestFiniteMagnitude
    for index in 0...bodyCount {
      let distance = abs(CGFloat(engine.caretX(Int32(index))) - contentX)
      if distance < bestDistance {
        bestDistance = distance
        best = index
      }
    }
    let codePoint = min(best, textCount)
    let utf16 = Self.utf16Offset(in: text, codePoint: codePoint)
    return field.position(from: field.beginningOfDocument, offset: utf16)
  }

  // MARK: - Hidden field

  /// The system field: invisible text, no caret, our insets, our hit mapping.
  private final class HiddenTextField: UITextField {
    weak var owner: MorphInputView?
    var leftInset: CGFloat = 0
    var rightInset: CGFloat = 0

    /// UIKit's paste controller puts the selection back where the pasted text
    /// would have ended *if it had inserted it*, which after a declined
    /// (formatted, transformed) edit is the pre-paste caret. Apply pasted
    /// text through the same path as a keystroke instead.
    override func paste(_ sender: Any?) {
      guard let owner, let string = UIPasteboard.general.string, let range = selectedTextRange else {
        return super.paste(sender)
      }
      let location = offset(from: beginningOfDocument, to: range.start)
      let length = offset(from: range.start, to: range.end)
      let nsRange = NSRange(location: location, length: length)
      if owner.textField(self, shouldChangeCharactersIn: nsRange, replacementString: string) {
        replace(range, withText: string)
      }
    }

    override func caretRect(for position: UITextPosition) -> CGRect {
      let rect = super.caretRect(for: position)
      return CGRect(origin: rect.origin, size: .zero)
    }

    override func textRect(forBounds bounds: CGRect) -> CGRect {
      insetRect(super.textRect(forBounds: bounds))
    }

    override func editingRect(forBounds bounds: CGRect) -> CGRect {
      insetRect(super.editingRect(forBounds: bounds))
    }

    override func placeholderRect(forBounds bounds: CGRect) -> CGRect {
      insetRect(super.placeholderRect(forBounds: bounds))
    }

    private func insetRect(_ rect: CGRect) -> CGRect {
      var r = rect
      r.origin.x += leftInset
      r.size.width = max(0, r.size.width - leftInset - rightInset)
      return r
    }

    // UITextInput geometry is in `textInputView`'s coordinates: for a
    // UITextField that is its internal text canvas, which scrolls on its own
    // once the text is wider than the field, so convert from there.
    override func closestPosition(to point: CGPoint) -> UITextPosition? {
      if let owner, let position = owner.closestTextPosition(to: textInputView.convert(point, to: owner)) {
        return position
      }
      return super.closestPosition(to: point)
    }

    override func closestPosition(to point: CGPoint, within range: UITextRange) -> UITextPosition? {
      guard let owner, let position = owner.closestTextPosition(to: textInputView.convert(point, to: owner)) else {
        return super.closestPosition(to: point, within: range)
      }
      if compare(position, to: range.start) == .orderedAscending { return range.start }
      if compare(position, to: range.end) == .orderedDescending { return range.end }
      return position
    }
  }
}

// MARK: - UITextFieldDelegate

extension MorphInputView: UITextFieldDelegate {

  func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
    let current = text
    let start = Self.codePointOffset(in: current, utf16: range.location)
    let end = Self.codePointOffset(in: current, utf16: range.location + range.length)
    var newText: String
    var caret: Int
    switch format.mode {
    case .number:
      // Run the edit through the formatter and apply the result ourselves, so
      // the field never shows an unformatted frame.
      let edit = formatter.applyEdit(std.string(current), Int32(start), Int32(end), std.string(string))
      guard edit.accepted else { return false }
      newText = String(edit.text)
      caret = Int(edit.caret)
    case .text:
      // Without a transform or a length limit the field edits itself (keeps
      // marked text / autocorrect intact); `fieldEditingChanged` reports it.
      guard worklets.transform != 0 || format.maxLength > 0, let swiftRange = Range(range, in: current) else { return true }
      var replacement = string
      if format.maxLength > 0 {
        // Keep as much of the replacement as fits (a paste), or nothing.
        let room = format.maxLength - (current.unicodeScalars.count - (end - start))
        if !string.isEmpty && room <= 0 { return false }
        if string.unicodeScalars.count > room {
          var view = String.UnicodeScalarView()
          view.append(contentsOf: string.unicodeScalars.prefix(max(0, room)))
          replacement = String(view)
        }
      }
      newText = current
      newText.replaceSubrange(swiftRange, with: replacement)
      caret = start + replacement.unicodeScalars.count
    }
    var selectionEnd = caret
    if worklets.transform != 0 {
      let result = margelo.nitro.nitromorphinput.morphworklets.runTransform(
        Int32(worklets.transform), std.string(newText), std.string(current), Int32(caret), Int32(caret), Int32(start), Int32(end))
      if result.applied {
        newText = String(result.text)
        let count = newText.unicodeScalars.count
        caret = Int(result.selectionStart) < 0 ? count : min(Int(result.selectionStart), count)
        selectionEnd = min(max(caret, Int(result.selectionEnd)), count)
      }
    }
    // The common keystroke: the formatter and transform changed nothing beyond
    // the typed characters, and the caret lands where UIKit would put it. Let
    // the field apply the edit itself (its incremental path is far cheaper than
    // replacing the text); `fieldEditingChanged` then reports it.
    if let swiftRange = Range(range, in: current), selectionEnd == caret,
       caret == start + string.unicodeScalars.count {
      var plain = current
      plain.replaceSubrange(swiftRange, with: string)
      if plain == newText { return true }
    }
    isSettingText = true
    replaceMinimally(in: textField, with: newText)
    let from = Self.utf16Offset(in: newText, codePoint: caret)
    let to = Self.utf16Offset(in: newText, codePoint: selectionEnd)
    if let fromPosition = textField.position(from: textField.beginningOfDocument, offset: from),
       let toPosition = textField.position(from: textField.beginningOfDocument, offset: to) {
      textField.selectedTextRange = textField.textRange(from: fromPosition, to: toPosition)
    }
    isSettingText = false
    textDidChange(caret: caret, reason: .user)
    return false
  }

  /// Replaces only the span that differs between the field's text and `newText`
  /// (a comma that appeared, a mask's punctuation): `UITextField.text = ...`
  /// rebuilds the whole text storage and was the bulk of a keystroke's cost.
  private func replaceMinimally(in textField: UITextField, with newText: String) {
    let current = Array((textField.text ?? "").utf16)
    let next = Array(newText.utf16)
    var prefix = 0
    while prefix < current.count, prefix < next.count, current[prefix] == next[prefix] { prefix += 1 }
    var suffix = 0
    while suffix < current.count - prefix, suffix < next.count - prefix,
          current[current.count - 1 - suffix] == next[next.count - 1 - suffix] { suffix += 1 }
    guard prefix + suffix < current.count || prefix + suffix < next.count else { return }
    let replacement = String(utf16CodeUnits: Array(next[prefix..<(next.count - suffix)]), count: next.count - suffix - prefix)
    if let from = textField.position(from: textField.beginningOfDocument, offset: prefix),
       let to = textField.position(from: textField.beginningOfDocument, offset: current.count - suffix),
       let textRange = textField.textRange(from: from, to: to) {
      textField.replace(textRange, withText: replacement)
    } else {
      textField.text = newText
    }
  }

  func textFieldDidBeginEditing(_ textField: UITextField) {
    if contentOverflows { render() }
    updateCaret(restartBlink: true)
    onFocusChange?(true)
  }

  func textFieldDidEndEditing(_ textField: UITextField) {
    if contentOverflows { render() }
    updateCaret()
    onFocusChange?(false)
  }

  func textFieldDidChangeSelection(_ textField: UITextField) {
    guard !isSettingText else { return }
    // A caret move alone does not re-render; when the content is wider than
    // the view the scroll offset has to follow it.
    if contentOverflows { render() }
    updateCaret(restartBlink: true)
  }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    onSubmit?(text)
    textField.resignFirstResponder()
    return false
  }
}
