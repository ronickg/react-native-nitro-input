///
/// InputSizing.swift
/// What a single-line field's size follows, worked out the same way before its
/// view exists (`HybridNitroInputMeasure`, on the JS thread) and after
/// (`NitroInputView.reportIntrinsicSize`, on the main thread).
///
/// Mirrors `InputSizing.kt` on Android.
///

import Foundation
import NitroModules
import UIKit

private typealias AmountFormatter = margelo.nitro.nitroinput.AmountFormatter
private typealias MaskEngine = margelo.nitro.nitroinput.MaskEngine

// MARK: - Props

/// The props a field's size follows, under the names both
/// `HybridNitroInputView` and `NitroInputSizing` give them, so one mapping
/// serves the view and the measure that runs before it exists.
protocol InputSizingProps {
  var mode: NitroInputMode { get }
  var mask: String { get }
  var maskNotations: [NitroInputNotation] { get }
  var maskAutocomplete: Bool { get }
  var maskAutoSkip: Bool { get }
  var maskAffinityFormats: [String] { get }
  var maskAffinityStrategy: NitroInputMaskAffinity { get }
  var maskTextCase: NitroInputTextCase { get }
  var maskCharacterMap: [NitroInputCharacterMapping] { get }
  var maskSlotPlaceholder: String { get }
  var keepPlaceholder: Bool { get }
  var fractionDigits: Double { get }
  var maxIntegerDigits: Double { get }
  var groupingSeparator: String { get }
  var decimalSeparator: String { get }
  var prefix: String { get }
  var suffix: String { get }
  var signPlacement: NitroInputSignPlacement { get }
  var placeholder: String { get }
  var maxLength: Double { get }
  var textSize: Double { get }
  var textLineHeight: Double { get }
  var prefixFontSize: Double { get }
  var suffixFontSize: Double { get }
  var textWeight: Double { get }
  var textFamily: String { get }
  var textLetterSpacing: Double { get }
  var prefixSpacing: Double { get }
  var suffixSpacing: Double { get }
  var allowFontScaling: Bool { get }
  var maxFontSizeMultiplier: Double { get }
  var variant: NitroInputVariant { get }
  var label: String { get }
  var labelBehavior: NitroInputLabelBehavior { get }
  var labelFontSize: Double { get }
  var cornerRadius: Double { get }
}

extension HybridNitroInputView: InputSizingProps {}
extension NitroInputSizing: InputSizingProps {}

enum InputMapping {
  static func clampInt(_ value: Double, _ lower: Int, _ upper: Int, fallback: Int) -> Int {
    guard value.isFinite else { return fallback }
    return min(upper, max(lower, Int(value.rounded())))
  }

  static func format(_ p: some InputSizingProps) -> NitroInputView.Format {
    var format = NitroInputView.Format()
    switch p.mode {
    case .number: format.mode = .number
    case .mask: format.mode = .mask
    case .text: format.mode = .text
    }
    format.mask = p.mask
    format.maskNotations = p.maskNotations.map {
      NitroInputView.MaskNotation(character: $0.character, characterSet: $0.characterSet, isOptional: $0.isOptional)
    }
    format.maskAutocomplete = p.maskAutocomplete
    format.maskAutoSkip = p.maskAutoSkip
    format.maskAffinityFormats = p.maskAffinityFormats
    format.maskAffinityStrategy = Int(p.maskAffinityStrategy.rawValue)
    format.maskTextCase = Int(p.maskTextCase.rawValue)
    format.maskCharacterMap = p.maskCharacterMap.map { NitroInputView.MaskMapping(from: $0.from, to: $0.to) }
    format.maskSlotPlaceholder = p.maskSlotPlaceholder
    format.keepPlaceholder = p.keepPlaceholder
    format.fractionDigits = clampInt(p.fractionDigits, 0, 9, fallback: 2)
    format.maxIntegerDigits = clampInt(p.maxIntegerDigits, 1, 30, fallback: 15)
    format.groupingSeparator = p.groupingSeparator
    format.decimalSeparator = p.decimalSeparator.isEmpty ? "." : p.decimalSeparator
    format.prefix = p.prefix
    format.suffix = p.suffix
    format.signPlacement = p.signPlacement == .afteraffix ? .afterAffix : .beforeAffix
    format.placeholder = p.placeholder
    format.maxLength = clampInt(p.maxLength, 0, 1_000_000, fallback: 0)
    return format
  }

  /// The typography's sizing half; the view adds the colours, alignment and offsets.
  static func sizingTypography(_ p: some InputSizingProps) -> NitroInputView.Typography {
    var typography = NitroInputView.Typography()
    typography.fontSize = CGFloat(p.textSize.isFinite && p.textSize > 0 ? p.textSize : 32)
    typography.lineHeight = CGFloat(p.textLineHeight.isFinite && p.textLineHeight > 0 ? p.textLineHeight : 0)
    typography.prefixFontSize = p.prefixFontSize.isFinite && p.prefixFontSize > 0 ? CGFloat(p.prefixFontSize) : nil
    typography.suffixFontSize = p.suffixFontSize.isFinite && p.suffixFontSize > 0 ? CGFloat(p.suffixFontSize) : nil
    typography.fontWeight = CGFloat(p.textWeight.isFinite ? p.textWeight : 400)
    typography.fontFamily = p.textFamily.isEmpty ? nil : p.textFamily
    typography.letterSpacing = CGFloat(p.textLetterSpacing.isFinite ? p.textLetterSpacing : 0)
    typography.prefixSpacing = p.prefixSpacing.isFinite ? CGFloat(p.prefixSpacing) : nil
    typography.suffixSpacing = p.suffixSpacing.isFinite ? CGFloat(p.suffixSpacing) : nil
    typography.allowFontScaling = p.allowFontScaling
    typography.maxFontSizeMultiplier = CGFloat(max(0, p.maxFontSizeMultiplier.isFinite ? p.maxFontSizeMultiplier : 0))
    return typography
  }
}

extension InputMapping {
  /// The frame's sizing half; the view adds the colours and the stroke width.
  static func sizingFrame(_ p: some InputSizingProps) -> NitroInputView.Frame {
    var frame = NitroInputView.Frame()
    switch p.variant {
    case .outlined: frame.variant = .outlined
    case .filled: frame.variant = .filled
    case .none: frame.variant = .none
    }
    frame.label = p.label
    frame.labelBehavior = p.labelBehavior == .always ? .always : .float
    frame.labelFontSize = p.labelFontSize.isFinite ? max(0, CGFloat(p.labelFontSize)) : 0
    frame.cornerRadius = p.cornerRadius.isFinite ? max(0, CGFloat(p.cornerRadius)) : 8
    return frame
  }
}

// MARK: - Frame

/// The room an outlined or filled frame keeps around its text and for its
/// label. The view lays itself out with these; `InputSizing` adds them to the
/// size it reports. Mirrors `InputFrame` in InputSizing.kt.
enum InputFrameMetrics {
  /// The room a framed field keeps above and below its text. Flat, because
  /// nothing about the vertical middle of the box depends on its corners.
  static let framePadding: CGFloat = 16
  /// Material's ratio: the floated label is three quarters of the body size.
  static let floatedLabelRatio: CGFloat = 0.75
  /// A filled field's floated label line, as a multiple of its size. A fudge,
  /// not a Material metric: enough of a gap under the floated label that the
  /// two lines do not crowd at the default sizes.
  static let filledLabelLine: CGFloat = 1.4

  /// How far in the label - and so the text under it - starts: far enough past
  /// the corner that the notch never opens onto the arc itself.
  static func labelInset(_ frame: NitroInputView.Frame) -> CGFloat { max(16, frame.cornerRadius + 8) }

  static func sideInset(_ frame: NitroInputView.Frame) -> CGFloat { frame.draws ? labelInset(frame) : 0 }

  static func floatedLabelSize(_ frame: NitroInputView.Frame, restingSize: CGFloat) -> CGFloat {
    frame.labelFontSize > 0 ? frame.labelFontSize : max(9, restingSize * floatedLabelRatio)
  }

  /// Room at the top for the floated label - which only the filled variant
  /// needs. Its floated label lives inside the box, on its own line above the
  /// text. An outlined field's sits *on* the stroke, outside the content box.
  static func topInset(_ frame: NitroInputView.Frame, restingSize: CGFloat) -> CGFloat {
    guard frame.hasLabel, frame.variant == .filled else { return 0 }
    return floatedLabelSize(frame, restingSize: restingSize) * filledLabelLine
  }

  /// The label at rest, in the body font: the widest it gets.
  static func restingLabelWidth(_ frame: NitroInputView.Frame, metrics: InputMetrics) -> CGFloat {
    guard frame.hasLabel else { return 0 }
    return (frame.label as NSString).size(withAttributes: [.font: metrics.body]).width
  }

  /// A framed field's width: its content, or its label if wider, between the side insets.
  static func width(content: CGFloat, frame: NitroInputView.Frame, metrics: InputMetrics) -> CGFloat {
    guard frame.draws else { return content }
    return 2 * sideInset(frame) + max(content, restingLabelWidth(frame, metrics: metrics))
  }

  /// A framed single line's height: the line with the frame's padding above
  /// and below it, and a filled field's label line. The line is centred in it,
  /// as it is in any height the caller gives. (A wrapping field adds its own.)
  static func singleLineHeight(_ line: CGFloat, frame: NitroInputView.Frame, metrics: InputMetrics) -> CGFloat {
    guard frame.draws else { return line }
    return line + topInset(frame, restingSize: metrics.body.pointSize) + 2 * framePadding
  }
}

// MARK: - Metrics

/// A field's body / prefix / suffix fonts, the letter spacing and seams between
/// them, and the advance widths of what they draw. `NitroInputView.FontSet`
/// draws with one; `HybridNitroInputMeasure` measures with its own.
///
/// Not thread-safe (its width cache): one instance per thread. Fonts and
/// attributed-string measuring are safe off the main thread.
final class InputMetrics {
  let body: UIFont
  let prefix: UIFont
  let suffix: UIFont
  /// Letter spacing after a body / prefix / suffix glyph, the spacing at the affix seams (nil: the letter spacing) and the affix offsets, scaled with the fonts.
  let bodySpacing: CGFloat
  let prefixLetterSpacing: CGFloat
  let suffixLetterSpacing: CGFloat
  let prefixSeam: CGFloat?
  let suffixSeam: CGFloat?
  let prefixOffset: CGFloat
  let suffixOffset: CGFloat
  /// Height of the line box (the body font's line height).
  let lineHeight: CGFloat
  /// The height a single line asks for: `lineHeight` when the typography sets
  /// one, else the font's own, as on Android (and as `TextInput` sizes itself).
  let lineBoxHeight: CGFloat
  /// The advance of one of the bullets a plain secure field draws (see `init`).
  let secureBulletWidth: CGFloat
  private var widthCache: [WidthKey: CGFloat] = [:]

  private struct WidthKey: Hashable {
    let text: String
    let role: NitroInputView.GlyphRole
  }

  init(_ t: NitroInputView.Typography) {
    let scale = NitroInputView.systemFontMultiplier(t)
    body = NitroInputView.makeFont(size: t.fontSize * scale, weight: t.fontWeight, family: t.fontFamily)
    prefix = NitroInputView.makeFont(size: (t.prefixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily)
    suffix = NitroInputView.makeFont(size: (t.suffixFontSize ?? t.fontSize) * scale, weight: t.fontWeight, family: t.fontFamily)
    bodySpacing = t.letterSpacing * scale
    prefixLetterSpacing = t.letterSpacing * scale * (prefix.pointSize / body.pointSize)
    suffixLetterSpacing = t.letterSpacing * scale * (suffix.pointSize / body.pointSize)
    prefixSeam = t.prefixSpacing.map { $0 * scale }
    suffixSeam = t.suffixSpacing.map { $0 * scale }
    prefixOffset = t.prefixOffset * scale
    suffixOffset = t.suffixOffset * scale
    lineHeight = ceil(body.lineHeight)
    lineBoxHeight = t.lineHeight > 0 ? t.lineHeight : lineHeight
    // A plain secure field is drawn by UITextField, which shows every
    // character as U+2219 in the *system* font at the field's size - in the
    // field's weight when that is the system font, regular otherwise - not as
    // the field's own font would draw a bullet. Measured with the caret on the
    // simulator: 8 bullets at 18 pt advance 87 pt whatever the field's font.
    let bulletFont = t.fontFamily == nil
      ? UIFont.systemFont(ofSize: body.pointSize, weight: NitroInputView.uiWeight(t.fontWeight))
      : UIFont.systemFont(ofSize: body.pointSize)
    secureBulletWidth = ("\u{2219}" as NSString).size(withAttributes: [.font: bulletFont]).width
  }

  func font(for role: NitroInputView.GlyphRole) -> UIFont {
    switch role {
    case .body: return body
    case .prefix: return prefix
    case .suffix: return suffix
    }
  }

  /// Letter spacing after a glyph of `role`.
  func spacing(for role: NitroInputView.GlyphRole) -> CGFloat {
    switch role {
    case .body: return bodySpacing
    case .prefix: return prefixLetterSpacing
    case .suffix: return suffixLetterSpacing
    }
  }

  /// Advance width of `text` in the role's font, in points.
  func width(of text: String, role: NitroInputView.GlyphRole) -> CGFloat {
    let key = WidthKey(text: text, role: role)
    if let cached = widthCache[key] { return cached }
    let width = NSAttributedString(string: text, attributes: [.font: font(for: role), .kern: 0]).size().width
    widthCache[key] = width
    return width
  }

  /// The room an affix takes beside the text: its glyphs, their spacing and the seam.
  func affixRoom(_ affix: String, role: NitroInputView.GlyphRole) -> CGFloat {
    guard !affix.isEmpty else { return 0 }
    let glyphs = affix.unicodeScalars.reduce(CGFloat(0)) { $0 + width(of: String($1), role: role) }
    let count = CGFloat(affix.unicodeScalars.count)
    if role == .prefix { return glyphs + prefixLetterSpacing * (count - 1) + (prefixSeam ?? prefixLetterSpacing) }
    // The field's own kerning already spaces its last glyph by the body spacing.
    return glyphs + suffixLetterSpacing * count + ((suffixSeam ?? bodySpacing) - bodySpacing)
  }
}

// MARK: - Text

/// What a field shows for its format: the text conformed to it, the placeholder
/// and `keepPlaceholder`'s tail. Pure functions of the format and the shared C++
/// engines, which the view holds for its life and a measure configures afresh.
enum InputText {
  /// Points the formatter and the mask engine at `format`. `previous` skips
  /// what did not change; nil configures everything.
  fileprivate static func configure(formatter: inout AmountFormatter, maskEngine: inout MaskEngine,
                                    previous: NitroInputView.Format?, format: NitroInputView.Format) -> Bool {
    if format.mode == .number {
      formatter.setFormat(Int32(max(0, format.fractionDigits)), Int32(max(1, format.maxIntegerDigits)),
                          std.string(format.groupingSeparator), std.string(format.decimalSeparator))
    }
    let maskChanged = previous.map {
      format.mask != $0.mask || format.maskNotations != $0.maskNotations
        || format.maskAffinityFormats != $0.maskAffinityFormats
        || format.maskAffinityStrategy != $0.maskAffinityStrategy
        || format.maskTextCase != $0.maskTextCase || format.maskCharacterMap != $0.maskCharacterMap
        || format.maskSlotPlaceholder != $0.maskSlotPlaceholder
    } ?? true
    if format.mode == .mask, maskChanged || previous?.mode != .mask {
      maskEngine.clearNotations()
      for notation in format.maskNotations {
        maskEngine.addNotation(std.string(notation.character), std.string(notation.characterSet),
                               notation.isOptional)
      }
      maskEngine.clearAffinityFormats()
      for alternative in format.maskAffinityFormats {
        maskEngine.addAffinityFormat(std.string(alternative))
      }
      maskEngine.setAffinityStrategy(Int32(format.maskAffinityStrategy))
      maskEngine.setTextCase(Int32(format.maskTextCase))
      maskEngine.clearCharacterMap()
      for mapping in format.maskCharacterMap {
        maskEngine.addCharacterMapping(std.string(mapping.from), std.string(mapping.to))
      }
      maskEngine.setSlotPlaceholder(std.string(format.maskSlotPlaceholder))
      // A bad pattern leaves the engine inactive; the field then behaves as
      // plain text rather than refusing every keystroke.
      _ = maskEngine.setFormat(std.string(format.mask))
    }
    return maskChanged
  }

  /// `raw` as the format holds it: formatted, masked, or cut to `maxLength` code points.
  fileprivate static func normalized(_ raw: String, format: NitroInputView.Format,
                                     formatter: inout AmountFormatter, maskEngine: inout MaskEngine) -> String {
    switch format.mode {
    case .number:
      return String(formatter.normalize(std.string(raw)).text)
    case .mask:
      let count = Int32(raw.unicodeScalars.count)
      let result = maskEngine.apply(std.string(raw), count, true, format.maskAutocomplete, false)
      return String(result.formattedText)
    case .text:
      return truncated(raw, to: format.maxLength)
    }
  }

  static func truncated(_ text: String, to maxLength: Int) -> String {
    guard maxLength > 0, text.unicodeScalars.count > maxLength else { return text }
    var view = String.UnicodeScalarView()
    view.append(contentsOf: text.unicodeScalars.prefix(maxLength))
    return String(view)
  }

  /// `keepPlaceholder` without a `placeholder` shows the mask itself, empty
  /// slots as `maskSlotPlaceholder`: "+1 (___) ___-____".
  fileprivate static func basePlaceholder(format: NitroInputView.Format, maskEngine: inout MaskEngine) -> String {
    if format.placeholder.isEmpty, format.mode == .mask, format.keepPlaceholder, maskEngine.isActive() {
      return String(maskEngine.apply(std.string(""), 0, true, false, false).tailPlaceholder)
    }
    return format.placeholder
  }

  /// `keepPlaceholder`: what is still to come after the typed text, drawn in
  /// the placeholder colour. The caller's placeholder from where the text ends
  /// - "1234 5" leaves "678 9012" of "1234 5678 9012" - or, without one, the
  /// rest of the mask. The placeholder is written for `mask`, so when one of
  /// `maskAffinityFormats` has taken over (a 4-6-5 Amex under a 4-4-4-4
  /// placeholder) its characters no longer line up, and that format's own
  /// tail is shown instead. A complete text has nothing to come.
  fileprivate static func ghostTail(_ text: String, format: NitroInputView.Format, maskEngine: inout MaskEngine,
                                    secure: Bool) -> String {
    guard format.mode == .mask, format.keepPlaceholder, !text.isEmpty, !secure,
          maskEngine.isActive() else { return "" }
    let typed = text.unicodeScalars.count
    let result = maskEngine.apply(std.string(text), Int32(typed), true, false, false)
    if result.complete { return "" }
    let placeholder = Array(format.placeholder.unicodeScalars)
    if placeholder.isEmpty || result.formatIndex != 0 { return String(result.tailPlaceholder) }
    guard typed < placeholder.count else { return "" }
    var rest = String.UnicodeScalarView()
    rest.append(contentsOf: placeholder[typed...])
    return String(rest)
  }

  /// `secureTextEntry` draws a bullet for every code point.
  static func bullets(_ text: String) -> String {
    String(repeating: "\u{2022}", count: text.unicodeScalars.count)
  }

  /// A leading minus, in either the keyboard's spelling or the typographic one.
  static func isSign(_ scalar: Unicode.Scalar) -> Bool {
    scalar == "-" || scalar.value == 0x2212
  }
}

extension NitroInputView {
  /// The view's engines, configured through `InputText` as a measure's are.
  func configureEngines(previous: Format?) -> Bool {
    InputText.configure(formatter: &formatter, maskEngine: &maskEngine, previous: previous, format: format)
  }

  func normalizedText(_ raw: String) -> String {
    InputText.normalized(raw, format: format, formatter: &formatter, maskEngine: &maskEngine)
  }

  var sharedBasePlaceholder: String {
    InputText.basePlaceholder(format: format, maskEngine: &maskEngine)
  }

  func sharedGhostTail(secure: Bool) -> String {
    InputText.ghostTail(text, format: format, maskEngine: &maskEngine, secure: secure)
  }
}

// MARK: - Glyphs

/// The glyphs a reflowing field lays out, in order, with the advance each
/// takes: the prefix, the text (or the placeholder), `keepPlaceholder`'s tail
/// and the suffix. The view hands them to the engine; `InputSizing` adds them
/// up, which is the engine's width at rest.
enum InputGlyphs {
  /// `shown` is the text or, when `showPlaceholder`, the placeholder; `tail` is
  /// ignored then. Advances carry the letter spacing; the last prefix glyph and
  /// the last body glyph before a suffix carry the seams instead.
  static func walk(_ m: InputMetrics, format: NitroInputView.Format, shown: String, showPlaceholder: Bool, tail: String,
                   _ sink: (_ scalar: Unicode.Scalar, _ role: NitroInputView.GlyphRole, _ placeholder: Bool, _ advance: CGFloat) -> Void) {
    // A negative amount reads "-$1,234.56", not "$-1,234.56": the sign belongs
    // to the amount, not to the digits after the symbol. It stays a *body*
    // glyph - it is part of the text, and the caret counts body glyphs in the
    // order they are added - and is only laid out ahead of the prefix.
    var rest = Array(shown.unicodeScalars)
    let sign: Unicode.Scalar? =
      format.signPlacement == .beforeAffix && !showPlaceholder && !format.prefix.isEmpty
        && rest.first.map(InputText.isSign) == true
        ? rest.removeFirst()
        : nil
    if let sign {
      sink(sign, .body, false, m.width(of: String(sign), role: .body) + m.bodySpacing)
    }
    let prefixScalars = Array(format.prefix.unicodeScalars)
    for (i, scalar) in prefixScalars.enumerated() {
      let after = i == prefixScalars.count - 1 ? (m.prefixSeam ?? m.prefixLetterSpacing) : m.prefixLetterSpacing
      sink(scalar, .prefix, false, m.width(of: String(scalar), role: .prefix) + after)
    }
    let hasSuffix = !format.suffix.isEmpty
    for (i, scalar) in rest.enumerated() {
      let after = hasSuffix && i == rest.count - 1 ? (m.suffixSeam ?? m.bodySpacing) : m.bodySpacing
      sink(scalar, .body, showPlaceholder, m.width(of: String(scalar), role: .body) + after)
    }
    // `keepPlaceholder`: the rest of the mask trails the text as placeholder
    // glyphs. They come after every typed glyph, so the caret - which counts
    // body glyphs in order - never lands among them.
    if !showPlaceholder {
      for scalar in tail.unicodeScalars {
        sink(scalar, .body, true, m.width(of: String(scalar), role: .body) + m.bodySpacing)
      }
    }
    for scalar in format.suffix.unicodeScalars {
      sink(scalar, .suffix, false, m.width(of: String(scalar), role: .suffix) + m.suffixLetterSpacing)
    }
  }
}

// MARK: - Size

/// The size a single-line field reports through `onSizeChange`.
enum InputSizing {
  /// A plain field's content width: the text (the placeholder when empty, a
  /// bullet per character when secure, with `keepPlaceholder`'s tail) and the
  /// affixes. The field's own kerning follows every glyph; the affixes take
  /// their room with their seams.
  static func plainWidth(_ m: InputMetrics, format: NitroInputView.Format, text: String, hint: String, tail: String,
                         secure: Bool) -> CGFloat {
    let affixes = m.affixRoom(format.prefix, role: .prefix) + m.affixRoom(format.suffix, role: .suffix)
    if secure, !text.isEmpty {
      let count = CGFloat(text.unicodeScalars.count)
      return affixes + (m.secureBulletWidth + m.bodySpacing) * count
    }
    let body = text.isEmpty ? hint : text + tail
    return affixes + m.width(of: body, role: .body) + m.bodySpacing * CGFloat(body.unicodeScalars.count)
  }

  /// A reflowing field's width at rest: the engine's target, the sum of its glyphs' advances.
  static func reflowWidth(_ m: InputMetrics, format: NitroInputView.Format, text: String, hint: String, tail: String,
                          secure: Bool) -> CGFloat {
    let body = secure ? InputText.bullets(text) : text
    let showPlaceholder = body.isEmpty && !hint.isEmpty
    var width: Double = 0
    // The engine clamps every advance at 0 (a negative letter spacing).
    InputGlyphs.walk(m, format: format, shown: showPlaceholder ? hint : body, showPlaceholder: showPlaceholder,
                     tail: tail) { _, _, _, advance in width += max(0, Double(advance)) }
    return CGFloat(width)
  }

  /// Content width and line height to the reported size.
  static func reported(width: CGFloat, height: CGFloat) -> CGSize {
    CGSize(width: ceil(width + 2), height: height)
  }
}

// MARK: - Measure

/// Measures a single-line field on the JS thread, before its view exists, with
/// `InputMetrics`, `InputText` and `InputGlyphs` - the code the view sizes
/// itself with - so it lays out at its real size in the commit that mounts it.
///
/// Mirrors `HybridNitroInputMeasure` on Android.
final class HybridNitroInputMeasure: HybridNitroInputMeasureSpec {
  // Reused across calls and reconfigured by each; the lock keeps a second
  // runtime out while one measures.
  private var formatter = AmountFormatter()
  private var maskEngine = MaskEngine()
  private let lock = NSLock()

  func measure(sizing: NitroInputSizing) throws -> NitroInputSize {
    lock.lock()
    defer { lock.unlock() }
    let format = InputMapping.format(sizing)
    let metrics = InputMetrics(InputMapping.sizingTypography(sizing))
    _ = InputText.configure(formatter: &formatter, maskEngine: &maskEngine, previous: nil, format: format)
    let text = InputText.normalized(sizing.text, format: format, formatter: &formatter, maskEngine: &maskEngine)
    let frame = InputMapping.sizingFrame(sizing)
    // Unfocused, as a field mounts: a label resting inside it hides the placeholder.
    let labelFloats = frame.labelBehavior == .always || !text.isEmpty
    let hint = frame.hasLabel && !labelFloats ? "" : InputText.basePlaceholder(format: format, maskEngine: &maskEngine)
    let tail = InputText.ghostTail(text, format: format, maskEngine: &maskEngine, secure: sizing.secureTextEntry)
    let width = sizing.plain
      ? InputSizing.plainWidth(metrics, format: format, text: text, hint: hint, tail: tail, secure: sizing.secureTextEntry)
      : InputSizing.reflowWidth(metrics, format: format, text: text, hint: hint, tail: tail, secure: sizing.secureTextEntry)
    let size = InputSizing.reported(width: InputFrameMetrics.width(content: width, frame: frame, metrics: metrics),
                                    height: InputFrameMetrics.singleLineHeight(metrics.lineBoxHeight, frame: frame, metrics: metrics))
    return NitroInputSize(width: Double(size.width), height: Double(size.height))
  }
}
