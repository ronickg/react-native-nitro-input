// Host-side checks for NumberFormatProbe. Build & run with `bun run test:cpp`.
//
// Each case plays a platform formatter set to two fraction digits with
// grouping on: the strings it returns for the probe numbers are what
// Foundation / ICU print for that locale. The learned format then has to
// format other numbers the same way.
#include "numberformat/NumberFormatProbe.hpp"

#include <cmath>
#include <cstdio>
#include <map>
#include <string>

using namespace margelo::nitro::nitroinput::numberformat;

static int failures = 0;

#define CHECK_EQ_STR(actual, expected)                                                                                          \
  do {                                                                                                                          \
    const std::string a_ = (actual);                                                                                            \
    const std::string e_ = (expected);                                                                                          \
    if (a_ != e_) {                                                                                                             \
      std::printf("FAIL %s:%d: %s == \"%s\", expected \"%s\"\n", __FILE__, __LINE__, #actual, a_.c_str(), e_.c_str());         \
      failures++;                                                                                                               \
    }                                                                                                                           \
  } while (0)

/// A fake platform: the probe numbers mapped to what the platform prints.
static ProbeFormat platform(std::map<std::string, std::string> outputs) {
  return [outputs](double v) -> std::string {
    std::string key;
    if (std::isnan(v)) key = "nan";
    else if (std::isinf(v)) key = "inf";
    else if (std::fabs(std::fabs(v) - 1234.5) < 1e-6 || std::fabs(std::fabs(v) - 12.345) < 1e-9) key = "small";
    else key = v < 0 ? "neg" : "pos";
    auto it = outputs.find(key);
    return it == outputs.end() ? std::string() : it->second;
  };
}

static const std::array<std::string, 10> kLatin = learnDigits("1234567890");

static std::string fmt(const LocaleFormat& f, int minFraction, int maxFraction, double v, SignDisplay sign = SignDisplay::Auto) {
  Rounding r;
  r.minimumFractionDigits = minFraction;
  r.maximumFractionDigits = maxFraction;
  return NumberFormatCore(f, r, Grouping::Auto, sign).format(Decimal::fromDouble(v));
}

int main() {
  // en-US, USD.
  {
    ProbeSymbols s;
    s.currency = "$";
    s.infinity = "+∞"; // Foundation's positiveInfinitySymbol
    const auto f = learnLocaleFormat(platform({{"pos", "$1,234,567.89"}, {"neg", "-$1,234,567.89"}, {"small", "$1,234.50"}}), kLatin, s, 0);
    CHECK_EQ_STR(fmt(f, 2, 2, 1234.5), "$1,234.50");
    CHECK_EQ_STR(fmt(f, 2, 2, -0.5), "-$0.50");
    CHECK_EQ_STR(fmt(f, 2, 2, 7, SignDisplay::Always), "+$7.00");
    CHECK_EQ_STR(fmt(f, 2, 2, std::nan("")), "$NaN");
    CHECK_EQ_STR(fmt(f, 2, 2, INFINITY), "$∞");
    CHECK_EQ_STR(fmt(f, 2, 2, -INFINITY), "-$∞");
  }

  // de-DE, EUR: suffixed with a no-break space.
  {
    ProbeSymbols s;
    s.currency = "€";
    const auto f = learnLocaleFormat(platform({{"pos", "1.234.567,89 €"}, {"neg", "-1.234.567,89 €"}, {"small", "1.234,50 €"}}), kLatin, s, 0);
    CHECK_EQ_STR(fmt(f, 2, 2, 1234.5), "1.234,50 €");
    CHECK_EQ_STR(fmt(f, 2, 2, -9876543.21), "-9.876.543,21 €");
  }

  // es-ES: four-digit numbers are not grouped.
  {
    ProbeSymbols s;
    const auto f = learnLocaleFormat(platform({{"pos", "1.234.567,89"}, {"neg", "-1.234.567,89"}, {"small", "1234,50"}}), kLatin, s, 0);
    CHECK_EQ_STR(std::to_string(f.minimumGroupingDigits), "2");
    CHECK_EQ_STR(fmt(f, 0, 3, 1234), "1234");
    CHECK_EQ_STR(fmt(f, 0, 3, 12345), "12.345");
  }

  // en-IN: groups of two above the thousands.
  {
    ProbeSymbols s;
    s.currency = "₹";
    const auto f = learnLocaleFormat(platform({{"pos", "₹12,34,567.89"}, {"neg", "-₹12,34,567.89"}, {"small", "₹1,234.50"}}), kLatin, s, 0);
    CHECK_EQ_STR(fmt(f, 2, 2, 123456789), "₹12,34,56,789.00");
  }

  // Accounting: parentheses, no minus sign.
  {
    ProbeSymbols s;
    s.currency = "$";
    const auto f = learnLocaleFormat(platform({{"pos", "$1,234,567.89"}, {"neg", "($1,234,567.89)"}, {"small", "$1,234.50"}}), kLatin, s, 0);
    CHECK_EQ_STR(fmt(f, 2, 2, -5), "($5.00)");
    CHECK_EQ_STR(fmt(f, 2, 2, 5, SignDisplay::Always), "+$5.00");
  }

  // Percent: the platform multiplies by 100.
  {
    ProbeSymbols s;
    const auto f = learnLocaleFormat(platform({{"pos", "1,234,567.89%"}, {"neg", "-1,234,567.89%"}, {"small", "1,234.50%"}}), kLatin, s, 2);
    CHECK_EQ_STR(fmt(f, 0, 0, 0.256), "26%");
  }

  // ar-EG: Arabic-Indic digits, and marks around the minus sign.
  {
    const auto digits = learnDigits("١٢٣٤٥٦٧٨٩٠");
    CHECK_EQ_STR(digits[0], "٠");
    ProbeSymbols s;
    s.minusSign = "؜-";
    s.plusSign = "؜+";
    const auto f = learnLocaleFormat(
        platform({{"pos", "١٬٢٣٤٬٥٦٧٫٨٩"},
                  {"neg", "؜-١٬٢٣٤٬٥٦٧٫٨٩"},
                  {"small", "١٬٢٣٤٫٥٠"}}),
        digits, s, 0);
    CHECK_EQ_STR(fmt(f, 0, 3, -1234.5), "؜-١٬٢٣٤٫٥");
  }

  // Parts of platform output (compact notation).
  {
    ProbeSymbols s;
    LocaleFormat f;
    std::string out;
    for (const auto& p : partsOfFormatted("-1.2K", f, s, TextKind::Compact, false)) out += std::string(partTypeName(p.type)) + ":" + p.value + " ";
    CHECK_EQ_STR(out, "minusSign:- integer:1 decimal:. fraction:2 compact:K ");
    out.clear();
    for (const auto& p : partsOfFormatted("1.23E-4", f, s, TextKind::Literal, true)) out += std::string(partTypeName(p.type)) + ":" + p.value + " ";
    CHECK_EQ_STR(out, "integer:1 decimal:. fraction:23 exponentSeparator:E exponentMinusSign:- exponentInteger:4 ");
    out.clear();
    for (const auto& p : partsOfFormatted("12 km/h", f, s, TextKind::Unit, false)) out += std::string(partTypeName(p.type)) + ":" + p.value + " ";
    CHECK_EQ_STR(out, "integer:12 literal:  unit:km/h ");
  }

  if (failures == 0) std::printf("NumberFormatProbe: all checks passed\n");
  return failures == 0 ? 0 : 1;
}
