//
//  HybridMorphInputView.swift
//  NitroMorphInput
//
//  Nitro glue between React props / hybrid methods and `MorphInputView`.
//

import Foundation
import NitroModules
import UIKit

final class HybridMorphInputView: HybridMorphInputViewSpec, RecyclableView {
  private let inputView = MorphInputView()

  var view: UIView { inputView }

  private var isBatching = false
  private var configDirty = true
  /// The `text` prop as last applied; nil until the first application.
  private var lastAppliedText: String?
  private var textDirty = true

  /// What `getText()` / `getValue()` / `isFocused()` answer with. Nitro may
  /// call them off the main thread, so the view's state is mirrored here.
  private struct Snapshot {
    var text = ""
    var value = Double.nan
    var focused = false
    var eventCount = 0
  }
  private let snapshotLock = NSLock()
  private var snapshot = Snapshot()

  override init() {
    super.init()
    inputView.onTextChange = { [weak self] text, value, eventCount, reason in
      guard let self else { return }
      self.snapshotLock.lock()
      self.snapshot.text = text
      self.snapshot.value = value
      self.snapshot.eventCount = eventCount
      self.snapshotLock.unlock()
      guard reason != .prop else { return }
      self.onChangeText?(text, Double(eventCount))
      if self.mode == .number {
        self.onChangeValue?(value)
      }
    }
    inputView.onFocusChange = { [weak self] focused in
      guard let self else { return }
      self.snapshotLock.lock()
      self.snapshot.focused = focused
      self.snapshotLock.unlock()
      self.onFocusChange?(focused)
    }
    inputView.onSubmit = { [weak self] text in
      self?.onSubmitEditing?(text)
    }
    inputView.onIntrinsicSizeChange = { [weak self] size in
      self?.onSizeChange?(Double(size.width), Double(size.height))
    }
  }

  // MARK: - Props

  var text: String = "" { didSet { markTextDirty() } }
  var mostRecentEventCount: Double = 0 { didSet { markTextDirty() } }
  var mode: MorphInputMode = .text { didSet { markConfigDirty() } }
  var fractionDigits: Double = 2 { didSet { markConfigDirty() } }
  var maxIntegerDigits: Double = 15 { didSet { markConfigDirty() } }
  var groupingSeparator: String = "," { didSet { markConfigDirty() } }
  var decimalSeparator: String = "." { didSet { markConfigDirty() } }
  var prefix: String = "" { didSet { markConfigDirty() } }
  var suffix: String = "" { didSet { markConfigDirty() } }
  var prefixFontSize: Double = 32 { didSet { markConfigDirty() } }
  var suffixFontSize: Double = 32 { didSet { markConfigDirty() } }
  var affixAlign: MorphInputAffixAlign = .baseline { didSet { markConfigDirty() } }
  var prefixAlign: MorphInputAffixAlign = .baseline { didSet { markConfigDirty() } }
  var suffixAlign: MorphInputAffixAlign = .baseline { didSet { markConfigDirty() } }
  var placeholder: String = "" { didSet { markConfigDirty() } }
  var placeholderColor: Double = .nan { didSet { markConfigDirty() } }
  var duration: Double = 400 { didSet { markConfigDirty() } }
  var easing: MorphInputEasing = .expo { didSet { markConfigDirty() } }
  var bounce: Double = 0.15 { didSet { markConfigDirty() } }
  var effect: MorphInputEffect = .auto { didSet { markConfigDirty() } }
  var fontSize: Double = 32 { didSet { markConfigDirty() } }
  var fontWeight: Double = 400 { didSet { markConfigDirty() } }
  var fontFamily: String = "" { didSet { markConfigDirty() } }
  var color: Double = .nan { didSet { markConfigDirty() } }
  var textAlign: MorphInputTextAlign = .left { didSet { markConfigDirty() } }
  var caretColor: Double = .nan { didSet { markConfigDirty() } }
  var selectionColor: Double = .nan { didSet { markConfigDirty() } }
  var caretHidden: Bool = false { didSet { markConfigDirty() } }
  var adjustsFontSizeToFit: Bool = false { didSet { markConfigDirty() } }
  var minimumFontScale: Double = 0.5 { didSet { markConfigDirty() } }
  var allowFontScaling: Bool = false { didSet { markConfigDirty() } }
  var maxFontSizeMultiplier: Double = 0 { didSet { markConfigDirty() } }
  var keyboardType: MorphInputKeyboardType = .default { didSet { markConfigDirty() } }
  var returnKeyType: MorphInputReturnKeyType = .default { didSet { markConfigDirty() } }
  var autoCapitalize: MorphInputAutoCapitalize = .sentences { didSet { markConfigDirty() } }
  var autoCorrect: Bool = true { didSet { markConfigDirty() } }
  var editable: Bool = true { didSet { markConfigDirty() } }
  var autoFocus: Bool = false { didSet { markConfigDirty() } }
  var maxLength: Double = 0 { didSet { markConfigDirty() } }
  var onChangeText: ((String, Double) -> Void)?
  var onChangeValue: ((Double) -> Void)?
  var onFocusChange: ((Bool) -> Void)?
  var onSubmitEditing: ((String) -> Void)?
  var onSizeChange: ((Double, Double) -> Void)? {
    didSet { onMain { self.inputView.resendIntrinsicSize() } }
  }

  // MARK: - Methods

  func focus() throws {
    onMain {
      self.flushConfigIfNeeded()
      self.inputView.focus()
    }
  }

  func blur() throws {
    onMain { self.inputView.blur() }
  }

  func clear() throws {
    onMain {
      self.flushConfigIfNeeded()
      self.inputView.clear(reason: .method)
    }
  }

  func replaceText(text: String) throws {
    onMain {
      self.flushConfigIfNeeded()
      self.inputView.setText(text, reason: .method)
    }
  }

  func setValue(value: Double) throws {
    onMain {
      self.flushConfigIfNeeded()
      self.inputView.setValue(value, reason: .method)
    }
  }

  func currentText() throws -> String {
    snapshotLock.lock()
    defer { snapshotLock.unlock() }
    return snapshot.text
  }

  func getValue() throws -> Double {
    snapshotLock.lock()
    defer { snapshotLock.unlock() }
    return snapshot.value
  }

  func isFocused() throws -> Bool {
    snapshotLock.lock()
    defer { snapshotLock.unlock() }
    return snapshot.focused
  }

  // MARK: - Lifecycle

  func beforeUpdate() {
    isBatching = true
  }

  func afterUpdate() {
    isBatching = false
    commit()
  }

  func onDropView() {
    onMain { self.inputView.stopAnimation() }
  }

  /// Fabric is about to reuse this view for another element: forget every prop
  /// and all state. Nitro re-applies the new element's props next.
  func prepareForRecycle() {
    isBatching = true
    text = ""
    mostRecentEventCount = 0
    mode = .text
    fractionDigits = 2
    maxIntegerDigits = 15
    groupingSeparator = ","
    decimalSeparator = "."
    prefix = ""
    suffix = ""
    prefixFontSize = 32
    suffixFontSize = 32
    affixAlign = .baseline
    prefixAlign = .baseline
    suffixAlign = .baseline
    placeholder = ""
    placeholderColor = .nan
    duration = 400
    easing = .expo
    bounce = 0.15
    effect = .auto
    fontSize = 32
    fontWeight = 400
    fontFamily = ""
    color = .nan
    textAlign = .left
    caretColor = .nan
    selectionColor = .nan
    caretHidden = false
    adjustsFontSizeToFit = false
    minimumFontScale = 0.5
    allowFontScaling = false
    maxFontSizeMultiplier = 0
    keyboardType = .default
    returnKeyType = .default
    autoCapitalize = .sentences
    autoCorrect = true
    editable = true
    autoFocus = false
    maxLength = 0
    onChangeText = nil
    onChangeValue = nil
    onFocusChange = nil
    onSubmitEditing = nil
    onSizeChange = nil
    lastAppliedText = nil
    configDirty = true
    textDirty = true
    isBatching = false
    snapshotLock.lock()
    snapshot = Snapshot()
    snapshotLock.unlock()
    onMain { self.inputView.resetForRecycle() }
  }

  // MARK: - Batching

  private func markConfigDirty() {
    configDirty = true
    commitIfNeeded()
  }

  private func markTextDirty() {
    textDirty = true
    commitIfNeeded()
  }

  private func commitIfNeeded() {
    if !isBatching { commit() }
  }

  private func commit() {
    onMain {
      self.flushConfigIfNeeded()
      self.applyTextIfNeeded()
    }
  }

  /// The `text` prop handshake: apply it when it differs from the last applied
  /// value and JS has seen every native edit (`mostRecentEventCount` caught up
  /// with the native count), like React Native's own `TextInput`.
  private func applyTextIfNeeded() {
    guard textDirty else { return }
    textDirty = false
    guard text != lastAppliedText else { return }
    snapshotLock.lock()
    let nativeCount = snapshot.eventCount
    snapshotLock.unlock()
    guard mostRecentEventCount.isFinite, Int(mostRecentEventCount) >= nativeCount else { return }
    lastAppliedText = text
    inputView.setText(text, reason: .prop)
  }

  private func flushConfigIfNeeded() {
    guard configDirty else { return }
    configDirty = false

    var format = MorphInputView.Format()
    format.mode = mode == .number ? .number : .text
    format.fractionDigits = Self.clampInt(fractionDigits, 0, 9, fallback: 2)
    format.maxIntegerDigits = Self.clampInt(maxIntegerDigits, 1, 15, fallback: 15)
    format.groupingSeparator = groupingSeparator
    format.decimalSeparator = decimalSeparator.isEmpty ? "." : decimalSeparator
    format.prefix = prefix
    format.suffix = suffix
    format.placeholder = placeholder
    format.maxLength = Self.clampInt(maxLength, 0, 1_000_000, fallback: 0)

    var typography = MorphInputView.Typography()
    typography.fontSize = CGFloat(fontSize.isFinite && fontSize > 0 ? fontSize : 32)
    typography.prefixFontSize = prefixFontSize.isFinite && prefixFontSize > 0 ? CGFloat(prefixFontSize) : nil
    typography.suffixFontSize = suffixFontSize.isFinite && suffixFontSize > 0 ? CGFloat(suffixFontSize) : nil
    typography.fontWeight = CGFloat(fontWeight.isFinite ? fontWeight : 400)
    typography.fontFamily = fontFamily.isEmpty ? nil : fontFamily
    typography.color = Self.color(fromARGB: color) ?? .label
    typography.placeholderColor = Self.color(fromARGB: placeholderColor) ?? .placeholderText
    typography.prefixAlign = Self.mapAffixAlign(prefixAlign)
    typography.suffixAlign = Self.mapAffixAlign(suffixAlign)
    typography.adjustsFontSizeToFit = adjustsFontSizeToFit
    typography.minimumFontScale = CGFloat(min(1, max(0.05, minimumFontScale.isFinite ? minimumFontScale : 0.5)))
    typography.allowFontScaling = allowFontScaling
    typography.maxFontSizeMultiplier = CGFloat(max(0, maxFontSizeMultiplier.isFinite ? maxFontSizeMultiplier : 0))

    var timing = MorphInputView.Timing()
    timing.duration = max(0, (duration.isFinite ? duration : 400) / 1000)
    timing.easing = Self.mapEasing(easing)
    timing.bounce = min(1, max(0, bounce.isFinite ? bounce : 0.15))
    timing.effect = Self.mapEffect(effect)

    var traits = MorphInputView.Traits()
    traits.keyboardType = Self.mapKeyboardType(keyboardType)
    traits.returnKeyType = Self.mapReturnKeyType(returnKeyType)
    traits.autocapitalization = Self.mapAutoCapitalize(autoCapitalize)
    traits.autocorrect = autoCorrect
    traits.editable = editable
    traits.autoFocus = autoFocus
    traits.caretHidden = caretHidden
    traits.caretColor = Self.color(fromARGB: caretColor)
    traits.selectionColor = Self.color(fromARGB: selectionColor)

    inputView.typography = typography
    inputView.format = format
    inputView.timing = timing
    inputView.traits = traits
    inputView.alignment = Self.mapAlignment(textAlign)
  }

  // MARK: - Helpers

  private func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
      block()
    } else {
      DispatchQueue.main.async(execute: block)
    }
  }

  private static func clampInt(_ value: Double, _ lower: Int, _ upper: Int, fallback: Int) -> Int {
    guard value.isFinite else { return fallback }
    return min(upper, max(lower, Int(value.rounded())))
  }

  /// A processed React Native color (ARGB packed in a double); NaN = platform default.
  private static func color(fromARGB value: Double) -> UIColor? {
    guard value.isFinite else { return nil }
    let bits = UInt32(truncatingIfNeeded: Int64(value))
    let a = CGFloat((bits >> 24) & 0xff) / 255
    let r = CGFloat((bits >> 16) & 0xff) / 255
    let g = CGFloat((bits >> 8) & 0xff) / 255
    let b = CGFloat(bits & 0xff) / 255
    return UIColor(red: r, green: g, blue: b, alpha: a)
  }

  private static func mapEasing(_ easing: MorphInputEasing) -> Int32 {
    switch easing {
    case .expo: return 0
    case .easeout: return 1
    case .easeinout: return 2
    case .linear: return 3
    case .spring: return 4
    default: return 0
    }
  }

  private static func mapEffect(_ effect: MorphInputEffect) -> Int32 {
    switch effect {
    case .auto: return 0
    case .slide: return 1
    case .fade: return 2
    default: return 0
    }
  }

  private static func mapAffixAlign(_ align: MorphInputAffixAlign) -> MorphInputView.AffixAlign {
    switch align {
    case .baseline: return .baseline
    case .center: return .center
    case .top: return .top
    case .bottom: return .bottom
    default: return .baseline
    }
  }

  private static func mapAlignment(_ align: MorphInputTextAlign) -> MorphInputView.Alignment {
    switch align {
    case .left: return .left
    case .center: return .center
    case .right: return .right
    default: return .left
    }
  }

  private static func mapKeyboardType(_ type: MorphInputKeyboardType) -> UIKeyboardType {
    switch type {
    case .default: return .default
    case .numberPad: return .numberPad
    case .decimalPad: return .decimalPad
    case .numeric: return .numbersAndPunctuation
    case .emailAddress: return .emailAddress
    case .phonePad: return .phonePad
    case .url: return .URL
    case .asciiCapable: return .asciiCapable
    case .numbersAndPunctuation: return .numbersAndPunctuation
    default: return .default
    }
  }

  private static func mapReturnKeyType(_ type: MorphInputReturnKeyType) -> UIReturnKeyType {
    switch type {
    case .default: return .default
    case .done: return .done
    case .go: return .go
    case .next: return .next
    case .search: return .search
    case .send: return .send
    default: return .default
    }
  }

  private static func mapAutoCapitalize(_ type: MorphInputAutoCapitalize) -> UITextAutocapitalizationType {
    switch type {
    case .none: return .none
    case .sentences: return .sentences
    case .words: return .words
    case .characters: return .allCharacters
    default: return .sentences
    }
  }
}
