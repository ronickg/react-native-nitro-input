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

  // Compact notation: the powers of ten from the platform, the rounding from ECMA-402 (test262's en-US and ja-JP).
  {
    LocaleFormat f;
    const auto en = learnCompactExponents([](double v) {
      const char* out[] = {"1", "10", "100", "1K", "10K", "100K", "1M", "10M", "100M", "1B", "10B", "100B", "1T", "10T", "100T", "1000T"};
      return std::string(out[static_cast<int>(std::lround(std::log10(v)))]);
    }, f);
    Rounding r; // compact's default: morePrecision of 0 fraction digits and 2 significant digits
    r.minimumFractionDigits = 0;
    r.maximumFractionDigits = 0;
    r.useSignificant = true;
    r.minimumSignificantDigits = 1;
    r.maximumSignificantDigits = 2;
    r.priority = RoundingPriority::MorePrecision;
    auto compact = [&](const std::array<int, 16>& e, double v) {
      Decimal d = roundCompact(Decimal::fromDouble(v), r, e);
      std::string s = d.digits;
      return s + "@" + std::to_string(d.point);
    };
    CHECK_EQ_STR(compact(en, 987654321), "988@9");
    CHECK_EQ_STR(compact(en, 98765), "99@5");
    CHECK_EQ_STR(compact(en, 9876), "99@4");
    CHECK_EQ_STR(compact(en, 159), "159@3");
    CHECK_EQ_STR(compact(en, 15.9), "16@2");
    CHECK_EQ_STR(compact(en, 0.00159), "16@-2");
    CHECK_EQ_STR(compact(en, 999999), "1@7");
    const auto ja = learnCompactExponents([](double v) {
      const char* out[] = {"1", "10", "100", "1000", "1万", "10万", "100万", "1000万", "1億", "10億", "100億", "1000億", "1兆", "10兆", "100兆", "1000兆"};
      return std::string(out[static_cast<int>(std::lround(std::log10(v)))]);
    }, f);
    CHECK_EQ_STR(compact(ja, 98765432), "9877@8");
    CHECK_EQ_STR(compact(ja, 9876), "9876@4");
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
