//
//  NumberFormatProbe.cpp
//  NitroInput
//

#include "NumberFormatProbe.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace margelo::nitro::nitroinput::numberformat {

std::vector<std::string> codePoints(const std::string& text) {
  std::vector<std::string> out;
  out.reserve(text.size());
  size_t i = 0;
  while (i < text.size()) {
    const auto c = static_cast<unsigned char>(text[i]);
    size_t length = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xE ? 3 : (c >> 3) == 0x1E ? 4 : 1;
    if (i + length > text.size()) length = 1;
    out.push_back(text.substr(i, length));
    i += length;
  }
  return out;
}

namespace {

/// Direction marks some locales put around numbers and signs.
bool isBidiControl(const std::string& cp) {
  return cp == "‎" || cp == "‏" || cp == "؜" || cp == "‪" || cp == "‫" || cp == "‬" || cp == "‭" ||
         cp == "‮" || cp == "⁦" || cp == "⁧" || cp == "⁨" || cp == "⁩";
}

int digitValue(const std::string& cp, const std::array<std::string, 10>& digits) {
  for (int d = 0; d < 10; d++) {
    if (digits[static_cast<size_t>(d)] == cp) return d;
  }
  if (cp.size() == 1 && cp[0] >= '0' && cp[0] <= '9') return cp[0] - '0';
  return -1;
}

struct Around {
  std::string prefix;
  std::vector<std::string> core; // from the first digit to the last, code points
  std::string suffix;
  bool hasDigits = false;
};

Around splitAround(const std::string& text, const std::array<std::string, 10>& digits) {
  Around out;
  const auto cps = codePoints(text);
  int first = -1;
  int last = -1;
  for (int i = 0; i < static_cast<int>(cps.size()); i++) {
    if (digitValue(cps[static_cast<size_t>(i)], digits) >= 0) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) {
    out.prefix = text;
    return out;
  }
  out.hasDigits = true;
  for (int i = 0; i < first; i++) out.prefix += cps[static_cast<size_t>(i)];
  for (int i = first; i <= last; i++) out.core.push_back(cps[static_cast<size_t>(i)]);
  for (int i = last + 1; i < static_cast<int>(cps.size()); i++) out.suffix += cps[static_cast<size_t>(i)];
  return out;
}

/// The core as alternating runs of digits and of separators.
struct Run {
  bool digits;
  std::string text;
  int count; // digits in a digit run
};

std::vector<Run> runsOf(const std::vector<std::string>& core, const std::array<std::string, 10>& digits) {
  std::vector<Run> runs;
  for (const auto& cp : core) {
    const bool isDigit = digitValue(cp, digits) >= 0;
    if (runs.empty() || runs.back().digits != isDigit) runs.push_back({isDigit, "", 0});
    runs.back().text += cp;
    if (isDigit) runs.back().count++;
  }
  return runs;
}

} // namespace

std::array<std::string, 10> learnDigits(const std::string& formatted) {
  std::vector<std::string> cps;
  for (auto& cp : codePoints(formatted)) {
    if (!isBidiControl(cp)) cps.push_back(cp);
  }
  std::array<std::string, 10> digits = {"0", "1", "2", "3", "4", "5", "6", "7", "8", "9"};
  if (cps.size() != 10) return digits;
  // "1234567890": positions 0…8 are 1…9, position 9 is 0.
  for (size_t i = 0; i < 9; i++) digits[i + 1] = cps[i];
  digits[0] = cps[9];
  return digits;
}

LocaleFormat learnLocaleFormat(const ProbeFormat& format, const std::array<std::string, 10>& digits, const ProbeSymbols& symbols, int scale) {
  LocaleFormat out;
  out.digits = digits;
  out.scale = scale;
  const double unit = std::pow(10.0, scale);

  // 1,234,567.89: the separators, the grouping sizes and the positive affixes.
  const Around positive = splitAround(format(1234567.89 / unit), digits);
  const auto runs = runsOf(positive.core, digits);
  // The last separator before the two fraction digits is the decimal separator.
  size_t integerEnd = runs.size();
  if (runs.size() >= 3 && runs.back().digits && runs.back().count == 2 && !runs[runs.size() - 2].digits) {
    out.decimalSeparator = runs[runs.size() - 2].text;
    integerEnd = runs.size() - 2;
  }
  std::vector<int> groups;
  out.groupingSeparator.clear();
  for (size_t i = 0; i < integerEnd; i++) {
    if (runs[i].digits) groups.push_back(runs[i].count);
    else if (out.groupingSeparator.empty()) out.groupingSeparator = runs[i].text;
  }
  if (groups.size() >= 2) {
    out.primaryGroupingSize = groups.back();
    out.secondaryGroupingSize = groups.size() >= 3 ? groups[groups.size() - 2] : groups.back();
  } else {
    out.primaryGroupingSize = 0;
    out.secondaryGroupingSize = 0;
  }

  // 1234.5: grouped only when a single digit may stand before a separator.
  if (!out.groupingSeparator.empty()) {
    const Around small = splitAround(format(1234.5 / unit), digits);
    const auto smallRuns = runsOf(small.core, digits);
    const bool grouped = smallRuns.size() >= 2 && smallRuns[0].digits && smallRuns[0].count == 1 && smallRuns[1].text == out.groupingSeparator;
    out.minimumGroupingDigits = grouped ? 1 : 2;
  }

  const Around negative = splitAround(format(-1234567.89 / unit), digits);

  auto split = [&](const std::string& text) {
    return NumberFormatCore::splitAffix(text, symbols.currency, symbols.minusSign, symbols.plusSign, symbols.percentSign);
  };
  out.positivePrefix = split(positive.prefix);
  out.positiveSuffix = split(positive.suffix);
  out.negativePrefix = split(negative.prefix);
  out.negativeSuffix = split(negative.suffix);

  // The plus pattern is the minus pattern with the sign swapped (ICU's rule);
  // a minus pattern without a sign (accounting) gets the sign in front.
  std::string plusPrefix = negative.prefix;
  std::string plusSuffix = negative.suffix;
  const auto swap = [&](std::string& text) {
    const size_t at = symbols.minusSign.empty() ? std::string::npos : text.find(symbols.minusSign);
    if (at == std::string::npos) return false;
    text.replace(at, symbols.minusSign.size(), symbols.plusSign);
    return true;
  };
  if (!swap(plusPrefix) && !swap(plusSuffix)) {
    plusPrefix = symbols.plusSign + positive.prefix;
    plusSuffix = positive.suffix;
  }
  out.plusPrefix = split(plusPrefix);
  out.plusSuffix = split(plusSuffix);

  // The platform's own output for NaN and infinities is no guide (Foundation
  // prints "+∞" without the currency), so the symbols come from its data.
  if (!symbols.nan.empty()) out.nan = symbols.nan;
  std::string infinity = symbols.infinity;
  for (const auto& sign : {symbols.plusSign, symbols.minusSign, std::string("+"), std::string("-")}) {
    if (!sign.empty() && infinity.size() > sign.size() && infinity.compare(0, sign.size(), sign) == 0) infinity.erase(0, sign.size());
  }
  if (!infinity.empty()) out.infinity = infinity;
  if (!symbols.exponentSeparator.empty()) out.exponentSeparator = symbols.exponentSeparator;
  // The exponent's minus sign is the bare sign, without the direction marks around it.
  std::string exponentMinus = symbols.minusSign;
  for (const auto& mark : {std::string("\u200E"), std::string("\u200F"), std::string("\u061C")}) {
    for (size_t at; (at = exponentMinus.find(mark)) != std::string::npos;) exponentMinus.erase(at, mark.size());
  }
  if (!exponentMinus.empty()) out.exponentMinusSign = exponentMinus;
  return out;
}

std::array<int, 16> learnCompactExponents(const ProbeFormat& format, const LocaleFormat& locale) {
  std::array<int, 16> exponents{};
  for (int k = 0; k < 16; k++) {
    // Digits before the decimal separator in the platform's "1K", "10K", "100K"…
    int integerDigits = 0;
    const std::string decimal = locale.decimalSeparator;
    std::string text = format(std::pow(10.0, k));
    const size_t at = decimal.empty() ? std::string::npos : text.find(decimal);
    if (at != std::string::npos) text.erase(at);
    for (const auto& cp : codePoints(text)) {
      if (digitValue(cp, locale.digits) >= 0) integerDigits++;
    }
    exponents[static_cast<size_t>(k)] = integerDigits > 0 ? std::max(0, k - (integerDigits - 1)) : (k > 0 ? exponents[static_cast<size_t>(k - 1)] : 0);
  }
  return exponents;
}

Decimal roundCompact(const Decimal& value, const Rounding& rounding, const std::array<int, 16>& exponents) {
  if (value.kind != Decimal::Kind::Finite || value.digits.empty()) return value;
  auto exponentFor = [&](int magnitude) { return exponents[static_cast<size_t>(std::clamp(magnitude, 0, 15))]; };
  const int magnitude = decimalMagnitude(value);
  int exponent = exponentFor(magnitude);
  int fractionDigits = 0;
  Decimal scaled = value;
  scaled.point -= exponent;
  Decimal rounded = roundDecimal(scaled, rounding, fractionDigits);
  // Rounding up can reach the next compact magnitude (999.9K → 1M).
  if (!rounded.digits.empty() && decimalMagnitude(rounded) + exponent > magnitude) {
    const int carried = exponentFor(decimalMagnitude(rounded) + exponent);
    if (carried != exponent) {
      exponent = carried;
      scaled = value;
      scaled.point -= exponent;
      rounded = roundDecimal(scaled, rounding, fractionDigits);
    }
  }
  if (!rounded.digits.empty()) rounded.point += exponent;
  return rounded;
}

std::vector<Part> partsOfFormatted(const std::string& text, const LocaleFormat& format, const ProbeSymbols& symbols, TextKind words,
                                   bool scientific) {
  std::vector<Part> parts;
  const auto cps = codePoints(text);
  std::string pending; // text that is not part of the number
  bool afterDecimal = false;
  bool inExponent = false;

  auto flushText = [&] {
    if (pending.empty()) return;
    // Spaces and marks around a word are literals of their own ("12", " ", "km/h").
    const auto cps = codePoints(pending);
    auto isBlank = [](const std::string& cp) { return cp == " " || cp == " " || cp == " " || isBidiControl(cp); };
    size_t begin = 0;
    size_t end = cps.size();
    while (begin < end && isBlank(cps[begin])) begin++;
    while (end > begin && isBlank(cps[end - 1])) end--;
    PartType type = PartType::Literal;
    switch (words) {
      case TextKind::Compact:
        type = PartType::Compact;
        break;
      case TextKind::Unit:
        type = PartType::Unit;
        break;
      case TextKind::CurrencyName:
        type = PartType::Currency;
        break;
      case TextKind::Literal:
        break;
    }
    if (begin == end || type == PartType::Literal) {
      parts.push_back({PartType::Literal, pending});
    } else {
      std::string lead, word, trail;
      for (size_t i = 0; i < begin; i++) lead += cps[i];
      for (size_t i = begin; i < end; i++) word += cps[i];
      for (size_t i = end; i < cps.size(); i++) trail += cps[i];
      if (!lead.empty()) parts.push_back({PartType::Literal, lead});
      parts.push_back({type, word});
      if (!trail.empty()) parts.push_back({PartType::Literal, trail});
    }
    pending.clear();
  };
  auto push = [&](PartType type, const std::string& value) {
    if (!parts.empty() && parts.back().type == type && (type == PartType::Integer || type == PartType::Fraction || type == PartType::ExponentInteger)) {
      parts.back().value += value;
    } else {
      parts.push_back({type, value});
    }
  };
  auto startsAt = [&](size_t i, const std::string& symbol) {
    if (symbol.empty()) return false;
    std::string joined;
    for (size_t j = i; j < cps.size() && joined.size() < symbol.size(); j++) joined += cps[j];
    return joined == symbol;
  };
  auto isDigitAt = [&](size_t i) { return i < cps.size() && digitValue(cps[i], format.digits) >= 0; };
  auto advance = [&](size_t& i, const std::string& symbol) {
    size_t consumed = 0;
    while (i < cps.size() && consumed < symbol.size()) consumed += cps[i++].size();
  };

  bool seenDigit = false;
  for (size_t i = 0; i < cps.size();) {
    if (isDigitAt(i)) {
      flushText();
      push(inExponent ? PartType::ExponentInteger : afterDecimal ? PartType::Fraction : PartType::Integer, cps[i]);
      seenDigit = true;
      i++;
      continue;
    }
    if (seenDigit && !inExponent && !afterDecimal && startsAt(i, format.groupingSeparator)) {
      size_t j = i;
      advance(j, format.groupingSeparator);
      if (isDigitAt(j)) {
        flushText();
        parts.push_back({PartType::Group, format.groupingSeparator});
        i = j;
        continue;
      }
    }
    if (seenDigit && !inExponent && !afterDecimal && startsAt(i, format.decimalSeparator)) {
      size_t j = i;
      advance(j, format.decimalSeparator);
      if (isDigitAt(j)) {
        flushText();
        parts.push_back({PartType::Decimal, format.decimalSeparator});
        afterDecimal = true;
        i = j;
        continue;
      }
    }
    if (scientific && seenDigit && !inExponent && (cps[i] == "E" || cps[i] == "e")) {
      flushText();
      parts.push_back({PartType::ExponentSeparator, cps[i]});
      inExponent = true;
      i++;
      continue;
    }
    struct Symbol {
      const std::string* text;
      PartType type;
    };
    const Symbol candidates[] = {{&symbols.currency, PartType::Currency},
                                 {&symbols.minusSign, inExponent ? PartType::ExponentMinusSign : PartType::MinusSign},
                                 {&symbols.plusSign, PartType::PlusSign},
                                 {&symbols.percentSign, PartType::PercentSign},
                                 {&format.nan, PartType::Nan},
                                 {&format.infinity, PartType::Infinity}};
    const Symbol* best = nullptr;
    for (const auto& c : candidates) {
      if (startsAt(i, *c.text) && (!best || c.text->size() > best->text->size())) best = &c;
    }
    if (best) {
      flushText();
      parts.push_back({best->type, *best->text});
      advance(i, *best->text);
      continue;
    }
    pending += cps[i++];
  }
  flushText();
  return parts;
}

} // namespace margelo::nitro::nitroinput::numberformat
