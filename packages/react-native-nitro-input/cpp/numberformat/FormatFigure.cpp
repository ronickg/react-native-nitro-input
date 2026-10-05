//
//  FormatFigure.cpp
//  NitroInput
//

#include "FormatFigure.hpp"

#include <cstdlib>

namespace margelo::nitro::nitroinput::numberformat {

namespace {

bool isNumberPart(PartType type) {
  return type == PartType::Integer || type == PartType::Group || type == PartType::Decimal || type == PartType::Fraction;
}

/// `text` with the locale's digits written as Latin ones.
std::string latin(const std::string& text, const std::array<std::string, 10>& localeDigits) {
  std::string out;
  out.reserve(text.size());
  size_t i = 0;
  while (i < text.size()) {
    bool matched = false;
    for (int d = 0; d < 10; d++) {
      const std::string& glyph = localeDigits[static_cast<size_t>(d)];
      if (!glyph.empty() && text.compare(i, glyph.size(), glyph) == 0) {
        out.push_back(static_cast<char>('0' + d));
        i += glyph.size();
        matched = true;
        break;
      }
    }
    if (!matched) out.push_back(text[i++]);
  }
  return out;
}

std::string joined(const std::vector<Part>& parts, PartType type, const std::array<std::string, 10>& localeDigits) {
  std::string out;
  for (const Part& p : parts) {
    if (p.type == type) out += p.value;
  }
  return latin(out, localeDigits);
}

/// The text before and after the number in `parts`; the sign is the components' own glyph, not part of either.
void affixesOf(const std::vector<Part>& parts, std::string& prefix, std::string& suffix) {
  int first = -1;
  int last = -1;
  for (int i = 0; i < static_cast<int>(parts.size()); i++) {
    if (isNumberPart(parts[static_cast<size_t>(i)].type)) {
      if (first < 0) first = i;
      last = i;
    }
  }
  prefix.clear();
  suffix.clear();
  if (first < 0) return;
  for (int i = 0; i < static_cast<int>(parts.size()); i++) {
    const Part& p = parts[static_cast<size_t>(i)];
    if (p.type == PartType::MinusSign || p.type == PartType::PlusSign) continue;
    if (i < first) prefix += p.value;
    if (i > last) suffix += p.value;
  }
}

bool isLatin(const std::array<std::string, 10>& localeDigits) {
  for (int d = 0; d < 10; d++) {
    if (localeDigits[static_cast<size_t>(d)] != std::string(1, static_cast<char>('0' + d))) return false;
  }
  return true;
}

} // namespace

double Figure::value() const {
  if (!finite) return 0;
  const double magnitude = std::strtod(digits.c_str(), nullptr);
  if (magnitude == 0) return 0;
  return negative ? -magnitude : magnitude;
}

Figure figureOf(const std::vector<Part>& parts, bool negative, const std::array<std::string, 10>& localeDigits) {
  Figure figure;
  affixesOf(parts, figure.prefix, figure.suffix);
  const std::string integer = joined(parts, PartType::Integer, localeDigits);
  const std::string fraction = joined(parts, PartType::Fraction, localeDigits);
  // NaN and infinities have no integer part: nothing the digits can roll to.
  if (integer.empty()) return figure;
  figure.finite = true;
  figure.digits = fraction.empty() ? integer : integer + "." + fraction;
  figure.fractionDigits = static_cast<int>(fraction.size());
  bool nonZero = false;
  for (char c : figure.digits) nonZero = nonZero || (c >= '1' && c <= '9');
  figure.negative = negative && nonZero;
  return figure;
}

Layout layoutOf(const std::vector<Part>& sample, const std::vector<Part>& negativeOne, const std::array<std::string, 10>& localeDigits) {
  Layout layout;
  affixesOf(sample, layout.prefix, layout.suffix);
  std::vector<int> integers;
  bool hasGroup = false;
  bool hasDecimal = false;
  for (const Part& p : sample) {
    if (p.type == PartType::Group && !hasGroup) {
      layout.groupingSeparator = p.value;
      hasGroup = true;
    } else if (p.type == PartType::Decimal && !hasDecimal) {
      layout.decimalSeparator = p.value;
      hasDecimal = true;
    } else if (p.type == PartType::Integer) {
      integers.push_back(static_cast<int>(latin(p.value, localeDigits).size()));
    }
  }
  // "12,34,567": the last group is the first size, the one before it every later one.
  if (integers.size() >= 3) {
    layout.groupingSizes = {integers[integers.size() - 1], integers[integers.size() - 2]};
  }
  int minus = -1;
  int currency = -1;
  for (int i = 0; i < static_cast<int>(negativeOne.size()); i++) {
    const PartType type = negativeOne[static_cast<size_t>(i)].type;
    if (type == PartType::MinusSign && minus < 0) minus = i;
    if ((type == PartType::Currency || type == PartType::PercentSign) && currency < 0) currency = i;
  }
  if (minus >= 0) layout.minusSign = negativeOne[static_cast<size_t>(minus)].value;
  layout.signAfterAffix = minus >= 0 && currency >= 0 && minus > currency;
  if (!isLatin(localeDigits)) layout.digitGlyphs.assign(localeDigits.begin(), localeDigits.end());
  return layout;
}

} // namespace margelo::nitro::nitroinput::numberformat
