//
//  AmountFormatter.hpp
//  NitroInput
//
//  The amount model behind `mode="number"`: turns an edit on the formatted
//  text ("1,234.5" with a range replaced by what the user typed) into the next
//  formatted text and caret, synchronously and on the native side, so the
//  field never shows an unformatted frame and never waits for JS.
//
//  Strings are UTF-8; offsets count code points. Shared by both platforms
//  and the docs site.
//

#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace margelo::nitro::nitroinput {

class AmountFormatter final {
public:
  struct Edit {
    std::string text;
    int caret;
    /// False when the edit was rejected (too many digits): `text` is the unchanged input.
    bool accepted;
  };

  AmountFormatter();

  /// `grouping` / `decimal`: one character each (UTF-8); empty grouping disables grouping.
  void setFormat(int fractionDigits, int maxIntegerDigits, const std::string& grouping, const std::string& decimal);

  /// Replaces code points [start, end) of `current` (formatted) with
  /// `replacement` (raw keystrokes / paste) and reformats. Backspacing over a
  /// grouping separator removes the digit before it. Digits beyond
  /// `fractionDigits` / `maxIntegerDigits` reject the edit.
  Edit applyEdit(const std::string& current, int start, int end, const std::string& replacement) const;
  /// Formats arbitrary text (e.g. a `text` prop): keeps digits and the first
  /// decimal, truncates instead of rejecting. Caret at the end.
  Edit normalize(const std::string& text) const;
  /// Formats a value with up to `fractionDigits` (no trailing zeros). NaN → "".
  std::string format(double value) const;
  /// The numeric value of formatted text; NaN when there are no digits.
  double value(const std::string& formatted) const;

  /// MorphEngine::Kind of a character in formatted text.
  int kindOf(uint32_t character) const;
  bool isGrouping(uint32_t character) const { return grouping_ != 0 && character == grouping_; }
  bool isDecimal(uint32_t character) const { return character == decimal_; }

  static std::vector<uint32_t> decode(const std::string& utf8);
  static std::string encode(const std::vector<uint32_t>& codePoints);
  static int codePointCount(const std::string& utf8) { return static_cast<int>(decode(utf8).size()); }

private:
  /// Digits and the decimal, in order, as typed.
  struct Raw {
    std::vector<uint32_t> chars;
    int caret;
  };
  Raw rawOf(const std::vector<uint32_t>& formatted, int caretFormatted) const;
  bool isTypedDecimal(uint32_t c) const;
  struct Rules {
    /// Drop integer digits past the limit instead of rejecting.
    bool truncateInteger;
    /// Drop fraction digits past the limit instead of rejecting.
    bool truncateFraction;
    /// ".5" becomes "0.5" (formatted values); while typing it stays ".5".
    bool leadingZero;
  };
  Edit formatRaw(std::vector<uint32_t> raw, int caret, Rules rules, const std::string& fallback, int fallbackCaret) const;

  int fractionDigits_ = 2;
  int maxIntegerDigits_ = 15;
  uint32_t grouping_ = ',';
  uint32_t decimal_ = '.';
};

} // namespace margelo::nitro::nitroinput
