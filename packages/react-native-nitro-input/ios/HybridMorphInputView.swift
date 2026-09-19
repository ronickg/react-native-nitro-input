//
//  HybridNitroInputView.swift
//  NitroInput
//
//  Nitro glue between React props / hybrid methods and `NitroInputView`.
//

import Foundation
import NitroModules
import UIKit

final class HybridNitroInputView: HybridNitroInputViewSpec, RecyclableView {
  private let inputView = NitroInputView()

  var view: UIView { inputView }

  private var isBatching = false
  private var configDirty = true
  /// The `text` prop as last applied; nil until the first application.
  private var lastAppliedText: String?
  private var textDirty = true
  private var selectionDirty = false

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
    inputView.onEndEditing = { [weak self] text in
      self?.onEndEditing?(text)
    }
    inputView.onSelectionChange = { [weak self] start, end in
      self?.onSelectionChange?(Double(start), Double(end))
    }
    inputView.onKeyPress = { [weak self] key in
      self?.onKeyPress?(key)
    }
    inputView.onIntrinsicSizeChange = { [weak self] size in
      self?.onSizeChange?(Double(size.width), Double(size.height))
    }
  }

  // MARK: - Props

  var text: String = "" { didSet { markTextDirty() } }
  var mostRecentEventCount: Double = 0 { didSet { markTextDirty() } }
  var mode: NitroInputMode = .text { didSet { markConfigDirty() } }
  var plain: Bool = false { didSet { markConfigDirty() } }
  var fractionDigits: Double = 2 { didSet { markConfigDirty() } }
  var maxIntegerDigits: Double = 15 { didSet { markConfigDirty() } }
  var groupingSeparator: String = "," { didSet { markConfigDirty() } }
  var decimalSeparator: String = "." { didSet { markConfigDirty() } }
  var prefix: String = "" { didSet { markConfigDirty() } }
  var suffix: String = "" { didSet { markConfigDirty() } }
  var prefixFontSize: Double = 32 { didSet { markConfigDirty() } }
  var suffixFontSize: Double = 32 { didSet { markConfigDirty() } }
  var affixAlign: NitroInputAffixAlign = .baseline { didSet { markConfigDirty() } }
  var prefixAlign: NitroInputAffixAlign = .baseline { didSet { markConfigDirty() } }
  var suffixAlign: NitroInputAffixAlign = .baseline { didSet { markConfigDirty() } }
  var placeholder: String = "" { didSet { markConfigDirty() } }
  var placeholderColor: Double = .nan { didSet { markConfigDirty() } }
  var duration: Double = 400 { didSet { markConfigDirty() } }
  var easing: NitroInputEasing = .expo { didSet { markConfigDirty() } }
  var bounce: Double = 0.15 { didSet { markConfigDirty() } }
  var effect: NitroInputEffect = .auto { didSet { markConfigDirty() } }
  var fontSize: Double = 32 { didSet { markConfigDirty() } }
  var fontWeight: Double = 400 { didSet { markConfigDirty() } }
  var fontFamily: String = "" { didSet { markConfigDirty() } }
  var color: Double = .nan { didSet { markConfigDirty() } }
  var textAlign: NitroInputTextAlign = .left { didSet { markConfigDirty() } }
  var caretColor: Double = .nan { didSet { markConfigDirty() } }
  var selectionColor: Double = .nan { didSet { markConfigDirty() } }
  var caretHidden: Bool = false { didSet { markConfigDirty() } }
  var adjustsFontSizeToFit: Bool = false { didSet { markConfigDirty() } }
  var minimumFontScale: Double = 0.5 { didSet { markConfigDirty() } }
  var allowFontScaling: Bool = false { didSet { markConfigDirty() } }
  var maxFontSizeMultiplier: Double = 0 { didSet { markConfigDirty() } }
  var keyboardType: NitroInputKeyboardType = .default { didSet { markConfigDirty() } }
  var returnKeyType: NitroInputReturnKeyType = .default { didSet { markConfigDirty() } }
  var autoCapitalize: NitroInputAutoCapitalize = .sentences { didSet { markConfigDirty() } }
  var autoCorrect: Bool = true { didSet { markConfigDirty() } }
  var editable: Bool = true { didSet { markConfigDirty() } }
  var autoFocus: Bool = false { didSet { markConfigDirty() } }
  var fieldTestID: String = "" { didSet { markConfigDirty() } }
  var fieldAccessibilityLabel: String = "" { didSet { markConfigDirty() } }
  var submitBehavior: NitroInputSubmitBehavior = .blurandsubmit { didSet { markConfigDirty() } }
  var secureTextEntry: Bool = false { didSet { markConfigDirty() } }
  var keyboardAppearance: NitroInputKeyboardAppearance = .default { didSet { markConfigDirty() } }
  var textContentType: String = "" { didSet { markConfigDirty() } }
  var enablesReturnKeyAutomatically: Bool = false { didSet { markConfigDirty() } }
  var showSoftInputOnFocus: Bool = true { didSet { markConfigDirty() } }
  var selectTextOnFocus: Bool = false { didSet { markConfigDirty() } }
  var clearTextOnFocus: Bool = false { didSet { markConfigDirty() } }
  var contextMenuHidden: Bool = false { didSet { markConfigDirty() } }
  var spellCheck: Bool = true { didSet { markConfigDirty() } }
  var selectionStart: Double = -1 { didSet { markSelectionDirty() } }
  var selectionEnd: Double = -1 { didSet { markSelectionDirty() } }
  var maxLength: Double = 0 { didSet { markConfigDirty() } }
  var transformWorklet: Double = 0 { didSet { markConfigDirty() } }
  var onChangeTextWorklet: Double = 0 { didSet { markConfigDirty() } }
  var onChangeValueWorklet: Double = 0 { didSet { markConfigDirty() } }
  var onChangeText: ((String, Double) -> Void)?
  var onChangeValue: ((Double) -> Void)?
  var onFocusChange: ((Bool) -> Void)?
  var onSubmitEditing: ((String) -> Void)?
  var onEndEditing: ((String) -> Void)?
  var onSelectionChange: ((Double, Double) -> Void)?
  var onKeyPress: ((String) -> Void)?
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
    plain = false
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
    fieldTestID = ""
    fieldAccessibilityLabel = ""
    submitBehavior = .blurandsubmit
    secureTextEntry = false
    keyboardAppearance = .default
    textContentType = ""
    enablesReturnKeyAutomatically = false
    showSoftInputOnFocus = true
    selectTextOnFocus = false
    clearTextOnFocus = false
    contextMenuHidden = false
    spellCheck = true
    selectionStart = -1
    selectionEnd = -1
    maxLength = 0
    transformWorklet = 0
    onChangeTextWorklet = 0
    onChangeValueWorklet = 0
    onChangeText = nil
    onChangeValue = nil
    onFocusChange = nil
    onSubmitEditing = nil
    onEndEditing = nil
    onSelectionChange = nil
    onKeyPress = nil
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

  private func markSelectionDirty() {
    selectionDirty = true
    commitIfNeeded()
  }

  private func commitIfNeeded() {
    if !isBatching { commit() }
  }

  private func commit() {
    onMain {
      self.flushConfigIfNeeded()
      self.applyTextIfNeeded()
      self.applySelectionIfNeeded()
    }
  }

  /// A controlled `selection`: `-1` on either end means "leave the caret alone",
  /// which is what an uncontrolled field sends on every render.
  private func applySelectionIfNeeded() {
    guard selectionDirty else { return }
    selectionDirty = false
    let start = Self.clampInt(selectionStart, -1, Int(Int32.max), fallback: -1)
    let end = Self.clampInt(selectionEnd, -1, Int(Int32.max), fallback: -1)
    guard start >= 0, end >= 0 else { return }
    inputView.setSelection(start: start, end: end)
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

  private static func mapKeyboardAppearance(_ value: NitroInputKeyboardAppearance) -> UIKeyboardAppearance {
    switch value {
    case .light: return .light
    case .dark: return .dark
    case .default: return .default
    }
  }

  /// React Native's `textContentType` / `autoComplete` names mapped to UIKit's.
  /// An unknown or empty name means "no autofill".
  private static func mapTextContentType(_ value: String) -> UITextContentType? {
    switch value {
    case "name": return .name
    case "namePrefix": return .namePrefix
    case "nameSuffix": return .nameSuffix
    case "givenName": return .givenName
    case "middleName": return .middleName
    case "familyName": return .familyName
    case "nickname": return .nickname
    case "jobTitle": return .jobTitle
    case "organizationName": return .organizationName
    case "location": return .location
    case "fullStreetAddress": return .fullStreetAddress
    case "streetAddressLine1": return .streetAddressLine1
    case "streetAddressLine2": return .streetAddressLine2
    case "addressCity": return .addressCity
    case "addressState": return .addressState
    case "addressCityAndState": return .addressCityAndState
    case "sublocality": return .sublocality
    case "countryName": return .countryName
    case "postalCode": return .postalCode
    case "telephoneNumber": return .telephoneNumber
    case "emailAddress": return .emailAddress
    case "URL": return .URL
    case "creditCardNumber": return .creditCardNumber
    case "username": return .username
    case "password": return .password
    case "newPassword": return .newPassword
    case "oneTimeCode": return .oneTimeCode
    default: return nil
    }
  }

  private func flushConfigIfNeeded() {
    guard configDirty else { return }
    configDirty = false

    var format = NitroInputView.Format()
    format.mode = mode == .number ? .number : .text
    format.fractionDigits = Self.clampInt(fractionDigits, 0, 9, fallback: 2)
    format.maxIntegerDigits = Self.clampInt(maxIntegerDigits, 1, 15, fallback: 15)
    format.groupingSeparator = groupingSeparator
    format.decimalSeparator = decimalSeparator.isEmpty ? "." : decimalSeparator
    format.prefix = prefix
    format.suffix = suffix
    format.placeholder = placeholder
    format.maxLength = Self.clampInt(maxLength, 0, 1_000_000, fallback: 0)

    var typography = NitroInputView.Typography()
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

    var timing = NitroInputView.Timing()
    timing.duration = max(0, (duration.isFinite ? duration : 400) / 1000)
    timing.easing = Self.mapEasing(easing)
    timing.bounce = min(1, max(0, bounce.isFinite ? bounce : 0.15))
    timing.effect = Self.mapEffect(effect)

    var traits = NitroInputView.Traits()
    traits.keyboardType = Self.mapKeyboardType(keyboardType)
    traits.returnKeyType = Self.mapReturnKeyType(returnKeyType)
    traits.autocapitalization = Self.mapAutoCapitalize(autoCapitalize)
    traits.autocorrect = autoCorrect
    traits.editable = editable
    traits.autoFocus = autoFocus
    traits.caretHidden = caretHidden
    traits.caretColor = Self.color(fromARGB: caretColor)
    traits.selectionColor = Self.color(fromARGB: selectionColor)
    traits.plain = plain
    traits.testID = fieldTestID.isEmpty ? nil : fieldTestID
    traits.accessibilityLabel = fieldAccessibilityLabel.isEmpty ? nil : fieldAccessibilityLabel
    traits.blurOnSubmit = submitBehavior == .blurandsubmit
    traits.secureTextEntry = secureTextEntry
    traits.keyboardAppearance = Self.mapKeyboardAppearance(keyboardAppearance)
    traits.textContentType = Self.mapTextContentType(textContentType)
    traits.enablesReturnKeyAutomatically = enablesReturnKeyAutomatically
    traits.showSoftInputOnFocus = showSoftInputOnFocus
    traits.selectTextOnFocus = selectTextOnFocus
    traits.clearTextOnFocus = clearTextOnFocus
    traits.contextMenuHidden = contextMenuHidden
    traits.spellCheck = spellCheck && autoCorrect

    var worklets = NitroInputView.Worklets()
    worklets.transform = Self.clampInt(transformWorklet, 0, Int(Int32.max), fallback: 0)
    worklets.onChangeText = Self.clampInt(onChangeTextWorklet, 0, Int(Int32.max), fallback: 0)
    worklets.onChangeValue = Self.clampInt(onChangeValueWorklet, 0, Int(Int32.max), fallback: 0)

    inputView.typography = typography
    inputView.format = format
    inputView.timing = timing
    inputView.traits = traits
    inputView.worklets = worklets
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

  private static func mapEasing(_ easing: NitroInputEasing) -> Int32 {
    switch easing {
    case .expo: return 0
    case .easeout: return 1
    case .easeinout: return 2
    case .linear: return 3
    case .spring: return 4
    default: return 0
    }
  }

  private static func mapEffect(_ effect: NitroInputEffect) -> Int32 {
    switch effect {
    case .auto: return 0
    case .slide: return 1
    case .fade: return 2
    default: return 0
    }
  }

  private static func mapAffixAlign(_ align: NitroInputAffixAlign) -> NitroInputView.AffixAlign {
    switch align {
    case .baseline: return .baseline
    case .center: return .center
    case .top: return .top
    case .bottom: return .bottom
    default: return .baseline
    }
  }

  private static func mapAlignment(_ align: NitroInputTextAlign) -> NitroInputView.Alignment {
    switch align {
    case .left: return .left
    case .center: return .center
    case .right: return .right
    default: return .left
    }
  }

  private static func mapKeyboardType(_ type: NitroInputKeyboardType) -> UIKeyboardType {
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

  private static func mapReturnKeyType(_ type: NitroInputReturnKeyType) -> UIReturnKeyType {
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

  private static func mapAutoCapitalize(_ type: NitroInputAutoCapitalize) -> UITextAutocapitalizationType {
    switch type {
    case .none: return .none
    case .sentences: return .sentences
    case .words: return .words
    case .characters: return .allCharacters
    default: return .sentences
    }
  }
}
