//
//  NumberFormatProbe.hpp
//  NitroInput
//
//  Learns a locale's number format from the platform's own formatter, by
//  formatting a few known numbers with it and reading the output: the digits,
//  the separators, the grouping sizes, the text before and after a positive
//  and a negative number. What the platform prints for those numbers is by
//  construction what `NumberFormatCore` prints afterwards, so the C++ output
//  matches the platform's (and so Hermes' `Intl`, which uses the same
//  formatter) without asking it again per number.
//

#pragma once

#include "NumberFormatCore.hpp"

#include <functional>
#include <string>

namespace margelo::nitro::nitroinput::numberformat {

struct ProbeSymbols {
  std::string minusSign = "-";
  std::string plusSign = "+";
  std::string percentSign = "%";
  /// The currency as the formatter shows it; empty without one.
  std::string currency;
  std::string nan = "NaN";
  std::string infinity = "\u221E";
  std::string exponentSeparator = "E";
};

/// Formats a number with the platform formatter being probed.
using ProbeFormat = std::function<std::string(double)>;

/// The locale's digits 0…9 from its formatting of 1234567890 without grouping,
/// or Latin digits when that output is not ten digits.
std::array<std::string, 10> learnDigits(const std::string& formatted1234567890);

/// The format of a formatter set to two fraction digits with grouping on.
/// `scale` is 2 for percent (the formatter multiplies by 100).
LocaleFormat learnLocaleFormat(const ProbeFormat& format, const std::array<std::string, 10>& digits, const ProbeSymbols& symbols, int scale);

/// What the output of a platform-formatted number consists of, for the
/// notations and styles C++ does not format itself.
enum class TextKind { Literal, Compact, Unit, CurrencyName };
std::vector<Part> partsOfFormatted(const std::string& text, const LocaleFormat& format, const ProbeSymbols& symbols, TextKind words,
                                   bool scientific);

/// Compact notation: for each magnitude 0…15, the power of ten the platform
/// divides by ("1K" for 10^3 → 3, "1万" for 10^4 → 4, "1000" → 0), read off its
/// formatting of 10^magnitude.
std::array<int, 16> learnCompactExponents(const ProbeFormat& format, const LocaleFormat& locale);

/// A value rounded the way ECMA-402 rounds a compact number (the digit options
/// applied to the value divided by its compact power of ten), still undivided.
Decimal roundCompact(const Decimal& value, const Rounding& rounding, const std::array<int, 16>& exponents);

/// Splits UTF-8 into code points (as strings); invalid bytes stand alone.
std::vector<std::string> codePoints(const std::string& text);

} // namespace margelo::nitro::nitroinput::numberformat
