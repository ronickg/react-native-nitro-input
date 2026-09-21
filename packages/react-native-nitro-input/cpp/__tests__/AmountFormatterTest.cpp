// Host-side checks for the amount model. Build & run with `bun run test:cpp`.
//
// `MorphEngineTest.cpp` exercises the formatter incidentally, through the
// engine. These are the formatter's own checks: the programmatic entry points
// (`format`, `value`, `normalize`) and the invariants that are easy to break
// from inside `formatRaw`.
#include "AmountFormatter.hpp"

#include <clocale>
#include <cmath>
#include <cstdio>
#include <string>

using margelo::nitro::nitroinput::AmountFormatter;

static int failures = 0;

#define CHECK(cond)                                                                   \
  do {                                                                                \
    if (!(cond)) {                                                                    \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);                     \
      failures++;                                                                     \
    }                                                                                 \
  } while (0)

#define CHECK_EQ_STR(actual, expected)                                                        \
  do {                                                                                        \
    const std::string a_ = (actual);                                                          \
    const std::string e_ = (expected);                                                        \
    if (a_ != e_) {                                                                           \
      std::printf("FAIL %s:%d: %s == \"%s\", expected \"%s\"\n", __FILE__, __LINE__, #actual, \
                  a_.c_str(), e_.c_str());                                                    \
      failures++;                                                                             \
    }                                                                                         \
  } while (0)

#define CHECK_EQ_NUM(actual, expected)                                                    \
  do {                                                                                    \
    const double a_ = (actual);                                                           \
    const double e_ = (expected);                                                         \
    if (!(std::fabs(a_ - e_) < 1e-9)) {                                                   \
      std::printf("FAIL %s:%d: %s == %.10g, expected %.10g\n", __FILE__, __LINE__,        \
                  #actual, a_, e_);                                                       \
      failures++;                                                                         \
    }                                                                                     \
  } while (0)

static AmountFormatter usFormatter(int fractionDigits = 2, int maxIntegerDigits = 15) {
  AmountFormatter f;
  f.setFormat(fractionDigits, maxIntegerDigits, ",", ".");
  return f;
}

static AmountFormatter deFormatter(int fractionDigits = 2) {
  AmountFormatter f;
  f.setFormat(fractionDigits, 15, ".", ",");
  return f;
}

// MARK: - format(double)

static void formatGroupsAndTrimsTrailingZeros() {
  const auto f = usFormatter();
  CHECK_EQ_STR(f.format(0), "0");
  CHECK_EQ_STR(f.format(5), "5");
  CHECK_EQ_STR(f.format(1234.5), "1,234.5");
  CHECK_EQ_STR(f.format(1234.56), "1,234.56");
  CHECK_EQ_STR(f.format(1000), "1,000");
  CHECK_EQ_STR(f.format(1000000), "1,000,000");
  // Trailing zeros go, but zeros inside the integer part stay.
  CHECK_EQ_STR(f.format(1200.00), "1,200");
  CHECK_EQ_STR(f.format(0.5), "0.5");
  CHECK_EQ_STR(f.format(0.50), "0.5");
}

static void formatHonoursTheFormat() {
  CHECK_EQ_STR(usFormatter(0).format(1234.56), "1,235"); // rounded, no fraction
  CHECK_EQ_STR(deFormatter().format(1234.5), "1.234,5");
  AmountFormatter plain;
  plain.setFormat(2, 15, "", ".");
  CHECK_EQ_STR(plain.format(1234.5), "1234.5");
}

static void formatRejectsNonFinite() {
  const auto f = usFormatter();
  CHECK_EQ_STR(f.format(std::nan("")), "");
  CHECK_EQ_STR(f.format(INFINITY), "");
  CHECK_EQ_STR(f.format(-INFINITY), "");
}

/// Regression: `format` used `std::fabs`, so every negative amount came back
/// positive and `format(value(x))` silently changed the sign.
static void formatKeepsTheSign() {
  const auto f = usFormatter();
  CHECK_EQ_STR(f.format(-5), "-5");
  CHECK_EQ_STR(f.format(-1234.5), "-1,234.5");
  CHECK_EQ_STR(f.format(-0.5), "-0.5");
  CHECK_EQ_STR(deFormatter().format(-1234.5), "-1.234,5");
  // -0.0 is not a negative amount.
  CHECK_EQ_STR(f.format(-0.0), "0");
  // Rounding to nothing must not leave a stray sign.
  CHECK_EQ_STR(usFormatter(0).format(-0.4), "0");
}

// MARK: - value(string)

static void valueReadsFormattedText() {
  const auto f = usFormatter();
  CHECK_EQ_NUM(f.value("1,234.5"), 1234.5);
  CHECK_EQ_NUM(f.value("0"), 0);
  CHECK_EQ_NUM(f.value("1,000,000"), 1000000);
  CHECK(std::isnan(f.value("")));
  CHECK(std::isnan(f.value(".")));
  CHECK_EQ_NUM(deFormatter().value("1.234,5"), 1234.5);
}

/// Regression: the sign was not part of the accepted character set, so a
/// negative amount read back positive.
static void valueReadsTheSign() {
  const auto f = usFormatter();
  CHECK_EQ_NUM(f.value("-1,234.5"), -1234.5);
  CHECK_EQ_NUM(f.value("-0.5"), -0.5);
  CHECK(std::isnan(f.value("-")));
  CHECK_EQ_NUM(deFormatter().value("-1.234,5"), -1234.5);
}

static void formatAndValueRoundTrip() {
  const auto f = usFormatter();
  const double samples[] = {0, 1, 5, 0.5, 1234.5, 1234.56, 1000000, -5, -1234.5, -0.5};
  for (double sample : samples) {
    CHECK_EQ_NUM(f.value(f.format(sample)), sample);
  }
}

// MARK: - normalize(string)

static void normalizeFormatsArbitraryText() {
  const auto f = usFormatter();
  CHECK_EQ_STR(f.normalize("1234.5").text, "1,234.5");
  CHECK_EQ_STR(f.normalize("1,234.5").text, "1,234.5");
  // Truncates instead of rejecting.
  CHECK_EQ_STR(f.normalize("1.239").text, "1.23");
  // A bare fraction gains its leading zero.
  CHECK_EQ_STR(f.normalize(".5").text, "0.5");
  CHECK_EQ_STR(f.normalize("").text, "");
  // Junk is dropped.
  CHECK_EQ_STR(f.normalize("$1,234.50 USD").text, "1,234.50");
}

static void normalizeKeepsTheSign() {
  const auto f = usFormatter();
  CHECK_EQ_STR(f.normalize("-1234.5").text, "-1,234.5");
  CHECK_EQ_STR(f.normalize("-.5").text, "-0.5");
  // Only a leading sign counts.
  CHECK_EQ_STR(f.normalize("1-234").text, "1,234");
  CHECK_EQ_STR(f.normalize("-").text, "");
}

// MARK: - Locale independence

/// Regression: `format` went through `snprintf("%.*f")` and `value` through
/// `strtod`, both of which follow `LC_NUMERIC`. Any native dependency in the
/// host app that calls `setlocale` turned "1234.5" into "123,4,5".
static void formatterIgnoresTheCLocale() {
  const char* previous = std::setlocale(LC_NUMERIC, nullptr);
  const std::string saved = previous != nullptr ? previous : "C";
  // Any locale whose decimal separator is a comma will do.
  const char* candidates[] = {"de_DE.UTF-8", "de_DE", "fr_FR.UTF-8", "nl_NL.UTF-8"};
  bool applied = false;
  for (const char* candidate : candidates) {
    if (std::setlocale(LC_NUMERIC, candidate) != nullptr) {
      applied = true;
      break;
    }
  }
  if (!applied) {
    std::printf("SKIP no comma-decimal locale on this host; locale independence unverified\n");
    return;
  }

  const auto f = usFormatter();
  CHECK_EQ_STR(f.format(1234.5), "1,234.5");
  CHECK_EQ_STR(f.format(-1234.5), "-1,234.5");
  CHECK_EQ_STR(f.format(0.25), "0.25");
  CHECK_EQ_NUM(f.value("1,234.5"), 1234.5);
  CHECK_EQ_NUM(f.value("-0.25"), -0.25);
  CHECK_EQ_STR(deFormatter().format(1234.5), "1.234,5");
  CHECK_EQ_NUM(deFormatter().value("1.234,5"), 1234.5);

  std::setlocale(LC_NUMERIC, saved.c_str());
}

// MARK: - Limits

static void limitsAreEnforced() {
  const auto f = usFormatter(2, 4);
  // applyEdit rejects past the limit and hands back the input unchanged.
  const auto rejected = f.applyEdit("1,234", 5, 5, "5");
  CHECK(!rejected.accepted);
  CHECK_EQ_STR(rejected.text, "1,234");
  // normalize truncates instead.
  CHECK_EQ_STR(f.normalize("123456").text, "1,234");
  const auto tooManyDecimals = f.applyEdit("1.23", 4, 4, "4");
  CHECK(!tooManyDecimals.accepted);
  CHECK_EQ_STR(tooManyDecimals.text, "1.23");
  // A rejected edit on signed text must hand back the caret it was given,
  // in offsets into the signed string.
  const auto signedReject = f.applyEdit("-1,234", 6, 6, "5");
  CHECK(!signedReject.accepted);
  CHECK_EQ_STR(signedReject.text, "-1,234");
  CHECK(signedReject.caret == 6);
}

/// The sign is carried through an edit but can never be typed.
static void editingPreservesTheSign() {
  const auto f = usFormatter();
  auto e = f.applyEdit("-12", 3, 3, "3");
  CHECK(e.accepted);
  CHECK_EQ_STR(e.text, "-123");
  CHECK(e.caret == 4);
  // Backspacing back to nothing drops the sign with the digits.
  e = f.applyEdit("-1", 1, 2, "");
  CHECK_EQ_STR(e.text, "");
  // Typing a minus does nothing - it is not an accepted character.
  e = f.applyEdit("12", 2, 2, "-");
  CHECK_EQ_STR(e.text, "12");
  e = f.applyEdit("12", 0, 0, "-");
  CHECK_EQ_STR(e.text, "12");
  // The caret never parks in front of the sign.
  e = f.applyEdit("-123", 1, 1, "9");
  CHECK_EQ_STR(e.text, "-9,123");
  CHECK(e.caret == 2);
}

static void setFormatClampsItsArguments() {
  AmountFormatter f;
  // fractionDigits clamps to [0, 9], maxIntegerDigits to [1, 30].
  f.setFormat(-3, 99, ",", ".");
  // fractionDigits clamped to 0. snprintf rounds half to even, so .5 goes both ways.
  CHECK_EQ_STR(f.format(1234.5), "1,234");
  CHECK_EQ_STR(f.format(1235.5), "1,236");
  CHECK_EQ_STR(f.format(1234.6), "1,235");
  f.setFormat(2, 0, ",", ".");
  CHECK_EQ_STR(f.normalize("1234.5").text, "1.5"); // maxIntegerDigits clamped to 1
  f.setFormat(99, 99, ",", ".");
  CHECK_EQ_STR(f.normalize("1.1234567891").text, "1.123456789"); // clamped to 9
  // A grouping separator equal to the decimal is dropped.
  AmountFormatter same;
  same.setFormat(2, 15, ".", ".");
  CHECK_EQ_STR(same.format(1234.5), "1234.5");
}

// MARK: - Character classification

static void kindOfClassifies() {
  const auto f = usFormatter();
  CHECK(f.kindOf('0') == 1);
  CHECK(f.kindOf('9') == 1);
  CHECK(f.kindOf(',') == 2);
  CHECK(f.kindOf('.') == 3);
  CHECK(f.kindOf('$') == 0);
  CHECK(f.isGrouping(','));
  CHECK(!f.isGrouping('.'));
  CHECK(f.isDecimal('.'));
}

// MARK: - UTF-8

static void utf8RoundTrips() {
  const std::string samples[] = {"", "abc", "1,234.56", "€1.234,56", "a\xF0\x9F\x98\x80z"};
  for (const std::string& sample : samples) {
    CHECK_EQ_STR(AmountFormatter::encode(AmountFormatter::decode(sample)), sample);
  }
  CHECK(AmountFormatter::codePointCount("a\xF0\x9F\x98\x80z") == 3);
  CHECK(AmountFormatter::codePointCount("€") == 1);
}

static void utf8SeparatorsCanBeMultiByte() {
  AmountFormatter f;
  // Narrow no-break space grouping, comma decimal - the fr-FR convention.
  f.setFormat(2, 15, "\xE2\x80\xAF", ",");
  CHECK_EQ_STR(f.format(1234.5), "1\xE2\x80\xAF"
                                 "234,5");
  CHECK_EQ_NUM(f.value("1\xE2\x80\xAF"
                       "234,5"),
               1234.5);
}

int main() {
  formatGroupsAndTrimsTrailingZeros();
  formatHonoursTheFormat();
  formatRejectsNonFinite();
  formatKeepsTheSign();
  valueReadsFormattedText();
  valueReadsTheSign();
  formatAndValueRoundTrip();
  normalizeFormatsArbitraryText();
  normalizeKeepsTheSign();
  formatterIgnoresTheCLocale();
  limitsAreEnforced();
  editingPreservesTheSign();
  setFormatClampsItsArguments();
  kindOfClassifies();
  utf8RoundTrips();
  utf8SeparatorsCanBeMultiByte();
  if (failures == 0) {
    std::printf("AmountFormatter: all checks passed\n");
    return 0;
  }
  std::printf("AmountFormatter: %d check(s) failed\n", failures);
  return 1;
}
