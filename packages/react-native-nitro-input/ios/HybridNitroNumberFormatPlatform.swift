//
//  HybridNitroNumberFormatPlatform.swift
//  NitroInput
//
//  Foundation's `NumberFormatter`, for the C++ `NumberFormat`: C++ learns a
//  locale's format from it once (see NumberFormatProbe) and formats with it
//  only for what C++ does not draw itself (compact and scientific notation,
//  currency names). Hermes' `Intl.NumberFormat` uses the same formatter on
//  iOS, so the two agree.
//

import Foundation
import NitroModules

final class HybridNitroNumberFormatPlatform: HybridNitroNumberFormatPlatformSpec {
  func create(options: NumberFormatPlatformOptions) throws -> any HybridNitroPlatformNumberFormatterSpec {
    return try HybridNitroPlatformNumberFormatter(options: options)
  }

  func supportedLocalesOf(locales: [String]) throws -> [String] {
    return locales.compactMap { NumberFormatLocales.match($0)?.tag }
  }
}

/// ECMA-402's lookup matcher over the locales Foundation has data for.
enum NumberFormatLocales {
  private static let available = Set(Locale.availableIdentifiers)

  struct Match {
    /// The matched locale as a BCP 47 tag, without extensions ("de-DE").
    let tag: String
    /// Foundation's identifier for it ("de_DE").
    let identifier: String
    /// The numbering system asked for with `-u-nu-`, if any.
    let numberingSystem: String?
  }

  static func match(_ requested: String) -> Match? {
    let lowered = requested.replacingOccurrences(of: "_", with: "-")
    // "de-DE-u-nu-latn": the base tag and the numbering system of its Unicode extension.
    var base = lowered
    var numberingSystem: String?
    if let range = lowered.range(of: "-u-") {
      base = String(lowered[..<range.lowerBound])
      let keys = lowered[range.upperBound...].split(separator: "-")
      if let nu = keys.firstIndex(of: "nu"), nu + 1 < keys.endIndex { numberingSystem = String(keys[nu + 1]) }
    }
    var subtags = base.split(separator: "-").map(String.init)
    while !subtags.isEmpty {
      let identifier = subtags.joined(separator: "_")
      if available.contains(identifier) {
        return Match(tag: subtags.joined(separator: "-"), identifier: identifier, numberingSystem: numberingSystem)
      }
      subtags.removeLast()
    }
    return nil
  }

  /// The first requested locale Foundation knows, or the device's.
  static func resolve(_ requested: [String]) -> Match {
    for tag in requested {
      if let match = match(tag) { return match }
    }
    let current = Locale.current.identifier
    let base = current.split(separator: "@").first.map(String.init) ?? current
    return Match(tag: base.replacingOccurrences(of: "_", with: "-"), identifier: base, numberingSystem: nil)
  }
}

final class HybridNitroPlatformNumberFormatter: HybridNitroPlatformNumberFormatterSpec {
  private let formatter = NumberFormatter()
  /// Compact notation, which `NumberFormatter` does not have (iOS 16+).
  private var compact: ((Double) -> String)?
  let symbols: NumberFormatPlatformSymbols

  init(options o: NumberFormatPlatformOptions) throws {
    let match = NumberFormatLocales.resolve(o.locales)
    let numberingSystem = o.numberingSystem ?? match.numberingSystem
    // The currency goes into the locale too: Foundation otherwise takes some
    // patterns (accounting in tr_TR) from the locale's own currency.
    var keywords: [String] = []
    if o.style == .currency, let code = o.currency { keywords.append("currency=\(code)") }
    if let numberingSystem { keywords.append("numbers=\(numberingSystem)") }
    let locale = Locale(identifier: keywords.isEmpty ? match.identifier : "\(match.identifier)@\(keywords.joined(separator: ";"))")
    formatter.locale = locale

    var currencyShown = ""
    switch o.style {
    case .decimal:
      formatter.numberStyle = .decimal
    case .percent:
      formatter.numberStyle = .percent
    case .currency:
      switch o.currencyDisplay {
      case .code:
        formatter.numberStyle = .currencyISOCode
      case .name:
        formatter.numberStyle = .currencyPlural
      default:
        formatter.numberStyle = o.currencySign == .accounting ? .currencyAccounting : .currency
      }
      formatter.currencyCode = o.currency ?? "USD"
      if o.currencyDisplay == .narrowsymbol, let narrow = Self.narrowSymbol(o.currency ?? "USD", locale: locale) {
        formatter.currencySymbol = narrow
      }
      currencyShown = o.currencyDisplay == .code ? formatter.internationalCurrencySymbol : formatter.currencySymbol
    case .unit:
      throw RuntimeError.error(withMessage: "NumberFormat: style 'unit' is not supported on iOS yet.")
    }

    switch o.notation {
    case .scientific, .engineering:
      formatter.numberStyle = .scientific
    case .compact, .standard:
      break
    }
    formatter.usesGroupingSeparator = o.useGrouping
    formatter.minimumIntegerDigits = Int(o.minimumIntegerDigits)
    if o.minimumSignificantDigits > 0 {
      formatter.usesSignificantDigits = true
      formatter.minimumSignificantDigits = Int(o.minimumSignificantDigits)
      formatter.maximumSignificantDigits = Int(o.maximumSignificantDigits)
    } else {
      formatter.minimumFractionDigits = Int(o.minimumFractionDigits)
      formatter.maximumFractionDigits = Int(o.maximumFractionDigits)
    }
    formatter.roundingMode = Self.roundingMode(o.roundingMode)
    switch o.signDisplay {
    case .always, .exceptzero:
      formatter.positivePrefix = formatter.plusSign + formatter.positivePrefix
    case .never:
      formatter.negativePrefix = formatter.positivePrefix
      formatter.negativeSuffix = formatter.positiveSuffix
    case .auto, .negative:
      break
    }

    if o.notation == .compact, #available(iOS 16.0, *) {
      var style = FloatingPointFormatStyle<Double>(locale: locale)
        .notation(.compactName)
        .grouping(o.useGrouping ? .automatic : .never)
      if o.minimumSignificantDigits > 0 {
        style = style.precision(.significantDigits(Int(o.minimumSignificantDigits)...Int(o.maximumSignificantDigits)))
      } else {
        style = style.precision(.fractionLength(Int(o.minimumFractionDigits)...Int(o.maximumFractionDigits)))
      }
      compact = { style.format($0) }
    }

    symbols = NumberFormatPlatformSymbols(
      locale: match.tag,
      numberingSystem: Self.numberingSystem(of: locale),
      minusSign: formatter.minusSign,
      plusSign: formatter.plusSign,
      percentSign: formatter.percentSymbol,
      currency: currencyShown,
      nan: formatter.notANumberSymbol,
      infinity: formatter.positiveInfinitySymbol
    )
  }

  func format(value: Double) throws -> String {
    if let compact { return compact(value) }
    return formatter.string(from: NSNumber(value: value)) ?? ""
  }

  func formatDecimal(value: String) throws -> String {
    if value.hasSuffix("Infinity") || value == "NaN" {
      return try format(value: value == "NaN" ? .nan : value.hasPrefix("-") ? -.infinity : .infinity)
    }
    if compact != nil { return try format(value: Double(value) ?? .nan) }
    let number = NSDecimalNumber(string: value, locale: Locale(identifier: "en_US_POSIX"))
    return formatter.string(from: number) ?? ""
  }

  private static func roundingMode(_ mode: NumberFormatRoundingMode) -> NumberFormatter.RoundingMode {
    switch mode {
    case .ceil: return .ceiling
    case .floor: return .floor
    case .expand: return .up
    case .trunc: return .down
    case .halftrunc: return .halfDown
    case .halfeven: return .halfEven
    case .halfexpand, .halfceil, .halffloor: return .halfUp
    }
  }

  private static func numberingSystem(of locale: Locale) -> String {
    if #available(iOS 16.0, *) { return locale.numberingSystem.identifier }
    return "latn"
  }

  /// The currency's narrow symbol ("$" for CA$), read off a formatted zero.
  private static func narrowSymbol(_ code: String, locale: Locale) -> String? {
    guard #available(iOS 16.0, *) else { return nil }
    let text = Decimal(0).formatted(.currency(code: code).locale(locale).presentation(.narrow))
    let symbol = text.unicodeScalars.filter { scalar in
      !CharacterSet.decimalDigits.contains(scalar) && !CharacterSet.whitespaces.contains(scalar) && !CharacterSet.punctuationCharacters.contains(scalar)
        && !(0x200E...0x200F).contains(scalar.value) && scalar.value != 0x061C
    }
    let result = String(String.UnicodeScalarView(symbol))
    return result.isEmpty ? nil : result
  }
}
