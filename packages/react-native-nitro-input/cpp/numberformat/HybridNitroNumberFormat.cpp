//
//  HybridNitroNumberFormat.cpp
//  NitroInput
//

#include "HybridNitroNumberFormat.hpp"

#include "HybridNitroNumberFormatPlatformSpec.hpp"

#include <NitroModules/HybridObjectRegistry.hpp>

#include <algorithm>
#include <cmath>
#include <mutex>
#include <stdexcept>
#include <unordered_map>

namespace margelo::nitro::nitroinput {

using namespace numberformat;

namespace {

Decimal toDecimal(const std::variant<int64_t, double, std::string>& value) {
  if (std::holds_alternative<double>(value)) return Decimal::fromDouble(std::get<double>(value));
  if (std::holds_alternative<int64_t>(value)) return Decimal::fromInt64(std::get<int64_t>(value));
  return Decimal::fromString(std::get<std::string>(value));
}

/// A decimal as a plain numeric string ("-0.00125"), for the platform's decimal formatting.
std::string decimalString(const Decimal& d) {
  if (d.kind == Decimal::Kind::NaN) return "NaN";
  std::string out = d.negative ? "-" : "";
  if (d.kind == Decimal::Kind::Infinity) return out + "Infinity";
  if (d.digits.empty()) return out + "0";
  const int size = static_cast<int>(d.digits.size());
  if (d.point <= 0) {
    out += "0.";
    out.append(static_cast<size_t>(-d.point), '0');
    out += d.digits;
  } else if (d.point >= size) {
    out += d.digits;
    out.append(static_cast<size_t>(d.point - size), '0');
  } else {
    out += d.digits.substr(0, static_cast<size_t>(d.point));
    out += '.';
    out += d.digits.substr(static_cast<size_t>(d.point));
  }
  return out;
}

std::vector<NumberFormatPart> toParts(const std::vector<Part>& parts) {
  std::vector<NumberFormatPart> out;
  out.reserve(parts.size());
  for (const auto& p : parts) out.emplace_back(partTypeName(p.type), p.value);
  return out;
}

[[noreturn]] void rangeError(const std::string& message) { throw std::range_error("RangeError: " + message); }
[[noreturn]] void typeError(const std::string& message) { throw std::invalid_argument("TypeError: " + message); }

/// An integer option within [min, max] (ECMA-402 GetNumberOption).
std::optional<int> numberOption(const std::optional<double>& value, int min, int max, const char* name) {
  if (!value) return std::nullopt;
  const double v = *value;
  if (std::isnan(v) || v < min || v > max) rangeError(std::string(name) + " value is out of range.");
  return static_cast<int>(std::floor(v));
}

bool isAsciiLetter(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }

RoundingMode toCore(NumberFormatRoundingMode mode) {
  switch (mode) {
    case NumberFormatRoundingMode::CEIL:
      return RoundingMode::Ceil;
    case NumberFormatRoundingMode::FLOOR:
      return RoundingMode::Floor;
    case NumberFormatRoundingMode::EXPAND:
      return RoundingMode::Expand;
    case NumberFormatRoundingMode::TRUNC:
      return RoundingMode::Trunc;
    case NumberFormatRoundingMode::HALFCEIL:
      return RoundingMode::HalfCeil;
    case NumberFormatRoundingMode::HALFFLOOR:
      return RoundingMode::HalfFloor;
    case NumberFormatRoundingMode::HALFEXPAND:
      return RoundingMode::HalfExpand;
    case NumberFormatRoundingMode::HALFTRUNC:
      return RoundingMode::HalfTrunc;
    case NumberFormatRoundingMode::HALFEVEN:
      return RoundingMode::HalfEven;
  }
  return RoundingMode::HalfExpand;
}

SignDisplay toCore(NumberFormatSignDisplay sign) {
  switch (sign) {
    case NumberFormatSignDisplay::AUTO:
      return SignDisplay::Auto;
    case NumberFormatSignDisplay::NEVER:
      return SignDisplay::Never;
    case NumberFormatSignDisplay::ALWAYS:
      return SignDisplay::Always;
    case NumberFormatSignDisplay::EXCEPTZERO:
      return SignDisplay::ExceptZero;
    case NumberFormatSignDisplay::NEGATIVE:
      return SignDisplay::Negative;
  }
  return SignDisplay::Auto;
}

// MARK: - The platform, and what was learned from it

std::mutex gMutex;
std::shared_ptr<HybridNitroNumberFormatPlatformSpec> gPlatform;
struct Learned {
  LocaleFormat format;
  ProbeSymbols symbols;
  std::string locale;
  std::string numberingSystem;
};
// By locales, numbering system, style and currency display: what the probes depend on.
std::unordered_map<std::string, Learned> gLearned;
// By locales and numbering system.
std::unordered_map<std::string, std::array<std::string, 10>> gDigits;
// Every formatter handed out, by locales and all resolved options: they are immutable.
std::unordered_map<std::string, std::shared_ptr<HybridNitroNumberFormat>> gFormatters;
constexpr size_t kMaxFormatters = 512;

std::shared_ptr<HybridNitroNumberFormatPlatformSpec> platform() {
  if (!gPlatform) {
    auto object = HybridObjectRegistry::createHybridObject("NitroNumberFormatPlatform");
    gPlatform = std::dynamic_pointer_cast<HybridNitroNumberFormatPlatformSpec>(object);
    if (!gPlatform) throw std::runtime_error("NitroNumberFormatPlatform is not registered");
  }
  return gPlatform;
}

NumberFormatPlatformOptions platformOptions(const std::vector<std::string>& locales, const std::optional<std::string>& numberingSystem) {
  NumberFormatPlatformOptions o;
  o.locales = locales;
  o.numberingSystem = numberingSystem;
  o.style = NumberFormatStyle::DECIMAL;
  o.currencyDisplay = NumberFormatCurrencyDisplay::SYMBOL;
  o.currencySign = NumberFormatCurrencySign::STANDARD;
  o.unitDisplay = NumberFormatUnitDisplay::SHORT;
  o.notation = NumberFormatNotation::STANDARD;
  o.compactDisplay = NumberFormatCompactDisplay::SHORT;
  o.useGrouping = true;
  o.minimumIntegerDigits = 1;
  o.minimumFractionDigits = 0;
  o.maximumFractionDigits = 3;
  o.minimumSignificantDigits = 0;
  o.maximumSignificantDigits = 0;
  o.roundingMode = NumberFormatRoundingMode::HALFEXPAND;
  o.signDisplay = NumberFormatSignDisplay::AUTO;
  return o;
}

std::string join(const std::vector<std::string>& locales) {
  std::string out;
  for (const auto& l : locales) out += l + ",";
  return out;
}

} // namespace

// MARK: - The formatter

HybridNitroNumberFormat::HybridNitroNumberFormat(ResolvedNumberFormatOptions resolved, NumberFormatCore core)
    : HybridObject(TAG), resolved_(std::move(resolved)), core_(std::move(core)) {}

HybridNitroNumberFormat::HybridNitroNumberFormat(ResolvedNumberFormatOptions resolved, std::shared_ptr<HybridNitroPlatformNumberFormatterSpec> platform,
                                                 LocaleFormat format, ProbeSymbols symbols, TextKind words, bool scientific)
    : HybridObject(TAG), resolved_(std::move(resolved)), platform_(std::move(platform)), platformFormat_(std::move(format)),
      platformSymbols_(std::move(symbols)), words_(words), scientific_(scientific) {}

std::string HybridNitroNumberFormat::formatWithPlatform(const std::variant<int64_t, double, std::string>& value) {
  if (std::holds_alternative<double>(value)) return platform_->format(std::get<double>(value));
  return platform_->formatDecimal(decimalString(toDecimal(value)));
}

std::string HybridNitroNumberFormat::format(const std::variant<int64_t, double, std::string>& value) {
  if (core_) return core_->format(toDecimal(value));
  return formatWithPlatform(value);
}

std::vector<NumberFormatPart> HybridNitroNumberFormat::formatToParts(const std::variant<int64_t, double, std::string>& value) {
  if (core_) return toParts(core_->formatToParts(toDecimal(value)));
  return toParts(partsOfFormatted(formatWithPlatform(value), platformFormat_, platformSymbols_, words_, scientific_));
}

// MARK: - The factory

std::shared_ptr<HybridNitroNumberFormatSpec> HybridNitroNumberFormatFactory::create(const std::vector<std::string>& locales,
                                                                                    const NumberFormatOptions& options) {
  // ECMA-402 InitializeNumberFormat, in its order.
  if (options.numberingSystem) {
    for (char c : *options.numberingSystem) {
      if (!isAsciiLetter(c) && !(c >= '0' && c <= '9')) rangeError("Invalid numberingSystem: " + *options.numberingSystem);
    }
  }
  const NumberFormatStyle style = options.style.value_or(NumberFormatStyle::DECIMAL);
  std::optional<std::string> currency;
  if (options.currency) {
    const std::string& c = *options.currency;
    if (c.size() != 3 || !isAsciiLetter(c[0]) || !isAsciiLetter(c[1]) || !isAsciiLetter(c[2])) rangeError("Invalid currency code: " + c);
    std::string upper = c;
    for (char& ch : upper) ch = static_cast<char>(ch >= 'a' && ch <= 'z' ? ch - 32 : ch);
    currency = upper;
  }
  const auto currencyDisplay = options.currencyDisplay.value_or(NumberFormatCurrencyDisplay::SYMBOL);
  const auto currencySign = options.currencySign.value_or(NumberFormatCurrencySign::STANDARD);
  if (style == NumberFormatStyle::CURRENCY && !currency) typeError("Currency code is required with currency style.");
  if (style == NumberFormatStyle::UNIT && !options.unit) typeError("Unit is required with unit style.");
  const auto unitDisplay = options.unitDisplay.value_or(NumberFormatUnitDisplay::SHORT);
  const auto notation = options.notation.value_or(NumberFormatNotation::STANDARD);

  // SetNumberFormatDigitOptions.
  int mnfdDefault = 0;
  int mxfdDefault = 3;
  if (style == NumberFormatStyle::CURRENCY && notation == NumberFormatNotation::STANDARD) {
    mnfdDefault = mxfdDefault = currencyDigits(*currency);
  } else if (style == NumberFormatStyle::PERCENT) {
    mxfdDefault = 0;
  }
  const int minimumIntegerDigits = numberOption(options.minimumIntegerDigits, 1, 21, "minimumIntegerDigits").value_or(1);
  const auto roundingIncrementOption = numberOption(options.roundingIncrement, 1, 5000, "roundingIncrement");
  const int roundingIncrement = roundingIncrementOption.value_or(1);
  static constexpr int kIncrements[] = {1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000};
  if (std::find(std::begin(kIncrements), std::end(kIncrements), roundingIncrement) == std::end(kIncrements)) {
    rangeError("roundingIncrement value is out of range.");
  }
  const auto roundingMode = options.roundingMode.value_or(NumberFormatRoundingMode::HALFEXPAND);
  const auto roundingPriority = options.roundingPriority.value_or(NumberFormatRoundingPriority::AUTO);
  const auto trailingZeroDisplay = options.trailingZeroDisplay.value_or(NumberFormatTrailingZeroDisplay::AUTO);
  if (roundingIncrement != 1) mxfdDefault = mnfdDefault;

  const bool hasSd = options.minimumSignificantDigits.has_value() || options.maximumSignificantDigits.has_value();
  const bool hasFd = options.minimumFractionDigits.has_value() || options.maximumFractionDigits.has_value();
  bool needSd = true;
  bool needFd = true;
  if (roundingPriority == NumberFormatRoundingPriority::AUTO) {
    needSd = hasSd;
    if (needSd || (!hasFd && notation == NumberFormatNotation::COMPACT)) needFd = false;
  }
  Rounding rounding;
  rounding.minimumIntegerDigits = minimumIntegerDigits;
  rounding.increment = roundingIncrement;
  rounding.mode = toCore(roundingMode);
  rounding.trailingZeroDisplay = trailingZeroDisplay == NumberFormatTrailingZeroDisplay::STRIPIFINTEGER ? TrailingZeroDisplay::StripIfInteger
                                                                                                        : TrailingZeroDisplay::Auto;
  if (needSd) {
    if (hasSd) {
      rounding.minimumSignificantDigits = numberOption(options.minimumSignificantDigits, 1, 21, "minimumSignificantDigits").value_or(1);
      rounding.maximumSignificantDigits =
          numberOption(options.maximumSignificantDigits, rounding.minimumSignificantDigits, 21, "maximumSignificantDigits").value_or(21);
    } else {
      rounding.minimumSignificantDigits = 1;
      rounding.maximumSignificantDigits = 21;
    }
  }
  if (needFd) {
    if (hasFd) {
      auto mnfd = numberOption(options.minimumFractionDigits, 0, 100, "minimumFractionDigits");
      auto mxfd = numberOption(options.maximumFractionDigits, 0, 100, "maximumFractionDigits");
      if (!mnfd) {
        mnfd = std::min(mnfdDefault, *mxfd);
      } else if (!mxfd) {
        mxfd = std::max(mxfdDefault, *mnfd);
      } else if (*mnfd > *mxfd) {
        rangeError("maximumFractionDigits value is out of range.");
      }
      rounding.minimumFractionDigits = *mnfd;
      rounding.maximumFractionDigits = *mxfd;
    } else {
      rounding.minimumFractionDigits = mnfdDefault;
      rounding.maximumFractionDigits = mxfdDefault;
    }
  }
  NumberFormatRoundingPriority resolvedPriority = roundingPriority;
  if (!needSd && !needFd) {
    // Compact notation's own rounding: two significant digits, or whole numbers above 100.
    rounding.minimumFractionDigits = 0;
    rounding.maximumFractionDigits = 0;
    rounding.minimumSignificantDigits = 1;
    rounding.maximumSignificantDigits = 2;
    rounding.useFraction = rounding.useSignificant = true;
    rounding.priority = RoundingPriority::MorePrecision;
    resolvedPriority = NumberFormatRoundingPriority::MOREPRECISION;
  } else {
    rounding.useSignificant = needSd;
    rounding.useFraction = needFd;
    rounding.priority = roundingPriority == NumberFormatRoundingPriority::MOREPRECISION   ? RoundingPriority::MorePrecision
                        : roundingPriority == NumberFormatRoundingPriority::LESSPRECISION ? RoundingPriority::LessPrecision
                                                                                          : RoundingPriority::Auto;
  }
  if (roundingIncrement != 1) {
    if (!rounding.useFraction || rounding.useSignificant) typeError("roundingIncrement can only be used with fraction digits.");
    if (rounding.maximumFractionDigits != rounding.minimumFractionDigits) {
      rangeError("maximumFractionDigits must equal minimumFractionDigits with a roundingIncrement.");
    }
  }

  const auto compactDisplay = options.compactDisplay.value_or(NumberFormatCompactDisplay::SHORT);
  std::variant<bool, NumberFormatGrouping> useGrouping =
      notation == NumberFormatNotation::COMPACT ? NumberFormatGrouping::MIN2 : NumberFormatGrouping::AUTO;
  if (options.useGrouping) {
    const auto& g = *options.useGrouping;
    if (std::holds_alternative<bool>(g)) useGrouping = std::get<bool>(g) ? std::variant<bool, NumberFormatGrouping>(NumberFormatGrouping::ALWAYS) : false;
    else useGrouping = std::get<NumberFormatGrouping>(g);
  }
  Grouping grouping = Grouping::Off;
  if (std::holds_alternative<NumberFormatGrouping>(useGrouping)) {
    switch (std::get<NumberFormatGrouping>(useGrouping)) {
      case NumberFormatGrouping::ALWAYS:
        grouping = Grouping::Always;
        break;
      case NumberFormatGrouping::AUTO:
        grouping = Grouping::Auto;
        break;
      case NumberFormatGrouping::MIN2:
        grouping = Grouping::Min2;
        break;
    }
  }
  const auto signDisplay = options.signDisplay.value_or(NumberFormatSignDisplay::AUTO);

  // The same request twice returns the same formatter.
  const std::string key = join(locales) + "|" + options.numberingSystem.value_or("") + "|" + std::to_string(static_cast<int>(style)) + "|" +
                          currency.value_or("") + "|" + std::to_string(static_cast<int>(currencyDisplay)) +
                          std::to_string(static_cast<int>(currencySign)) + "|" + options.unit.value_or("") +
                          std::to_string(static_cast<int>(unitDisplay)) + "|" + std::to_string(static_cast<int>(notation)) +
                          std::to_string(static_cast<int>(compactDisplay)) + "|" + std::to_string(minimumIntegerDigits) + "," +
                          std::to_string(rounding.useFraction) + std::to_string(rounding.minimumFractionDigits) + "," +
                          std::to_string(rounding.maximumFractionDigits) + "," + std::to_string(rounding.useSignificant) +
                          std::to_string(rounding.minimumSignificantDigits) + "," + std::to_string(rounding.maximumSignificantDigits) + "," +
                          std::to_string(static_cast<int>(resolvedPriority)) + "," + std::to_string(roundingIncrement) + "," +
                          std::to_string(static_cast<int>(roundingMode)) + std::to_string(static_cast<int>(trailingZeroDisplay)) + "|" +
                          std::to_string(useGrouping.index()) +
                          std::to_string(std::holds_alternative<bool>(useGrouping) ? 0 : static_cast<int>(std::get<NumberFormatGrouping>(useGrouping))) +
                          "|" + std::to_string(static_cast<int>(signDisplay));

  std::lock_guard<std::mutex> lock(gMutex);
  if (auto it = gFormatters.find(key); it != gFormatters.end()) return it->second;
  auto shared = platform();

  // What the probes depend on: locales, numbering system, style and currency display.
  const std::string learnKey = join(locales) + "|" + options.numberingSystem.value_or("") + "|" + std::to_string(static_cast<int>(style)) + "|" +
                               currency.value_or("") + "|" + std::to_string(static_cast<int>(currencyDisplay)) +
                               std::to_string(static_cast<int>(currencySign));
  auto learned = gLearned.find(learnKey);
  if (learned == gLearned.end()) {
    const std::string digitsKey = join(locales) + "|" + options.numberingSystem.value_or("");
    auto digits = gDigits.find(digitsKey);
    if (digits == gDigits.end()) {
      auto o = platformOptions(locales, options.numberingSystem);
      o.useGrouping = false;
      o.maximumFractionDigits = 0;
      const auto formatter = shared->create(o);
      digits = gDigits.emplace(digitsKey, learnDigits(formatter->format(1234567890))).first;
    }
    auto o = platformOptions(locales, options.numberingSystem);
    // Units and names are drawn by the platform; their structure is a plain decimal's.
    o.style = style == NumberFormatStyle::UNIT ? NumberFormatStyle::DECIMAL : style;
    o.currency = currency;
    o.currencyDisplay = currencyDisplay == NumberFormatCurrencyDisplay::NAME ? NumberFormatCurrencyDisplay::CODE : currencyDisplay;
    o.currencySign = currencySign;
    o.minimumFractionDigits = 2;
    o.maximumFractionDigits = 2;
    const auto formatter = shared->create(o);
    const auto s = formatter->getSymbols();
    ProbeSymbols symbols;
    symbols.minusSign = s.minusSign;
    symbols.plusSign = s.plusSign;
    symbols.percentSign = s.percentSign;
    symbols.nan = s.nan;
    symbols.infinity = s.infinity;
    if (style == NumberFormatStyle::CURRENCY) symbols.currency = s.currency;
    const int scale = style == NumberFormatStyle::PERCENT ? 2 : 0;
    Learned l{learnLocaleFormat([&](double v) { return formatter->format(v); }, digits->second, symbols, scale), symbols, s.locale, s.numberingSystem};
    learned = gLearned.emplace(learnKey, std::move(l)).first;
  }

  ResolvedNumberFormatOptions resolved;
  resolved.locale = learned->second.locale;
  resolved.numberingSystem = learned->second.numberingSystem;
  resolved.style = style;
  if (style == NumberFormatStyle::CURRENCY) {
    resolved.currency = currency;
    resolved.currencyDisplay = currencyDisplay;
    resolved.currencySign = currencySign;
  }
  if (style == NumberFormatStyle::UNIT) {
    resolved.unit = options.unit;
    resolved.unitDisplay = unitDisplay;
  }
  resolved.minimumIntegerDigits = minimumIntegerDigits;
  if (rounding.useFraction) {
    resolved.minimumFractionDigits = rounding.minimumFractionDigits;
    resolved.maximumFractionDigits = rounding.maximumFractionDigits;
  }
  if (rounding.useSignificant) {
    resolved.minimumSignificantDigits = rounding.minimumSignificantDigits;
    resolved.maximumSignificantDigits = rounding.maximumSignificantDigits;
  }
  resolved.useGrouping = useGrouping;
  resolved.notation = notation;
  if (notation == NumberFormatNotation::COMPACT) resolved.compactDisplay = compactDisplay;
  resolved.signDisplay = signDisplay;
  resolved.roundingIncrement = roundingIncrement;
  resolved.roundingMode = roundingMode;
  resolved.roundingPriority = resolvedPriority;
  resolved.trailingZeroDisplay = trailingZeroDisplay;

  std::shared_ptr<HybridNitroNumberFormat> result;
  const bool platformDraws = notation != NumberFormatNotation::STANDARD || style == NumberFormatStyle::UNIT ||
                             (style == NumberFormatStyle::CURRENCY && currencyDisplay == NumberFormatCurrencyDisplay::NAME);
  if (!platformDraws) {
    result = std::make_shared<HybridNitroNumberFormat>(std::move(resolved), NumberFormatCore(learned->second.format, rounding, grouping, toCore(signDisplay)));
  } else {
    auto o = platformOptions(locales, options.numberingSystem);
    o.style = style;
    o.currency = currency;
    o.currencyDisplay = currencyDisplay;
    o.currencySign = currencySign;
    o.unit = options.unit;
    o.unitDisplay = unitDisplay;
    o.notation = notation;
    o.compactDisplay = compactDisplay;
    o.useGrouping = grouping != Grouping::Off;
    o.minimumIntegerDigits = minimumIntegerDigits;
    o.minimumFractionDigits = rounding.useFraction ? rounding.minimumFractionDigits : 0;
    o.maximumFractionDigits = rounding.useFraction ? rounding.maximumFractionDigits : 20;
    o.minimumSignificantDigits = rounding.useSignificant ? rounding.minimumSignificantDigits : 0;
    o.maximumSignificantDigits = rounding.useSignificant ? rounding.maximumSignificantDigits : 0;
    o.roundingMode = roundingMode;
    o.signDisplay = signDisplay;
    TextKind words = notation == NumberFormatNotation::COMPACT ? TextKind::Compact
                     : style == NumberFormatStyle::UNIT        ? TextKind::Unit
                     : style == NumberFormatStyle::CURRENCY && currencyDisplay == NumberFormatCurrencyDisplay::NAME ? TextKind::CurrencyName
                                                                                                                     : TextKind::Literal;
    const bool scientific = notation == NumberFormatNotation::SCIENTIFIC || notation == NumberFormatNotation::ENGINEERING;
    result = std::make_shared<HybridNitroNumberFormat>(std::move(resolved), shared->create(o), learned->second.format, learned->second.symbols,
                                                       words, scientific);
  }
  if (gFormatters.size() >= kMaxFormatters) gFormatters.clear();
  gFormatters.emplace(key, result);
  return result;
}

std::vector<std::string> HybridNitroNumberFormatFactory::supportedLocalesOf(const std::vector<std::string>& locales) {
  std::lock_guard<std::mutex> lock(gMutex);
  return platform()->supportedLocalesOf(locales);
}

} // namespace margelo::nitro::nitroinput
