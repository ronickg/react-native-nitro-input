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
    let lowered = requested.replacingOccurrences(of: "_", with: "-").lowercased()
    // "de-DE-u-nu-latn": the base tag and the numbering system of its Unicode extension.
    var base = lowered
    var numberingSystem: String?
    if let range = lowered.range(of: "-u-") {
      base = String(lowered[..<range.lowerBound])
      let keys = lowered[range.upperBound...].split(separator: "-")
      if let nu = keys.firstIndex(of: "nu"), nu + 1 < keys.endIndex { numberingSystem = String(keys[nu + 1]) }
    }
    // Canonical case: language lower, script title, region upper ("zh-hant-tw" → zh_Hant_TW).
    var subtags = base.split(separator: "-").enumerated().map { index, tag -> String in
      let tag = String(tag)
      if index == 0 { return tag }
      if tag.count == 4 { return tag.prefix(1).uppercased() + tag.dropFirst() }
      if tag.count == 2 || (tag.count == 3 && tag.allSatisfy(\.isNumber)) { return tag.uppercased() }
      return tag
    }
    // Foundation lists some locales with their script only ("zh_Hant_TW" for zh-TW): try the full form too.
    if #available(iOS 16.0, *), subtags.count > 1 {
      let maximal = Locale.Language(identifier: subtags.joined(separator: "-")).maximalIdentifier.replacingOccurrences(of: "-", with: "_")
      if !available.contains(subtags.joined(separator: "_")), available.contains(maximal) {
        return Match(tag: subtags.joined(separator: "-"), identifier: maximal, numberingSystem: numberingSystem)
      }
    }
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
  /// Units, through `MeasurementFormatter` with this formatter for the number.
  private var measure: ((Double) -> String)?
  let symbols: NumberFormatPlatformSymbols

  init(options o: NumberFormatPlatformOptions) throws {
    let match = NumberFormatLocales.resolve(o.locales)
    // Foundation knows numbering systems only in lower case, and one it does not
    // know leaves the formatter without symbols; Intl ignores those, so drop it.
    var numberingSystem = (o.numberingSystem ?? match.numberingSystem)?.lowercased()
    // The currency goes into the locale too: Foundation otherwise takes some
    // patterns (accounting in tr_TR) from the locale's own currency.
    func makeLocale() -> Locale {
      var keywords: [String] = []
      if o.style == .currency, let code = o.currency { keywords.append("currency=\(code)") }
      if let numberingSystem { keywords.append("numbers=\(numberingSystem)") }
      return Locale(identifier: keywords.isEmpty ? match.identifier : "\(match.identifier)@\(keywords.joined(separator: ";"))")
    }
    var locale = makeLocale()
    formatter.locale = locale
    if numberingSystem != nil, (formatter.minusSign as String?) == nil {
      numberingSystem = nil
      locale = makeLocale()
      formatter.locale = locale
    }

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
      currencyShown = (o.currencyDisplay == .code ? formatter.internationalCurrencySymbol as String? : formatter.currencySymbol as String?) ?? (o.currency ?? "")
    case .unit:
      formatter.numberStyle = .decimal
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
      formatter.positivePrefix = ((formatter.plusSign as String?) ?? "+") + ((formatter.positivePrefix as String?) ?? "")
    case .never:
      formatter.negativePrefix = formatter.positivePrefix
      formatter.negativeSuffix = formatter.positiveSuffix
    case .auto, .negative:
      break
    }

    if o.notation == .compact, #available(iOS 16.0, *) {
      // Before iOS 18 Foundation has no compact currency style: the currency
      // formatter's own affixes go around the compact number ("$" + "1.5K").
      let affixes = o.style == .currency
        ? CompactAffixes(
            positivePrefix: formatter.positivePrefix ?? "", positiveSuffix: formatter.positiveSuffix ?? "",
            negativePrefix: formatter.negativePrefix ?? "-", negativeSuffix: formatter.negativeSuffix ?? "")
        : nil
      compact = Self.compactStyle(o, locale: locale, currencyAffixes: affixes)
    }

    if o.style == .unit, let unit = o.unit {
      measure = try Self.unitFormatter(unit, display: o.unitDisplay, locale: locale, number: formatter)
    }

    symbols = NumberFormatPlatformSymbols(
      locale: match.tag,
      numberingSystem: Self.numberingSystem(of: locale),
      minusSign: (formatter.minusSign as String?) ?? "-",
      plusSign: (formatter.plusSign as String?) ?? "+",
      percentSign: (formatter.percentSymbol as String?) ?? "%",
      currency: currencyShown,
      nan: (formatter.notANumberSymbol as String?) ?? "NaN",
      infinity: (formatter.positiveInfinitySymbol as String?) ?? "∞",
      exponentSeparator: (formatter.exponentSymbol as String?) ?? "E"
    )
  }

  /// Compact notation in the style the options ask for: a decimal style
  /// alone dropped the currency ("950" for "$950"), the percent sign and a
  /// signDisplay's plus. Foundation has a compact currency and percent style
  /// of its own, which prints the locale's compact currency patterns.
  /// A currency pattern's text around the number, for compact currency before iOS 18.
  private struct CompactAffixes {
    let positivePrefix: String
    let positiveSuffix: String
    let negativePrefix: String
    let negativeSuffix: String
  }

  @available(iOS 16.0, *)
  private static func compactStyle(_ o: NumberFormatPlatformOptions, locale: Locale, currencyAffixes: CompactAffixes?) -> (Double) -> String {
    let grouping: NumberFormatStyleConfiguration.Grouping = o.useGrouping ? .automatic : .never
    let precision: NumberFormatStyleConfiguration.Precision = o.minimumSignificantDigits > 0
      ? .significantDigits(Int(o.minimumSignificantDigits)...Int(o.maximumSignificantDigits))
      : .fractionLength(Int(o.minimumFractionDigits)...Int(o.maximumFractionDigits))
    let sign: NumberFormatStyleConfiguration.SignDisplayStrategy
    switch o.signDisplay {
    case .always: sign = .always(includingZero: true)
    case .exceptzero: sign = .always(includingZero: false)
    case .never: sign = .never
    default: sign = .automatic
    }
    if o.style == .currency, let code = o.currency, #available(iOS 18.0, *) {
      let presentation: CurrencyFormatStyleConfiguration.Presentation
      switch o.currencyDisplay {
      case .code: presentation = .isoCode
      case .name: presentation = .fullName
      case .narrowsymbol: presentation = .narrow
      default: presentation = .standard
      }
      let currencySign: CurrencyFormatStyleConfiguration.SignDisplayStrategy
      switch o.signDisplay {
      case .always: currencySign = .always(showZero: true)
      case .exceptzero: currencySign = .always(showZero: false)
      case .never: currencySign = .never
      default: currencySign = o.currencySign == .accounting ? .accounting : .automatic
      }
      let style = FloatingPointFormatStyle<Double>.Currency(code: code, locale: locale)
        .notation(.compactName)
        .grouping(grouping)
        .precision(precision)
        .presentation(presentation)
        .sign(strategy: currencySign)
      return { style.format($0) }
    }
    if o.style == .percent {
      let style = FloatingPointFormatStyle<Double>.Percent(locale: locale)
        .notation(.compactName)
        .grouping(grouping)
        .precision(precision)
        .sign(strategy: sign)
      return { style.format($0) }
    }
    if let affixes = currencyAffixes {
      // The sign is the currency pattern's (its prefixes carry signDisplay's plus).
      let number = FloatingPointFormatStyle<Double>(locale: locale)
        .notation(.compactName)
        .grouping(grouping)
        .precision(precision)
        .sign(strategy: .never)
      return { value in
        let negative = value < 0 || (value == 0 && value.sign == .minus)
        let body = number.format(value)
        return negative
          ? affixes.negativePrefix + body + affixes.negativeSuffix
          : affixes.positivePrefix + body + affixes.positiveSuffix
      }
    }
    let style = FloatingPointFormatStyle<Double>(locale: locale)
      .notation(.compactName)
      .grouping(grouping)
      .precision(precision)
      .sign(strategy: sign)
    return { style.format($0) }
  }

  func format(value: Double) throws -> String {
    if let measure { return measure(value) }
    if let compact { return compact(value) }
    return formatter.string(from: NSNumber(value: value)) ?? ""
  }

  func formatDecimal(value: String) throws -> String {
    if value.hasSuffix("Infinity") || value == "NaN" {
      return try format(value: value == "NaN" ? .nan : value.hasPrefix("-") ? -.infinity : .infinity)
    }
    if compact != nil || measure != nil { return try format(value: Double(value) ?? .nan) }
    let number = NSDecimalNumber(string: value, locale: Locale(identifier: "en_US_POSIX"))
    return formatter.string(from: number) ?? ""
  }

  /// ECMA-402's sanctioned units as Foundation units.
  private static func dimension(_ unit: String) -> Dimension? {
    switch unit {
    case "acre": return UnitArea.acres
    case "hectare": return UnitArea.hectares
    case "bit": return UnitInformationStorage.bits
    case "byte": return UnitInformationStorage.bytes
    case "kilobit": return UnitInformationStorage.kilobits
    case "kilobyte": return UnitInformationStorage.kilobytes
    case "megabit": return UnitInformationStorage.megabits
    case "megabyte": return UnitInformationStorage.megabytes
    case "gigabit": return UnitInformationStorage.gigabits
    case "gigabyte": return UnitInformationStorage.gigabytes
    case "terabit": return UnitInformationStorage.terabits
    case "terabyte": return UnitInformationStorage.terabytes
    case "petabyte": return UnitInformationStorage.petabytes
    case "celsius": return UnitTemperature.celsius
    case "fahrenheit": return UnitTemperature.fahrenheit
    case "centimeter": return UnitLength.centimeters
    case "foot": return UnitLength.feet
    case "inch": return UnitLength.inches
    case "kilometer": return UnitLength.kilometers
    case "meter": return UnitLength.meters
    case "mile": return UnitLength.miles
    case "mile-scandinavian": return UnitLength.scandinavianMiles
    case "millimeter": return UnitLength.millimeters
    case "yard": return UnitLength.yards
    case "degree": return UnitAngle.degrees
    case "fluid-ounce": return UnitVolume.fluidOunces
    case "gallon": return UnitVolume.gallons
    case "liter": return UnitVolume.liters
    case "milliliter": return UnitVolume.milliliters
    case "gram": return UnitMass.grams
    case "kilogram": return UnitMass.kilograms
    case "ounce": return UnitMass.ounces
    case "pound": return UnitMass.pounds
    case "stone": return UnitMass.stones
    case "hour": return UnitDuration.hours
    case "minute": return UnitDuration.minutes
    case "second": return UnitDuration.seconds
    case "millisecond": return UnitDuration.milliseconds
    case "microsecond": return UnitDuration.microseconds
    case "nanosecond": return UnitDuration.nanoseconds
    case "kilometer-per-hour": return UnitSpeed.kilometersPerHour
    case "meter-per-second": return UnitSpeed.metersPerSecond
    case "mile-per-hour": return UnitSpeed.milesPerHour
    case "mile-per-gallon": return UnitFuelEfficiency.milesPerGallon
    case "liter-per-kilometer": return nil
    default: return nil
    }
  }

  /// A unit formatter: Foundation's for the units it has; days to years and
  /// other compound units through DateComponentsFormatter or "x/y".
  private static func unitFormatter(_ unit: String, display: NumberFormatUnitDisplay, locale: Locale, number: NumberFormatter) throws -> (Double) -> String {
    if unit == "percent" {
      let percent = number.copy() as! NumberFormatter
      percent.numberStyle = .percent
      percent.multiplier = 1
      percent.minimumFractionDigits = number.minimumFractionDigits
      percent.maximumFractionDigits = number.maximumFractionDigits
      return { percent.string(from: NSNumber(value: $0)) ?? "" }
    }
    let formatter = MeasurementFormatter()
    formatter.locale = locale
    formatter.unitOptions = .providedUnit
    formatter.numberFormatter = number
    formatter.unitStyle = display == .long ? .long : display == .narrow ? .short : .medium
    if let dimension = dimension(unit) {
      return { (value: Double) -> String in
        let measurement: Measurement<Dimension> = Measurement(value: value, unit: dimension)
        return formatter.string(from: measurement)
      }
    }
    let durations: [String: NSCalendar.Unit] = ["day": .day, "week": .weekOfMonth, "month": .month, "year": .year]
    if let calendarUnit = durations[unit] {
      let components = DateComponentsFormatter()
      components.allowedUnits = [calendarUnit]
      components.unitsStyle = display == .long ? .full : display == .narrow ? .abbreviated : .short
      var calendar = Calendar(identifier: .gregorian)
      calendar.locale = locale
      components.calendar = calendar
      return { value in
        var parts = DateComponents()
        let whole = Int(value.rounded(.towardZero))
        switch calendarUnit {
        case .day: parts.day = whole
        case .weekOfMonth: parts.weekOfMonth = whole
        case .month: parts.month = whole
        default: parts.year = whole
        }
        return value == value.rounded(.towardZero) ? (components.string(from: parts) ?? "") : "\(number.string(from: NSNumber(value: value)) ?? "") \(unit)"
      }
    }
    if let per = unit.range(of: "-per-") {
      let first = String(unit[..<per.lowerBound])
      let second = String(unit[per.upperBound...])
      // "x-per-y" as "x/y", with Foundation's symbol for y where it has one.
      let head = try unitFormatter(first, display: display, locale: locale, number: number)
      var suffix = second
      if let b = dimension(second) {
        let symbols = MeasurementFormatter()
        symbols.locale = locale
        symbols.unitStyle = .short
        let unitB: Unit = b
        suffix = symbols.string(from: unitB)
      }
      return { (value: Double) -> String in head(value) + "/" + suffix }
    }
    throw RuntimeError.error(withMessage: "NumberFormat: the unit '\(unit)' is not available on iOS.")
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
