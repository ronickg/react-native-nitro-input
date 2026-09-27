// Edge cases ported from established mask libraries, run against MaskEngine.
//
//   RedMadRobot/input-mask-android   (MIT)  inputmask/src/test/kotlin/...
//   RedMadRobot/input-mask-ios       (MIT)  Source/InputMask/InputMaskTests/...
//   IvanIhnatsiuk/react-native-advanced-input-mask (MIT)  e2e/.maestro/*.yaml
//   beholdr/maska                    (MIT)  test/mask.test.ts, test/input.test.ts
//
// Every group names the upstream file it was ported from. Their
// `Mask.apply(CaretString(text, caret, gravity))` maps to our
// `apply(text, caret, caretForward, autocomplete, autoSkip)`:
//   .forward(autocomplete: x)  ->  apply(text, caret, true,  x,     false)
//   .backward(autoskip: x)     ->  apply(text, caret, false, false, x)
// Keystroke, deletion and paste cases go through `applyEdit`.
//
// Where our engine intentionally differs from the reference, the expectation
// is adjusted and the line says "DIVERGENCE (n)" (see MaskEngine.cpp `apply`):
//   (1) trailing constants autocomplete once the caret is at the end of input
//   (2) an empty text never autocompletes leading literals
//   (3) offsets are code points     (4) a bad format returns false
//   (5) letter slots take common non-ASCII scripts
//   (A) affinity formats are compared on value characters only, ties go to
//       the incumbent (the format whose output shares the longer prefix)
// (1) needed no adjustment: upstream's own autocomplete cases ("1111" ->
// "1111 AC", "11" -> "11.", "+7" -> "+7 (") already autocomplete trailing
// constants when the caret is at the end, because its FORWARD gravity is
// `index <= caret` (see `fixedGaps()`).
// Two engine bugs this corpus found are fixed; their cases stay in
// `fixedGaps()` as regular checks, so they cannot come back.
//
// Build & run (from packages/react-native-nitro-input):
//   clang++ -std=c++20 -O1 -Wall -Wextra -Icpp cpp/AmountFormatter.cpp cpp/MaskEngine.cpp \
//     cpp/__tests__/MaskEngineCorpusTest.cpp -o .cache/mask-engine-corpus-test && .cache/mask-engine-corpus-test
#include "MaskEngine.hpp"

#include <climits>
#include <cstdio>
#include <iterator>
#include <string>
#include <vector>

using margelo::nitro::nitroinput::MaskEngine;

static int failures = 0;
static int checks = 0;
static int* failureCounter = &failures;

#define CHECK(cond)                                                                   \
  do {                                                                                \
    checks++;                                                                         \
    if (!(cond)) {                                                                    \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);                     \
      (*failureCounter)++;                                                            \
    }                                                                                 \
  } while (0)

#define CHECK_EQ_STR(actual, expected)                                                        \
  do {                                                                                        \
    checks++;                                                                                 \
    const std::string a_ = (actual);                                                          \
    const std::string e_ = (expected);                                                        \
    if (a_ != e_) {                                                                           \
      std::printf("%s %s:%d: %s == \"%s\", expected \"%s\"\n",                                \
                  "FAIL", __FILE__, __LINE__, #actual, \
                  a_.c_str(), e_.c_str());                                                    \
      (*failureCounter)++;                                                                    \
    }                                                                                         \
  } while (0)

#define CHECK_EQ_INT(actual, expected)                                                 \
  do {                                                                                 \
    checks++;                                                                          \
    const int a_ = static_cast<int>(actual);                                           \
    const int e_ = static_cast<int>(expected);                                         \
    if (a_ != e_) {                                                                    \
      std::printf("%s %s:%d: %s == %d, expected %d\n",                                 \
                  "FAIL", __FILE__, __LINE__,   \
                  #actual, a_, e_);                                                    \
      (*failureCounter)++;                                                             \
    }                                                                                  \
  } while (0)

using Result = MaskEngine::Result;
using Notations = std::vector<MaskEngine::Notation>;

static std::vector<uint32_t> codePoints(const std::string& s) {
  std::vector<uint32_t> out;
  for (size_t i = 0; i < s.size();) {
    const unsigned char lead = static_cast<unsigned char>(s[i]);
    const size_t length = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
    uint32_t c = length == 1 ? lead : lead & (0xFF >> (length + 1));
    for (size_t k = 1; k < length && i + k < s.size(); ++k) c = (c << 6) | (s[i + k] & 0x3F);
    out.push_back(c);
    i += length;
  }
  return out;
}

static int length(const std::string& s) {
  return static_cast<int>(codePoints(s).size());
}

static MaskEngine make(const std::string& format, const Notations& notations = {}) {
  MaskEngine engine;
  CHECK(engine.setFormat(format, notations));
  return engine;
}

/// Types `keys` one code point at a time at the caret of `state`, like a
/// keyboard. "\b" is a backspace.
static Result typeFrom(const MaskEngine& engine, Result state, const std::string& keys, bool autocomplete = true,
                       bool autoSkip = false) {
  for (size_t i = 0; i < keys.size();) {
    const unsigned char lead = static_cast<unsigned char>(keys[i]);
    const size_t n = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
    if (keys[i] == '\b') {
      if (state.caret > 0) {
        state = engine.applyEdit(state.formattedText, state.caret - 1, state.caret, "", autocomplete, autoSkip);
      }
    } else {
      state = engine.applyEdit(state.formattedText, state.caret, state.caret, keys.substr(i, n), autocomplete,
                               autoSkip);
    }
    i += n;
  }
  return state;
}

static Result type(const MaskEngine& engine, const std::string& keys, bool autocomplete = true,
                   bool autoSkip = false) {
  return typeFrom(engine, Result{}, keys, autocomplete, autoSkip);
}

/// `state` with the caret moved to `caret`, as if the user tapped there.
static Result at(Result state, int caret) {
  state.caret = caret;
  return state;
}

/// Backspace at `caret` (deletes the code point before it).
static Result backspaceAt(const MaskEngine& engine, const Result& state, int caret, bool autoSkip = false) {
  return engine.applyEdit(state.formattedText, caret - 1, caret, "", false, autoSkip);
}

/// Forward-delete at `caret` (deletes the code point after it).
static Result deleteAt(const MaskEngine& engine, const Result& state, int caret, bool autoSkip = false) {
  return engine.applyEdit(state.formattedText, caret, caret + 1, "", false, autoSkip);
}

/// A whole-string `apply` with the caret at the end: maska's `masked()`.
static Result masked(const MaskEngine& engine, const std::string& text, bool eager = false) {
  return engine.apply(text, length(text), true, eager, false);
}

// MARK: - Table-driven RedMadRobot cases

constexpr int kNoAffinity = INT_MIN;

/// One `Mask.apply(CaretString(...))` test. `complete` is -1 when upstream
/// does not assert it; `affinity` is `kNoAffinity` likewise.
struct ApplyCase {
  const char* name;
  int line;
  const char* input;
  int caret;
  bool forward;
  bool flag; // autocomplete when forward, autoskip when backward
  const char* text;
  int caretOut;
  const char* value;
  int complete;
  int affinity;
};

struct Suite {
  const char* source;
  const char* format;
  Notations notations;
  const char* placeholder;
  int placeholderLine;
  const ApplyCase* cases;
  size_t count;
};

static void runCase(const char* source, const MaskEngine& engine, const ApplyCase& c) {
  const Result r = c.forward ? engine.apply(c.input, c.caret, true, c.flag, false)
                             : engine.apply(c.input, c.caret, false, false, c.flag);
  const char* tag = "FAIL";
  const auto report = [&](const char* what, const std::string& actual, const std::string& expected) {
    std::printf("%s %s:%d %s: %s == \"%s\", expected \"%s\" (input \"%s\", caret %d, %s)\n", tag, source, c.line,
                c.name, what, actual.c_str(), expected.c_str(), c.input, c.caret,
                c.forward ? (c.flag ? "forward+autocomplete" : "forward") : (c.flag ? "backward+autoskip" : "backward"));
    (*failureCounter)++;
  };
  checks += 3;
  if (r.formattedText != c.text) report("formattedText", r.formattedText, c.text);
  if (r.caret != c.caretOut) report("caret", std::to_string(r.caret), std::to_string(c.caretOut));
  if (r.extractedValue != c.value) report("extractedValue", r.extractedValue, c.value);
  if (c.complete >= 0) {
    checks++;
    if (r.complete != (c.complete == 1)) report("complete", r.complete ? "true" : "false", c.complete ? "true" : "false");
  }
  if (c.affinity != kNoAffinity) {
    checks++;
    if (r.affinity != c.affinity) report("affinity", std::to_string(r.affinity), std::to_string(c.affinity));
  }
}

static void runSuite(const Suite& suite) {
  MaskEngine engine;
  checks++;
  if (!engine.setFormat(suite.format, suite.notations)) {
    std::printf("FAIL %s: setFormat(\"%s\") refused\n", suite.source, suite.format);
    (*failureCounter)++;
    return;
  }
  // `mask.placeholder` is the tail placeholder of an empty field (null: not
  // checked).
  const Result empty = engine.apply("", 0, true, false, false);
  if (suite.placeholder != nullptr) {
    checks++;
    if (empty.tailPlaceholder != suite.placeholder) {
      std::printf("%s %s:%d placeholder == \"%s\", expected \"%s\"\n", "FAIL",
                  suite.source, suite.placeholderLine, empty.tailPlaceholder.c_str(), suite.placeholder);
      (*failureCounter)++;
    }
  }
  for (size_t i = 0; i < suite.count; ++i) runCase(suite.source, engine, suite.cases[i]);
}

// "[9999][.][99]" with `Notation(".", ".", isOptional: true)`.
static Notations decimalNotations() {
  return {MaskEngine::Notation{'.', {'.'}, true}};
}

// "[C…]" with `CharacterSet.letters ∪ " "`. The cases only type ASCII, so the
// set is ASCII letters and a space.
static Notations nameNotations() {
  MaskEngine::Notation n{'C', {' '}, false};
  for (uint32_t c = 'a'; c <= 'z'; ++c) n.characterSet.push_back(c);
  for (uint32_t c = 'A'; c <= 'Z'; ++c) n.characterSet.push_back(c);
  return {n};
}

// MARK: - RedMadRobot/input-mask-android
// https://github.com/RedMadRobot/input-mask-android/tree/master/inputmask/src/test/kotlin/com/redmadrobot/inputmask/helper

// Ported from inputmask/src/test/kotlin/com/redmadrobot/inputmask/helper/YearTest.kt (format "[0099]", 4 cases).
static const ApplyCase kAndroidYear[] = {
    {"apply_1_returns_1", 81, "1", 1, true, false, "1", 1, "1", 0, 1},
    {"apply_11_returns_11", 100, "11", 2, true, false, "11", 2, "11", 1, 2},
    {"apply_112_returns_112", 119, "112", 3, true, false, "112", 3, "112", 1, 3},
    {"apply_1122_returns_1122", 138, "1122", 4, true, false, "1122", 4, "1122", 1, 4},
};

// Ported from inputmask/src/test/kotlin/com/redmadrobot/inputmask/helper/YearACTest.kt (format "[9990] AC", 6 cases).
static const ApplyCase kAndroidYearAC[] = {
    {"apply_1_return_1", 81, "1", 1, true, false, "1", 1, "1", 1, kNoAffinity},
    {"apply_11_return_11", 99, "11", 2, true, false, "11", 2, "11", 1, kNoAffinity},
    {"apply_111_return_111", 117, "111", 3, true, false, "111", 3, "111", 1, kNoAffinity},
    {"apply_1111_return_1111", 135, "1111", 4, true, false, "1111", 4, "1111", 1, kNoAffinity},
    {"apply_11112_return_1111spaceAC", 153, "11112", 5, true, false, "1111 AC", 7, "1111", 1, kNoAffinity},
    {"applyAutocomplete_1111_return_1111spaceAC", 171, "1111", 4, true, true, "1111 AC", 7, "1111", 1, kNoAffinity},
};

// Ported from inputmask/src/test/kotlin/com/redmadrobot/inputmask/helper/PhoneTest.kt (format "+7 ([000]) [000] [00] [00]", 32 cases).
static const ApplyCase kAndroidPhone[] = {
    {"apply_plus_return_plus", 81, "+", 1, true, false, "+", 1, "", 0, kNoAffinity},
    {"apply_plus7_return_plus7", 99, "+7", 2, true, false, "+7", 2, "", 0, kNoAffinity},
    {"apply_plus7space_return_plus7space", 117, "+7 ", 3, true, false, "+7 ", 3, "", 0, kNoAffinity},
    {"apply_plus7spaceBrace_return_plus7spaceBrace", 135, "+7 (", 4, true, false, "+7 (", 4, "", 0, kNoAffinity},
    {"apply_plus7spaceBrace1_return_plus7spaceBrace1", 153, "+7 (1", 5, true, false, "+7 (1", 5, "1", 0, kNoAffinity},
    {"apply_plus7spaceBrace12_return_plus7spaceBrace12", 171, "+7 (12", 6, true, false, "+7 (12", 6, "12", 0, kNoAffinity},
    {"apply_plus7spaceBrace123_return_plus7spaceBrace123", 189, "+7 (123", 7, true, false, "+7 (123", 7, "123", 0, kNoAffinity},
    {"apply_plus7spaceBrace123brace_return_plus7spaceBrace123brace", 207, "+7 (123)", 8, true, false, "+7 (123)", 8, "123", 0, kNoAffinity},
    {"apply_plus7spaceBrace123braceSpace_return_plus7spaceBrace123braceSpace", 225, "+7 (123) ", 9, true, false, "+7 (123) ", 9, "123", 0, kNoAffinity},
    {"apply_plus7spaceBrace123braceSpace4_return_plus7spaceBrace123braceSpace4", 243, "+7 (123) 4", 10, true, false, "+7 (123) 4", 10, "1234", 0, kNoAffinity},
    {"apply_plus7spaceBrace123braceSpace45_return_plus7spaceBrace123braceSpace45", 261, "+7 (123) 45", 11, true, false, "+7 (123) 45", 11, "12345", 0, kNoAffinity},
    {"apply_plus7spaceBrace123braceSpace456_return_plus7spaceBrace123braceSpace456", 279, "+7 (123) 456", 12, true, false, "+7 (123) 456", 12, "123456", 0, kNoAffinity},
    {"apply_plus7spaceBrace123braceSpace456space_return_plus7spaceBrace123braceSpace456space", 297, "+7 (123) 456 ", 13, true, false, "+7 (123) 456 ", 13, "123456", 0, kNoAffinity},
    {"apply_plus7spaceBrace123braceSpace456space7_return_plus7spaceBrace123braceSpace456space7", 315, "+7 (123) 456 7", 14, true, false, "+7 (123) 456 7", 14, "1234567", 0, kNoAffinity},
    {"apply_plus7spaceBrace123braceSpace456space78_return_plus7spaceBrace123braceSpace456space78", 333, "+7 (123) 456 78", 15, true, false, "+7 (123) 456 78", 15, "12345678", 0, kNoAffinity},
    {"apply_plus7spaceBrace123braceSpace456space78space_return_plus7spaceBrace123braceSpace456space78space", 351, "+7 (123) 456 78 ", 16, true, false, "+7 (123) 456 78 ", 16, "12345678", 0, kNoAffinity},
    {"apply_plus7spaceBrace123braceSpace456space78space9_return_plus7spaceBrace123braceSpace456space78space9", 369, "+7 (123) 456 78 9", 17, true, false, "+7 (123) 456 78 9", 17, "123456789", 0, kNoAffinity},
    {"apply_plus7spaceBrace123braceSpace456space78space90_return_plus7spaceBrace123braceSpace456space78space90", 387, "+7 (123) 456 78 90", 18, true, false, "+7 (123) 456 78 90", 18, "1234567890", 1, kNoAffinity},
    {"apply_7_return_plus7", 405, "7", 1, true, false, "+7", 2, "", 0, kNoAffinity},
    {"apply_9_return_plus7spaceBrace9", 423, "9", 1, true, false, "+7 (9", 5, "9", 0, kNoAffinity},
    {"apply_1234567890_return_plus7spaceBrace123braceSpace456space78space90", 441, "1234567890", 10, true, false, "+7 (123) 456 78 90", 18, "1234567890", 1, kNoAffinity},
    {"apply_12345678901_return_plus7spaceBrace123braceSpace456space78space90", 459, "12345678901", 11, true, false, "+7 (123) 456 78 90", 18, "1234567890", 1, kNoAffinity},
    {"apply_plus1234567890_return_plus7spaceBrace123braceSpace456space78space90", 477, "+1234567890", 11, true, false, "+7 (123) 456 78 90", 18, "1234567890", 1, kNoAffinity},
    {"apply_plusBrace123brace456dash78dash90_return_plus7spaceBrace123braceSpace456space78space90", 495, "+(123)456-78-90", 15, true, false, "+7 (123) 456 78 90", 18, "1234567890", 1, kNoAffinity},
    {"applyAutocomplete_empty_return_plus7spaceBrace", 513, "", 0, true, true, "", 0, "", 0, kNoAffinity},  // DIVERGENCE (2): upstream "+7 (", caret 4
    {"applyAutocomplete_plus_return_plus7spaceBrace", 531, "+", 1, true, true, "+7 (", 4, "", 0, kNoAffinity},
    {"applyAutocomplete_plus7_return_plus7spaceBrace", 549, "+7", 2, true, true, "+7 (", 4, "", 0, kNoAffinity},
    {"applyAutocomplete_plus7space_return_plus7spaceBrace", 567, "+7 ", 3, true, true, "+7 (", 4, "", 0, kNoAffinity},
    {"applyAutocomplete_plus7spaceBrace_return_plus7spaceBrace", 585, "+7 (", 4, true, true, "+7 (", 4, "", 0, kNoAffinity},
    {"applyAutocomplete_a_return_plus7spaceBrace", 603, "a", 1, true, true, "+7 (", 4, "", 0, kNoAffinity},
    {"applyAutocomplete_aPlus7spaceBrace_return_plus7spaceBrace", 621, "a+7 (", 5, true, true, "+7 (7", 5, "7", 0, kNoAffinity},
    {"applyAutocomplete_7space_return_plus7spaceBrace", 639, "7 ", 2, true, true, "+7 (", 4, "", 0, kNoAffinity},
};

// Ported from inputmask/src/test/kotlin/com/redmadrobot/inputmask/helper/DayMonthYearMaskTest.kt (format "[00]{.}[00]{.}[0000]", 26 cases).
static const ApplyCase kAndroidDayMonthYearMask[] = {
    {"apply_1_returns_1", 81, "1", 1, true, false, "1", 1, "1", 0, kNoAffinity},
    {"apply_11_returns_11", 101, "11", 2, true, false, "11", 2, "11", 0, kNoAffinity},
    {"apply_111_returns_11dot1", 121, "111", 3, true, false, "11.1", 4, "11.1", 0, kNoAffinity},
    {"apply_1111_returns_11dot11", 141, "1111", 4, true, false, "11.11", 5, "11.11", 0, kNoAffinity},
    {"apply_123456_returns_12dot34dot56", 161, "123456", 6, true, false, "12.34.56", 8, "12.34.56", 0, kNoAffinity},
    {"apply_12dot3_returns_12dot3", 181, "12.3", 4, true, false, "12.3", 4, "12.3", 0, kNoAffinity},
    {"apply_12dot34_returns_12dot34", 201, "12.34", 5, true, false, "12.34", 5, "12.34", 0, kNoAffinity},
    {"apply_12dot34dot5_returns_12dot34dot5", 219, "12.34.5", 7, true, false, "12.34.5", 7, "12.34.5", 0, kNoAffinity},
    {"apply_12dot34dot56_returns_12dot34dot56", 237, "12.34.56", 8, true, false, "12.34.56", 8, "12.34.56", 0, kNoAffinity},
    {"apply_1234567_returns_12dot34dot567", 255, "1234567", 7, true, false, "12.34.567", 9, "12.34.567", 0, kNoAffinity},
    {"apply_12345678_returns_12dot34dot5678", 273, "12345678", 8, true, false, "12.34.5678", 10, "12.34.5678", 1, kNoAffinity},
    {"apply_1111_StartIndex_returns_11dot11_StartIndex", 291, "1111", 0, true, false, "11.11", 0, "11.11", 0, kNoAffinity},
    {"apply_abc1111_returns_11dot11", 327, "abc1111", 7, true, false, "11.11", 5, "11.11", 0, kNoAffinity},
    {"apply_abc1de111_returns_11dot11", 345, "abc1de111", 9, true, false, "11.11", 5, "11.11", 0, kNoAffinity},
    {"apply_abc1de1fg11_returns_11dot11", 363, "abc1de1fg11", 11, true, false, "11.11", 5, "11.11", 0, kNoAffinity},
    {"applyAutocomplete_empty_returns_empty", 381, "", 0, true, true, "", 0, "", 0, kNoAffinity},
    {"applyAutocomplete_1_returns_1", 399, "1", 1, true, true, "1", 1, "1", 0, kNoAffinity},
    {"applyAutocomplete_11_returns_11dot", 417, "11", 2, true, true, "11.", 3, "11.", 0, kNoAffinity},
    {"applyAutocomplete_111_returns_11dot1", 435, "111", 3, true, true, "11.1", 4, "11.1", 0, kNoAffinity},
    {"applyAutocomplete_1111_returns_11dot11dot", 453, "1111", 4, true, true, "11.11.", 6, "11.11.", 0, kNoAffinity},
    {"applyAutocomplete_11111_returns_11dot11dot1", 471, "11111", 5, true, true, "11.11.1", 7, "11.11.1", 0, kNoAffinity},
    {"applyAutocomplete_111111_returns_11dot11dot11", 489, "111111", 6, true, true, "11.11.11", 8, "11.11.11", 0, kNoAffinity},
    {"applyAutocomplete_1111111_returns_11dot11dot111", 507, "1111111", 7, true, true, "11.11.111", 9, "11.11.111", 0, kNoAffinity},
    {"applyAutocomplete_11111111_returns_11dot11dot1111", 525, "11111111", 8, true, true, "11.11.1111", 10, "11.11.1111", 1, kNoAffinity},
    {"applyAutocomplete_111111111_returns_11dot11dot1111", 543, "111111111", 9, true, true, "11.11.1111", 10, "11.11.1111", 1, kNoAffinity},
};

// Ported from inputmask/src/test/kotlin/com/redmadrobot/inputmask/helper/DayMonthYearShortTest.kt (format "[90]{.}[90]{.}[0000]", 27 cases).
static const ApplyCase kAndroidDayMonthYearShort[] = {
    {"apply_1_returns_1", 81, "1", 1, true, false, "1", 1, "1", 0, 1},
    {"apply_11_returns_11", 100, "11", 2, true, false, "11", 2, "11", 0, 2},
    {"apply_111_returns_11dot1", 119, "111", 3, true, false, "11.1", 4, "11.1", 0, 2},
    {"apply_1111_returns_11dot11", 138, "1111", 4, true, false, "11.11", 5, "11.11", 0, 3},
    {"apply_123456_returns_12dot34dot56", 157, "123456", 6, true, false, "12.34.56", 8, "12.34.56", 0, 4},
    {"apply_12dot3_returns_12dot3", 176, "12.3", 4, true, false, "12.3", 4, "12.3", 0, 4},
    {"apply_12dot34_returns_12dot34", 195, "12.34", 5, true, false, "12.34", 5, "12.34", 0, 5},
    {"apply_12dot34dot5_returns_12dot34dot5", 214, "12.34.5", 7, true, false, "12.34.5", 7, "12.34.5", 0, 7},
    {"apply_12dot34dot56_returns_12dot34dot56", 233, "12.34.56", 8, true, false, "12.34.56", 8, "12.34.56", 0, 8},
    {"apply_1234567_returns_12dot34dot567", 252, "1234567", 7, true, false, "12.34.567", 9, "12.34.567", 0, 5},
    {"apply_12345678_returns_12dot34dot5678", 271, "12345678", 8, true, false, "12.34.5678", 10, "12.34.5678", 1, 6},
    {"apply_1111_StartIndex_returns_11dot11_StartIndex", 290, "1111", 0, true, false, "11.11", 0, "11.11", 0, 3},
    {"apply_abc1111_returns_11dot11", 328, "abc1111", 7, true, false, "11.11", 5, "11.11", 0, 0},
    {"apply_abc1de111_returns_11dot11", 347, "abc1de111", 9, true, false, "1.11.1", 6, "1.11.1", 0, -4},
    {"apply_abc1de1fg11_returns_11dot11", 366, "abc1de1fg11", 11, true, false, "1.1.11", 6, "1.1.11", 0, -7},
    {"apply_a_returns_empty", 385, "a", 1, true, false, "", 0, "", 0, -1},
    {"applyAutocomplete_empty_returns_empty", 404, "", 0, true, false, "", 0, "", 0, 0},
    {"applyAutocomplete_1_returns_1", 423, "1", 1, true, false, "1", 1, "1", 0, 1},
    {"applyAutocomplete_11_returns_11dot", 442, "11", 2, true, true, "11.", 3, "11.", 0, 2},
    {"applyAutocomplete_112_returns_11dot2", 461, "112", 3, true, true, "11.2", 4, "11.2", 0, 2},
    {"applyAutocomplete_1122_returns_11dot22dot", 480, "1122", 4, true, true, "11.22.", 6, "11.22.", 0, 3},
    {"applyAutocomplete_11223_returns_11dot22dot3", 499, "11223", 5, true, true, "11.22.3", 7, "11.22.3", 0, 3},
    {"applyAutocomplete_112233_returns_11dot22dot33", 518, "112233", 6, true, true, "11.22.33", 8, "11.22.33", 0, 4},
    {"applyAutocomplete_1122333_returns_11dot22dot333", 537, "1122333", 7, true, true, "11.22.333", 9, "11.22.333", 0, 5},
    {"applyAutocomplete_11223333_returns_11dot22dot3333", 556, "11223333", 8, true, true, "11.22.3333", 10, "11.22.3333", 1, 6},
    {"applyAutocomplete_112233334_returns_11dot22dot3333", 575, "112233334", 9, true, true, "11.22.3333", 10, "11.22.3333", 1, 5},
};

static void redMadRobotAndroidSuites() {
  const Suite suites[] = {
      {"YearTest.kt", "[0099]", {}, "0000", 51, kAndroidYear, std::size(kAndroidYear)},
      {"YearACTest.kt", "[9990] AC", {}, "0000 AC", 51, kAndroidYearAC, std::size(kAndroidYearAC)},
      {"PhoneTest.kt", "+7 ([000]) [000] [00] [00]", {}, "+7 (000) 000 00 00", 51, kAndroidPhone, std::size(kAndroidPhone)},
      {"DayMonthYearMaskTest.kt", "[00]{.}[00]{.}[0000]", {}, "00.00.0000", 51, kAndroidDayMonthYearMask, std::size(kAndroidDayMonthYearMask)},
      {"DayMonthYearShortTest.kt", "[90]{.}[90]{.}[0000]", {}, "00.00.0000", 51, kAndroidDayMonthYearShort, std::size(kAndroidDayMonthYearShort)},
  };
  for (const Suite& suite : suites) runSuite(suite);
}

// MARK: - RedMadRobot/input-mask-ios
// https://github.com/RedMadRobot/input-mask-ios/tree/master/Source/InputMask/InputMaskTests/Classes/Mask

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/YearCase.swift (format "[0099]", 4 cases).
static const ApplyCase kIosYear[] = {
    {"testApply_1_returns_1", 68, "1", 1, true, false, "1", 1, "1", 0, kNoAffinity},
    {"testApply_11_returns_11", 91, "11", 2, true, false, "11", 2, "11", 1, kNoAffinity},
    {"testApply_112_returns_112", 114, "112", 3, true, false, "112", 3, "112", 1, kNoAffinity},
    {"testApply_1122_returns_1122", 137, "1122", 4, true, false, "1122", 4, "1122", 1, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/YearACCase.swift (format "[9990] AC", 6 cases).
static const ApplyCase kIosYearAC[] = {
    {"testApply_1_returns_1", 68, "1", 1, true, false, "1", 1, "1", 1, kNoAffinity},
    {"testApply_11_returns_11", 91, "11", 2, true, false, "11", 2, "11", 1, kNoAffinity},
    {"testApply_111_returns_111", 114, "111", 3, true, false, "111", 3, "111", 1, kNoAffinity},
    {"testApply_1111_returns_1111", 137, "1111", 4, true, false, "1111", 4, "1111", 1, kNoAffinity},
    {"testApply_11112_returns_1111spaceAC", 160, "11112", 5, true, false, "1111 AC", 7, "1111", 1, kNoAffinity},
    {"testApplyAutocomplete_1111_returns_1111spaceAC", 183, "1111", 4, true, true, "1111 AC", 7, "1111", 1, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/PhoneCase.swift (format "+7 ([000]) [000] [00] [00]", 32 cases).
static const ApplyCase kIosPhone[] = {
    {"testApply_plus_return_plus", 68, "+", 1, true, false, "+", 1, "", 0, kNoAffinity},
    {"testApply_plus7_return_plus7", 91, "+7", 2, true, false, "+7", 2, "", 0, kNoAffinity},
    {"testApply_plus7space_return_plus7space", 114, "+7 ", 3, true, false, "+7 ", 3, "", 0, kNoAffinity},
    {"testApply_plus7spaceBrace_return_plus7spaceBrace", 137, "+7 (", 4, true, false, "+7 (", 4, "", 0, kNoAffinity},
    {"testApply_plus7spaceBrace1_return_plus7spaceBrace1", 160, "+7 (1", 5, true, false, "+7 (1", 5, "1", 0, kNoAffinity},
    {"testApply_plus7spaceBrace12_return_plus7spaceBrace12", 183, "+7 (12", 6, true, false, "+7 (12", 6, "12", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123_return_plus7spaceBrace123", 206, "+7 (123", 7, true, false, "+7 (123", 7, "123", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123brace_return_plus7spaceBrace123brace", 229, "+7 (123)", 8, true, false, "+7 (123)", 8, "123", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123braceSpace_return_plus7spaceBrace123braceSpace", 252, "+7 (123) ", 9, true, false, "+7 (123) ", 9, "123", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123braceSpace4_return_plus7spaceBrace123braceSpace4", 275, "+7 (123) 4", 10, true, false, "+7 (123) 4", 10, "1234", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123braceSpace45_return_plus7spaceBrace123braceSpace45", 298, "+7 (123) 45", 11, true, false, "+7 (123) 45", 11, "12345", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123braceSpace456_return_plus7spaceBrace123braceSpace456", 321, "+7 (123) 456", 12, true, false, "+7 (123) 456", 12, "123456", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123braceSpace456space_return_plus7spaceBrace123braceSpace456space", 344, "+7 (123) 456 ", 13, true, false, "+7 (123) 456 ", 13, "123456", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123braceSpace456space7_return_plus7spaceBrace123braceSpace456space7", 367, "+7 (123) 456 7", 14, true, false, "+7 (123) 456 7", 14, "1234567", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123braceSpace456space78_return_plus7spaceBrace123braceSpace456space78", 390, "+7 (123) 456 78", 15, true, false, "+7 (123) 456 78", 15, "12345678", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123braceSpace456space78space_return_plus7spaceBrace123braceSpace456space78space", 413, "+7 (123) 456 78 ", 16, true, false, "+7 (123) 456 78 ", 16, "12345678", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123braceSpace456space78space9_return_plus7spaceBrace123braceSpace456space78space9", 436, "+7 (123) 456 78 9", 17, true, false, "+7 (123) 456 78 9", 17, "123456789", 0, kNoAffinity},
    {"testApply_plus7spaceBrace123braceSpace456space78space90_return_plus7spaceBrace123braceSpace456space78space90", 459, "+7 (123) 456 78 90", 18, true, false, "+7 (123) 456 78 90", 18, "1234567890", 1, kNoAffinity},
    {"testApply_7_return_plus7", 482, "7", 1, true, false, "+7", 2, "", 0, kNoAffinity},
    {"testApply_9_return_plus7spaceBrace9", 505, "9", 1, true, false, "+7 (9", 5, "9", 0, kNoAffinity},
    {"testApply_1234567890_return_plus7spaceBrace123braceSpace456space78space90", 528, "1234567890", 10, true, false, "+7 (123) 456 78 90", 18, "1234567890", 1, kNoAffinity},
    {"testApply_12345678901_return_plus7spaceBrace123braceSpace456space78space90", 551, "12345678901", 11, true, false, "+7 (123) 456 78 90", 18, "1234567890", 1, kNoAffinity},
    {"testApply_plus1234567890_return_plus7spaceBrace123braceSpace456space78space90", 574, "+1234567890", 11, true, false, "+7 (123) 456 78 90", 18, "1234567890", 1, kNoAffinity},
    {"testApply_plusBrace123brace456dash78dash90_return_plus7spaceBrace123braceSpace456space78space90", 597, "+(123)456-78-90", 15, true, false, "+7 (123) 456 78 90", 18, "1234567890", 1, kNoAffinity},
    {"testApplyAutocomplete_empty_return_plus7spaceBrace", 620, "", 0, true, true, "", 0, "", 0, kNoAffinity},  // DIVERGENCE (2): upstream "+7 (", caret 4
    {"testApplyAutocomplete_plus_return_plus7spaceBrace", 643, "+", 1, true, true, "+7 (", 4, "", 0, kNoAffinity},
    {"testApplyAutocomplete_plus7_return_plus7spaceBrace", 666, "+7", 2, true, true, "+7 (", 4, "", 0, kNoAffinity},
    {"testApplyAutocomplete_plus7space_return_plus7spaceBrace", 689, "+7 ", 3, true, true, "+7 (", 4, "", 0, kNoAffinity},
    {"testApplyAutocomplete_plus7spaceBrace_return_plus7spaceBrace", 712, "+7 (", 4, true, true, "+7 (", 4, "", 0, kNoAffinity},
    {"testApplyAutocomplete_a_return_plus7spaceBrace", 735, "a", 1, true, true, "+7 (", 4, "", 0, kNoAffinity},
    {"testApplyAutocomplete_aPlus7spaceBrace_return_plus7spaceBrace", 758, "a+7 (", 5, true, true, "+7 (7", 5, "7", 0, kNoAffinity},
    {"testApplyAutocomplete_7space_return_plus7spaceBrace", 781, "7 ", 2, true, true, "+7 (", 4, "", 0, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/DayMonthYearCase.swift (format "[00]{.}[00]{.}[0000]", 29 cases).
static const ApplyCase kIosDayMonthYear[] = {
    {"testApply_1_returns_1", 68, "1", 1, true, false, "1", 1, "1", 0, kNoAffinity},
    {"testApply_11_returns_11", 91, "11", 2, true, false, "11", 2, "11", 0, kNoAffinity},
    {"testApply_111_returns_11dot1", 114, "111", 3, true, false, "11.1", 4, "11.1", 0, kNoAffinity},
    {"testApply_1111_returns_11dot11", 137, "1111", 4, true, false, "11.11", 5, "11.11", 0, kNoAffinity},
    {"testApply_123456_returns_12dot34dot56", 160, "123456", 6, true, false, "12.34.56", 8, "12.34.56", 0, kNoAffinity},
    {"testApply_12dot3_returns_12dot3", 183, "12.3", 4, true, false, "12.3", 4, "12.3", 0, kNoAffinity},
    {"testApply_12dot34_returns_12dot34", 206, "12.34", 5, true, false, "12.34", 5, "12.34", 0, kNoAffinity},
    {"testApply_12dot34dot5_returns_12dot34dot5", 229, "12.34.5", 7, true, false, "12.34.5", 7, "12.34.5", 0, kNoAffinity},
    {"testApply_12dot34dot56_returns_12dot34dot56", 252, "12.34.56", 8, true, false, "12.34.56", 8, "12.34.56", 0, kNoAffinity},
    {"testApply_1234567_returns_12dot34dot567", 275, "1234567", 7, true, false, "12.34.567", 9, "12.34.567", 0, kNoAffinity},
    {"testApply_12345678_returns_12dot34dot5678", 298, "12345678", 8, true, false, "12.34.5678", 10, "12.34.5678", 1, kNoAffinity},
    {"testApply_1111_StartIndex_returns_11dot11_StartIndex", 321, "1111", 0, true, false, "11.11", 0, "11.11", 0, kNoAffinity},
    {"testApply_abc1111_returns_11dot11", 390, "abc1111", 7, true, false, "11.11", 5, "11.11", 0, kNoAffinity},
    {"testApply_abc1de111_returns_11dot11", 413, "abc1de111", 9, true, false, "11.11", 5, "11.11", 0, kNoAffinity},
    {"testApply_abc1de1fg11_returns_11dot11", 436, "abc1de1fg11", 11, true, false, "11.11", 5, "11.11", 0, kNoAffinity},
    {"testApplyAutocomplete_empty_returns_empty", 459, "", 0, true, true, "", 0, "", 0, kNoAffinity},
    {"testApplyAutocomplete_1_returns_1", 482, "1", 1, true, true, "1", 1, "1", 0, kNoAffinity},
    {"testApplyAutocomplete_11_returns_11dot", 505, "11", 2, true, true, "11.", 3, "11.", 0, kNoAffinity},
    {"testApplyAutoskip_11dot_returns_11", 528, "11.", 3, false, true, "11", 2, "11", 0, kNoAffinity},
    {"testAppyAutoskip_11dot1_returns11dot1CaretMoved", 551, "11.1", 3, false, true, "11.1", 2, "11.1", 0, kNoAffinity},
    {"testApplyAutocomplete_111_returns_11dot1", 574, "111", 3, true, true, "11.1", 4, "11.1", 0, kNoAffinity},
    {"testApplyAutocomplete_1111_returns_11dot11dot", 597, "1111", 4, true, true, "11.11.", 6, "11.11.", 0, kNoAffinity},
    {"testApplyAutocomplete_11111_returns_11dot11dot1", 620, "11111", 5, true, true, "11.11.1", 7, "11.11.1", 0, kNoAffinity},
    {"testApplyAutocomplete_111111_returns_11dot11dot11", 643, "111111", 6, true, true, "11.11.11", 8, "11.11.11", 0, kNoAffinity},
    {"testApplyAutocomplete_1111111_returns_11dot11dot111", 666, "1111111", 7, true, true, "11.11.111", 9, "11.11.111", 0, kNoAffinity},
    {"testApplyAutocomplete_11111111_returns_11dot11dot1111", 689, "11111111", 8, true, true, "11.11.1111", 10, "11.11.1111", 1, kNoAffinity},
    {"testApplyAutocomplete_111111111_returns_11dot11dot1111", 712, "111111111", 9, true, true, "11.11.1111", 10, "11.11.1111", 1, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/DayMonthYearShortCase.swift (format "[90]{.}[90]{.}[0000]", 28 cases).
static const ApplyCase kIosDayMonthYearShort[] = {
    {"testApply_1_returns_1", 68, "1", 1, true, false, "1", 1, "1", 0, 1},
    {"testApply_11_returns_11", 92, "11", 2, true, false, "11", 2, "11", 0, 2},
    {"testApply_111_returns_11dot1", 116, "111", 3, true, false, "11.1", 4, "11.1", 0, 2},
    {"testApply_1111_returns_11dot11", 140, "1111", 4, true, false, "11.11", 5, "11.11", 0, 3},
    {"testApply_123456_returns_12dot34dot56", 164, "123456", 6, true, false, "12.34.56", 8, "12.34.56", 0, 4},
    {"testApply_12dot3_returns_12dot3", 188, "12.3", 4, true, false, "12.3", 4, "12.3", 0, 4},
    {"testApply_12dot34_returns_12dot34", 212, "12.34", 5, true, false, "12.34", 5, "12.34", 0, 5},
    {"testApply_12dot34dot5_returns_12dot34dot5", 236, "12.34.5", 7, true, false, "12.34.5", 7, "12.34.5", 0, 7},
    {"testApply_12dot34dot56_returns_12dot34dot56", 260, "12.34.56", 8, true, false, "12.34.56", 8, "12.34.56", 0, 8},
    {"testApply_1234567_returns_12dot34dot567", 284, "1234567", 7, true, false, "12.34.567", 9, "12.34.567", 0, 5},
    {"testApply_12345678_returns_12dot34dot5678", 308, "12345678", 8, true, false, "12.34.5678", 10, "12.34.5678", 1, 6},
    {"testApply_1111_StartIndex_returns_11dot11_StartIndex", 332, "1111", 0, true, false, "11.11", 0, "11.11", 0, 3},
    {"testApply_abc1111_returns_11dot11", 404, "abc1111", 7, true, false, "11.11", 5, "11.11", 0, 0},
    {"testApply_abc1de111_returns_11dot11", 428, "abc1de111", 9, true, false, "1.11.1", 6, "1.11.1", 0, -4},
    {"testApply_abc1de1fg11_returns_11dot11", 452, "abc1de1fg11", 11, true, false, "1.1.11", 6, "1.1.11", 0, -7},
    {"testApply_a_returns_empty", 476, "a", 1, true, false, "", 0, "", 0, -1},
    {"testApplyAutocomplete_empty_returns_empty", 500, "", 0, true, true, "", 0, "", 0, 0},
    {"testApplyAutocomplete_1_returns_1", 524, "1", 1, true, true, "1", 1, "1", 0, 1},
    {"testApplyAutocomplete_11_returns_11dot", 548, "11", 2, true, true, "11.", 3, "11.", 0, 2},
    {"testApplyAutocomplete_112_returns_11dot2", 572, "112", 3, true, true, "11.2", 4, "11.2", 0, 2},
    {"testApplyAutocomplete_1122_returns_11dot22dot", 596, "1122", 4, true, true, "11.22.", 6, "11.22.", 0, 3},
    {"testApplyAutocomplete_11223_returns_11dot22dot3", 620, "11223", 5, true, true, "11.22.3", 7, "11.22.3", 0, 3},
    {"testApplyAutocomplete_112233_returns_11dot22dot33", 644, "112233", 6, true, true, "11.22.33", 8, "11.22.33", 0, 4},
    {"testApplyAutocomplete_1122333_returns_11dot22dot333", 668, "1122333", 7, true, true, "11.22.333", 9, "11.22.333", 0, 5},
    {"testApplyAutocomplete_11223333_returns_11dot22dot3333", 692, "11223333", 8, true, true, "11.22.3333", 10, "11.22.3333", 1, 6},
    {"testApplyAutocomplete_112233334_returns_11dot22dot3333", 716, "112233334", 9, true, true, "11.22.3333", 10, "11.22.3333", 1, 5},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/MonthYearCase.swift (format "[00]{/}[0000]", 18 cases).
static const ApplyCase kIosMonthYear[] = {
    {"testApply_1_returns_1", 68, "1", 1, true, false, "1", 1, "1", 0, kNoAffinity},
    {"testApply_11_returns_11", 91, "11", 2, true, false, "11", 2, "11", 0, kNoAffinity},
    {"testApply_111_returns_11slash1", 114, "111", 3, true, false, "11/1", 4, "11/1", 0, kNoAffinity},
    {"testApply_1111_returns_11slash11", 137, "1111", 4, true, false, "11/11", 5, "11/11", 0, kNoAffinity},
    {"testApply_123456_returns_12slash3456", 160, "123456", 6, true, false, "12/3456", 7, "12/3456", 1, kNoAffinity},
    {"testApply_12slash3_returns_12slash3", 183, "12/3", 4, true, false, "12/3", 4, "12/3", 0, kNoAffinity},
    {"testApply_12slash34_returns_12slash34", 206, "12/34", 5, true, false, "12/34", 5, "12/34", 0, kNoAffinity},
    {"testApply_12slash345_returns_12slash345", 229, "12/345", 6, true, false, "12/345", 6, "12/345", 0, kNoAffinity},
    {"testApply_12slash3456_returns_12slash3456", 252, "12/3456", 7, true, false, "12/3456", 7, "12/3456", 1, kNoAffinity},
    {"testApply_1234567_returns_12slash3456", 275, "1234567", 7, true, false, "12/3456", 7, "12/3456", 1, kNoAffinity},
    {"testApply_12345678_returns_12slash3456", 298, "12345678", 8, true, false, "12/3456", 7, "12/3456", 1, kNoAffinity},
    {"testApply_1111_StartIndex_returns_11slash11_StartIndex", 321, "1111", 0, true, false, "11/11", 0, "11/11", 0, kNoAffinity},
    {"testApply_abc1111_returns_11slash11", 390, "abc1111", 7, true, false, "11/11", 5, "11/11", 0, kNoAffinity},
    {"testApply_abc1de111_returns_11slash11", 413, "abc1de111", 9, true, false, "11/11", 5, "11/11", 0, kNoAffinity},
    {"testApply_abc1de1fg11_returns_11slash11", 436, "abc1de1fg11", 11, true, false, "11/11", 5, "11/11", 0, kNoAffinity},
    {"testApply_a_returns_empty", 459, "a", 1, true, false, "", 0, "", 0, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/MonthYearDoubleSlashCase.swift (format "[00]{//}[0000]", 19 cases).
static const ApplyCase kIosMonthYearDoubleSlash[] = {
    {"testApply_1_returns_1", 68, "1", 1, true, false, "1", 1, "1", 0, kNoAffinity},
    {"testApply_11_returns_11", 91, "11", 2, true, false, "11", 2, "11", 0, kNoAffinity},
    {"testApply_111_returns_11doubleShash1", 114, "111", 3, true, false, "11//1", 5, "11//1", 0, kNoAffinity},
    {"testApply_1111_returns_11doubleShash11", 137, "1111", 4, true, false, "11//11", 6, "11//11", 0, kNoAffinity},
    {"testApply_123456_returns_12doubleShash3456", 160, "123456", 6, true, false, "12//3456", 8, "12//3456", 1, kNoAffinity},
    {"testApply_12shash3_returns_12doubleShash3", 183, "12/3", 4, true, false, "12//3", 5, "12//3", 0, kNoAffinity},
    {"testApply_12doubleShash3_returns_12doubleShash3", 206, "12//3", 5, true, false, "12//3", 5, "12//3", 0, kNoAffinity},
    {"testApply_12shash34_returns_12doubleShash34", 229, "12/34", 5, true, false, "12//34", 6, "12//34", 0, kNoAffinity},
    {"testApply_12doubleShash34_returns_12doubleShash34", 252, "12//34", 6, true, false, "12//34", 6, "12//34", 0, kNoAffinity},
    {"testApply_12doubleShash345_returns_12doubleShash345", 275, "12//345", 7, true, false, "12//345", 7, "12//345", 0, kNoAffinity},
    {"testApply_12doubleShash3456_returns_12doubleShash3456", 298, "12//3456", 8, true, false, "12//3456", 8, "12//3456", 1, kNoAffinity},
    {"testApply_1234567_returns_12doubleShash3456", 321, "1234567", 7, true, false, "12//3456", 8, "12//3456", 1, kNoAffinity},
    {"testApply_12345678_returns_12doubleShash3456", 344, "12345678", 8, true, false, "12//3456", 8, "12//3456", 1, kNoAffinity},
    {"testApply_1111_StartIndex_returns_11doubleShash11_StartIndex", 367, "1111", 0, true, false, "11//11", 0, "11//11", 0, kNoAffinity},
    {"testApply_abc1111_returns_11doubleShash11", 436, "abc1111", 7, true, false, "11//11", 6, "11//11", 0, kNoAffinity},
    {"testApply_abc1de111_returns_11doubleShash11", 459, "abc1de111", 9, true, false, "11//11", 6, "11//11", 0, kNoAffinity},
    {"testApply_abc1de1fg11_returns_11doubleShash11", 482, "abc1de1fg11", 11, true, false, "11//11", 6, "11//11", 0, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/EscapedCase.swift (format "\\{\\[[00]\\]{99}{\\}\\]}", 4 cases).
static const ApplyCase kIosEscaped[] = {
    {"testApply_1_returns_bracket1", 70, "1", 1, true, false, "{[1", 3, "1", 0, kNoAffinity},
    {"testApply_11_returns_bracket11", 93, "11", 2, true, false, "{[11", 4, "11", 0, kNoAffinity},
    {"testApply_112_returns_bracket11bracket", 116, "112", 3, true, false, "{[11]99}]", 9, "1199}]", 1, kNoAffinity},
    {"testApply_1122_returns_bracket11bracket", 139, "1122", 4, true, false, "{[11]99}]", 9, "1199}]", 1, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/EndlessIntegerCase.swift (format "[0…]", 8 cases).
static const ApplyCase kIosEndlessInteger[] = {
    {"testApply_J_returns_emptyString", 68, "J", 1, true, false, "", 0, "", 0, kNoAffinity},
    {"testApply_Je_returns_emptyString", 91, "Je", 2, true, false, "", 0, "", 0, kNoAffinity},
    {"testApply_Jeo_returns_emptyString", 114, "Jeo", 3, true, false, "", 0, "", 0, kNoAffinity},
    {"testApply_1_returns_1", 137, "1", 1, true, false, "1", 1, "1", 1, kNoAffinity},
    {"testApply_12_returns_12", 160, "12", 2, true, false, "12", 2, "12", 1, kNoAffinity},
    {"testApply_123_returns_123", 183, "123", 3, true, false, "123", 3, "123", 1, kNoAffinity},
    {"testApply_1Jeorge2_returns_12", 206, "1Jeorge2", 8, true, false, "12", 2, "12", 1, kNoAffinity},
    {"testApply_1Jeorge23_returns_123", 229, "1Jeorge23", 9, true, false, "123", 3, "123", 1, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/NameCase.swift (format "[A…]", 7 cases).
static const ApplyCase kIosName[] = {
    {"testApply_J_returns_J", 68, "J", 1, true, false, "J", 1, "J", 1, kNoAffinity},
    {"testApply_Je_returns_Je", 91, "Je", 2, true, false, "Je", 2, "Je", 1, kNoAffinity},
    {"testApply_Jeo_returns_Jeo", 114, "Jeo", 3, true, false, "Jeo", 3, "Jeo", 1, kNoAffinity},
    {"testApply_Jeor_returns_Jeor", 137, "Jeor", 4, true, false, "Jeor", 4, "Jeor", 1, kNoAffinity},
    {"testApply_Jeorge_returns_Jeorge", 160, "Jeorge", 6, true, false, "Jeorge", 6, "Jeorge", 1, kNoAffinity},
    {"testApply_Jeorge1_returns_Jeorge", 183, "Jeorge1", 7, true, false, "Jeorge", 6, "Jeorge", 1, kNoAffinity},
    {"testApply_1Jeorge2_returns_Jeorge", 206, "1Jeorge2", 8, true, false, "Jeorge", 6, "Jeorge", 1, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/WildcardCase.swift (format "[…]", 8 cases).
static const ApplyCase kIosWildcard[] = {
    {"testApply_emptyString_returns_Complete", 68, "", 0, true, false, "", 0, "", 1, kNoAffinity},
    {"testApply_J_returns_J", 91, "J", 1, true, false, "J", 1, "J", 1, kNoAffinity},
    {"testApply_Je_returns_Je", 114, "Je", 2, true, false, "Je", 2, "Je", 1, kNoAffinity},
    {"testApply_Jeo_returns_Jeo", 137, "Jeo", 3, true, false, "Jeo", 3, "Jeo", 1, kNoAffinity},
    {"testApply_Jeor_returns_Jeor", 160, "Jeor", 4, true, false, "Jeor", 4, "Jeor", 1, kNoAffinity},
    {"testApply_Jeorge_returns_Jeorge", 183, "Jeorge", 6, true, false, "Jeorge", 6, "Jeorge", 1, kNoAffinity},
    {"testApply_Jeorge1_returns_Jeorge", 206, "Jeorge1", 7, true, false, "Jeorge1", 7, "Jeorge1", 1, kNoAffinity},
    {"testApply_1Jeorge2_returns_Jeorge", 229, "1Jeorge2", 8, true, false, "1Jeorge2", 8, "1Jeorge2", 1, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/SillyEllipticalCase.swift (format "[0…][AAA]", 9 cases).
static const ApplyCase kIosSillyElliptical[] = {
    {"testApply_J_returns_emptyString", 68, "J", 1, true, false, "", 0, "", 0, kNoAffinity},
    {"testApply_Je_returns_emptyString", 91, "Je", 2, true, false, "", 0, "", 0, kNoAffinity},
    {"testApply_Jeo_returns_emptyString", 114, "Jeo", 3, true, false, "", 0, "", 0, kNoAffinity},
    {"testApply_1_returns_1", 137, "1", 1, true, false, "1", 1, "1", 1, kNoAffinity},
    {"testApply_12_returns_12", 160, "12", 2, true, false, "12", 2, "12", 1, kNoAffinity},
    {"testApply_123_returns_123", 183, "123", 3, true, false, "123", 3, "123", 1, kNoAffinity},
    {"testApply_1Jeorge2_returns_12", 206, "1Jeorge2", 8, true, false, "12", 2, "12", 1, kNoAffinity},
    {"testApply_1Jeorge23_returns_123", 229, "1Jeorge23", 9, true, false, "123", 3, "123", 1, kNoAffinity},
    {"testApply_1234Jeorge56_returns_123456", 252, "1234Jeorge56", 12, true, false, "123456", 6, "123456", 1, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/SillyPiEllipticalCase.swift (format "{3.14}[9…]", 5 cases).
static const ApplyCase kIosSillyPiElliptical[] = {
    {"testApply_314_returns_314", 68, "3.14", 4, true, false, "3.14", 4, "3.14", 1, kNoAffinity},
    {"testApply_3141_returns_3141", 91, "3.141", 5, true, false, "3.141", 5, "3.141", 1, kNoAffinity},
    {"testApply_31415_returns_31415", 114, "3.1415", 6, true, false, "3.1415", 6, "3.1415", 1, kNoAffinity},
    {"testApply_1_returns_31", 137, "1", 1, true, false, "3.1", 3, "3.1", 0, kNoAffinity},
    {"testApply_15_returns_3145", 160, "3.145", 5, true, false, "3.145", 5, "3.145", 1, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/DecimalNumberCase.swift (format "[9999][.][99]", 11 cases).
static const ApplyCase kIosDecimalNumber[] = {
    {"testApply_1_returns_1", 82, "1", 1, true, false, "1", 1, "1", 1, kNoAffinity},
    {"testApply_1dot_returns_1dot", 105, "1.", 2, true, false, "1.", 2, "1.", 1, kNoAffinity},
    {"testApply_11_returns_11", 128, "11", 2, true, false, "11", 2, "11", 1, kNoAffinity},
    {"testApply_11dot_returns_11dot", 151, "11.", 3, true, false, "11.", 3, "11.", 1, kNoAffinity},
    {"testApply_1dot1_returns_1dot1", 174, "1.1", 3, true, false, "1.1", 3, "1.1", 1, kNoAffinity},
    {"testApply_112_returns_112", 197, "112", 3, true, false, "112", 3, "112", 1, kNoAffinity},
    {"testApply_11dot2_returns_11dot2", 220, "11.2", 4, true, false, "11.2", 4, "11.2", 1, kNoAffinity},
    {"testApply_1122_returns_1122", 243, "1122", 4, true, false, "1122", 4, "1122", 1, kNoAffinity},
    {"testApply_1122dot_returns_1122dot", 266, "1122.", 5, true, false, "1122.", 5, "1122.", 1, kNoAffinity},
    {"testApply_1122dot33_returns_1122dot33", 289, "1122.33", 7, true, false, "1122.33", 7, "1122.33", 1, kNoAffinity},
    {"testApply_1122comma33_returns_1122", 312, "1122,33", 7, true, false, "1122", 4, "1122", 1, kNoAffinity},
};

// Ported from Source/InputMask/InputMaskTests/Classes/Mask/CustomNotationEllipticalCase.swift (format "[C…]", 11 cases).
static const ApplyCase kIosCustomNotationElliptical[] = {
    {"testApply_J_returns_J", 85, "J", 1, true, false, "J", 1, "J", 1, kNoAffinity},
    {"testApply_Je_returns_Je", 108, "Je", 2, true, false, "Je", 2, "Je", 1, kNoAffinity},
    {"testApply_Jeo_returns_Jeo", 131, "Jeo", 3, true, false, "Jeo", 3, "Jeo", 1, kNoAffinity},
    {"testApply_1_returns_emptyString", 154, "1", 1, true, false, "", 0, "", 0, kNoAffinity},
    {"testApply_12_returns_emptyString", 177, "12", 2, true, false, "", 0, "", 0, kNoAffinity},
    {"testApply_123_returns_emptyString", 200, "123", 3, true, false, "", 0, "", 0, kNoAffinity},
    {"testApply_1Jeorge2_returns_Jeorge", 223, "1Jeorge2", 8, true, false, "Jeorge", 6, "Jeorge", 1, kNoAffinity},
    {"testApply_1Jeorge23_returns_Jeorge", 246, "1Jeorge23", 9, true, false, "Jeorge", 6, "Jeorge", 1, kNoAffinity},
    {"testApply_1234Jeorge56_returns_Jeorge", 269, "1234Jeorge56", 12, true, false, "Jeorge", 6, "Jeorge", 1, kNoAffinity},
    {"testApply_JeorgeSpaceSmith_returns_JeorgeSpaceSmith", 292, "Jeorge Smith", 12, true, false, "Jeorge Smith", 12, "Jeorge Smith", 1, kNoAffinity},
    {"testApply_JeorgeSpaceSmithUnderscore_returns_JeorgeSpaceSmith", 315, "Jeorge Smith_", 13, true, false, "Jeorge Smith", 12, "Jeorge Smith", 1, kNoAffinity},
};

static void redMadRobotIosSuites() {
  const Suite suites[] = {
      {"YearCase.swift", "[0099]", {}, "0000", 43, kIosYear, std::size(kIosYear)},
      {"YearACCase.swift", "[9990] AC", {}, "0000 AC", 43, kIosYearAC, std::size(kIosYearAC)},
      {"PhoneCase.swift", "+7 ([000]) [000] [00] [00]", {}, "+7 (000) 000 00 00", 43, kIosPhone, std::size(kIosPhone)},
      {"DayMonthYearCase.swift", "[00]{.}[00]{.}[0000]", {}, "00.00.0000", 43, kIosDayMonthYear, std::size(kIosDayMonthYear)},
      {"DayMonthYearShortCase.swift", "[90]{.}[90]{.}[0000]", {}, "00.00.0000", 43, kIosDayMonthYearShort, std::size(kIosDayMonthYearShort)},
      {"MonthYearCase.swift", "[00]{/}[0000]", {}, "00/0000", 43, kIosMonthYear, std::size(kIosMonthYear)},
      {"MonthYearDoubleSlashCase.swift", "[00]{//}[0000]", {}, "00//0000", 43, kIosMonthYearDoubleSlash, std::size(kIosMonthYearDoubleSlash)},
      {"EscapedCase.swift", "\\{\\[[00]\\]{99}{\\}\\]}", {}, "{[00]99}]", 45, kIosEscaped, std::size(kIosEscaped)},
      {"EndlessIntegerCase.swift", "[0…]", {}, "0", 43, kIosEndlessInteger, std::size(kIosEndlessInteger)},
      {"NameCase.swift", "[A…]", {}, "a", 43, kIosName, std::size(kIosName)},
      {"WildcardCase.swift", "[…]", {}, "", 43, kIosWildcard, std::size(kIosWildcard)},
      {"SillyEllipticalCase.swift", "[0…][AAA]", {}, "0", 43, kIosSillyElliptical, std::size(kIosSillyElliptical)},
      {"SillyPiEllipticalCase.swift", "{3.14}[9…]", {}, "3.140", 43, kIosSillyPiElliptical, std::size(kIosSillyPiElliptical)},
      {"DecimalNumberCase.swift", "[9999][.][99]", decimalNotations(), "0000.00", 57, kIosDecimalNumber, std::size(kIosDecimalNumber)},
      {"CustomNotationEllipticalCase.swift", "[C…]", nameNotations(), "C", 60, kIosCustomNotationElliptical, std::size(kIosCustomNotationElliptical)},
  };
  for (const Suite& suite : suites) runSuite(suite);
}

// MARK: - RedMadRobot: format sanitizer and compiler

// Ported from input-mask-android .../helper/FormatSanitizerTest.kt,
// .../helper/CompilerTest.kt and input-mask-ios .../Mask/MaskTestCase.swift.
// Upstream throws on a bad format; we return false (DIVERGENCE 4). The
// sanitized string and the state chain are private here, so both are checked
// by their behaviour.
static void redMadRobotSanitizerAndCompiler() {
  MaskEngine engine;
  // FormatSanitizerTest.sanitize_BadMask_ThrowFormatError
  CHECK(!engine.setFormat("+7 ([0[0]0]) [000]-[00]-[00]", {}));
  CHECK(!engine.isActive());
  // CompilerTest.compile_BadMask_ThrowFormatError
  CHECK(!engine.setFormat("[00[9]9]", {}));
  // MaskTestCase.testInit_nestedBrackets_throwsWrongFormatCompilerError
  CHECK(!engine.setFormat("[[00]000]", {}));
  // MaskTestCase.testInit_mixedCharacters_initialized: "[00000Aa]" is
  // "[00000][Aa]" - five digits, a letter, an optional letter.
  CHECK(engine.setFormat("[00000Aa]", {}));
  CHECK_EQ_STR(masked(engine, "12345ab").formattedText, "12345ab");
  CHECK(masked(engine, "12345a").complete);
  CHECK(!masked(engine, "12345").complete);

  // FormatSanitizerTest.sanitize_ReturnsSanitizedString: "[0909]" -> "[0099]".
  const MaskEngine year = make("[0909]");
  CHECK(!masked(year, "1").complete);
  CHECK(masked(year, "12").complete);
  CHECK_EQ_STR(masked(year, "12345").formattedText, "1234");
  CHECK_EQ_STR(masked(year, "1").tailPlaceholder, "000");

  // FormatSanitizerTest.sanitize_DivideMixedSymbolsIntoOwnGroups:
  // "[09Aa_-]" -> "[09][Aa][_-]".
  const MaskEngine mixed = make("[09Aa_-]");
  CHECK_EQ_STR(masked(mixed, "1a1").formattedText, "1a1");
  CHECK(masked(mixed, "1a1").complete);
  CHECK(!masked(mixed, "1").complete);
  CHECK_EQ_STR(masked(mixed, "12ab34").formattedText, "12ab34");
  CHECK_EQ_STR(masked(mixed, "12ab345").formattedText, "12ab34");
  CHECK_EQ_STR(mixed.apply("", 0, true, false, false).tailPlaceholder, "00aa--");

  // CompilerTest.compile_ReturnsCorrectState: "[09]{.}[09]{.}19[00]" is
  // Value, OptionalValue, Fixed, Value, OptionalValue, Fixed, Free, Free,
  // Value, Value.
  const MaskEngine chain = make("[09]{.}[09]{.}19[00]");
  CHECK_EQ_STR(chain.apply("", 0, true, false, false).tailPlaceholder, "00.00.1900");
  const Result shortDate = masked(chain, "1.2.34");
  CHECK_EQ_STR(shortDate.formattedText, "1.2.1934");
  CHECK_EQ_STR(shortDate.extractedValue, "1.2.34"); // Fixed counts, Free does not
  CHECK(shortDate.complete);
  const Result longDate = masked(chain, "12.34.1956");
  CHECK_EQ_STR(longDate.formattedText, "12.34.1956");
  CHECK_EQ_STR(longDate.extractedValue, "12.34.56");
  CHECK(!masked(chain, "1.2.3").complete);
}

// MARK: - RedMadRobot: affinity calculation strategies

// Neither repository has tests for these; the worked examples are in the doc
// comments of input-mask-android .../helper/AffinityCalculationStrategy.kt
// (the same text is in input-mask-ios AffinityCalculationStrategy.swift).
static void redMadRobotAffinityStrategies() {
  // WHOLE_STRING: format "[00].[00]".
  const MaskEngine whole = make("[00].[00]");
  CHECK_EQ_INT(masked(whole, "1234").affinity, 3);  // 4 symbols - 1 missed dot
  CHECK_EQ_INT(masked(whole, "12.34").affinity, 5); // 5 symbols
  // The doc says "5 (symbols) - 1 (superfluous dot) - 1 (missed dot) = 3",
  // but the superfluous dot is a rejection, not a symbol: upstream's own
  // `Mask.apply` scores 4 passes - 2 = 2 (a slip in the doc comment, not a
  // divergence), and so do we.
  CHECK_EQ_INT(masked(whole, "1.234").affinity, 2);

  // PREFIX: "+7 [000] [000]" vs "8 [000] [000]". DIVERGENCE (A): we re-mask
  // the value characters alone, so the outputs below are what each format
  // makes of "712345" / "812345"; the winner is the one upstream picks.
  MaskEngine prefix;
  prefix.setAffinityStrategy(MaskEngine::kAffinityPrefix);
  prefix.addAffinityFormat("8 [000] [000]");
  CHECK(prefix.setFormat("+7 [000] [000]", {}));
  const Result plus7 = masked(prefix, "+7 12 345");
  CHECK_EQ_INT(plus7.formatIndex, 0);
  CHECK_EQ_STR(plus7.formattedText, "+7 123 45");
  const Result eight = masked(prefix, "8 12 345");
  CHECK_EQ_INT(eight.formatIndex, 1);
  CHECK_EQ_STR(eight.formattedText, "8 123 45");

  // CAPACITY: "[00]-[0]", "[00]-[000]", "[00]-[00000]", widest as primary
  // ("N.B.: Make sure the widest mask format is the primary mask format").
  // Index 0 = [00]-[00000], 1 = [00]-[0], 2 = [00]-[000]. Winners per the
  // documented affinity table.
  MaskEngine capacity;
  capacity.setAffinityStrategy(MaskEngine::kAffinityCapacity);
  capacity.addAffinityFormat("[00]-[0]");
  capacity.addAffinityFormat("[00]-[000]");
  CHECK(capacity.setFormat("[00]-[00000]", {}));
  CHECK_EQ_INT(masked(capacity, "1").formatIndex, 1);       // -3 -5 -7
  CHECK_EQ_INT(masked(capacity, "12").formatIndex, 1);      // -2 -4 -6
  CHECK_EQ_INT(masked(capacity, "123").formatIndex, 1);     // -1 -3 -5
  CHECK_EQ_INT(masked(capacity, "12-3").formatIndex, 1);    //  0 -2 -4
  CHECK_EQ_INT(masked(capacity, "1234").formatIndex, 1);    //  0 -2 -4
  CHECK_EQ_INT(masked(capacity, "12345").formatIndex, 2);   // MIN -1 -3
  CHECK_EQ_INT(masked(capacity, "123456").formatIndex, 2);  // MIN  0 -2
  CHECK_EQ_STR(masked(capacity, "12-3").formattedText, "12-3");
  CHECK_EQ_STR(masked(capacity, "12345").formattedText, "12-345");

  // EXTRACTED_VALUE_CAPACITY: same formats, the documented table.
  MaskEngine value;
  value.setAffinityStrategy(MaskEngine::kAffinityExtractedValueCapacity);
  value.addAffinityFormat("[00]-[0]");
  value.addAffinityFormat("[00]-[000]");
  CHECK(value.setFormat("[00]-[00000]", {}));
  CHECK_EQ_INT(masked(value, "1").formatIndex, 1);       // -2 -4 -6
  CHECK_EQ_INT(masked(value, "12").formatIndex, 1);      // -1 -3 -5
  CHECK_EQ_INT(masked(value, "123").formatIndex, 1);     //  0 -2 -4
  CHECK_EQ_INT(masked(value, "12-3").formatIndex, 1);    //  0 -2 -4
  CHECK_EQ_INT(masked(value, "1234").formatIndex, 2);    // MIN -1 -3
  CHECK_EQ_INT(masked(value, "12345").formatIndex, 2);   // MIN  0 -2
  CHECK_EQ_INT(masked(value, "123456").formatIndex, 0);  // MIN MIN -1
  CHECK_EQ_STR(masked(value, "123").formattedText, "12-3");
  CHECK_EQ_STR(masked(value, "1234").formattedText, "12-34");
  CHECK_EQ_STR(masked(value, "123456").formattedText, "12-3456");
}

// MARK: - IvanIhnatsiuk/react-native-advanced-input-mask

// Ported from e2e/.maestro/*.yaml against the masks in
// apps/example/src/screens/*. Component-level behaviour (allowedKeys,
// validationRegex, focus) is out of scope; only what the mask produces is.
static void advancedInputMaskE2e() {
  const MaskEngine phone = make("+1 ([000]) [000]-[0000]");

  // clear-text.yaml (Phone screen, autoSkip): "1" into the empty field.
  const Result one = type(phone, "1", true, true);
  CHECK_EQ_STR(one.formattedText, "+1 (");
  CHECK_EQ_STR(one.extractedValue, "");
  CHECK_EQ_INT(one.caret, 4);

  // phone-input.yaml: "1234567890" -> "+1 (234) 567-890".
  const Result typed = type(phone, "1234567890", true, true);
  CHECK_EQ_STR(typed.formattedText, "+1 (234) 567-890");
  CHECK_EQ_STR(typed.extractedValue, "234567890");
  CHECK(!typed.complete);
  CHECK_EQ_STR(typed.tailPlaceholder, "0");

  // controlled-input.yaml: initial "+1 (111", type 123456789, erase 17.
  const Result initial = phone.apply("+1 (111", 7, true, false, false);
  CHECK_EQ_STR(initial.formattedText, "+1 (111");
  CHECK_EQ_STR(initial.extractedValue, "111");
  const Result controlled = typeFrom(phone, initial, "123456789");
  CHECK_EQ_STR(controlled.formattedText, "+1 (111) 123-4567");
  CHECK_EQ_STR(controlled.extractedValue, "1111234567");
  CHECK(controlled.complete);
  const Result erased = typeFrom(phone, controlled, std::string(17, '\b'));
  CHECK_EQ_STR(erased.formattedText, "");
  CHECK_EQ_STR(erased.extractedValue, "");

  // set-text.yaml: setText("999999", autocomplete: false).
  const Result set = phone.apply("999999", 6, true, false, false);
  CHECK_EQ_STR(set.formattedText, "+1 (999) 999");
  CHECK_EQ_STR(set.extractedValue, "999999");

  // validation-regex.yaml: "[09999999].[00]".
  const MaskEngine decimal = make("[09999999].[00]");
  CHECK_EQ_STR(decimal.apply("22.11", 5, true, false, false).formattedText, "22.11");
  const Result letters = type(decimal, "aa11.11");
  CHECK_EQ_STR(letters.formattedText, "11.11");
  CHECK_EQ_STR(letters.extractedValue, "1111");
  const Result comma = type(decimal, "123456,.78");
  CHECK_EQ_STR(comma.formattedText, "123456.78");
  CHECK_EQ_STR(comma.extractedValue, "12345678");
}

// MARK: - beholdr/maska: Mask

// Ported from test/mask.test.ts. Maska's tokens translate as `#` -> [0],
// `@` -> [A], `*` -> [_], `!x` -> `\x` (or a bare literal), and everything
// else is a free literal, as it is here. `masked` is a whole-string apply with
// the caret at the end; `eager: true` is autocomplete; `unmasked` is the
// extracted value (maska leaves literals out of it, as free literals are).
// Not ported: `repeated`, `multiple`, `reversed`, `transform`, `tokensReplace`
// and function masks - none has an equivalent notation.

#define MASKED(engine, input, expected) CHECK_EQ_STR(masked(engine, input).formattedText, expected)
#define EAGER(engine, input, expected) CHECK_EQ_STR(masked(engine, input, true).formattedText, expected)
#define UNMASKED(engine, input, expected) CHECK_EQ_STR(masked(engine, input).extractedValue, expected)
#define COMPLETED(engine, input, expected) CHECK_EQ_INT(masked(engine, input).complete, expected)

static void maskaMask() {
  {  // '@ @' and '@ @' eager
    const MaskEngine m = make("[A] [A]");
    MASKED(m, "1", ""); MASKED(m, "a", "a"); MASKED(m, "ab", "a b"); MASKED(m, "abc", "a b");
    MASKED(m, "1abc", "a b"); UNMASKED(m, "1abc", "ab"); COMPLETED(m, "a", false); COMPLETED(m, "ab", true);
    EAGER(m, "1", ""); EAGER(m, "a", "a "); EAGER(m, "ab", "a b"); EAGER(m, "abc", "a b"); EAGER(m, "1abc", "a b");
  }
  {  // '#.#'
    const MaskEngine m = make("[0].[0]");
    MASKED(m, "1", "1"); MASKED(m, "1.", "1."); MASKED(m, "12", "1.2"); MASKED(m, "123", "1.2");
    MASKED(m, "a123", "1.2"); UNMASKED(m, "a123", "12");
    EAGER(m, "1", "1."); EAGER(m, "1.", "1."); EAGER(m, "1 ", "1."); EAGER(m, "12", "1.2"); EAGER(m, "123", "1.2");
    EAGER(m, "a123", "1.2");
  }
  {  // '@@-##'
    const MaskEngine m = make("[AA]-[00]");
    MASKED(m, "12", ""); MASKED(m, "ab", "ab"); MASKED(m, "ab12", "ab-12"); MASKED(m, "ab-12", "ab-12");
    MASKED(m, "abc123", "ab-12"); MASKED(m, "a1b2a1b2", "ab-21"); UNMASKED(m, "a1b2a1b2", "ab21");
    EAGER(m, "12", ""); EAGER(m, "ab", "ab-"); EAGER(m, "ab12", "ab-12"); EAGER(m, "ab-12", "ab-12");
    EAGER(m, "abc123", "ab-12"); EAGER(m, "a1b2a1b2", "ab-21");
  }
  {  // '(#)'
    const MaskEngine m = make("([0])");
    MASKED(m, "1", "(1"); MASKED(m, "(1", "(1"); MASKED(m, "1 ", "(1)"); MASKED(m, "12", "(1)");
    MASKED(m, "a12", "(1)"); UNMASKED(m, "a123", "1");
    EAGER(m, "1", "(1)"); EAGER(m, "(1", "(1)"); EAGER(m, "12", "(1)"); EAGER(m, "a12", "(1)");
  }
  {  // '#-#--#'
    const MaskEngine m = make("[0]-[0]--[0]");
    MASKED(m, "1", "1"); MASKED(m, "12", "1-2"); MASKED(m, "123", "1-2--3"); MASKED(m, "a1234", "1-2--3");
    UNMASKED(m, "a1234", "123");
    EAGER(m, "1", "1-"); EAGER(m, "12", "1-2--"); EAGER(m, "123", "1-2--3"); EAGER(m, "a1234", "1-2--3");
  }
  {  // '!##.#' - an escaped '#' literal
    const MaskEngine m = make("\\#[0].[0]");
    MASKED(m, "1", "#1"); MASKED(m, "#1", "#1"); MASKED(m, "12", "#1.2"); MASKED(m, "1.2", "#1.2");
    MASKED(m, "#1.2", "#1.2"); MASKED(m, "123", "#1.2"); MASKED(m, "a123", "#1.2"); UNMASKED(m, "a123", "12");
    EAGER(m, "1", "#1."); EAGER(m, "#1", "#1."); EAGER(m, "12", "#1.2"); EAGER(m, "1.2", "#1.2");
    EAGER(m, "#1.2", "#1.2"); EAGER(m, "123", "#1.2"); EAGER(m, "a123", "#1.2");
  }
  {  // '0#.#' - a leading literal that is also a digit
    const MaskEngine m = make("0[0].[0]");
    MASKED(m, "1", "01"); MASKED(m, "0", "0"); MASKED(m, "01", "01"); MASKED(m, "01.", "01.");
    MASKED(m, "12", "01.2"); MASKED(m, "1.2", "01.2"); MASKED(m, "01.2", "01.2"); MASKED(m, "123", "01.2");
    MASKED(m, "a123", "01.2"); UNMASKED(m, "a123", "12");
    EAGER(m, "1", "01."); EAGER(m, "0", "0"); EAGER(m, "01", "01."); EAGER(m, "01.", "01.");
    EAGER(m, "12", "01.2"); EAGER(m, "1.2", "01.2"); EAGER(m, "01.2", "01.2"); EAGER(m, "123", "01.2");
    EAGER(m, "a123", "01.2");
  }
  {  // '#.#!*' - an escaped '*' literal at the end
    const MaskEngine m = make("[0].[0]*");
    MASKED(m, "1", "1"); MASKED(m, "12", "1.2"); MASKED(m, "1.2", "1.2"); MASKED(m, "12*", "1.2*");
    MASKED(m, "1.2*", "1.2*"); MASKED(m, "1.2 ", "1.2*"); MASKED(m, "123", "1.2*"); MASKED(m, "a123", "1.2*");
    UNMASKED(m, "a123", "12");
    EAGER(m, "1", "1."); EAGER(m, "12", "1.2*"); EAGER(m, "1.2", "1.2*"); EAGER(m, "12*", "1.2*");
    EAGER(m, "1.2*", "1.2*"); EAGER(m, "123", "1.2*"); EAGER(m, "a123", "1.2*");
  }
  {  // '#.#!**'
    const MaskEngine m = make("[0].[0]*[_]");
    MASKED(m, "1", "1"); MASKED(m, "12", "1.2"); MASKED(m, "1.2", "1.2"); MASKED(m, "12*", "1.2*");
    MASKED(m, "1.2*", "1.2*"); MASKED(m, "1.2 ", "1.2*"); MASKED(m, "123", "1.2*3"); MASKED(m, "12*3", "1.2*3");
    MASKED(m, "a123", "1.2*3"); UNMASKED(m, "a123", "123");
    EAGER(m, "1", "1."); EAGER(m, "12", "1.2*"); EAGER(m, "1.2", "1.2*"); EAGER(m, "12*", "1.2*");
    EAGER(m, "1.2*", "1.2*"); EAGER(m, "1.2*3", "1.2*3"); EAGER(m, "123", "1.2*3"); EAGER(m, "a123", "1.2*3");
  }
  {  // '0#!-#' and '!0#!-#' eager (escaped literals)
    const MaskEngine m = make("0[0]-[0]");
    MASKED(m, "a", "0"); MASKED(m, "0", "0"); MASKED(m, "01", "01"); MASKED(m, "1", "01"); MASKED(m, "12", "01-2");
    MASKED(m, "01-2", "01-2"); MASKED(m, "123", "01-2"); MASKED(m, "a123", "01-2"); UNMASKED(m, "a123", "12");
    const MaskEngine e = make("\\0[0]\\-[0]");
    EAGER(e, "a", "0"); EAGER(e, "0", "0"); EAGER(e, "01", "01-"); EAGER(e, "1", "01-"); EAGER(e, "12", "01-2");
    EAGER(e, "01-2", "01-2"); EAGER(e, "123", "01-2"); EAGER(e, "a123", "01-2"); UNMASKED(e, "a123", "12");
  }
  {  // '#2 ##' - a literal digit between slots
    const MaskEngine m = make("[0]2 [00]");
    MASKED(m, "1", "1"); MASKED(m, "12", "12"); MASKED(m, "12 ", "12 "); MASKED(m, "13", "12 3");
    MASKED(m, "123", "12 3"); MASKED(m, "134", "12 34"); MASKED(m, "1234", "12 34"); MASKED(m, "1345", "12 34");
    MASKED(m, "12345", "12 34"); MASKED(m, "a1", "1"); MASKED(m, "a13", "12 3"); UNMASKED(m, "12345", "134");
    EAGER(m, "1", "12 "); EAGER(m, "12", "12 "); EAGER(m, "12 ", "12 "); EAGER(m, "13", "12 3");
    EAGER(m, "123", "12 3"); EAGER(m, "134", "12 34"); EAGER(m, "1234", "12 34"); EAGER(m, "1345", "12 34");
    EAGER(m, "12345", "12 34"); EAGER(m, "a1", "12 "); EAGER(m, "a13", "12 3");
  }
  {  // '(#) 3##'
    const MaskEngine m = make("([0]) 3[00]");
    MASKED(m, "1", "(1"); MASKED(m, "12", "(1) 32"); MASKED(m, "123", "(1) 323"); MASKED(m, "1234", "(1) 323");
    MASKED(m, "13", "(1) 3"); MASKED(m, "134", "(1) 34"); MASKED(m, "(1) 23", "(1) 323");
    MASKED(m, "(1) 34", "(1) 34");
    UNMASKED(m, "1", "1"); UNMASKED(m, "1234", "123"); UNMASKED(m, "(1) 3", "1"); UNMASKED(m, "(1) 32", "12");
    EAGER(m, "1", "(1) 3"); EAGER(m, "1 ", "(1) 3"); EAGER(m, "12", "(1) 32"); EAGER(m, "1 2", "(1) 32");
    EAGER(m, "123", "(1) 323"); EAGER(m, "1234", "(1) 323"); EAGER(m, "13", "(1) 3"); EAGER(m, "1 3", "(1) 3");
    EAGER(m, "134", "(1) 34"); EAGER(m, "(1) 23", "(1) 323"); EAGER(m, "(1) 34", "(1) 34");
  }
  {  // '(1) 2#'
    const MaskEngine m = make("(1) 2[0]");
    MASKED(m, " ", "(1) "); MASKED(m, ".", "(1) 2"); MASKED(m, "1", "(1"); MASKED(m, "12", "(1) 2");
    MASKED(m, "123", "(1) 23"); MASKED(m, "1234", "(1) 23"); MASKED(m, "13", "(1) 23");
    MASKED(m, "(1) 23", "(1) 23"); MASKED(m, "(1) 34", "(1) 23"); MASKED(m, "2", "(1) 2"); MASKED(m, "23", "(1) 23");
    MASKED(m, "3", "(1) 23"); MASKED(m, "4", "(1) 24");
    UNMASKED(m, "1", ""); UNMASKED(m, "12", ""); UNMASKED(m, "123", "3"); UNMASKED(m, "(1) 23", "3");
  }
  {  // '(1) 2##' eager
    const MaskEngine m = make("(1) 2[00]");
    EAGER(m, " ", "(1) 2"); EAGER(m, ".", "(1) 2"); EAGER(m, "1", "(1) 2"); EAGER(m, "1 ", "(1) 2");
    EAGER(m, "12", "(1) 2"); EAGER(m, "1 2", "(1) 2"); EAGER(m, "123", "(1) 23"); EAGER(m, "1 23", "(1) 23");
    EAGER(m, "12 3", "(1) 23"); EAGER(m, "13", "(1) 23"); EAGER(m, "134", "(1) 234"); EAGER(m, "(1) 23", "(1) 23");
    EAGER(m, "(1) 34", "(1) 234"); EAGER(m, "2", "(1) 2"); EAGER(m, "23", "(1) 23"); EAGER(m, "3", "(1) 23");
    EAGER(m, "34", "(1) 234");
    UNMASKED(m, "1", ""); UNMASKED(m, "12", ""); UNMASKED(m, "123", "3"); UNMASKED(m, "(1) 23", "3");
  }
  {  // '12##'
    const MaskEngine m = make("12[00]");
    MASKED(m, ".", "12"); MASKED(m, "1", "1"); MASKED(m, "1 ", "12"); MASKED(m, "2", "12"); MASKED(m, "3", "123");
    MASKED(m, "12", "12"); MASKED(m, "12 ", "12"); MASKED(m, "123", "123"); MASKED(m, "13", "123");
    MASKED(m, "134", "1234");
    UNMASKED(m, "1", ""); UNMASKED(m, "12", ""); UNMASKED(m, "123", "3"); UNMASKED(m, "3", "3");
    UNMASKED(m, "(1) 23", "12");
    EAGER(m, " ", "12"); EAGER(m, ".", "12"); EAGER(m, "1", "12"); EAGER(m, "1 ", "12"); EAGER(m, "2", "12");
    EAGER(m, "3", "123"); EAGER(m, "12", "12"); EAGER(m, "123", "123"); EAGER(m, "13", "123");
    EAGER(m, "134", "1234"); EAGER(m, "34", "1234");
  }
  {  // '#!!#' - an escaped '!' literal
    const MaskEngine m = make("[0]![0]");
    MASKED(m, "1", "1"); MASKED(m, "12", "1!2"); MASKED(m, "1!2", "1!2"); MASKED(m, "123", "1!2");
    MASKED(m, "a123", "1!2"); UNMASKED(m, "a123", "12");
    EAGER(m, "1", "1!"); EAGER(m, "12", "1!2"); EAGER(m, "1!2", "1!2"); EAGER(m, "123", "1!2");
    EAGER(m, "a123", "1!2");
  }
  {  // '+1 (###) ###-##-##'
    const MaskEngine m = make("+1 ([000]) [000]-[00]-[00]");
    MASKED(m, "999", "+1 (999"); MASKED(m, "999123", "+1 (999) 123");
    MASKED(m, "19991234567", "+1 (999) 123-45-67"); MASKED(m, "+19991234567", "+1 (999) 123-45-67");
    MASKED(m, "9991234567", "+1 (999) 123-45-67"); MASKED(m, "a9991234567", "+1 (999) 123-45-67");
    UNMASKED(m, "+19991234567", "9991234567");
    EAGER(m, ".", "+1 ("); EAGER(m, " ", "+1 ("); EAGER(m, "+", "+1 ("); EAGER(m, "99", "+1 (99");
    EAGER(m, "999", "+1 (999) "); EAGER(m, "99912", "+1 (999) 12"); EAGER(m, "999123", "+1 (999) 123-");
    EAGER(m, "19", "+1 (9"); EAGER(m, "19991234567", "+1 (999) 123-45-67");
    EAGER(m, "+19991234567", "+1 (999) 123-45-67"); EAGER(m, "9991234567", "+1 (999) 123-45-67");
    EAGER(m, "a9991234567", "+1 (999) 123-45-67");
  }
  {  // '1 (###) ###-##-##' eager
    const MaskEngine m = make("1 ([000]) [000]-[00]-[00]");
    EAGER(m, "+", "1 ("); EAGER(m, "+19991234567", "1 (199) 912-34-56");
    EAGER(m, "19991234567", "1 (999) 123-45-67"); EAGER(m, "9991234567", "1 (999) 123-45-67");
    EAGER(m, "a9991234567", "1 (999) 123-45-67");
    UNMASKED(m, "19991234567", "9991234567"); UNMASKED(m, "+19991234567", "1999123456");
  }
  {  // 'IP mask': '#00.#00.#00.#00' with '0' an optional digit
    const MaskEngine m = make("[099].[099].[099].[099]");
    MASKED(m, "127.0.0.1", "127.0.0.1"); MASKED(m, "254254254254", "254.254.254.254");
    MASKED(m, "1.23.456.7890", "1.23.456.789"); MASKED(m, "a1.23.456.7890", "1.23.456.789");
    UNMASKED(m, "a254.254.254.254", "254254254254");
  }
  {  // 'dynamic mask': ['###.###.###-##', '##.###.###/####-##'] picks by
     // value length, which is our extracted-value capacity with the widest
     // format as the primary.
    MaskEngine m;
    m.setAffinityStrategy(MaskEngine::kAffinityExtractedValueCapacity);
    m.addAffinityFormat("[000].[000].[000]-[00]");
    CHECK(m.setFormat("[00].[000].[000]/[0000]-[00]", {}));
    MASKED(m, "12345678901", "123.456.789-01"); MASKED(m, "123456789012", "12.345.678/9012");
    MASKED(m, "12345678901234", "12.345.678/9012-34"); MASKED(m, "a123456789012345", "12.345.678/9012-34");
    UNMASKED(m, "a123456789012345", "12345678901234");
    COMPLETED(m, "1234567890", false); COMPLETED(m, "12345678901", true); COMPLETED(m, "123456789012", false);
    COMPLETED(m, "1234567890123", false); COMPLETED(m, "12345678901234", true);
  }
  {  // 'dynamic escaped mask': ['!###', '!###-##', '!###.##.##']
    MaskEngine m;
    m.setAffinityStrategy(MaskEngine::kAffinityExtractedValueCapacity);
    m.addAffinityFormat("\\#[00]");
    m.addAffinityFormat("\\#[00]-[00]");
    CHECK(m.setFormat("\\#[00].[00].[00]", {}));
    MASKED(m, "12", "#12"); MASKED(m, "1234", "#12-34"); MASKED(m, "12345", "#12.34.5");
    MASKED(m, "1234567", "#12.34.56");
  }
  {  // 'unicode tokens': 'A' as [\p{L}] multiple
    const MaskEngine m = make("[A…]");
    MASKED(m, "1", ""); MASKED(m, "z", "z"); MASKED(m, "zя", "zя"); MASKED(m, "zя1", "zя");
  }
}

// MARK: - beholdr/maska: MaskInput keystrokes

// Ported from test/input.test.ts. `user.type(input, keys)` types one key at a
// time at the caret: `{ }` is a space, `{backspace}` is "\b", `{ArrowLeft}`
// moves the caret, `initialSelectionStart` puts it somewhere first. Each test
// starts from an empty field.
//
// MASKA MODEL: maska's eager mode keeps completing after a deletion (erasing
// "-" from "1-" gives "1-" back; erasing "1" from "1-2" gives "2-"). Our
// deletions never autocomplete (RedMadRobot's backward gravity), so those
// cases expect what the RedMadRobot model gives and are marked MASKA MODEL.

#define TYPED(engine, keys, eager, expected) CHECK_EQ_STR(type(engine, keys, eager).formattedText, expected)

static void maskaInput() {
  {  // 'test callback' / 'test eager callback': '+1 ###'
    const MaskEngine m = make("+1 [000]");
    const Result one = type(m, "1", false);
    CHECK_EQ_STR(one.formattedText, "+1"); CHECK_EQ_STR(one.extractedValue, ""); CHECK(!one.complete);
    TYPED(m, "12", false, "+1 2"); TYPED(m, "2", false, "+1 2"); TYPED(m, "23", false, "+1 23");
    const Result full = type(m, "234", false);
    CHECK_EQ_STR(full.formattedText, "+1 234"); CHECK_EQ_STR(full.extractedValue, "234"); CHECK(full.complete);
    TYPED(m, "2345", false, "+1 234");
    const Result eagerOne = type(m, "1", true);
    CHECK_EQ_STR(eagerOne.formattedText, "+1 "); CHECK_EQ_STR(eagerOne.extractedValue, "");
    TYPED(m, "12", true, "+1 2"); TYPED(m, "2", true, "+1 2"); TYPED(m, "23", true, "+1 23");
    TYPED(m, "234", true, "+1 234"); TYPED(m, "2345", true, "+1 234");
    CHECK_EQ_STR(type(m, "12", true).extractedValue, "2");
  }
  {  // '#-# mask'
    const MaskEngine m = make("[0]-[0]");
    TYPED(m, "1", false, "1"); TYPED(m, "1-", false, "1-"); TYPED(m, "12", false, "1-2"); TYPED(m, "1-2", false, "1-2");
    TYPED(m, "123", false, "1-2"); TYPED(m, "1 ", false, "1-"); TYPED(m, "1 2", false, "1-2");
    TYPED(m, "12\b", false, "1-"); TYPED(m, "12\b\b", false, "1");
    const Result twelve = type(m, "12", false);
    CHECK_EQ_STR(backspaceAt(m, twelve, 1).formattedText, "2");
    CHECK_EQ_STR(backspaceAt(m, twelve, 2).formattedText, "1-2");
    CHECK_EQ_STR(deleteAt(m, twelve, 0).formattedText, "2");
    CHECK_EQ_STR(deleteAt(m, twelve, 1).formattedText, "1-2");
    CHECK_EQ_STR(deleteAt(m, twelve, 2).formattedText, "1-");
    CHECK_EQ_STR(typeFrom(m, at(twelve, 0), "3", false).formattedText, "3-1");
    CHECK_EQ_STR(typeFrom(m, at(twelve, 1), "3", false).formattedText, "1-3");
    CHECK_EQ_STR(typeFrom(m, at(twelve, 2), "3", false).formattedText, "1-3");
  }
  {  // '#-# eager mask'
    const MaskEngine m = make("[0]-[0]");
    TYPED(m, "1", true, "1-"); TYPED(m, "12", true, "1-2"); TYPED(m, "123", true, "1-2"); TYPED(m, "1 ", true, "1-");
    TYPED(m, "1 2", true, "1-2"); TYPED(m, "12\b", true, "1-");
    TYPED(m, "12\b\b", true, "1");  // MASKA MODEL: maska "1-"
    TYPED(m, "12\b\b\b", true, "");
    const Result twelve = type(m, "12", true);
    CHECK_EQ_STR(backspaceAt(m, twelve, 1).formattedText, "2");  // MASKA MODEL: maska "2-"
    CHECK_EQ_STR(backspaceAt(m, twelve, 2).formattedText, "1-2");
    CHECK_EQ_STR(deleteAt(m, twelve, 0).formattedText, "2");  // MASKA MODEL: maska "2-"
    CHECK_EQ_STR(deleteAt(m, twelve, 1).formattedText, "1-2");
    CHECK_EQ_STR(deleteAt(m, twelve, 2).formattedText, "1-");
    CHECK_EQ_STR(typeFrom(m, at(twelve, 0), "3").formattedText, "3-1");
    CHECK_EQ_STR(typeFrom(m, at(twelve, 1), "3").formattedText, "1-3");
    CHECK_EQ_STR(typeFrom(m, at(twelve, 2), "3").formattedText, "1-3");
  }
  {  // '+1 (#) #-# eager mask'
    const MaskEngine m = make("+1 ([0]) [0]-[0]");
    TYPED(m, "1", true, "+1 ("); TYPED(m, "12", true, "+1 (2) "); TYPED(m, "123", true, "+1 (2) 3-");
    TYPED(m, "1234", true, "+1 (2) 3-4"); TYPED(m, "2", true, "+1 (2) "); TYPED(m, "234", true, "+1 (2) 3-4");
    const Result two = type(m, "2");
    CHECK_EQ_STR(typeFrom(m, at(two, two.caret - 1), "3").formattedText, "+1 (2) 3-");
    TYPED(m, "234\b", true, "+1 (2) 3-");
    TYPED(m, "234\b\b", true, "+1 (2) 3");     // MASKA MODEL: maska "+1 (2) 3-"
    TYPED(m, "234\b\b\b", true, "+1 (2) ");
    TYPED(m, "234\b\b\b\b", true, "+1 (2)");    // MASKA MODEL: maska "+1 (2) "
    TYPED(m, "234\b\b\b\b\b", true, "+1 (2");   // MASKA MODEL: maska "+1 (2) "
    TYPED(m, "234\b\b\b\b\b\b", true, "+1 (");  // MASKA MODEL: maska ""
  }
  {  // '#-#--# mask'
    const MaskEngine m = make("[0]-[0]--[0]");
    TYPED(m, "12", false, "1-2"); TYPED(m, "12-", false, "1-2-"); TYPED(m, "12--", false, "1-2--");
    TYPED(m, "12---", false, "1-2--"); TYPED(m, "12 ", false, "1-2--"); TYPED(m, "1234", false, "1-2--3");
    TYPED(m, "1234\b", false, "1-2--"); TYPED(m, "1234\b\b", false, "1-2-");
    const Result three = type(m, "123", false);
    CHECK_EQ_STR(typeFrom(m, at(three, 5), "\b\b", false).formattedText, "1-2--3");
    CHECK_EQ_STR(backspaceAt(m, three, 3).formattedText, "1-3");
  }
  {  // '#-#--# eager mask'
    const MaskEngine m = make("[0]-[0]--[0]");
    TYPED(m, "12", true, "1-2--"); TYPED(m, "12 ", true, "1-2--"); TYPED(m, "1234", true, "1-2--3");
    TYPED(m, "1234\b", true, "1-2--");
    TYPED(m, "1234\b\b", true, "1-2-");  // MASKA MODEL: maska "1-2--"
    const Result three = type(m, "123", true);
    CHECK_EQ_STR(typeFrom(m, at(three, 5), "\b\b").formattedText, "1-2--3");
    CHECK_EQ_STR(backspaceAt(m, three, 3).formattedText, "1-3");  // MASKA MODEL: maska "1-3--"
  }
  {  // '#2 ## mask' and eager
    const MaskEngine m = make("[0]2 [00]");
    TYPED(m, "1", false, "1"); TYPED(m, "12", false, "12"); TYPED(m, "123", false, "12 3");
    TYPED(m, "13", false, "12 3"); TYPED(m, "133", false, "12 33");
    TYPED(m, "1", true, "12 "); TYPED(m, "2", true, "22 "); TYPED(m, "11", true, "12 1"); TYPED(m, "111", true, "12 11");
    TYPED(m, "12", true, "12 2"); TYPED(m, "123", true, "12 23"); TYPED(m, "1234", true, "12 23");
    TYPED(m, "13", true, "12 3"); TYPED(m, "133", true, "12 33"); TYPED(m, " ", true, "");
  }
  {  // '(#) 2## mask' and eager
    const MaskEngine m = make("([0]) 2[00]");
    TYPED(m, "1", false, "(1"); TYPED(m, "12", false, "(1) 2"); TYPED(m, "123", false, "(1) 23");
    TYPED(m, "13", false, "(1) 23"); TYPED(m, "133", false, "(1) 233");
    TYPED(m, "1", true, "(1) 2"); TYPED(m, "12", true, "(1) 22"); TYPED(m, "123", true, "(1) 223");
    TYPED(m, "13", true, "(1) 23"); TYPED(m, "133", true, "(1) 233");
  }
  {  // '12## eager mask'
    const MaskEngine m = make("12[00]");
    TYPED(m, "1", true, "12"); TYPED(m, "2", true, "12"); TYPED(m, "3", true, "123"); TYPED(m, "11", true, "121");
    TYPED(m, "12", true, "122"); TYPED(m, "123", true, "1223"); TYPED(m, "13", true, "123");
    TYPED(m, "133", true, "1233"); TYPED(m, " ", true, "12"); TYPED(m, "  ", true, "12");
    TYPED(m, "1\b", true, "1");  // MASKA MODEL: maska ""
    TYPED(m, "123\b", true, "122");
  }
  {  // '+1 (###) ###-##-## mask' and eager
    const MaskEngine m = make("+1 ([000]) [000]-[00]-[00]");
    TYPED(m, "1", false, "+1"); TYPED(m, "9", false, "+1 (9"); TYPED(m, "90", false, "+1 (90");
    TYPED(m, "903", false, "+1 (903"); TYPED(m, "9034", false, "+1 (903) 4");
    TYPED(m, "19991234567", false, "+1 (999) 123-45-67"); TYPED(m, "9991234567", false, "+1 (999) 123-45-67");
    TYPED(m, " ", false, "+1 ");
    TYPED(m, "+", true, "+1 ("); TYPED(m, "1", true, "+1 ("); TYPED(m, "9", true, "+1 (9"); TYPED(m, "90", true, "+1 (90");
    TYPED(m, "903", true, "+1 (903) "); TYPED(m, "9034", true, "+1 (903) 4");
    TYPED(m, "903456", true, "+1 (903) 456-"); TYPED(m, "19991234567", true, "+1 (999) 123-45-67");
    TYPED(m, "9991234567", true, "+1 (999) 123-45-67"); TYPED(m, " ", true, "+1 (");
  }
  {  // "Optional with multiple '-9' mask": '-' an optional sign, then digits
    const MaskEngine m = make("[s][0…]", {MaskEngine::Notation{'s', {'-'}, true}});
    TYPED(m, " ", false, ""); TYPED(m, "1", false, "1"); TYPED(m, "12", false, "12"); TYPED(m, "-", false, "-");
    TYPED(m, "-1", false, "-1");
    const Result one = type(m, "1", false);
    CHECK_EQ_STR(typeFrom(m, at(one, 0), "-", false).formattedText, "-1");
    CHECK_EQ_STR(typeFrom(m, at(one, 0), "--", false).formattedText, "-1");
  }
  {  // 'IP mask' and 'IP eager mask'
    const MaskEngine m = make("[099].[099].[099].[099]");
    for (const bool eager : {false, true}) {
      TYPED(m, "1", eager, "1"); TYPED(m, "12", eager, "12");
      TYPED(m, "123", eager, eager ? "123." : "123");
      TYPED(m, "1234", eager, "123.4"); TYPED(m, "123 ", eager, "123."); TYPED(m, "123.", eager, "123.");
      TYPED(m, "123..", eager, "123."); TYPED(m, "1.2.", eager, "1.2."); TYPED(m, "1.2..", eager, "1.2.");
      TYPED(m, "1.23", eager, "1.23");
      TYPED(m, "1.234", eager, eager ? "1.234." : "1.234");
      TYPED(m, "1.2345", eager, "1.234.5"); TYPED(m, "1.23.456.7", eager, "1.23.456.7");
      TYPED(m, "1.23.456.7.", eager, "1.23.456.7"); TYPED(m, "1.2.3.4", eager, "1.2.3.4");
      TYPED(m, "123.456.789.012", eager, "123.456.789.012");
      TYPED(m, "123.456.789.0123", eager, "123.456.789.012");
    }
    const Result ip = type(m, "12.3");
    CHECK_EQ_STR(typeFrom(m, at(ip, ip.caret - 1), "a").formattedText, "12.3");
    CHECK_EQ_STR(typeFrom(m, at(ip, ip.caret - 1), "1").formattedText, "12.13");
  }
  {  // 'Dynamic mask' / 'Dynamic eager mask': ['#--#', '#-#--#'], picked by
     // value length (extracted-value capacity, widest first).
    MaskEngine m;
    m.setAffinityStrategy(MaskEngine::kAffinityExtractedValueCapacity);
    m.addAffinityFormat("[0]--[0]");
    CHECK(m.setFormat("[0]-[0]--[0]", {}));
    TYPED(m, "1", false, "1"); TYPED(m, "12", false, "1--2"); TYPED(m, "123", false, "1-2--3");
    TYPED(m, "1234", false, "1-2--3"); TYPED(m, "123\b", false, "1--2");
    TYPED(m, "1", true, "1--"); TYPED(m, "12", true, "1--2"); TYPED(m, "123", true, "1-2--3");
    TYPED(m, "1234", true, "1-2--3"); TYPED(m, "123\b", true, "1--2");
  }
  {  // 'Cursor position eager mask': '##-##'
    const MaskEngine m = make("[00]-[00]");
    const Result three = type(m, "123");
    CHECK_EQ_STR(three.formattedText, "12-3");
    const Result zero = typeFrom(m, at(three, 2), "0");
    CHECK_EQ_STR(zero.formattedText, "12-03");
    CHECK_EQ_INT(zero.caret, 4);
    const Result space = typeFrom(m, at(three, 3), " ");
    CHECK_EQ_STR(space.formattedText, "12-3");
    CHECK_EQ_INT(space.caret, 3);
  }
  {  // 'Cursor position with multi-char literals': '(###) ###-####'
    const MaskEngine m = make("([000]) [000]-[0000]");
    const Result filled = type(m, "2025550123", false);
    CHECK_EQ_STR(filled.formattedText, "(202) 555-0123");
    const Result front = typeFrom(m, at(filled, 0), "9876", false);
    CHECK_EQ_STR(front.formattedText, "(987) 620-2555");
    CHECK_EQ_INT(front.caret, 7);
    CHECK_EQ_STR(typeFrom(m, at(filled, 0), "9876543210", false).formattedText, "(987) 654-3210");
  }
  {  // 'Cursor position with invisible literals (RTL date)': U+200F marks
    const MaskEngine m = make("[00]\u200F/[00]\u200F/[0000]");
    const Result date = type(m, "15082008", false);
    CHECK_EQ_STR(date.formattedText, "15\u200F/08\u200F/2008");
    CHECK_EQ_INT(date.caret, 12);
    const Result retyped = typeFrom(m, at(type(m, "25121995", false), 0), "27111990", false);
    CHECK_EQ_STR(retyped.formattedText, "27\u200F/11\u200F/1990");
    CHECK_EQ_INT(retyped.caret, 12);
    const Result four = typeFrom(m, date, "\b\b\b\b", false);
    CHECK_EQ_STR(four.formattedText, "15\u200F/08\u200F/");
    CHECK_EQ_INT(four.caret, 8);
    const Result six = typeFrom(m, four, "\b\b", false);
    CHECK_EQ_STR(six.formattedText, "15\u200F/08");
    CHECK_EQ_INT(six.caret, 6);
    const Result inside = backspaceAt(m, date, 9);
    CHECK_EQ_STR(inside.formattedText, "15\u200F/08\u200F/008");
    CHECK_EQ_INT(inside.caret, 8);
  }
  {  // 'Unicode tokens mask'
    const MaskEngine m = make("[A…]");
    Result r = type(m, "1");
    CHECK_EQ_STR(r.formattedText, "");
    r = typeFrom(m, r, "z");
    CHECK_EQ_STR(r.formattedText, "z");
    r = typeFrom(m, r, "я");
    CHECK_EQ_STR(r.formattedText, "zя");
    r = typeFrom(m, r, "1");
    CHECK_EQ_STR(r.formattedText, "zя");
  }
}

// MARK: - Fixed gaps

// Cases that failed because of a genuine engine bug, fixed since. They fail
// the run like any other check. Each names its upstream source and what was
// wrong.
static void fixedGaps() {
  // FIXED 1 - caret gravity was the wrong way round.
  // RedMadRobot's CaretStringIterator.insertionAffectsCaret() is
  // `currentIndex <= caret` under FORWARD gravity and `currentIndex < caret`
  // under BACKWARD; MaskEngine::applyCompiled has them swapped
  // (`caretForward ? at < caret : at <= caret`). So a constant the walk
  // inserts exactly at the caret stays in front of it after typing and jumps
  // behind it after deleting: "1111" with the caret at 2 under
  // "[00]{.}[00]{.}[0000]" gives "11|.11" forward (upstream "11.|11") and
  // "11.|11" backward (upstream "11|.11"). Text, value and completeness match;
  // only the caret is off.
  static const ApplyCase kAndroidDayMonthYearMaskGravity[] = {
      {"apply_1111_ThirdIndex_returns_11dot11_FourthIndex", 309, "1111", 2, true, false, "11.11", 3, "11.11", 0, kNoAffinity},
  };
  static const ApplyCase kAndroidDayMonthYearShortGravity[] = {
      {"apply_1111_ThirdIndex_returns_11dot11_FourthIndex", 309, "1111", 2, true, false, "11.11", 3, "11.11", 0, 3},
  };
  static const ApplyCase kIosDayMonthYearGravity[] = {
      {"testApply_1111_ThirdIndex_returns_11dot11_FourthIndex", 344, "1111", 2, true, false, "11.11", 3, "11.11", 0, kNoAffinity},
      {"testApply_1111_ThirdIndexGravityBackward_returns_11dot11_ThirdIndex", 367, "1111", 2, false, false, "11.11", 2, "11.11", 0, kNoAffinity},
  };
  static const ApplyCase kIosDayMonthYearShortGravity[] = {
      {"testApply_1111_ThirdIndex_returns_11dot11_FourthIndex", 356, "1111", 2, true, false, "11.11", 3, "11.11", 0, 3},
      {"testApply_1111_ThirdIndexGravityBackward_returns_11dot11_ThirdIndex", 380, "1111", 2, false, false, "11.11", 2, "11.11", 0, 3},
  };
  static const ApplyCase kIosMonthYearGravity[] = {
      {"testApply_1111_ThirdIndex_returns_11slash11_FourthIndex", 344, "1111", 2, true, false, "11/11", 3, "11/11", 0, kNoAffinity},
      {"testApply_1111_ThirdIndexGravityBackward_returns_11slash11_ThirdIndex", 367, "1111", 2, false, false, "11/11", 2, "11/11", 0, kNoAffinity},
  };
  static const ApplyCase kIosMonthYearDoubleSlashGravity[] = {
      {"testApply_1111_ThirdIndex_returns_11doubleShash11_FifthIndex", 390, "1111", 2, true, false, "11//11", 4, "11//11", 0, kNoAffinity},
      {"testApply_1111_ThirdIndexGravityBackward_returns_11doubleShash11_ThirdIndex", 413, "1111", 2, false, false, "11//11", 2, "11//11", 0, kNoAffinity},
  };
  const Suite gravity[] = {
      {"DayMonthYearMaskTest.kt", "[00]{.}[00]{.}[0000]", {}, nullptr, 0, kAndroidDayMonthYearMaskGravity, std::size(kAndroidDayMonthYearMaskGravity)},
      {"DayMonthYearShortTest.kt", "[90]{.}[90]{.}[0000]", {}, nullptr, 0, kAndroidDayMonthYearShortGravity, std::size(kAndroidDayMonthYearShortGravity)},
      {"DayMonthYearCase.swift", "[00]{.}[00]{.}[0000]", {}, nullptr, 0, kIosDayMonthYearGravity, std::size(kIosDayMonthYearGravity)},
      {"DayMonthYearShortCase.swift", "[90]{.}[90]{.}[0000]", {}, nullptr, 0, kIosDayMonthYearShortGravity, std::size(kIosDayMonthYearShortGravity)},
      {"MonthYearCase.swift", "[00]{/}[0000]", {}, nullptr, 0, kIosMonthYearGravity, std::size(kIosMonthYearGravity)},
      {"MonthYearDoubleSlashCase.swift", "[00]{//}[0000]", {}, nullptr, 0, kIosMonthYearDoubleSlashGravity, std::size(kIosMonthYearDoubleSlashGravity)},
  };
  for (const Suite& suite : gravity) runSuite(suite);

  // FIXED 2 - the format sanitizer moved an ellipsis in front of optional
  // slots. normalizeBlock() stable-partitions mandatory before optional, and
  // `…` is not an optional slot, so "[9…]" becomes "[…9]": the ellipsis now
  // follows `[` and inherits the alphanumeric default, and the `9` is
  // unreachable. Upstream's FormatSanitizer sorts by character, which always
  // leaves `…` last ("[9…]" stays "[9…]", a digit run). Same for "[a…]".
  // Ported from input-mask-ios SillyPiEllipticalCase.swift
  // (testGetPlaceholder_allSet_returnsCorrectPlaceholder) - its apply cases
  // only type digits, so they pass by luck.
  {
    const MaskEngine pi = make("{3.14}[9…]");
    CHECK_EQ_STR(pi.apply("", 0, true, false, false).tailPlaceholder, "3.140");
    // Not upstream, but what that placeholder implies: letters are refused.
    CHECK_EQ_STR(masked(pi, "3.14a1").formattedText, "3.141");
    CHECK_EQ_STR(masked(make("[9…]"), "a1b2").formattedText, "12");
    CHECK_EQ_STR(masked(make("[a…]"), "a1b2").formattedText, "ab");
  }
}

int main() {
  redMadRobotAndroidSuites();
  redMadRobotIosSuites();
  redMadRobotSanitizerAndCompiler();
  redMadRobotAffinityStrategies();
  advancedInputMaskE2e();
  maskaMask();
  maskaInput();
  fixedGaps();

  std::printf("%d checks, %d failed\n", checks, failures);
  if (failures == 0) {
    std::printf("MaskEngine corpus: all ported cases pass\n");
    return 0;
  }
  return 1;
}
