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
  var fontSize: Double { get }
  var lineHeight: Double { get }
  var prefixFontSize: Double { get }
  var suffixFontSize: Double { get }
  var fontWeight: Double { get }
  var fontFamily: String { get }
  var letterSpacing: Double { get }
  var prefixSpacing: Double { get }
  var suffixSpacing: Double { get }
  var allowFontScaling: Bool { get }
  var maxFontSizeMultiplier: Double { get }
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
    typography.fontSize = CGFloat(p.fontSize.isFinite && p.fontSize > 0 ? p.fontSize : 32)
    typography.lineHeight = CGFloat(p.lineHeight.isFinite && p.lineHeight > 0 ? p.lineHeight : 0)
    typography.prefixFontSize = p.prefixFontSize.isFinite && p.prefixFontSize > 0 ? CGFloat(p.prefixFontSize) : nil
    typography.suffixFontSize = p.suffixFontSize.isFinite && p.suffixFontSize > 0 ? CGFloat(p.suffixFontSize) : nil
    typography.fontWeight = CGFloat(p.fontWeight.isFinite ? p.fontWeight : 400)
    typography.fontFamily = p.fontFamily.isEmpty ? nil : p.fontFamily
    typography.letterSpacing = CGFloat(p.letterSpacing.isFinite ? p.letterSpacing : 0)
    typography.prefixSpacing = p.prefixSpacing.isFinite ? CGFloat(p.prefixSpacing) : nil
    typography.suffixSpacing = p.suffixSpacing.isFinite ? CGFloat(p.suffixSpacing) : nil
    typography.allowFontScaling = p.allowFontScaling
    typography.maxFontSizeMultiplier = CGFloat(max(0, p.maxFontSizeMultiplier.isFinite ? p.maxFontSizeMultiplier : 0))
    return typography
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
  /// What a plain field measures: the placeholder when empty, bullets when secure, else the text and its tail.
  static func plainBody(text: String, hint: String, tail: String, secure: Bool) -> String {
    text.isEmpty ? hint : secure ? InputText.bullets(text) : text + tail
  }

  /// A plain field's content width: the text (or the placeholder) and the
  /// affixes. The field's own kerning follows every glyph; the affixes take
  /// their room with their seams.
  static func plainWidth(_ m: InputMetrics, format: NitroInputView.Format, body: String) -> CGFloat {
    m.affixRoom(format.prefix, role: .prefix)
      + m.width(of: body, role: .body) + m.bodySpacing * CGFloat(body.unicodeScalars.count)
      + m.affixRoom(format.suffix, role: .suffix)
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
    // Unfocused, as a field mounts: a label resting inside it hides the placeholder.
    let hasLabel = sizing.variant != .none && !sizing.label.isEmpty
    let labelFloats = sizing.labelBehavior == .always || !text.isEmpty
    let hint = hasLabel && !labelFloats ? "" : InputText.basePlaceholder(format: format, maskEngine: &maskEngine)
    let tail = InputText.ghostTail(text, format: format, maskEngine: &maskEngine, secure: sizing.secureTextEntry)
    let width = sizing.plain
      ? InputSizing.plainWidth(metrics, format: format,
                               body: InputSizing.plainBody(text: text, hint: hint, tail: tail, secure: sizing.secureTextEntry))
      : InputSizing.reflowWidth(metrics, format: format, text: text, hint: hint, tail: tail, secure: sizing.secureTextEntry)
    let size = InputSizing.reported(width: width, height: metrics.lineHeight)
    return NitroInputSize(width: Double(size.width), height: Double(size.height))
  }
}
