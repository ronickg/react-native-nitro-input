// Host-side checks for NumberFormatCore. Build & run with `bun run test:cpp`.
//
// The locale formats here are written by hand the way NumberFormatProbe
// learns them on a device; the expected strings are what Intl.NumberFormat
// prints for the same locale and options (V8 / ICU).
#include "numberformat/NumberFormatCore.hpp"

#include <charconv>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <limits>
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

static std::vector<Part> affix(std::string_view text, std::string_view currency = "", std::string_view percent = "%") {
  return NumberFormatCore::splitAffix(text, currency, "-", "+", percent);
}

static LocaleFormat enUS(std::string_view prefix = "", std::string_view currency = "") {
  LocaleFormat f;
  f.positivePrefix = affix(prefix, currency);
  f.negativePrefix = affix(std::string("-") + std::string(prefix), currency);
  f.plusPrefix = affix(std::string("+") + std::string(prefix), currency);
  return f;
}

static LocaleFormat deDE(std::string_view suffix = "", std::string_view currency = "") {
  LocaleFormat f;
  f.decimalSeparator = ",";
  f.groupingSeparator = ".";
  f.positiveSuffix = affix(suffix, currency);
  f.negativePrefix = affix("-");
  f.negativeSuffix = affix(suffix, currency);
  f.plusPrefix = affix("+");
  f.plusSuffix = affix(suffix, currency);
  return f;
}

static Rounding fraction(int min, int max) {
  Rounding r;
  r.minimumFractionDigits = min;
  r.maximumFractionDigits = max;
  return r;
}

static std::string fmt(const LocaleFormat& f, const Rounding& r, double v, SignDisplay s = SignDisplay::Auto, Grouping g = Grouping::Auto) {
  return NumberFormatCore(f, r, g, s).format(Decimal::fromDouble(v));
}

static std::string parts(const LocaleFormat& f, const Rounding& r, double v) {
  std::string out;
  for (const auto& p : NumberFormatCore(f, r, Grouping::Auto, SignDisplay::Auto).formatToParts(Decimal::fromDouble(v))) {
    out += std::string(partTypeName(p.type)) + ":" + p.value + " ";
  }
  return out;
}

int main() {
  // Decimals from doubles are their shortest round-trip form.
  {
    Decimal d = Decimal::fromDouble(1.005);
    CHECK_EQ_STR(d.digits, "1005");
    CHECK_EQ_STR(std::to_string(d.point), "1");
    d = Decimal::fromDouble(0.1 + 0.2);
    CHECK_EQ_STR(d.digits, "30000000000000004");
    d = Decimal::fromDouble(1500);
    CHECK_EQ_STR(d.digits, "15");
    CHECK_EQ_STR(std::to_string(d.point), "4");
    d = Decimal::fromDouble(1e-7);
    CHECK_EQ_STR(d.digits, "1");
    CHECK_EQ_STR(std::to_string(d.point), "-6");
  }

  // The shortest round-trip digits, against to_chars (the host has it), for amounts of every size.
  {
    uint64_t seed = 12345;
    auto next = [&] {
      seed = seed * 6364136223846793005ULL + 1442695040888963407ULL;
      return seed >> 11;
    };
    int mismatches = 0;
    for (int i = 0; i < 200000; i++) {
      double v;
      switch (i % 4) {
        case 0: // cents
          v = static_cast<double>(next() % 100000000000ULL) / 100.0;
          break;
        case 1: // arbitrary doubles across magnitudes
          v = static_cast<double>(next()) / static_cast<double>(1ULL << 53) * std::pow(10.0, static_cast<int>(next() % 30) - 12);
          break;
        case 2: // a few decimals
          v = static_cast<double>(next() % 10000000ULL) / std::pow(10.0, static_cast<int>(next() % 8));
          break;
        default: // any bit pattern that is finite
        {
          uint64_t bits = next() << 11 | (next() & 0x7FF);
          std::memcpy(&v, &bits, sizeof v);
          if (!std::isfinite(v)) v = 1.5;
          break;
        }
      }
      char buffer[64];
      const auto result = std::to_chars(buffer, buffer + sizeof buffer, std::fabs(v), std::chars_format::scientific);
      std::string mantissa;
      const char* p = buffer;
      for (; p < result.ptr && *p != 'e'; p++) {
        if (*p >= '0' && *p <= '9') mantissa.push_back(*p);
      }
      const int exponent = std::atoi(std::string(p + 1, static_cast<const char*>(result.ptr)).c_str());
      while (!mantissa.empty() && mantissa.back() == '0') mantissa.pop_back();
      const Decimal d = Decimal::fromDouble(v);
      const bool same = (v == 0 && d.digits.empty()) || (d.digits == mantissa && d.point == exponent + 1);
      if (!same && mismatches++ < 5) std::printf("FAIL shortest digits of %.17g: %s @%d, to_chars %s @%d\n", v, d.digits.c_str(), d.point, mantissa.c_str(), exponent + 1);
    }
    if (mismatches > 0) failures++;
  }

  // Strings, as Intl.NumberFormat v3 reads them.
  {
    CHECK_EQ_STR(Decimal::fromString("12345678901234567890.125").digits, "12345678901234567890125");
    CHECK_EQ_STR(std::to_string(Decimal::fromString(" -1.5e3 ").point), "4");
    CHECK_EQ_STR(Decimal::fromString("0x1F").digits, "31");
    CHECK_EQ_STR(Decimal::fromString("").digits, "");
    CHECK_EQ_STR(Decimal::fromString("abc").kind == Decimal::Kind::NaN ? "nan" : "number", "nan");
    CHECK_EQ_STR(Decimal::fromString("-Infinity").kind == Decimal::Kind::Infinity ? "inf" : "other", "inf");
    CHECK_EQ_STR(Decimal::fromInt64(INT64_MIN).digits, "9223372036854775808");
  }

  const LocaleFormat usd = enUS("$", "$");
  const Rounding cents = fraction(2, 2);

  // Currency, grouping and rounding half away from zero.
  CHECK_EQ_STR(fmt(usd, cents, 1234.5), "$1,234.50");
  CHECK_EQ_STR(fmt(usd, cents, -1234.5), "-$1,234.50");
  CHECK_EQ_STR(fmt(usd, cents, 1.005), "$1.01");
  CHECK_EQ_STR(fmt(usd, cents, 0.125), "$0.13");
  CHECK_EQ_STR(fmt(usd, cents, -0.125), "-$0.13");
  CHECK_EQ_STR(fmt(usd, cents, 999.995), "$1,000.00");
  CHECK_EQ_STR(fmt(usd, cents, 0), "$0.00");
  CHECK_EQ_STR(fmt(usd, cents, -0.0), "-$0.00");
  CHECK_EQ_STR(fmt(usd, cents, -0.001), "-$0.00");
  CHECK_EQ_STR(fmt(usd, cents, 1e21), "$1,000,000,000,000,000,000,000.00");
  CHECK_EQ_STR(fmt(usd, cents, std::numeric_limits<double>::quiet_NaN()), "$NaN");
  CHECK_EQ_STR(fmt(usd, cents, -std::numeric_limits<double>::infinity()), "-$∞");

  // Decimal defaults: up to three fraction digits, trailing zeros dropped.
  const LocaleFormat plain = enUS();
  const Rounding decimal = fraction(0, 3);
  CHECK_EQ_STR(fmt(plain, decimal, 1234.5678), "1,234.568");
  CHECK_EQ_STR(fmt(plain, decimal, 0.1 + 0.2), "0.3");
  CHECK_EQ_STR(fmt(plain, decimal, 1000000), "1,000,000");
  CHECK_EQ_STR(fmt(plain, decimal, 0.0004), "0");
  CHECK_EQ_STR(fmt(plain, decimal, 0.0005), "0.001");

  // Sign display.
  CHECK_EQ_STR(fmt(usd, cents, 5, SignDisplay::Always), "+$5.00");
  CHECK_EQ_STR(fmt(usd, cents, 0, SignDisplay::Always), "+$0.00");
  CHECK_EQ_STR(fmt(usd, cents, 0, SignDisplay::ExceptZero), "$0.00");
  CHECK_EQ_STR(fmt(usd, cents, -0.001, SignDisplay::ExceptZero), "$0.00");
  CHECK_EQ_STR(fmt(usd, cents, -5, SignDisplay::Never), "$5.00");
  CHECK_EQ_STR(fmt(usd, cents, -0.0, SignDisplay::Negative), "$0.00");
  CHECK_EQ_STR(fmt(usd, cents, -5, SignDisplay::Negative), "-$5.00");

  // Grouping.
  CHECK_EQ_STR(fmt(plain, decimal, 1234, SignDisplay::Auto, Grouping::Off), "1234");
  CHECK_EQ_STR(fmt(plain, decimal, 1234, SignDisplay::Auto, Grouping::Min2), "1234");
  CHECK_EQ_STR(fmt(plain, decimal, 12345, SignDisplay::Auto, Grouping::Min2), "12,345");
  {
    LocaleFormat es = deDE();
    es.minimumGroupingDigits = 2;
    CHECK_EQ_STR(fmt(es, decimal, 1234), "1234");
    CHECK_EQ_STR(fmt(es, decimal, 12345), "12.345");
    CHECK_EQ_STR(fmt(es, decimal, 1234, SignDisplay::Auto, Grouping::Always), "1.234");
  }
  {
    LocaleFormat inr = enUS("₹", "₹");
    inr.secondaryGroupingSize = 2;
    CHECK_EQ_STR(fmt(inr, cents, 123456789.5), "₹12,34,56,789.50");
    CHECK_EQ_STR(fmt(inr, cents, 1000), "₹1,000.00");
  }

  // A suffixed currency.
  {
    const LocaleFormat eur = deDE(" €", "€");
    CHECK_EQ_STR(fmt(eur, cents, 1234.5), "1.234,50 €");
    CHECK_EQ_STR(fmt(eur, cents, -1234.5), "-1.234,50 €");
  }

  // Significant digits and rounding priority.
  {
    Rounding sig;
    sig.useFraction = false;
    sig.useSignificant = true;
    sig.maximumSignificantDigits = 3;
    CHECK_EQ_STR(fmt(plain, sig, 123456), "123,000");
    CHECK_EQ_STR(fmt(plain, sig, 0.0012345), "0.00123");
    CHECK_EQ_STR(fmt(plain, sig, 9.999), "10");
    sig.minimumSignificantDigits = 3;
    CHECK_EQ_STR(fmt(plain, sig, 9.999), "10.0");
    CHECK_EQ_STR(fmt(plain, sig, 0), "0.00");
    CHECK_EQ_STR(fmt(plain, sig, 1.5), "1.50");

    Rounding both = fraction(0, 1);
    both.useSignificant = true;
    both.maximumSignificantDigits = 2;
    both.priority = RoundingPriority::MorePrecision;
    CHECK_EQ_STR(fmt(plain, both, 1.23456), "1.2");
    CHECK_EQ_STR(fmt(plain, both, 0.0123), "0.012");
    both.priority = RoundingPriority::LessPrecision;
    CHECK_EQ_STR(fmt(plain, both, 0.0123), "0");
    CHECK_EQ_STR(fmt(plain, both, 123.45), "120");
  }

  // Rounding modes and increments.
  {
    Rounding r = fraction(0, 0);
    r.mode = RoundingMode::HalfEven;
    CHECK_EQ_STR(fmt(plain, r, 2.5), "2");
    CHECK_EQ_STR(fmt(plain, r, 3.5), "4");
    r.mode = RoundingMode::Ceil;
    CHECK_EQ_STR(fmt(plain, r, -2.5), "-2");
    CHECK_EQ_STR(fmt(plain, r, 2.1), "3");
    r.mode = RoundingMode::Floor;
    CHECK_EQ_STR(fmt(plain, r, -2.1), "-3");
    r.mode = RoundingMode::Trunc;
    CHECK_EQ_STR(fmt(plain, r, -2.9), "-2");
    r.mode = RoundingMode::HalfTrunc;
    CHECK_EQ_STR(fmt(plain, r, 2.5), "2");
    CHECK_EQ_STR(fmt(plain, r, 2.51), "3");

    Rounding nickel = fraction(2, 2);
    nickel.increment = 5;
    CHECK_EQ_STR(fmt(usd, nickel, 1.22), "$1.20");
    CHECK_EQ_STR(fmt(usd, nickel, 1.225), "$1.25");
    CHECK_EQ_STR(fmt(usd, nickel, 1.2749), "$1.25");
    CHECK_EQ_STR(fmt(usd, nickel, 1.275), "$1.30");
    CHECK_EQ_STR(fmt(usd, nickel, 0.02), "$0.00");
    CHECK_EQ_STR(fmt(usd, nickel, 0.03), "$0.05");
    CHECK_EQ_STR(fmt(usd, nickel, 999.98), "$1,000.00");

    Rounding quarter = fraction(2, 2);
    quarter.increment = 25;
    CHECK_EQ_STR(fmt(usd, quarter, 1.13), "$1.25");
    CHECK_EQ_STR(fmt(usd, quarter, 1.12), "$1.00");
  }

  // Minimum integer digits and trailing zeros.
  {
    Rounding r = fraction(0, 3);
    r.minimumIntegerDigits = 4;
    CHECK_EQ_STR(fmt(plain, r, 1), "0,001");
    Rounding strip = fraction(2, 2);
    strip.trailingZeroDisplay = TrailingZeroDisplay::StripIfInteger;
    CHECK_EQ_STR(fmt(usd, strip, 5), "$5");
    CHECK_EQ_STR(fmt(usd, strip, 5.1), "$5.10");
    CHECK_EQ_STR(fmt(usd, strip, 4.999), "$5");
  }

  // Percent.
  {
    LocaleFormat pct = enUS();
    pct.positiveSuffix = affix("%");
    pct.negativeSuffix = affix("%");
    pct.scale = 2;
    CHECK_EQ_STR(fmt(pct, fraction(0, 0), 0.256), "26%");
    CHECK_EQ_STR(fmt(pct, fraction(0, 0), -0.5), "-50%");
  }

  // Parts.
  CHECK_EQ_STR(parts(usd, cents, -1234.5), "minusSign:- currency:$ integer:1 group:, integer:234 decimal:. fraction:50 ");
  CHECK_EQ_STR(parts(deDE(" €", "€"), cents, 5), "integer:5 decimal:, fraction:00 literal:  currency:€ ");

  // Direction marks around a symbol are literals of their own, as in V8.
  {
    std::string out;
    for (const auto& p : NumberFormatCore::splitAffix("\u061C-", "", "\u061C-", "\u061C+", "%")) out += std::string(partTypeName(p.type)) + ":" + p.value + " ";
    CHECK_EQ_STR(out, "literal:\u061C minusSign:- ");
    out.clear();
    for (const auto& p : NumberFormatCore::splitAffix(" \u062F.\u0628.\u200F", "\u062F.\u0628.\u200F", "-", "+", "%")) out += std::string(partTypeName(p.type)) + ":" + p.value + " ";
    CHECK_EQ_STR(out, "literal:  currency:\u062F.\u0628. literal:\u200F ");
  }

  // Native digits.
  {
    LocaleFormat arab = enUS();
    arab.digits = {"٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"};
    arab.groupingSeparator = "٬";
    arab.decimalSeparator = "٫";
    CHECK_EQ_STR(fmt(arab, fraction(0, 3), 1234.5), "١٬٢٣٤٫٥");
  }

  if (failures == 0) std::printf("NumberFormatCore: all checks passed\n");
  return failures == 0 ? 0 : 1;
}
