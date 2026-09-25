//
//  NumberFormatCore.hpp
//  NitroInput
//
//  The formatting half of `NumberFormat`: turns a number into text and parts
//  the way ECMA-402's `Intl.NumberFormat` does, from a locale's format that
//  was learned once from the platform formatter (see `NumberFormatProbe`).
//  Everything here is plain C++ with no platform or JSI dependency, so it is
//  exact, thread-safe once built, and unit-tested on the host.
//
//  The number is handled as decimal digits, never as a binary double after
//  parsing: a double is read as its shortest round-trip decimal (what ICU and
//  V8 do), so 1.005 rounds to 1.01 as it does in `Intl`, not 1.00.
//

#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace margelo::nitro::nitroinput::numberformat {

enum class PartType {
  Literal,
  Integer,
  Group,
  Decimal,
  Fraction,
  MinusSign,
  PlusSign,
  PercentSign,
  Currency,
  Nan,
  Infinity,
  Compact,
  Unit,
  ExponentSeparator,
  ExponentMinusSign,
  ExponentInteger,
};

/// The `type` string `formatToParts` reports for a part.
const char* partTypeName(PartType type);

struct Part {
  PartType type;
  std::string value;
};

enum class RoundingMode { Ceil, Floor, Expand, Trunc, HalfCeil, HalfFloor, HalfExpand, HalfTrunc, HalfEven };
enum class RoundingPriority { Auto, MorePrecision, LessPrecision };
enum class SignDisplay { Auto, Never, Always, ExceptZero, Negative };
enum class Grouping { Off, Min2, Auto, Always };
enum class TrailingZeroDisplay { Auto, StripIfInteger };

/// How a number is rounded and padded: the digit options of `Intl.NumberFormat`, resolved.
struct Rounding {
  int minimumIntegerDigits = 1;
  /// Fraction-digit rounding applies (it is off when only significant digits were given).
  bool useFraction = true;
  int minimumFractionDigits = 0;
  int maximumFractionDigits = 3;
  /// Significant-digit rounding applies.
  bool useSignificant = false;
  int minimumSignificantDigits = 1;
  int maximumSignificantDigits = 21;
  /// With both kinds on: which result wins (`roundingPriority`).
  RoundingPriority priority = RoundingPriority::Auto;
  /// 1, 2, 5, 10, 20, 25, 50, 100, … 5000, in units of the last fraction digit.
  int increment = 1;
  RoundingMode mode = RoundingMode::HalfExpand;
  TrailingZeroDisplay trailingZeroDisplay = TrailingZeroDisplay::Auto;
};

/// A locale's format for one style and currency, as learned from the platform.
struct LocaleFormat {
  /// The locale's digits 0…9 (Latin unless the numbering system says otherwise).
  std::array<std::string, 10> digits = {"0", "1", "2", "3", "4", "5", "6", "7", "8", "9"};
  std::string decimalSeparator = ".";
  std::string groupingSeparator = ",";
  int primaryGroupingSize = 3;
  int secondaryGroupingSize = 3;
  /// Digits needed before the first separator for `useGrouping: 'auto'` to group (2 in es, pl, …).
  int minimumGroupingDigits = 1;
  /// The text around the number, already split into parts.
  std::vector<Part> positivePrefix, positiveSuffix;
  std::vector<Part> negativePrefix, negativeSuffix;
  std::vector<Part> plusPrefix, plusSuffix;
  std::string nan = "NaN";
  std::string infinity = "∞";
  /// Powers of ten the value is scaled by before formatting (2 for percent).
  int scale = 0;
};

/// A number as decimal digits: `digits` with the decimal point after `point`
/// of them (`point` may be negative or past the end); no leading or trailing
/// zeros, and empty for zero.
struct Decimal {
  enum class Kind { Finite, NaN, Infinity };
  Kind kind = Kind::Finite;
  bool negative = false;
  std::string digits;
  int point = 0;

  bool isZero() const { return kind == Kind::Finite && digits.empty(); }

  static Decimal fromDouble(double value);
  /// A numeric string as `Intl` reads one: decimal with an optional exponent,
  /// `Infinity`, or a 0x / 0o / 0b integer; anything else is NaN.
  static Decimal fromString(std::string_view text);
  static Decimal fromInt64(int64_t value);
};

class NumberFormatCore final {
public:
  NumberFormatCore() = default;
  NumberFormatCore(LocaleFormat format, Rounding rounding, Grouping grouping, SignDisplay signDisplay);

  std::vector<Part> formatToParts(const Decimal& value) const;
  std::string format(const Decimal& value) const;

  const LocaleFormat& localeFormat() const { return format_; }
  const Rounding& rounding() const { return rounding_; }

  /// Splits `text` (a prefix or suffix) into currency, sign, percent and literal parts.
  static std::vector<Part> splitAffix(std::string_view text, std::string_view currency, std::string_view minus, std::string_view plus,
                                      std::string_view percent);

private:
  LocaleFormat format_;
  Rounding rounding_;
  Grouping grouping_ = Grouping::Auto;
  SignDisplay signDisplay_ = SignDisplay::Auto;
};

/// Rounds `value` as `rounding` asks; the result's `point` and `digits` give the kept digits.
/// Exposed for tests. `fractionDigits` receives how many fraction digits to show (with padding).
Decimal roundDecimal(const Decimal& value, const Rounding& rounding, int& fractionDigits);

/// ISO 4217 minor-unit digits, as ECMA-402's CurrencyDigits: 2 unless listed.
int currencyDigits(std::string_view currencyCode);

} // namespace margelo::nitro::nitroinput::numberformat
