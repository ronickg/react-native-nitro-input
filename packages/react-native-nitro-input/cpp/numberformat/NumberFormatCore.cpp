//
//  NumberFormatCore.cpp
//  NitroInput
//

#include "NumberFormatCore.hpp"

#include <algorithm>
#include <cerrno>
#include <charconv>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <utility>

namespace margelo::nitro::nitroinput::numberformat {

const char* partTypeName(PartType type) {
  switch (type) {
    case PartType::Literal:
      return "literal";
    case PartType::Integer:
      return "integer";
    case PartType::Group:
      return "group";
    case PartType::Decimal:
      return "decimal";
    case PartType::Fraction:
      return "fraction";
    case PartType::MinusSign:
      return "minusSign";
    case PartType::PlusSign:
      return "plusSign";
    case PartType::PercentSign:
      return "percentSign";
    case PartType::Currency:
      return "currency";
    case PartType::Nan:
      return "nan";
    case PartType::Infinity:
      return "infinity";
    case PartType::Compact:
      return "compact";
    case PartType::Unit:
      return "unit";
    case PartType::ExponentSeparator:
      return "exponentSeparator";
    case PartType::ExponentMinusSign:
      return "exponentMinusSign";
    case PartType::ExponentInteger:
      return "exponentInteger";
  }
  return "literal";
}

// MARK: - Decimal

namespace {

/// Drops leading and trailing zeros; `point` follows the leading ones.
void normalize(Decimal& d) {
  size_t lead = 0;
  while (lead < d.digits.size() && d.digits[lead] == '0') lead++;
  if (lead > 0) {
    d.digits.erase(0, lead);
    d.point -= static_cast<int>(lead);
  }
  while (!d.digits.empty() && d.digits.back() == '0') d.digits.pop_back();
  if (d.digits.empty()) d.point = 0;
}

/// Reads "d.ddde±x" (the decimal point may be ',' under a C locale that says so).
Decimal fromScientific(const char* begin, const char* end, bool negative) {
  Decimal d;
  d.negative = negative;
  int exponent = 0;
  const char* p = begin;
  int integerDigits = 0;
  bool afterPoint = false;
  for (; p < end && *p != 'e' && *p != 'E'; p++) {
    if (*p >= '0' && *p <= '9') {
      d.digits.push_back(*p);
      if (!afterPoint) integerDigits++;
    } else if (*p == '.' || *p == ',') {
      afterPoint = true;
    }
  }
  if (p < end) exponent = std::atoi(std::string(p + 1, end).c_str());
  d.point = integerDigits + exponent;
  normalize(d);
  return d;
}

} // namespace

Decimal Decimal::fromDouble(double value) {
  Decimal d;
  if (std::isnan(value)) {
    d.kind = Kind::NaN;
    return d;
  }
  d.negative = std::signbit(value);
  if (std::isinf(value)) {
    d.kind = Kind::Infinity;
    return d;
  }
  const double magnitude = std::fabs(value);
  if (magnitude == 0) return d;

  // The common case, amounts: the fewest fraction digits k for which the
  // nearest integer r to value·10^k gives back the same double as r / 10^k.
  // r and 10^k are exact below 2^53, so the division is the correctly rounded
  // value of the decimal r·10^-k: the test is exact, and the first k that
  // passes is the shortest round-trip form, as to_chars would print it.
  static constexpr double kPow10[] = {1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15};
  constexpr double kExact = 9007199254740992.0; // 2^53
  for (int k = 0; k < 16; k++) {
    const double scaled = magnitude * kPow10[k];
    if (scaled >= kExact) break;
    const double r = std::nearbyint(scaled);
    if (r / kPow10[k] == magnitude) {
      d.digits = std::to_string(static_cast<uint64_t>(r));
      d.point = static_cast<int>(d.digits.size()) - k;
      normalize(d);
      return d;
    }
  }

  char buffer[64];
#if !defined(__APPLE__)
  {
    const auto result = std::to_chars(buffer, buffer + sizeof(buffer), magnitude, std::chars_format::scientific);
    if (result.ec == std::errc()) return fromScientific(buffer, result.ptr, d.negative);
  }
#endif
  // The shortest of 15, 16 or 17 significant digits that reads back as the same double.
  for (int precision = 14; precision <= 16; precision++) {
    const int length = std::snprintf(buffer, sizeof(buffer), "%.*e", precision, magnitude);
    if (length <= 0) continue;
    if (precision == 16 || std::strtod(buffer, nullptr) == magnitude) return fromScientific(buffer, buffer + length, d.negative);
  }
  return d;
}

Decimal Decimal::fromInt64(int64_t value) {
  Decimal d;
  d.negative = value < 0;
  // Through unsigned so INT64_MIN has a magnitude.
  uint64_t magnitude = value < 0 ? 0 - static_cast<uint64_t>(value) : static_cast<uint64_t>(value);
  d.digits = std::to_string(magnitude);
  d.point = static_cast<int>(d.digits.size());
  normalize(d);
  return d;
}

Decimal Decimal::fromString(std::string_view text) {
  Decimal nan;
  nan.kind = Kind::NaN;
  // StringToNumber trims white space and line terminators.
  auto isSpace = [](char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f'; };
  while (!text.empty() && isSpace(text.front())) text.remove_prefix(1);
  while (!text.empty() && isSpace(text.back())) text.remove_suffix(1);
  Decimal d;
  if (text.empty()) return d; // "" is 0
  // 0x / 0o / 0b integers take no sign.
  if (text.size() > 2 && text[0] == '0') {
    int base = 0;
    if (text[1] == 'x' || text[1] == 'X') base = 16;
    else if (text[1] == 'o' || text[1] == 'O') base = 8;
    else if (text[1] == 'b' || text[1] == 'B') base = 2;
    if (base != 0) {
      // Accumulate in decimal digits so any length works.
      std::string decimal = "0";
      for (char c : text.substr(2)) {
        int v = -1;
        if (c >= '0' && c <= '9') v = c - '0';
        else if (c >= 'a' && c <= 'f') v = c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') v = c - 'A' + 10;
        if (v < 0 || v >= base) return nan;
        int carry = v;
        for (auto it = decimal.rbegin(); it != decimal.rend(); ++it) {
          int x = (*it - '0') * base + carry;
          *it = static_cast<char>('0' + x % 10);
          carry = x / 10;
        }
        while (carry > 0) {
          decimal.insert(decimal.begin(), static_cast<char>('0' + carry % 10));
          carry /= 10;
        }
      }
      d.digits = decimal;
      d.point = static_cast<int>(decimal.size());
      normalize(d);
      return d;
    }
  }
  size_t i = 0;
  if (text[i] == '+' || text[i] == '-') {
    d.negative = text[i] == '-';
    i++;
  }
  if (text.substr(i) == "Infinity") {
    d.kind = Kind::Infinity;
    return d;
  }
  bool anyDigit = false;
  bool afterPoint = false;
  int integerDigits = 0;
  for (; i < text.size(); i++) {
    const char c = text[i];
    if (c >= '0' && c <= '9') {
      d.digits.push_back(c);
      if (!afterPoint) integerDigits++;
      anyDigit = true;
    } else if (c == '.' && !afterPoint) {
      afterPoint = true;
    } else {
      break;
    }
  }
  if (!anyDigit) return nan;
  long exponent = 0;
  if (i < text.size()) {
    if (text[i] != 'e' && text[i] != 'E') return nan;
    i++;
    bool negativeExponent = false;
    if (i < text.size() && (text[i] == '+' || text[i] == '-')) {
      negativeExponent = text[i] == '-';
      i++;
    }
    if (i >= text.size()) return nan;
    for (; i < text.size(); i++) {
      if (text[i] < '0' || text[i] > '9') return nan;
      if (exponent < 100000) exponent = exponent * 10 + (text[i] - '0');
    }
    if (negativeExponent) exponent = -exponent;
  }
  d.point = integerDigits + static_cast<int>(exponent);
  normalize(d);
  return d;
}

// MARK: - Rounding

namespace {

/// Whether the digits dropped past `keep` are below, exactly at, or above half a unit.
enum class Remainder { Zero, BelowHalf, Half, AboveHalf };

Remainder remainderAfter(const std::string& digits, int keep) {
  if (keep >= static_cast<int>(digits.size())) return Remainder::Zero;
  if (keep < 0) return Remainder::BelowHalf; // the first dropped digit is a leading zero
  const char first = digits[static_cast<size_t>(keep)];
  // Trailing zeros are stripped, so anything after the first dropped digit is non-zero.
  const bool more = keep + 1 < static_cast<int>(digits.size());
  if (first > '5') return Remainder::AboveHalf;
  if (first == '5') return more ? Remainder::AboveHalf : Remainder::Half;
  return first == '0' && !more ? Remainder::Zero : Remainder::BelowHalf;
}

bool roundsAway(RoundingMode mode, bool negative, Remainder remainder, bool lastOdd) {
  if (remainder == Remainder::Zero) return false;
  switch (mode) {
    case RoundingMode::Ceil:
      return !negative;
    case RoundingMode::Floor:
      return negative;
    case RoundingMode::Expand:
      return true;
    case RoundingMode::Trunc:
      return false;
    default:
      break;
  }
  if (remainder == Remainder::AboveHalf) return true;
  if (remainder == Remainder::BelowHalf) return false;
  switch (mode) {
    case RoundingMode::HalfCeil:
      return !negative;
    case RoundingMode::HalfFloor:
      return negative;
    case RoundingMode::HalfExpand:
      return true;
    case RoundingMode::HalfTrunc:
      return false;
    case RoundingMode::HalfEven:
      return lastOdd;
    default:
      return true;
  }
}

/// Keeps the digits worth at least 10^magnitude and rounds the rest away,
/// in steps of `increment` units of 10^magnitude.
Decimal roundAt(const Decimal& value, int magnitude, RoundingMode mode, int increment) {
  Decimal out = value;
  const int keep = value.point - magnitude; // digits kept, counted from the first
  if (keep >= static_cast<int>(value.digits.size()) && increment == 1) return out;

  // The kept part as an integer K (units of 10^magnitude) and the dropped part.
  std::string kept = keep > 0 ? value.digits.substr(0, static_cast<size_t>(std::min<int>(keep, static_cast<int>(value.digits.size())))) : "";
  if (keep > static_cast<int>(value.digits.size())) kept.append(static_cast<size_t>(keep) - value.digits.size(), '0');
  const Remainder dropped = remainderAfter(value.digits, keep);

  // The last five digits of K decide everything an increment (a divisor of 10000) needs.
  const size_t tailLength = std::min<size_t>(kept.size(), 5);
  int64_t tail = 0;
  for (size_t i = kept.size() - tailLength; i < kept.size(); i++) tail = tail * 10 + (kept[i] - '0');

  const int64_t rem = tail % increment; // K mod increment
  int64_t lower = tail - rem;           // the multiple of increment at or below K (tail part)
  bool up;
  if (increment == 1) {
    up = roundsAway(mode, value.negative, dropped, (tail % 2) != 0);
  } else {
    // Where K + dropped sits between lower and lower + increment.
    Remainder position;
    if (rem == 0 && dropped == Remainder::Zero) {
      position = Remainder::Zero;
    } else {
      // Compare 2 × (rem + dropped) with increment.
      const int64_t t = 2 * rem - increment;
      if (t > 0) position = Remainder::AboveHalf;
      else if (t == 0) position = dropped == Remainder::Zero ? Remainder::Half : Remainder::AboveHalf;
      else if (t == -1) position = dropped == Remainder::Zero ? Remainder::BelowHalf : dropped;
      else position = Remainder::BelowHalf;
    }
    up = roundsAway(mode, value.negative, position, ((lower / increment) % 2) != 0);
  }
  int64_t newTail = up ? lower + increment : lower;

  // Write the new tail back, carrying into the digits before it.
  std::string head = kept.substr(0, kept.size() - tailLength);
  if (head.empty()) {
    out.digits = std::to_string(newTail);
    out.point = magnitude + static_cast<int>(out.digits.size());
    normalize(out);
    return out;
  }
  std::string tailText = std::to_string(newTail);
  if (tailText.size() < tailLength) tailText.insert(0, tailLength - tailText.size(), '0');
  if (tailText.size() > tailLength) {
    // A carry out of the tail: add 1 to the head.
    tailText.erase(0, 1);
    int i = static_cast<int>(head.size()) - 1;
    while (i >= 0 && head[static_cast<size_t>(i)] == '9') head[static_cast<size_t>(i--)] = '0';
    if (i >= 0) head[static_cast<size_t>(i)]++;
    else head.insert(head.begin(), '1');
  }
  out.digits = head + tailText;
  out.point = magnitude + static_cast<int>(out.digits.size());
  normalize(out);
  return out;
}

/// The power of ten of the leading digit (0 for zero).
int magnitudeOf(const Decimal& d) { return d.digits.empty() ? 0 : d.point - 1; }

struct Rounded {
  Decimal value;
  int minimumFraction;
  int roundingMagnitude;
};

Rounded roundFraction(const Decimal& value, const Rounding& r) {
  Decimal out = roundAt(value, -r.maximumFractionDigits, r.mode, r.increment);
  return {out, r.minimumFractionDigits, -r.maximumFractionDigits};
}

Rounded roundSignificant(const Decimal& value, const Rounding& r) {
  const int mag = magnitudeOf(value);
  Decimal out = roundAt(value, mag - r.maximumSignificantDigits + 1, r.mode, 1);
  // Rounding up can add a digit in front (9.99 → 10.0): keep the same number of significant digits.
  const int outMag = magnitudeOf(out);
  const int minimumFraction = std::max(0, r.minimumSignificantDigits - outMag - 1);
  return {out, minimumFraction, mag - r.maximumSignificantDigits + 1};
}

} // namespace

Decimal roundDecimal(const Decimal& value, const Rounding& r, int& fractionDigits) {
  Rounded result;
  if (r.useSignificant && (!r.useFraction || r.priority == RoundingPriority::Auto)) {
    result = roundSignificant(value, r);
  } else if (!r.useSignificant) {
    result = roundFraction(value, r);
  } else {
    const Rounded s = roundSignificant(value, r);
    const Rounded f = roundFraction(value, r);
    const bool pickSignificant = r.priority == RoundingPriority::MorePrecision ? s.roundingMagnitude <= f.roundingMagnitude
                                                                               : s.roundingMagnitude > f.roundingMagnitude;
    result = pickSignificant ? s : f;
  }
  const int shown = std::max(0, static_cast<int>(result.value.digits.size()) - result.value.point);
  fractionDigits = std::max(shown, result.minimumFraction);
  if (r.trailingZeroDisplay == TrailingZeroDisplay::StripIfInteger && shown == 0) fractionDigits = 0;
  return result.value;
}

int currencyDigits(std::string_view code) {
  struct Entry {
    const char* code;
    int digits;
  };
  // ISO 4217 currencies whose minor unit is not 2.
  static constexpr Entry kDigits[] = {
      {"BHD", 3}, {"BIF", 0}, {"CLF", 4}, {"CLP", 0}, {"DJF", 0}, {"GNF", 0}, {"IQD", 3}, {"ISK", 0}, {"JOD", 3},
      {"JPY", 0}, {"KMF", 0}, {"KRW", 0}, {"KWD", 3}, {"LYD", 3}, {"OMR", 3}, {"PYG", 0}, {"RWF", 0}, {"TND", 3},
      {"UGX", 0}, {"UYI", 0}, {"UYW", 4}, {"VND", 0}, {"VUV", 0}, {"XAF", 0}, {"XOF", 0}, {"XPF", 0},
  };
  if (code.size() != 3) return 2;
  char upper[3];
  for (size_t i = 0; i < 3; i++) upper[i] = static_cast<char>(code[i] >= 'a' && code[i] <= 'z' ? code[i] - 32 : code[i]);
  for (const auto& e : kDigits) {
    if (std::string_view(e.code, 3) == std::string_view(upper, 3)) return e.digits;
  }
  return 2;
}

// MARK: - Formatting

NumberFormatCore::NumberFormatCore(LocaleFormat format, Rounding rounding, Grouping grouping, SignDisplay signDisplay)
    : format_(std::move(format)), rounding_(rounding), grouping_(grouping), signDisplay_(signDisplay) {}

namespace {

/// A symbol without the direction marks around it: ICU's minus sign in ar is
/// ALM + "-", and `formatToParts` reports the mark as a literal of its own.
std::string_view trimBidi(std::string_view symbol) {
  static constexpr std::string_view kMarks[] = {"‎", "‏", "؜", "‪", "‫", "‬",
                                                "‭", "‮", "⁦", "⁧", "⁨", "⁩"};
  bool trimmed = true;
  while (trimmed && !symbol.empty()) {
    trimmed = false;
    for (auto mark : kMarks) {
      if (symbol.size() > mark.size() && symbol.substr(0, mark.size()) == mark) {
        symbol.remove_prefix(mark.size());
        trimmed = true;
      }
      if (symbol.size() > mark.size() && symbol.substr(symbol.size() - mark.size()) == mark) {
        symbol.remove_suffix(mark.size());
        trimmed = true;
      }
    }
  }
  return symbol;
}

} // namespace

std::vector<Part> NumberFormatCore::splitAffix(std::string_view text, std::string_view currencySymbol, std::string_view minusSign,
                                               std::string_view plusSign, std::string_view percentSign) {
  const std::string_view currency = trimBidi(currencySymbol);
  const std::string_view minus = trimBidi(minusSign);
  const std::string_view plus = trimBidi(plusSign);
  const std::string_view percent = trimBidi(percentSign);
  std::vector<Part> parts;
  std::string literal;
  auto flush = [&] {
    if (!literal.empty()) parts.push_back({PartType::Literal, std::move(literal)});
    literal.clear();
  };
  size_t i = 0;
  while (i < text.size()) {
    // The longest symbol first, so "US$" is not split around a "$" minus look-alike.
    struct Candidate {
      std::string_view symbol;
      PartType type;
    };
    const Candidate candidates[] = {{currency, PartType::Currency}, {minus, PartType::MinusSign}, {plus, PartType::PlusSign}, {percent, PartType::PercentSign}};
    const Candidate* best = nullptr;
    for (const auto& c : candidates) {
      if (!c.symbol.empty() && text.substr(i, c.symbol.size()) == c.symbol && (!best || c.symbol.size() > best->symbol.size())) best = &c;
    }
    if (best) {
      flush();
      parts.push_back({best->type, std::string(best->symbol)});
      i += best->symbol.size();
    } else {
      literal.push_back(text[i++]);
    }
  }
  flush();
  return parts;
}

std::vector<Part> NumberFormatCore::formatToParts(const Decimal& input) const {
  Decimal value = input;
  if (value.kind == Decimal::Kind::Finite && !value.digits.empty()) value.point += format_.scale;

  int fractionDigits = 0;
  Decimal rounded = value;
  if (value.kind == Decimal::Kind::Finite) rounded = roundDecimal(value, rounding_, fractionDigits);
  const bool isZero = rounded.kind == Decimal::Kind::Finite && rounded.digits.empty();
  const bool negative = value.kind != Decimal::Kind::NaN && value.negative;

  // Which sign the number wears (ECMA-402 GetNumberFormatPattern).
  enum class Sign { None, Minus, Plus } sign = Sign::None;
  switch (signDisplay_) {
    case SignDisplay::Auto:
      sign = negative ? Sign::Minus : Sign::None;
      break;
    case SignDisplay::Never:
      sign = Sign::None;
      break;
    case SignDisplay::Always:
      sign = negative ? Sign::Minus : Sign::Plus;
      break;
    case SignDisplay::ExceptZero:
      if (value.kind == Decimal::Kind::NaN || isZero) sign = Sign::None;
      else sign = negative ? Sign::Minus : Sign::Plus;
      break;
    case SignDisplay::Negative:
      sign = negative && !isZero ? Sign::Minus : Sign::None;
      break;
  }
  const auto& prefix = sign == Sign::Minus ? format_.negativePrefix : sign == Sign::Plus ? format_.plusPrefix : format_.positivePrefix;
  const auto& suffix = sign == Sign::Minus ? format_.negativeSuffix : sign == Sign::Plus ? format_.plusSuffix : format_.positiveSuffix;

  std::vector<Part> parts;
  parts.reserve(prefix.size() + suffix.size() + 8);
  parts.insert(parts.end(), prefix.begin(), prefix.end());

  if (value.kind == Decimal::Kind::NaN) {
    parts.push_back({PartType::Nan, format_.nan});
  } else if (value.kind == Decimal::Kind::Infinity) {
    parts.push_back({PartType::Infinity, format_.infinity});
  } else {
    // Integer digits, padded to minimumIntegerDigits.
    std::string integer;
    for (int i = 0; i < std::max(rounded.point, 0); i++) integer.push_back(i < static_cast<int>(rounded.digits.size()) ? rounded.digits[static_cast<size_t>(i)] : '0');
    if (integer.empty()) integer = "0";
    if (static_cast<int>(integer.size()) < rounding_.minimumIntegerDigits) integer.insert(0, static_cast<size_t>(rounding_.minimumIntegerDigits) - integer.size(), '0');

    const int length = static_cast<int>(integer.size());
    const int primary = std::max(1, format_.primaryGroupingSize);
    const int secondary = std::max(1, format_.secondaryGroupingSize);
    int minimumGrouping = 1;
    switch (grouping_) {
      case Grouping::Off:
        minimumGrouping = 1 << 20;
        break;
      case Grouping::Min2:
        minimumGrouping = std::max(2, format_.minimumGroupingDigits);
        break;
      case Grouping::Auto:
        minimumGrouping = format_.minimumGroupingDigits;
        break;
      case Grouping::Always:
        minimumGrouping = 1;
        break;
    }
    const bool group = !format_.groupingSeparator.empty() && format_.primaryGroupingSize > 0 && length >= primary + minimumGrouping;

    std::string run;
    auto flushRun = [&] {
      if (!run.empty()) parts.push_back({PartType::Integer, std::move(run)});
      run.clear();
    };
    for (int i = 0; i < length; i++) {
      run += format_.digits[static_cast<size_t>(integer[static_cast<size_t>(i)] - '0')];
      const int left = length - 1 - i; // digits after this one
      if (group && left > 0 && (left == primary || (left > primary && (left - primary) % secondary == 0))) {
        flushRun();
        parts.push_back({PartType::Group, format_.groupingSeparator});
      }
    }
    flushRun();

    if (fractionDigits > 0) {
      parts.push_back({PartType::Decimal, format_.decimalSeparator});
      std::string fraction;
      for (int i = 0; i < fractionDigits; i++) {
        const int index = rounded.point + i;
        const char c = index >= 0 && index < static_cast<int>(rounded.digits.size()) ? rounded.digits[static_cast<size_t>(index)] : '0';
        fraction += format_.digits[static_cast<size_t>(c - '0')];
      }
      parts.push_back({PartType::Fraction, std::move(fraction)});
    }
  }

  parts.insert(parts.end(), suffix.begin(), suffix.end());
  return parts;
}

std::string NumberFormatCore::format(const Decimal& value) const {
  std::string out;
  for (const auto& part : formatToParts(value)) out += part.value;
  return out;
}

} // namespace margelo::nitro::nitroinput::numberformat
