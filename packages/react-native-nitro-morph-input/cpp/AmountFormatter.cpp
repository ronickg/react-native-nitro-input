//
//  AmountFormatter.cpp
//  NitroMorphInput
//

#include "AmountFormatter.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace margelo::nitro::nitromorphinput {

namespace {

bool isDigit(uint32_t c) {
  return c >= '0' && c <= '9';
}

uint32_t firstCodePoint(const std::string& utf8, uint32_t fallback) {
  const auto decoded = AmountFormatter::decode(utf8);
  return decoded.empty() ? fallback : decoded[0];
}

} // namespace

AmountFormatter::AmountFormatter() = default;

void AmountFormatter::setFormat(int fractionDigits, int maxIntegerDigits, const std::string& grouping, const std::string& decimal) {
  fractionDigits_ = std::clamp(fractionDigits, 0, 9);
  maxIntegerDigits_ = std::clamp(maxIntegerDigits, 1, 30);
  grouping_ = firstCodePoint(grouping, 0);
  decimal_ = firstCodePoint(decimal, '.');
  if (grouping_ == decimal_) grouping_ = 0;
}

// MARK: - UTF-8

std::vector<uint32_t> AmountFormatter::decode(const std::string& utf8) {
  std::vector<uint32_t> out;
  out.reserve(utf8.size());
  size_t i = 0;
  while (i < utf8.size()) {
    const unsigned char c = static_cast<unsigned char>(utf8[i]);
    uint32_t cp;
    size_t len;
    if (c < 0x80) { cp = c; len = 1; }
    else if ((c >> 5) == 0x6) { cp = c & 0x1f; len = 2; }
    else if ((c >> 4) == 0xe) { cp = c & 0x0f; len = 3; }
    else if ((c >> 3) == 0x1e) { cp = c & 0x07; len = 4; }
    else { ++i; continue; }
    if (i + len > utf8.size()) break;
    for (size_t k = 1; k < len; ++k) cp = (cp << 6) | (static_cast<unsigned char>(utf8[i + k]) & 0x3f);
    out.push_back(cp);
    i += len;
  }
  return out;
}

std::string AmountFormatter::encode(const std::vector<uint32_t>& codePoints) {
  std::string out;
  out.reserve(codePoints.size());
  for (uint32_t cp : codePoints) {
    if (cp < 0x80) {
      out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800) {
      out.push_back(static_cast<char>(0xc0 | (cp >> 6)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
    } else if (cp < 0x10000) {
      out.push_back(static_cast<char>(0xe0 | (cp >> 12)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3f)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
    } else {
      out.push_back(static_cast<char>(0xf0 | (cp >> 18)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3f)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3f)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
    }
  }
  return out;
}

// MARK: - Model

int AmountFormatter::kindOf(uint32_t character) const {
  if (isDigit(character)) return 1;
  if (isGrouping(character)) return 2;
  if (isDecimal(character)) return 3;
  return 0;
}

/// Nobody types a grouping separator on purpose, but decimal pads show '.' or
/// ',' depending on the keyboard locale, so either counts as the decimal.
bool AmountFormatter::isTypedDecimal(uint32_t c) const {
  if (fractionDigits_ <= 0) return false;
  return c == decimal_ || c == '.' || c == ',';
}

AmountFormatter::Raw AmountFormatter::rawOf(const std::vector<uint32_t>& formatted, int caretFormatted) const {
  Raw raw;
  raw.caret = 0;
  for (size_t i = 0; i < formatted.size(); ++i) {
    const uint32_t c = formatted[i];
    if (isDigit(c)) {
      raw.chars.push_back(c);
    } else if (isDecimal(c)) {
      raw.chars.push_back(decimal_);
    } else {
      continue;
    }
    if (static_cast<int>(i) < caretFormatted) raw.caret = static_cast<int>(raw.chars.size());
  }
  return raw;
}

AmountFormatter::Edit AmountFormatter::applyEdit(const std::string& current, int start, int end, const std::string& replacement) const {
  const auto cur = decode(current);
  const int n = static_cast<int>(cur.size());
  start = std::clamp(start, 0, n);
  end = std::clamp(end, start, n);
  const auto rep = decode(replacement);

  // Backspacing over a grouping separator removes the digit before it.
  if (rep.empty() && end - start == 1 && isGrouping(cur[static_cast<size_t>(start)]) && start > 0) {
    --start;
  }

  const Raw full = rawOf(cur, n);
  const int rawStart = rawOf(cur, start).caret;
  const int rawEnd = rawOf(cur, end).caret;

  std::vector<uint32_t> accepted;
  bool typedDecimal = false;
  for (uint32_t c : rep) {
    if (isDigit(c)) {
      accepted.push_back(c);
    } else if (isTypedDecimal(c) && !typedDecimal) {
      accepted.push_back(decimal_);
      typedDecimal = true;
    }
  }

  std::vector<uint32_t> raw(full.chars.begin(), full.chars.begin() + rawStart);
  std::vector<uint32_t> after(full.chars.begin() + rawEnd, full.chars.end());
  // A decimal typed inside the fraction is ignored; typed in the integer part it
  // moves the decimal point: the old one goes and the fraction is cut to fit.
  if (typedDecimal) {
    for (int i = 0; i < rawStart; ++i) {
      if (full.chars[static_cast<size_t>(i)] == decimal_) {
        accepted.erase(std::remove(accepted.begin(), accepted.end(), decimal_), accepted.end());
        typedDecimal = false;
        break;
      }
    }
  }
  if (typedDecimal) {
    const auto drop = [&](std::vector<uint32_t>& part) {
      part.erase(std::remove(part.begin(), part.end(), decimal_), part.end());
    };
    drop(raw);
    drop(after);
  }
  raw.insert(raw.end(), accepted.begin(), accepted.end());
  // A digit typed in front of a lone leading zero ("0.5" → "7.5") replaces it.
  if (rawStart == 0 && !accepted.empty() && isDigit(accepted[0]) && !after.empty() && after[0] == '0' &&
      (after.size() == 1 || after[1] == decimal_)) {
    after.erase(after.begin());
  }
  const int caret = static_cast<int>(raw.size());
  raw.insert(raw.end(), after.begin(), after.end());

  return formatRaw(std::move(raw), caret, Rules{false, typedDecimal, false}, current, end);
}

AmountFormatter::Edit AmountFormatter::normalize(const std::string& text) const {
  // Text in the field's own format: its grouping separators are dropped, not read as decimals.
  std::vector<uint32_t> raw;
  for (uint32_t c : decode(text)) {
    if (isDigit(c)) raw.push_back(c);
    else if (!isGrouping(c) && isTypedDecimal(c)) raw.push_back(decimal_);
  }
  const int caret = static_cast<int>(raw.size());
  return formatRaw(std::move(raw), caret, Rules{true, true, true}, "", 0);
}

AmountFormatter::Edit AmountFormatter::formatRaw(std::vector<uint32_t> raw, int caret, Rules rules,
                                                 const std::string& fallback, int fallbackCaret) const {
  // Only the first decimal separator counts.
  {
    bool seen = false;
    std::vector<uint32_t> kept;
    kept.reserve(raw.size());
    int newCaret = caret;
    for (size_t i = 0; i < raw.size(); ++i) {
      if (raw[i] == decimal_) {
        if (seen || fractionDigits_ <= 0) {
          if (static_cast<int>(i) < caret) --newCaret;
          continue;
        }
        seen = true;
      }
      kept.push_back(raw[i]);
    }
    raw.swap(kept);
    caret = newCaret;
  }

  int decimalAt = -1;
  for (size_t i = 0; i < raw.size(); ++i) {
    if (raw[i] == decimal_) { decimalAt = static_cast<int>(i); break; }
  }
  std::vector<uint32_t> integer(raw.begin(), decimalAt >= 0 ? raw.begin() + decimalAt : raw.end());
  std::vector<uint32_t> fraction;
  if (decimalAt >= 0) fraction.assign(raw.begin() + decimalAt + 1, raw.end());

  // No leading zeros ("05" → "5"), but a lone zero before the decimal stays.
  while (integer.size() > 1 && integer[0] == '0') {
    integer.erase(integer.begin());
    if (caret > 0) --caret;
  }
  if (rules.leadingZero && integer.empty() && decimalAt >= 0) {
    integer.push_back('0');
    ++caret;
  }

  if (static_cast<int>(integer.size()) > maxIntegerDigits_) {
    if (!rules.truncateInteger) return Edit{fallback, fallbackCaret, false};
    integer.resize(static_cast<size_t>(maxIntegerDigits_));
  }
  if (static_cast<int>(fraction.size()) > fractionDigits_) {
    if (!rules.truncateFraction) return Edit{fallback, fallbackCaret, false};
    fraction.resize(static_cast<size_t>(fractionDigits_));
  }

  std::vector<uint32_t> formatted;
  formatted.reserve(integer.size() + integer.size() / 3 + fraction.size() + 1);
  for (size_t i = 0; i < integer.size(); ++i) {
    if (grouping_ != 0 && i > 0 && (integer.size() - i) % 3 == 0) formatted.push_back(grouping_);
    formatted.push_back(integer[i]);
  }
  if (decimalAt >= 0) {
    formatted.push_back(decimal_);
    formatted.insert(formatted.end(), fraction.begin(), fraction.end());
  }

  const int rawCount = static_cast<int>(integer.size()) + (decimalAt >= 0 ? 1 : 0) + static_cast<int>(fraction.size());
  caret = std::clamp(caret, 0, rawCount);
  int caretFormatted = 0;
  if (caret > 0) {
    int seen = 0;
    caretFormatted = static_cast<int>(formatted.size());
    for (size_t i = 0; i < formatted.size(); ++i) {
      if (isDigit(formatted[i]) || formatted[i] == decimal_) {
        if (++seen == caret) {
          caretFormatted = static_cast<int>(i) + 1;
          break;
        }
      }
    }
  }
  return Edit{encode(formatted), caretFormatted, true};
}

std::string AmountFormatter::format(double value) const {
  if (!std::isfinite(value)) return "";
  char buffer[64];
  std::snprintf(buffer, sizeof(buffer), "%.*f", fractionDigits_, std::fabs(value));
  std::string text(buffer);
  if (fractionDigits_ > 0) {
    while (!text.empty() && text.back() == '0') text.pop_back();
    if (!text.empty() && text.back() == '.') text.pop_back();
  }
  std::vector<uint32_t> raw;
  for (char c : text) {
    if (c == '.') raw.push_back(decimal_);
    else raw.push_back(static_cast<uint32_t>(static_cast<unsigned char>(c)));
  }
  const int caret = static_cast<int>(raw.size());
  return formatRaw(std::move(raw), caret, Rules{true, true, true}, "", 0).text;
}

double AmountFormatter::value(const std::string& formatted) const {
  const Raw raw = rawOf(decode(formatted), 0);
  std::string plain;
  bool digits = false;
  for (uint32_t c : raw.chars) {
    if (c == decimal_) plain.push_back('.');
    else { plain.push_back(static_cast<char>(c)); digits = true; }
  }
  if (!digits) return std::nan("");
  return std::strtod(plain.c_str(), nullptr);
}

} // namespace margelo::nitro::nitromorphinput
