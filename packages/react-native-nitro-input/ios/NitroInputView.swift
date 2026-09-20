//
//  NitroInputView.swift
//  NitroInput
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

final class NitroInputView: UIView {

  private typealias Engine = margelo.nitro.nitroinput.MorphEngine
  private typealias AmountFormatter = margelo.nitro.nitroinput.AmountFormatter
  private typealias MaskEngine = margelo.nitro.nitroinput.MaskEngine
  private typealias Outline = margelo.nitro.nitroinput.OutlineGeometry

  // Engine roles / kinds (plain ints so the unscoped C++ enums need no bridging).
  private enum Role { static let prefix: Int32 = 0, body: Int32 = 1, suffix: Int32 = 2 }
  private enum Kind { static let text: Int32 = 0 }

  // MARK: - Configuration

  enum Mode: Equatable {
    case text, number, mask
  }

  /// A caller-defined slot character for `mask`.
  struct MaskNotation: Equatable {
    var character: String
    var characterSet: String
    var isOptional: Bool
  }

  struct Format: Equatable {
    var mode: Mode = .text
    /// Mask mode: the pattern, e.g. "+1 ([000]) [000]-[0000]".
    var mask: String = ""
    var maskNotations: [MaskNotation] = []
    var maskAutocomplete: Bool = true
    var maskAutoSkip: Bool = false
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

  enum Variant: Equatable { case none, outlined, filled }
  enum LabelBehavior: Equatable { case float, always }

  /// The frame the view draws for itself: the outline (or fill) and the
  /// floating label. Separate from `Format` because it changes independently.
  struct Frame: Equatable {
    var variant: Variant = .none
    var label: String = ""
    var labelBehavior: LabelBehavior = .float
    var labelColor: UIColor? = nil
    var labelFocusedColor: UIColor? = nil
    var labelFontSize: CGFloat = 0
    var strokeColor: UIColor? = nil
    var focusedStrokeColor: UIColor? = nil
    var strokeWidth: CGFloat = 1
    var cornerRadius: CGFloat = 8
    var fillColor: UIColor? = nil

    var draws: Bool { variant != .none }
    var hasLabel: Bool { draws && !label.isEmpty }
  }

  struct Typography: Hashable {
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
    /// `submitBehavior`: whether the return key also dismisses the keyboard.
    var blurOnSubmit: Bool = true
    var secureTextEntry: Bool = false
    var keyboardAppearance: UIKeyboardAppearance = .default
    var textContentType: UITextContentType? = nil
    var enablesReturnKeyAutomatically: Bool = false
    var showSoftInputOnFocus: Bool = true
    var selectTextOnFocus: Bool = false
    var clearTextOnFocus: Bool = false
    var contextMenuHidden: Bool = false
    var spellCheck: Bool = true
    /// `testID` and `accessibilityLabel`, forwarded from JS so the hidden
    /// field — the element VoiceOver and e2e tools see — carries them.
    var testID: String? = nil
    var accessibilityLabel: String? = nil
    /// `NitroInput`: let the system field draw its own text and skip the
    /// overlay, the glyph engine and the custom caret entirely.
    var plain: Bool = false
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

  var inputFrame = Frame() {
    didSet {
      guard inputFrame != oldValue else { return }
      applyFrame()
    }
  }

  var typography = Typography() {
    didSet {
      guard typography != oldValue else { return }
      rebuildFonts()
      if inputFrame.draws { layoutFrame(animated: false) }
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
  /// UI thread through `NitroInputWorkletsBridge` while an edit is handled.
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
  /// Mask mode: formatted, extracted, tail placeholder, complete.
  var onMaskChange: ((String, String, String, Bool) -> Void)?
  var onFocusChange: ((Bool) -> Void)?
  var onSubmit: ((String) -> Void)?
  var onEndEditing: ((String) -> Void)?
  var onSelectionChange: ((Int, Int) -> Void)?
  var onKeyPress: ((String) -> Void)?
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

  fileprivate enum GlyphRole {
    case body, prefix, suffix
  }

  /// Body / prefix / suffix fonts with per-glyph caches (advance widths, ink
  /// metrics and pre-rasterized images in the text or placeholder colour).
  fileprivate final class FontSet {
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

    /// Font sets are immutable for a given `Typography` and their caches are
    /// pure functions of it, so views that look alike share one. Without this
    /// every field builds its own three `UIFont`s and re-rasterizes the same
    /// glyphs: 20 identical fields did the work 20 times, and each field did it
    /// twice over (once for the defaults in `init`, once when the real
    /// typography arrived). Main-thread only, like the rest of the view.
    private static var shared: [Typography: FontSet] = [:]
    private static var sharedOrder: [Typography] = []

    static func shared(for t: Typography) -> FontSet {
      if let hit = shared[t] { return hit }
      let made = FontSet(t)
      shared[t] = made
      sharedOrder.append(t)
      // A screen rarely uses many distinct typographies; keep the newest few
      // so the caches cannot grow without bound.
      if sharedOrder.count > 12 {
        let evicted = sharedOrder.removeFirst()
        shared.removeValue(forKey: evicted)
      }
      return made
    }

    init(_ t: Typography) {
      renderScale = max(1, UIScreen.main.scale)
      let scale = NitroInputView.systemFontMultiplier(t)
      body = NitroInputView.makeFont(size: t.fontSize * scale, weight: t.fontWeight, family: t.fontFamily)
      prefix = NitroInputView.makeFont(size: (t.prefixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily)
      suffix = NitroInputView.makeFont(size: (t.suffixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily)
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
  private var maskEngine = MaskEngine()
  /// The outline / fill. Stroke-only, so the notch is a hole rather than a mask.
  private lazy var frameLayer: CAShapeLayer = {
    let shape = CAShapeLayer()
    shape.fillColor = nil
    shape.lineCap = .round
    layer.insertSublayer(shape, at: 0)
    return shape
  }()
  /// `filled`: the bottom rule. A plain layer - it is a rectangle, so it needs
  /// no path, and Core Animation can tween its frame and colour directly.
  private lazy var underlineLayer: CALayer = {
    let rule = CALayer()
    layer.insertSublayer(rule, at: 1)
    return rule
  }()
  private lazy var labelLayer: CATextLayer = {
    let text = CATextLayer()
    text.contentsScale = UIScreen.main.scale
    text.anchorPoint = CGPoint(x: 0, y: 0.5)
    text.alignmentMode = .left
    layer.addSublayer(text)
    return text
  }()
  private var didBuildFrameLayers = false
  /// False until the frame has been laid out once, so the first pass settles
  /// into place rather than animating from nothing.
  private var didLayOutFrame = false
  /// 0 = label resting inside the field, 1 = floated into the notch.
  fileprivate var labelProgress: CGFloat = 0
  /// What the frame layers were last built from. Laying out mutates sublayers,
  /// which marks the view for layout again; without this the pass repeats
  /// forever. It also keeps text measurement off the common layout path.
  fileprivate struct FrameSnapshot: Equatable {
    var bounds: CGRect = .null
    var progress: CGFloat = -1
    var stroke: CGFloat = -1
    var focused = false
    var label = ""
    var fontSize: CGFloat = 0
    var frame = Frame()
  }
  fileprivate var lastFrameSnapshot = FrameSnapshot()
  fileprivate var fonts: FontSet
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

  fileprivate let field = HiddenTextField()
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
  /// Last selection handed to `onSelectionChange`, so it only fires on a move.
  private var lastReportedSelection: (Int, Int)?

  // MARK: - Lifecycle

  override init(frame: CGRect) {
    fonts = FontSet.shared(for: Typography())
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

  /// Fabric applies `testID`, `accessibilityLabel` and the react tag to the
  /// *component view* that hosts this one, not to this view, so they are copied
  /// down to the hidden field — it is the element VoiceOver and e2e tools see.
  /// The react tag also has to sit on this view: react-native-keyboard-controller
  /// reports the focused input as `firstResponder.superview.tag`, and this view
  /// is the field's superview.
  private func syncAccessibilityFromHost() {
    guard let host = superview else { return }
    if tag != host.tag { tag = host.tag }
    // `traits.testID` is the explicit prop; the host's own identifier is the
    // fallback for a caller that set it natively.
    let identifier = traits.testID ?? accessibilityIdentifier ?? host.accessibilityIdentifier
    if field.accessibilityIdentifier != identifier { field.accessibilityIdentifier = identifier }
    // A floating label is the field's visible name, but it is drawn in a layer
    // - VoiceOver cannot see it. Without this a field whose only name is its
    // `label` is announced as an unnamed text field. An explicit
    // `accessibilityLabel` still wins.
    let label = traits.accessibilityLabel ?? host.accessibilityLabel
      ?? (inputFrame.hasLabel ? inputFrame.label : nil)
    if field.accessibilityLabel != label { field.accessibilityLabel = label }
    let hint = host.accessibilityHint
    if field.accessibilityHint != hint { field.accessibilityHint = hint }
  }

  /// Gives the field UIKit's own placeholder so an *empty* field still has an
  /// accessibility value (VoiceOver reads it, e2e tools can find it). It is
  /// drawn in clear: the overlay already draws the placeholder glyphs itself.
  fileprivate func syncAccessibilityPlaceholder() {
    let placeholder = effectivePlaceholder
    // Drawn for real in plain mode; in morph mode the overlay draws it and the
    // field's own copy exists only so an empty field still has an
    // accessibility value, hence clear.
    let color = traits.plain ? typography.placeholderColor : UIColor.clear
    let unchanged = field.attributedPlaceholder?.string == placeholder
      && field.attributedPlaceholder?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor == color
    guard !unchanged || placeholder.isEmpty != (field.attributedPlaceholder == nil) else { return }
    field.attributedPlaceholder = placeholder.isEmpty
      ? nil
      : NSAttributedString(string: placeholder, attributes: [.foregroundColor: color])
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    syncAccessibilityFromHost()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    field.frame = bounds
    // UIKit makes the field first responder - and lays us out for the keyboard
    // - before it calls the delegate, so this pass is usually the first to see
    // the label needing to float. If it committed the move without animating,
    // `textFieldDidBeginEditing` would arrive to find nothing left to change
    // and the label would snap. Layout animates a progress change too; an
    // ordinary layout does not change progress, so nothing animates then. Only
    // the very first pass is silent, so a field mounted focused starts settled.
    if wantsFrameDrawing { layoutFrame(animated: didLayOutFrame) }
    // Props are applied after the view is mounted, so the host's identifier and
    // tag are only reliable once it has been laid out.
    syncAccessibilityFromHost()
    // The shrink-to-fit scale and alignment depend on the bounds.
    render()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    syncAccessibilityFromHost()
    maybeAutoFocus()
  }

  /// `autoFocus`, taken **synchronously** as soon as the view has a window and
  /// the prop has arrived — whichever of the two happens last.
  ///
  /// Pushing a screen blurs the field on the screen being covered, and iOS
  /// starts animating the keyboard away as soon as nothing is first responder.
  /// Claiming it in the same runloop turn beats that: UIKit swaps the keyboard
  /// in place, so a different keyboard type appears with no dismiss and
  /// re-present. That is what React Native's own `TextInput` does. Deferring by
  /// even one turn loses the race and costs a full hide plus show animation.
  /// If UIKit declines — the view is in a window but not ready to accept first
  /// responder yet — retry next turn, which is correct, just not seamless.
  private func maybeAutoFocus() {
    guard window != nil, traits.autoFocus, traits.editable, !didAutoFocus else { return }
    didAutoFocus = true
    if field.becomeFirstResponder() { return }
    DispatchQueue.main.async { [weak self] in
      guard let self, self.window != nil else { return }
      self.field.becomeFirstResponder()
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
    lastReportedSelection = nil
    pendingSizeReport = false
    didAutoFocus = false
    eventCount = 0
    isSettingText = true
    field.text = ""
    isSettingText = false
    inputFrame = Frame()
    labelProgress = 0
    lastFrameSnapshot = FrameSnapshot()
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

  /// Moves the caret/selection to `start`..`end`, in code points.
  func setSelection(start: Int, end: Int) {
    let count = text.unicodeScalars.count
    let lower = min(max(0, start), count)
    let upper = min(max(lower, end), count)
    guard let from = field.position(from: field.beginningOfDocument, offset: utf16Offset(ofCodePoint: lower)),
          let to = field.position(from: field.beginningOfDocument, offset: utf16Offset(ofCodePoint: upper)),
          let range = field.textRange(from: from, to: to) else { return }
    guard field.selectedTextRange != range else { return }
    field.selectedTextRange = range
  }

  /// UITextField works in UTF-16; the props and callbacks speak code points.
  private func utf16Offset(ofCodePoint index: Int) -> Int {
    guard index > 0 else { return 0 }
    let scalars = Array(text.unicodeScalars)
    let slice = scalars.prefix(min(index, scalars.count))
    return String(String.UnicodeScalarView(slice)).utf16.count
  }

  /// Replaces the text (formatted in number mode, truncated to `maxLength` in
  /// text mode), caret at the end. Returns false when nothing changed.
  @discardableResult
  func setText(_ newText: String, reason: ChangeReason) -> Bool {
    var normalized = normalized(newText)
    if worklets.transform != 0 {
      let count = normalized.unicodeScalars.count
      let (selStart, selEnd) = selectionCodePoints()
      let result = margelo.nitro.nitroinput.nitroinputworklets.runTransform(
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
    case .mask:
      let count = Int32(raw.unicodeScalars.count)
      let result = maskEngine.apply(std.string(raw), count, true, format.maskAutocomplete, false)
      return String(result.formattedText)
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
    if format.mode == .mask, format.mask != previous.mask || format.maskNotations != previous.maskNotations
        || previous.mode != .mask {
      maskEngine.clearNotations()
      for notation in format.maskNotations {
        maskEngine.addNotation(std.string(notation.character), std.string(notation.characterSet),
                               notation.isOptional)
      }
      // A bad pattern leaves the engine inactive; the field then behaves as
      // plain text rather than refusing every keystroke.
      _ = maskEngine.setFormat(std.string(format.mask))
    }
    updateFieldInsets()
    syncAccessibilityPlaceholder()
    // A changed formatter or mode reformats what is in the field.
    let formatChanged = format.mode != previous.mode || format.fractionDigits != previous.fractionDigits
      || format.maxIntegerDigits != previous.maxIntegerDigits || format.groupingSeparator != previous.groupingSeparator
      || format.decimalSeparator != previous.decimalSeparator || format.maxLength != previous.maxLength
      || format.mask != previous.mask || format.maskNotations != previous.maskNotations
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
    fonts = FontSet.shared(for: typography)
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
    attributes[.foregroundColor] = traits.plain ? typography.color : UIColor.clear
    field.defaultTextAttributes = attributes
    updateFieldInsets()
  }

  /// In morph mode the overlay draws the prefix and suffix, so the field only
  /// has to reserve the space. In `plain` mode nothing is drawing them, so the
  /// field carries them itself as its left/right accessory views — UIKit insets
  /// the text for those on its own.
  private func updateFieldInsets() {
    // A floated label sits half above the top edge, so the text starts lower.
    field.topInset = frameTopInset
    let side = frameSideInset
    if traits.plain {
      field.leftInset = side
      field.rightInset = side
      field.leftView = affixLabel(format.prefix, role: .prefix, reusing: field.leftView as? UILabel)
      field.leftViewMode = field.leftView == nil ? .never : .always
      field.rightView = affixLabel(format.suffix, role: .suffix, reusing: field.rightView as? UILabel)
      field.rightViewMode = field.rightView == nil ? .never : .always
    } else {
      field.leftView = nil
      field.rightView = nil
      field.leftViewMode = .never
      field.rightViewMode = .never
      field.leftInset = side + affixWidth(format.prefix, role: .prefix)
      field.rightInset = side + affixWidth(format.suffix, role: .suffix)
    }
    field.setNeedsLayout()
  }

  private func affixLabel(_ affix: String, role: GlyphRole, reusing existing: UILabel?) -> UILabel? {
    guard !affix.isEmpty else { return nil }
    let label = existing ?? UILabel()
    label.font = fonts.font(for: role)
    label.textColor = typography.color
    if label.text != affix { label.text = affix }
    label.sizeToFit()
    return label
  }

  private func affixWidth(_ affix: String, role: GlyphRole) -> CGFloat {
    affix.unicodeScalars.reduce(CGFloat(0)) { $0 + fonts.width(of: String($1), role: role) }
  }

  private func applyTraits() {
    field.keyboardType = traits.keyboardType
    field.returnKeyType = traits.returnKeyType
    field.isEnabled = traits.editable
    field.isUserInteractionEnabled = traits.editable
    // `tintColor` is both the caret and the selection on a UITextField. The
    // overlay draws its own caret, so only `plain` has a caret colour to honour
    // here — and `caretColor` wins over `selectionColor` when both are set.
    field.tintColor = traits.plain ? (traits.caretColor ?? traits.selectionColor) : traits.selectionColor
    field.keyboardAppearance = traits.keyboardAppearance
    field.enablesReturnKeyAutomatically = traits.enablesReturnKeyAutomatically
    field.textContentType = traits.textContentType
    // UIKit would draw its own bullets; the overlay masks the glyphs instead
    // (see `glyphs()`), so the field itself only needs the secure *behaviour*
    // — no autocorrect, no dictation, no screenshot of the text.
    if field.isSecureTextEntry != traits.secureTextEntry {
      field.isSecureTextEntry = traits.secureTextEntry
      // The mask changes what is drawn, not what is stored.
      if engine.hasText() { feedEngine(caret: -1) }
    }
    applyPlain()
    syncAccessibilityFromHost()
    field.showSoftInputOnFocus = traits.showSoftInputOnFocus
    field.contextMenuHidden = traits.contextMenuHidden
    if !traits.editable, field.isFirstResponder {
      field.resignFirstResponder()
    }
    applyKeyboardTraitsForMode()
    maybeAutoFocus()
    updateCaret()
  }

  /// Switches between "hidden field + overlay" and "the field draws itself".
  private func applyPlain() {
    let plain = traits.plain
    defer { syncAccessibilityPlaceholder() }
    field.hidesNativeCaret = !plain || traits.caretHidden
    if plain {
      stopDisplayLink()
      stopBlink()
      caretLayer.isHidden = true
      if contentLayer.superlayer != nil { contentLayer.removeFromSuperlayer() }
      clearGlyphLayers()
      engine.reset()
      field.textColor = typography.color
      field.textAlignment = Self.textAlignment(for: alignment)
      field.adjustsFontSizeToFitWidth = typography.adjustsFontSizeToFit
      field.minimumFontSize = typography.adjustsFontSizeToFit
        ? typography.fontSize * typography.minimumFontScale
        : 0
    } else {
      if contentLayer.superlayer == nil { layer.addSublayer(contentLayer) }
      field.textColor = .clear
      field.textAlignment = .left
      field.adjustsFontSizeToFitWidth = false
    }
    // The overlay used to paint the glyphs in the text colour; the field's own
    // attributes carry it now, so they have to be re-applied either way.
    var attributes = field.defaultTextAttributes
    attributes[.foregroundColor] = plain ? typography.color : UIColor.clear
    field.defaultTextAttributes = attributes
    updateFieldInsets()
  }

  private static func textAlignment(for alignment: Alignment) -> NSTextAlignment {
    switch alignment {
    case .left: return .left
    case .center: return .center
    case .right: return .right
    }
  }

  private func applyKeyboardTraitsForMode() {
    // A mask decides every character, so the keyboard must not second-guess it:
    // autocorrect would fight `shouldChangeCharactersIn` over the replacement.
    if format.mode == .number || format.mode == .mask {
      field.autocapitalizationType = .none
      field.autocorrectionType = .no
      field.spellCheckingType = .no
      field.smartInsertDeleteType = .no
      field.smartQuotesType = .no
      field.smartDashesType = .no
    } else {
      field.autocapitalizationType = traits.autocapitalization
      field.autocorrectionType = traits.autocorrect ? .default : .no
      field.spellCheckingType = traits.spellCheck ? .default : .no
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
        margelo.nitro.nitroinput.nitroinputworklets.runChangeText(Int32(worklets.onChangeText), std.string(text))
      }
      if worklets.onChangeValue != 0, format.mode == .number {
        margelo.nitro.nitroinput.nitroinputworklets.runChangeValue(Int32(worklets.onChangeValue), value)
      }
    }
    if format.mode == .mask, let onMaskChange {
      // Derived from the settled text so every route reports the same thing:
      // a keystroke, `setText`, a prop change or a transform worklet.
      let result = maskEngine.apply(std.string(text), Int32(text.unicodeScalars.count), true,
                                    format.maskAutocomplete, false)
      onMaskChange(text, String(result.extractedValue), String(result.tailPlaceholder), result.complete)
    }
    if wantsFrameDrawing { layoutFrame(animated: reason != .prop) }
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
  fileprivate func feedEngine(caret: Int) {
    // Plain mode has no overlay to feed: the field draws its own text.
    guard !traits.plain else { return }
    engine.setReduceMotion(UIAccessibility.isReduceMotionEnabled)
    engine.beginText()
    for scalar in format.prefix.unicodeScalars {
      engine.addGlyph(scalar.value, Role.prefix, Kind.text, Double(fonts.width(of: String(scalar), role: .prefix)), false)
    }
    // `secureTextEntry` masks what the overlay draws: the hidden field keeps
    // the real text (UIKit needs it for editing and autofill), but every glyph
    // the user sees is a bullet.
    let body = traits.secureTextEntry
      ? String(repeating: "\u{2022}", count: text.unicodeScalars.count)
      : text
    let showPlaceholder = body.isEmpty && !effectivePlaceholder.isEmpty
    let bodyText = showPlaceholder ? effectivePlaceholder : body
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
    weak var target: NitroInputView?
    init(target: NitroInputView) { self.target = target }
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
    // An outlined or filled frame reserves room at the sides for its stroke
    // and at the top for the floated label; the glyphs lay out inside that.
    let side = frameSideInset
    let top = frameTopInset
    let boxWidth = max(0, bounds.width - side * 2)
    let originX: CGFloat
    if boxWidth > 0, shown > boxWidth + 0.5 {
      // Wider than the view (no shrink-to-fit, or its floor reached): scroll
      // horizontally so the caret stays in view while editing; at rest show
      // the start (the end for right-aligned content).
      let maxScroll = shown - boxWidth
      if field.isFirstResponder {
        let margin: CGFloat = 2
        let caretOnScreen = CGFloat(engine.caretX(caretBodyIndex())) * fit - scrollX
        if caretOnScreen > boxWidth - margin {
          scrollX += caretOnScreen - (boxWidth - margin)
        } else if caretOnScreen < margin {
          scrollX -= margin - caretOnScreen
        }
      } else {
        scrollX = alignment == .right ? maxScroll : 0
      }
      scrollX = min(max(0, scrollX), maxScroll)
      originX = side - scrollX
    } else {
      scrollX = 0
      switch alignment {
      case .left: originX = side
      case .center: originX = side + (boxWidth - shown) / 2
      case .right: originX = side + boxWidth - shown
      }
    }
    let originY = top + (bounds.height - top - lineHeight * fit) / 2
    return (CGPoint(x: originX, y: originY), fit)
  }

  /// Whether the content is wider than the view, so a caret move may need to scroll it.
  private var contentOverflows: Bool {
    bounds.width > 0 && CGFloat(engine.contentWidth()) * fontScale > bounds.width + 0.5
  }

  private func render() {
    guard !traits.plain else { return }
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
    // The system caret is the real one in plain mode.
    guard !traits.plain else { return }
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
  fileprivate final class HiddenTextField: UITextField {
    weak var owner: NitroInputView?
    var leftInset: CGFloat = 0
    var rightInset: CGFloat = 0
    /// Room for a floated label sitting on the top edge.
    var topInset: CGFloat = 0
    /// `showSoftInputOnFocus: false` keeps focus and the caret but shows no
    /// keyboard, for a field driven by an in-app keypad.
    var showSoftInputOnFocus: Bool = true {
      didSet {
        guard showSoftInputOnFocus != oldValue else { return }
        // An empty input view is how UIKit is told "no keyboard".
        inputView = showSoftInputOnFocus ? nil : UIView(frame: .zero)
        if isFirstResponder { reloadInputViews() }
      }
    }
    /// `contextMenuHidden`: suppresses the Cut/Copy/Paste menu.
    var contextMenuHidden: Bool = false
    /// The morph overlay draws its own caret, so the field's is collapsed away.
    /// In `plain` mode there is no overlay and the system caret is the caret.
    var hidesNativeCaret: Bool = true

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
      if contextMenuHidden { return false }
      return super.canPerformAction(action, withSender: sender)
    }

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
      guard hidesNativeCaret else { return rect }
      return CGRect(origin: rect.origin, size: .zero)
    }

    override func textRect(forBounds bounds: CGRect) -> CGRect {
      insetRect(super.textRect(forBounds: bounds))
    }

    override func editingRect(forBounds bounds: CGRect) -> CGRect {
      insetRect(super.editingRect(forBounds: bounds))
    }

    override func placeholderRect(forBounds bounds: CGRect) -> CGRect {
      // NOT `super.placeholderRect` - UIKit derives that from `textRect`,
      // which is overridden above and has already applied the insets, so
      // insetting its result applies them a second time. The placeholder was
      // landing at twice the left inset (and, on the filled variant, twice the
      // top one). It belongs in the text's own rect.
      insetRect(super.textRect(forBounds: bounds))
    }

    // The affix accessories are laid out by UIKit, which knows nothing about
    // our insets - so a prefix sat on top of the frame's stroke instead of
    // starting where the text does. `insetRect` cannot be reused here: it also
    // trims the width, and these are sized to their own content.
    override func leftViewRect(forBounds bounds: CGRect) -> CGRect {
      var r = super.leftViewRect(forBounds: bounds)
      r.origin.x += leftInset
      // `insetRect` moves the text's centre by half the top inset; the affix
      // has to travel with it or it sits above its own text.
      r.origin.y += topInset / 2
      return r
    }

    override func rightViewRect(forBounds bounds: CGRect) -> CGRect {
      var r = super.rightViewRect(forBounds: bounds)
      r.origin.x -= rightInset
      r.origin.y += topInset / 2
      return r
    }

    private func insetRect(_ rect: CGRect) -> CGRect {
      var r = rect
      // UIKit lays the text rect out *after* the accessories, using
      // `leftViewRect` / `rightViewRect` - which are overridden above and
      // already apply the insets. Adding them again on this side would double
      // them, which is exactly what `placeholderRect` used to do. So the inset
      // is ours to apply only on the edges with no accessory.
      let leading = leftView == nil ? leftInset : 0
      let trailing = rightView == nil ? rightInset : 0
      r.origin.x += leading
      r.size.width = max(0, r.size.width - leading - trailing)
      r.origin.y += topInset
      r.size.height = max(0, r.size.height - topInset)
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

extension NitroInputView: UITextFieldDelegate {

  func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
    // Like React Native's `onKeyPress`: fires before the text changes, with
    // 'Backspace' for a deletion and the inserted string otherwise.
    if let onKeyPress {
      onKeyPress(string.isEmpty ? "Backspace" : string)
    }
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
    case .mask:
      // The mask owns the whole edit: it decides what the text and caret become.
      let result = maskEngine.applyEdit(std.string(current), Int32(start), Int32(end), std.string(string),
                                        format.maskAutocomplete, format.maskAutoSkip)
      newText = String(result.formattedText)
      caret = Int(result.caret)
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
      let result = margelo.nitro.nitroinput.nitroinputworklets.runTransform(
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
    if traits.clearTextOnFocus {
      setText("", reason: .user)
    } else if traits.selectTextOnFocus {
      // In the next runloop turn: UIKit sets its own selection as it begins.
      DispatchQueue.main.async { [weak self] in
        guard let self, self.field.isFirstResponder else { return }
        self.field.selectAll(nil)
      }
    }
    if contentOverflows { render() }
    updateCaret(restartBlink: true)
    onFocusChange?(true)
    if wantsFrameDrawing { layoutFrame(animated: true) }
  }

  func textFieldDidEndEditing(_ textField: UITextField) {
    if contentOverflows { render() }
    updateCaret()
    onFocusChange?(false)
    onEndEditing?(text)
    if wantsFrameDrawing { layoutFrame(animated: true) }
  }

  func textFieldDidChangeSelection(_ textField: UITextField) {
    guard !isSettingText else { return }
    // A caret move alone does not re-render; when the content is wider than
    // the view the scroll offset has to follow it.
    if contentOverflows { render() }
    updateCaret(restartBlink: true)
    reportSelection()
  }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    onKeyPress?("Enter")
    onSubmit?(text)
    // `submitBehavior: 'submit'` keeps focus so a form can move on itself.
    if traits.blurOnSubmit {
      textField.resignFirstResponder()
    }
    return false
  }

  /// Reports the caret/selection in code points, and only when it moved.
  private func reportSelection() {
    guard let onSelectionChange, field.selectedTextRange != nil else { return }
    let (start, end) = selectionCodePoints()
    guard lastReportedSelection == nil || lastReportedSelection! != (start, end) else { return }
    lastReportedSelection = (start, end)
    onSelectionChange(start, end)
  }
}

// MARK: - Outlined / filled frame

extension NitroInputView {

  /// Material's ratio: the floated label is three quarters of the body size.
  private static let floatedLabelRatio: CGFloat = 0.75
  /// Breathing room either side of the label inside the notch.
  private static let labelGapPadding: CGFloat = 4
  /// Inset of the label (and the text below it) from the leading edge.
  /// Material uses 16; a large corner radius needs more, or the notch opens
  /// flush against the corner arc and the run of line before it disappears.
  private var labelInset: CGFloat { max(16, inputFrame.cornerRadius + 8) }
  // Timings taken from Material's own text fields. The label runs the whole
  // duration on the standard decelerate curve; the notch is staggered behind
  // it, because the label has to travel most of the way to the top edge before
  // there is anything for a hole to be under. Closing is quicker than opening -
  // the gap should be gone before the label lands back inside the box.
  //
  // MUI's OutlinedInput: label 200ms cubic-bezier(0,0,0.2,1); legend max-width
  // 100ms after a 50ms delay when notching, 50ms flat when un-notching.
  // Material Components Android runs both off one animator instead (167ms, or
  // 400ms `motionDurationMedium4` under an M3 theme) and snaps the stroke.
  private static let frameAnimationDuration: CFTimeInterval = 0.2
  private static let notchOpenDelay: CFTimeInterval = 0.05
  private static let notchOpenDuration: CFTimeInterval = 0.1
  private static var notchOpenTotal: CFTimeInterval { notchOpenDelay + notchOpenDuration }
  private static let notchCloseDuration: CFTimeInterval = 0.05
  /// Material's standard decelerate. UIKit's named `.easeOut` is much weaker
  /// (0, 0, 0.58, 1), which is what made the move read as abrupt.
  private static func decelerate() -> CAMediaTimingFunction {
    CAMediaTimingFunction(controlPoints: 0, 0, 0.2, 1)
  }

  var wantsFrameDrawing: Bool { inputFrame.draws }

  /// A label resting inside the field already labels it, so the placeholder
  /// waits until the label has floated clear rather than printing over it.
  var effectivePlaceholder: String {
    guard inputFrame.hasLabel, !labelShouldFloat else { return format.placeholder }
    return ""
  }

  /// The label floats once the field is focused or holds text - or always, if
  /// the caller asked for that.
  private var labelShouldFloat: Bool {
    guard inputFrame.hasLabel else { return false }
    if inputFrame.labelBehavior == .always { return true }
    return field.isFirstResponder || !text.isEmpty
  }

  private var restingLabelFont: UIFont { fonts.font(for: .body) }

  private var floatedLabelSize: CGFloat {
    let explicit = inputFrame.labelFontSize
    if explicit > 0 { return explicit }
    return max(9, restingLabelFont.pointSize * Self.floatedLabelRatio)
  }

  private var resolvedOutlineColor: UIColor {
    let base = inputFrame.strokeColor ?? UIColor.separator
    guard field.isFirstResponder else { return base }
    return inputFrame.focusedStrokeColor ?? base
  }

  private var resolvedLabelColor: UIColor {
    if field.isFirstResponder {
      return inputFrame.labelFocusedColor ?? inputFrame.focusedStrokeColor ?? typography.placeholderColor
    }
    return inputFrame.labelColor ?? typography.placeholderColor
  }

  /// Applies everything that does not depend on the bounds, then lays out.
  func applyFrame() {
    guard inputFrame.draws else {
      if didBuildFrameLayers {
        frameLayer.isHidden = true
        labelLayer.isHidden = true
        underlineLayer.isHidden = true
      }
      syncAccessibilityFromHost()
      updateFieldInsets()
      return
    }
    didBuildFrameLayers = true
    frameLayer.isHidden = false
    labelLayer.isHidden = !inputFrame.hasLabel
    labelLayer.string = inputFrame.label
    // The label is also the field's accessible name when nothing else gives it
    // one, so a change to it has to reach VoiceOver.
    syncAccessibilityFromHost()
    updateFieldInsets()
    layoutFrame(animated: false)
  }

  /// The top inset the label needs when it is floated onto the outline: half of
  /// it sits above the line, so the text below has to start lower.
  var frameTopInset: CGFloat {
    // Only the filled variant needs the room. Its floated label lives inside
    // the box, on its own line above the text. An outlined field's floated
    // label sits *on* the stroke, outside the content box entirely - it
    // intrudes into the top of the frame but never onto the text's line - so
    // the text stays centred, which is what Material's outlined field does and
    // what a field with no label at all does. Reserving space for it here left
    // the text sitting half an inset low.
    guard inputFrame.hasLabel, inputFrame.variant == .filled else { return 0 }
    // 1.4 is a fudge, not a Material metric: enough of a gap under the
    // floated label that the two lines do not crowd at the default sizes.
    // Material's filled field is specified at a fixed 56dp with its own
    // baselines; if this field is ever given fixed metrics, derive it there.
    return floatedLabelSize * 1.4
  }

  /// Horizontal room for the frame, so the text lines up under the label
  /// instead of running into the stroke.
  var frameSideInset: CGFloat {
    inputFrame.draws ? labelInset : 0
  }

  func layoutFrame(animated: Bool) {
    guard inputFrame.draws, bounds.width > 0, bounds.height > 0 else { return }

    let target: CGFloat = labelShouldFloat ? 1 : 0
    var snapshot = FrameSnapshot()
    snapshot.bounds = bounds
    snapshot.progress = target
    snapshot.stroke = strokeWidthNow
    snapshot.focused = field.isFirstResponder
    snapshot.label = inputFrame.label
    snapshot.fontSize = restingLabelFont.pointSize
    snapshot.frame = inputFrame
    guard snapshot != lastFrameSnapshot else { return }

    let changed = target != labelProgress
    // Focusing a field that already holds text does not move the label, but the
    // stroke still has to travel to its focused colour and weight rather than
    // snapping to it.
    let focusChanged = lastFrameSnapshot.focused != snapshot.focused
    labelProgress = target
    lastFrameSnapshot = snapshot
    defer { didLayOutFrame = true }
    if changed {
      // The placeholder is hidden behind a resting label and revealed once it
      // floats, so it has to follow the same transition.
      syncAccessibilityPlaceholder()
      if !traits.plain { feedEngine(caret: -1) }
    }

    let floatedSize = floatedLabelSize
    let labelText = inputFrame.label as NSString
    let restingFont = restingLabelFont
    let floatedFont = restingFont.withSize(floatedSize)
    let restingWidth = labelText.size(withAttributes: [.font: restingFont]).width
    let floatedWidth = labelText.size(withAttributes: [.font: floatedFont]).width

    // Resting: on the text's own baseline. Floated: centred on the top edge
    // (outlined) or tucked under it (filled).
    let restingCentreY = bounds.midY
    let floatedCentreY = inputFrame.variant == .outlined ? 0 : floatedSize * 0.9
    let resting = Outline.Rect(x: Double(labelInset), y: Double(restingCentreY),
                               width: Double(restingWidth), height: Double(restingFont.lineHeight))
    let floated = Outline.Rect(x: Double(labelInset), y: Double(floatedCentreY),
                               width: Double(floatedWidth), height: Double(floatedFont.lineHeight))

    let filled = inputFrame.variant == .filled
    var box = Outline.Box()
    box.width = Double(bounds.width)
    box.height = Double(bounds.height)
    box.radius = Double(inputFrame.cornerRadius)
    // Filled is not stroked, so the path is the fill's own edge rather than the
    // centre line of a stroke, and its bottom is square: that is the edge the
    // indicator rule below sits flush against. Rounding it would leave the rule
    // overhanging the curve at both ends.
    box.strokeWidth = filled ? 0 : Double(strokeWidthNow)
    box.bottomRadius = filled ? 0 : -1

    // The notch follows the floated label whatever the progress, so the two
    // paths we animate between describe the same shape.
    let gap = inputFrame.hasLabel && !filled
      ? Outline.gapFor(floated, Double(Self.labelGapPadding))
      : Outline.Gap()
    let path = Self.cgPath(from: Outline.outline(box, gap, Double(target)))

    let placement = Outline.lerp(resting, floated, Double(target))
    let scale = floatedWidth > 0 && restingWidth > 0
      ? (target == 1 ? floatedSize / restingFont.pointSize : 1)
      : 1

    let animating = animated && (changed || focusChanged)
    CATransaction.begin()
    if animating {
      CATransaction.setAnimationDuration(Self.frameAnimationDuration)
      CATransaction.setAnimationTimingFunction(Self.decelerate())
    } else {
      CATransaction.setDisableActions(true)
    }
    frameLayer.frame = bounds
    // `path` is the one animatable CAShapeLayer property with no implicit
    // animation (UIKit documents the exception), so setting it inside an
    // animated transaction still snaps. The notch jumping open a frame before
    // the label reaches it was exactly that. Driving it explicitly hands the
    // interpolation to Core Animation - the render server tweens it off the
    // main thread, with no display link and nothing in JS - and the stroke
    // travels with it. The two paths always have the same verbs, which is what
    // makes them interpolable at all; see `OutlineGeometry.hpp`.
    animateShape(
      path: path,
      lineWidth: strokeWidthNow,
      strokeColor: filled ? nil : resolvedOutlineColor.cgColor,
      fillColor: filled ? (inputFrame.fillColor ?? UIColor.secondarySystemFill).cgColor : nil,
      animated: animating,
      opening: target == 1,
    )

    if filled {
      underlineLayer.isHidden = false
      let thickness = strokeWidthNow
      underlineLayer.frame = CGRect(x: 0, y: bounds.height - thickness, width: bounds.width, height: thickness)
      underlineLayer.backgroundColor = resolvedOutlineColor.cgColor
    } else if didBuildFrameLayers {
      underlineLayer.isHidden = true
    }

    labelLayer.fontSize = restingFont.pointSize
    labelLayer.font = CGFont(restingFont.fontName as CFString)
    labelLayer.foregroundColor = resolvedLabelColor.cgColor
    labelLayer.bounds = CGRect(x: 0, y: 0, width: restingWidth + 1, height: restingFont.lineHeight)
    labelLayer.position = CGPoint(x: CGFloat(placement.x), y: CGFloat(placement.y))
    labelLayer.transform = CATransform3DMakeScale(scale, scale, 1)
    CATransaction.commit()
  }

  /// A focused outlined field draws a heavier line, as Material does.
  private var strokeWidthNow: CGFloat {
    guard inputFrame.draws else { return inputFrame.strokeWidth }
    return field.isFirstResponder ? inputFrame.strokeWidth * 2 : inputFrame.strokeWidth
  }

  /// Replays the shared geometry into a CGPath. The arcs are the same centre /
  /// radius / angles Android's `Path.arcTo` takes, so both platforms trace it
  /// identically.
  /// Moves the frame layer to a new shape, explicitly rather than relying on
  /// implicit actions. The stroke keeps pace with the path so the outline never
  /// changes colour or weight ahead of its own geometry.
  private func animateShape(path: CGPath, lineWidth: CGFloat, strokeColor: CGColor?, fillColor: CGColor?,
                            animated: Bool, opening: Bool) {
    // Read the presentation layer first: an interrupted run continues from
    // wherever it had got to rather than snapping back to its target.
    let live = frameLayer.presentation()
    let fromPath = live?.path ?? frameLayer.path
    let fromWidth = live?.lineWidth ?? frameLayer.lineWidth
    let fromStroke = live?.strokeColor ?? frameLayer.strokeColor
    let fromFill = live?.fillColor ?? frameLayer.fillColor

    frameLayer.removeAnimation(forKey: Self.shapeAnimationKey)
    frameLayer.path = path
    frameLayer.lineWidth = lineWidth
    frameLayer.strokeColor = strokeColor
    frameLayer.fillColor = fillColor
    guard animated, let fromPath else { return }

    func basic(_ keyPath: String, _ from: Any?, _ to: Any?) -> CABasicAnimation? {
      guard from != nil || to != nil else { return nil }
      let animation = CABasicAnimation(keyPath: keyPath)
      animation.fromValue = from
      animation.toValue = to
      // Set on every child rather than only on the group: a group's timing
      // function governs the group's own clock, not its children's, so the
      // children would otherwise run linear.
      animation.timingFunction = Self.decelerate()
      return animation
    }

    // The notch's delay is a keyframe hold, not a `beginTime`. A delayed
    // animation is a thing that has not started yet, and any of the layout
    // passes that follow a focus change will pre-empt it before it does - the
    // gap then jumped open in a single frame. A keyframe is running from the
    // first frame; it just has not moved yet.
    let notch = CAKeyframeAnimation(keyPath: "path")
    notch.calculationMode = .linear
    if opening {
      notch.values = [fromPath, fromPath, path]
      notch.keyTimes = [0, NSNumber(value: Self.notchOpenDelay / Self.notchOpenTotal), 1]
      notch.duration = Self.notchOpenTotal
      notch.timingFunctions = [CAMediaTimingFunction(name: .linear), Self.decelerate()]
    } else {
      notch.values = [fromPath, path]
      notch.keyTimes = [0, 1]
      notch.duration = Self.notchCloseDuration
      notch.timingFunctions = [Self.decelerate()]
    }

    // The stroke travels with the label, over the full duration.
    let group = CAAnimationGroup()
    group.duration = Self.frameAnimationDuration
    group.animations = [
      notch,
      basic("lineWidth", fromWidth, lineWidth),
      basic("strokeColor", fromStroke, strokeColor),
      basic("fillColor", fromFill, fillColor),
    ].compactMap { $0 }
    frameLayer.add(group, forKey: Self.shapeAnimationKey)
  }

  private static let shapeAnimationKey = "nitroFrameShape"

  private static func cgPath<S: Sequence>(from segments: S) -> CGPath where S.Element == Outline.Segment {
    let path = CGMutablePath()
    for segment in segments {
      let point = CGPoint(x: CGFloat(segment.point.x), y: CGFloat(segment.point.y))
      switch segment.verb {
      case .Move:
        path.move(to: point)
      case .Line:
        path.addLine(to: point)
      case .Arc:
        // `addRelativeArc` takes a signed sweep, so there is no `clockwise`
        // flag to get the wrong way round under the y-down flip - which drew
        // 270-degree arcs. It is also the exact shape of Android's
        // `Path.arcTo(oval, start, sweep)`, so both platforms trace the same
        // geometry from the same numbers.
        path.addRelativeArc(center: point,
                            radius: CGFloat(segment.radius),
                            startAngle: CGFloat(segment.startAngle) * .pi / 180,
                            delta: CGFloat(segment.sweepAngle) * .pi / 180)
      @unknown default:
        break
      }
    }
    return path
  }
}
