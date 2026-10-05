//
//  FormatFigure.hpp
//  NitroInput
//
//  What `NitroNumber` and `NitroInput` take from a formatted number: the
//  figure the digits show, and the text around it. Read off the parts the
//  formatter produced, so the figure is rounded and trimmed exactly as the
//  format prints it (its rounding mode, trailing zeros, significant digits,
//  compact notation), from the decimal the value was, never through a double.
//  Plain C++, unit-tested on the host.
//

#pragma once

#include "NumberFormatCore.hpp"

#include <array>
#include <string>
#include <vector>

namespace margelo::nitro::nitroinput::numberformat {

/// One formatted value, as the rolling figure takes it.
struct Figure {
  /// Finite, and so a figure the digits can roll to (NaN and infinities are not).
  bool finite = false;
  /// The value was below zero and its shown digits are not all zero: "-$0.00" is not negative.
  bool negative = false;
  /// The digits shown, in Latin digits with "." before the fraction ("1234.5"), without sign or grouping.
  std::string digits;
  /// How many of `digits` follow the point: what this value shows ("$1,234" 0, "$1,234.50" 2).
  int fractionDigits = 0;
  /// The text before and after the number, without the sign: the components draw their own.
  std::string prefix;
  std::string suffix;

  /// The figure as a double: its digits, signed. 0 (never -0) for a figure that is not finite or rounds to nothing.
  double value() const;
};

/// The figure in `parts`, formatted from a value that was `negative`.
/// `localeDigits` are the format's digits 0…9, which map back to Latin ones.
Figure figureOf(const std::vector<Part>& parts, bool negative, const std::array<std::string, 10>& localeDigits);

/// The shape of a format, as the components lay a number out.
struct Layout {
  std::string prefix;
  std::string suffix;
  /// Empty when the format does not group.
  std::string groupingSeparator;
  std::string decimalSeparator = ".";
  /// A negative amount's sign comes after the prefix ("$-5"), not before it ("-$5").
  bool signAfterAffix = false;
  std::string minusSign = "-";
  /// The group nearest the decimal point and every one before it ([3, 2]: 12,34,567).
  std::vector<int> groupingSizes = {3};
  /// The format's digits 0…9, or empty for Latin ones.
  std::vector<std::string> digitGlyphs;
};

/// The layout of a format, read off its parts for a value with every part
/// (`sample`: 1234567, or 1234567.5 when it shows a fraction) and for -1.
Layout layoutOf(const std::vector<Part>& sample, const std::vector<Part>& negativeOne, const std::array<std::string, 10>& localeDigits);

} // namespace margelo::nitro::nitroinput::numberformat
