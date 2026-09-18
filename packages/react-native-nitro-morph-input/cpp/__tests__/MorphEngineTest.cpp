// Host-side checks for the shared engine and formatter. Build & run with `bun run test:cpp`.
#include "AmountFormatter.hpp"
#include "MorphEngine.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

using margelo::nitro::nitromorphinput::AmountFormatter;
using margelo::nitro::nitromorphinput::MorphEngine;

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

static bool near(double a, double b, double eps = 1e-6) {
  return std::fabs(a - b) < eps;
}

// MARK: - Formatter

static AmountFormatter usFormatter(int fractionDigits = 2, int maxIntegerDigits = 15) {
  AmountFormatter f;
  f.setFormat(fractionDigits, maxIntegerDigits, ",", ".");
  return f;
}

/// Types `keys` one at a time at the caret, like a keyboard.
static AmountFormatter::Edit type(const AmountFormatter& f, std::string text, int caret, const std::string& keys) {
  AmountFormatter::Edit edit{text, caret, true};
  for (char k : keys) {
    edit = f.applyEdit(edit.text, edit.caret, edit.caret, std::string(1, k));
  }
  return edit;
}

static void formatterGroupsAsYouType() {
  const auto f = usFormatter();
  auto e = type(f, "", 0, "1");
  CHECK_EQ_STR(e.text, "1");
  CHECK(e.caret == 1);
  e = type(f, e.text, e.caret, "234");
  CHECK_EQ_STR(e.text, "1,234");
  CHECK(e.caret == 5);
  e = type(f, e.text, e.caret, "5");
  CHECK_EQ_STR(e.text, "12,345");
  CHECK(e.caret == 6);
  e = type(f, e.text, e.caret, "67");
  CHECK_EQ_STR(e.text, "1,234,567");
  CHECK(e.caret == 9);

  // Backspace at the end.
  e = f.applyEdit("1,234", 4, 5, "");
  CHECK_EQ_STR(e.text, "123");
  CHECK(e.caret == 3);
  // Backspace over the comma removes the digit before it.
  e = f.applyEdit("1,234", 1, 2, "");
  CHECK_EQ_STR(e.text, "234");
  CHECK(e.caret == 0);
  // Insert in the middle keeps the caret after the typed digit.
  e = f.applyEdit("1,234", 3, 3, "9");
  CHECK_EQ_STR(e.text, "12,934");
  CHECK(e.caret == 4);
  // Replacing a selection.
  e = f.applyEdit("1,234", 2, 5, "5");
  CHECK_EQ_STR(e.text, "15");
  CHECK(e.caret == 2);
}

static void formatterDecimals() {
  const auto f = usFormatter();
  auto e = type(f, "1,234", 5, ".");
  CHECK_EQ_STR(e.text, "1,234.");
  CHECK(e.caret == 6);
  e = type(f, e.text, e.caret, "5");
  CHECK_EQ_STR(e.text, "1,234.5");
  e = type(f, e.text, e.caret, "6");
  CHECK_EQ_STR(e.text, "1,234.56");
  CHECK(e.caret == 8);
  // A third decimal is rejected, the text and caret stay.
  e = f.applyEdit(e.text, e.caret, e.caret, "7");
  CHECK(!e.accepted);
  CHECK_EQ_STR(e.text, "1,234.56");
  CHECK(e.caret == 8);
  // A second decimal separator typed at the end is dropped.
  e = f.applyEdit("1,234.56", 8, 8, ".");
  CHECK_EQ_STR(e.text, "1,234.56");
  CHECK(e.caret == 8);
  // A decimal typed elsewhere moves the decimal point; the fraction is cut to fit.
  e = f.applyEdit("1,234.5", 2, 2, ".");
  CHECK_EQ_STR(e.text, "1.23");
  CHECK(e.caret == 2);
  // A comma typed on a decimal pad counts as the decimal.
  e = f.applyEdit("12", 2, 2, ",");
  CHECK_EQ_STR(e.text, "12.");
  // A leading decimal stays as typed (no synthesised zero while typing).
  e = type(f, "", 0, ".5");
  CHECK_EQ_STR(e.text, ".5");
  CHECK(e.caret == 2);
  CHECK(near(f.value(".5"), 0.5));
  // A digit typed in front of a lone zero replaces it.
  e = f.applyEdit("0.5", 0, 0, "7");
  CHECK_EQ_STR(e.text, "7.5");
  CHECK(e.caret == 1);
  // Deleting the decimal point merges the fraction into the integer part.
  e = f.applyEdit("1,234.56", 5, 6, "");
  CHECK_EQ_STR(e.text, "123,456");
  CHECK(e.caret == 5);
  // Leading zeros collapse.
  e = type(f, "", 0, "05");
  CHECK_EQ_STR(e.text, "5");
  CHECK(e.caret == 1);
  e = type(f, "", 0, "0");
  CHECK_EQ_STR(e.text, "0");
  // No decimals at all.
  const auto whole = usFormatter(0);
  e = whole.applyEdit("12", 2, 2, ".");
  CHECK_EQ_STR(e.text, "12");
  CHECK(e.caret == 2);
}

static void formatterLimitsAndValues() {
  const auto f = usFormatter(2, 3);
  auto e = f.applyEdit("123", 3, 3, "4");
  CHECK(!e.accepted);
  CHECK_EQ_STR(e.text, "123");
  e = f.normalize("123456.789");
  CHECK_EQ_STR(e.text, "123.78");

  const auto us = usFormatter();
  CHECK(near(us.value("1,234.56"), 1234.56));
  CHECK(near(us.value("0.5"), 0.5));
  CHECK(std::isnan(us.value("")));
  CHECK(std::isnan(us.value(".")));
  CHECK_EQ_STR(us.format(1234.5), "1,234.5");
  CHECK_EQ_STR(us.format(1234), "1,234");
  CHECK_EQ_STR(us.format(0.126), "0.13");
  CHECK_EQ_STR(us.format(std::nan("")), "");
  CHECK_EQ_STR(us.normalize("$ 12,345.678 USD").text, "12,345.67");
  CHECK_EQ_STR(us.normalize(".5").text, "0.5");
  CHECK_EQ_STR(us.format(0.5), "0.5");

  // European separators: '.' groups, ',' is the decimal.
  AmountFormatter eu;
  eu.setFormat(2, 15, ".", ",");
  e = type(eu, "", 0, "1234,5");
  CHECK_EQ_STR(e.text, "1.234,5");
  e = eu.applyEdit("1.234", 5, 5, ".");
  CHECK_EQ_STR(e.text, "1.234,");  // a '.' from a US decimal pad still means the decimal
  CHECK_EQ_STR(eu.format(1234.5), "1.234,5");
  CHECK(near(eu.value("1.234,5"), 1234.5));
  CHECK(eu.kindOf('.') == MorphEngine::Separator);
  CHECK(eu.kindOf(',') == MorphEngine::Decimal);
  CHECK(us.kindOf('7') == MorphEngine::Digit);
  CHECK(us.kindOf('$') == MorphEngine::Text);

  // Thin-space grouping (UTF-8, multi-byte).
  AmountFormatter fr;
  fr.setFormat(2, 15, " ", ",");
  e = type(fr, "", 0, "1234567");
  CHECK_EQ_STR(e.text, "1 234 567");
  CHECK(e.caret == 9);
  CHECK(AmountFormatter::codePointCount(e.text) == 9);
}

// MARK: - Engine

/// Feeds `text` as body glyphs (US number kinds) after an optional prefix.
static void feed(MorphEngine& e, const std::string& prefix, const std::string& body, int caret, double now,
                 double digitWidth = 10, double symbolWidth = 4, bool placeholder = false) {
  const auto us = usFormatter();
  e.beginText();
  for (char c : prefix) e.addGlyph(static_cast<uint32_t>(c), MorphEngine::Prefix, MorphEngine::Text, 12, false);
  for (char c : body) {
    const int kind = us.kindOf(static_cast<uint32_t>(c));
    e.addGlyph(static_cast<uint32_t>(c), MorphEngine::Body, kind, kind == MorphEngine::Digit ? digitWidth : symbolWidth, placeholder);
  }
  e.commitText(caret, now);
}

static std::vector<int64_t> liveIds(const MorphEngine& e) {
  std::vector<int64_t> ids;
  for (const auto& g : e.glyphs()) if (!g.exiting) ids.push_back(g.id);
  return ids;
}

static int countExiting(const MorphEngine& e) {
  int n = 0;
  for (const auto& g : e.glyphs()) if (g.exiting) ++n;
  return n;
}

static const MorphEngine::Glyph* liveGlyph(const MorphEngine& e, char c) {
  for (const auto& g : e.glyphs()) if (!g.exiting && g.character == static_cast<uint32_t>(c)) return &g;
  return nullptr;
}

static void firstCommitSnaps() {
  MorphEngine e;
  e.setTiming(0.4, 0, 0.15);
  feed(e, "$", "12", 2, 0);
  CHECK(!e.needsFrames());
  CHECK(e.glyphCount() == 3);
  CHECK(near(e.glyphAt(0).x, 0));
  CHECK(near(e.glyphAt(1).x, 12));
  CHECK(near(e.glyphAt(2).x, 22));
  CHECK(near(e.contentWidth(), 32));
  CHECK(near(e.caretX(0), 12));
  CHECK(near(e.caretX(2), 32));
  CHECK(e.bodyCount() == 2);
}

static void typingAppendsAnEnteringDigit() {
  MorphEngine e;
  e.setTiming(0.4, 3 /* linear */, 0.15);
  feed(e, "", "12", 2, 0);
  const auto before = liveIds(e);
  feed(e, "", "123", 3, 1);
  CHECK(e.needsFrames());
  const auto after = liveIds(e);
  CHECK(after.size() == 3);
  CHECK(after[0] == before[0] && after[1] == before[1]);
  CHECK(countExiting(e) == 0);
  const auto* three = liveGlyph(e, '3');
  CHECK(three != nullptr);
  CHECK(near(three->opacity, 0));
  CHECK(near(three->y, -1));             // a digit arrives from above
  CHECK(near(three->x, 20));
  CHECK(near(e.contentWidth(), 20));
  e.tick(1.2);                            // half way
  three = liveGlyph(e, '3');
  CHECK(near(three->y, -0.5));
  CHECK(near(three->opacity, 1));         // faded in over the first quarter
  CHECK(near(e.contentWidth(), 25));
  e.tick(1.4);
  three = liveGlyph(e, '3');
  CHECK(!e.needsFrames());
  CHECK(near(three->y, 0));
  CHECK(near(e.contentWidth(), 30));
  CHECK(near(e.caretX(3), 30));
}

static void groupingSeparatorReflows() {
  MorphEngine e;
  e.setTiming(0.4, 3, 0.15);
  feed(e, "", "123", 3, 0);
  const auto ids = liveIds(e);
  feed(e, "", "1,234", 5, 1);
  // 1, 2, 3 persist; ',' and '4' enter.
  const auto* one = liveGlyph(e, '1');
  const auto* two = liveGlyph(e, '2');
  const auto* comma = liveGlyph(e, ',');
  const auto* four = liveGlyph(e, '4');
  CHECK(one && two && comma && four);
  CHECK(one->id == ids[0] && two->id == ids[1]);
  CHECK(countExiting(e) == 0);
  CHECK(near(comma->y, 1));               // a separator arrives from below
  CHECK(near(four->y, -1));
  CHECK(near(two->x, 10));                // still where it was
  e.tick(1.4);
  two = liveGlyph(e, '2');
  comma = liveGlyph(e, ',');
  four = liveGlyph(e, '4');
  CHECK(near(two->x, 14));                // slid right to make room for the comma
  CHECK(near(comma->x, 10));
  CHECK(near(four->x, 34));

  // Backspace: the comma and the 4 leave, both downwards.
  feed(e, "", "123", 3, 2);
  CHECK(countExiting(e) == 2);
  bool commaDown = false, fourDown = false;
  e.tick(2.2);                            // half way: faded out already (45 % share), half slid
  for (const auto& g : e.glyphs()) {
    if (g.exiting && g.character == ',') commaDown = near(g.y, 0.5) && near(g.opacity, 0);
    if (g.exiting && g.character == '4') fourDown = near(g.y, 0.5) && near(g.opacity, 0);
  }
  CHECK(commaDown && fourDown);
  e.tick(2.4);
  CHECK(countExiting(e) == 0);
  CHECK(liveIds(e).size() == 3);
  CHECK(!e.needsFrames());
}

static void insertInTheMiddleKeepsBothSides() {
  MorphEngine e;
  e.setTiming(0.4, 3, 0.15);
  feed(e, "", "1,234", 5, 0);
  const auto ids = liveIds(e); // 1 , 2 3 4
  feed(e, "", "12,934", 4, 1); // typed 9 after "12"
  const auto after = liveIds(e);
  CHECK(after.size() == 6);
  CHECK(after[0] == ids[0]);   // 1
  CHECK(after[1] == ids[2]);   // 2
  CHECK(after[2] == ids[1]);   // the thousands comma is still the thousands comma
  CHECK(after[4] == ids[3]);   // 3
  CHECK(after[5] == ids[4]);   // 4
  CHECK(countExiting(e) == 0);
}

static void placeMatchingSwapsChangedColumns() {
  MorphEngine e;
  e.setTiming(0.4, 3, 0.15);
  feed(e, "$", "1,204", -1, 0);
  const auto ids = liveIds(e); // $ 1 , 2 0 4
  feed(e, "$", "1,318", -1, 1);
  const auto after = liveIds(e);
  CHECK(after.size() == 6);
  CHECK(after[0] == ids[0]);   // $
  CHECK(after[1] == ids[1]);   // 1 (thousands)
  CHECK(after[2] == ids[2]);   // ,
  CHECK(after[3] != ids[3] && after[4] != ids[4] && after[5] != ids[5]);
  CHECK(countExiting(e) == 3);
  // Same value, more digits: 999,999 → 1,000,000 keeps nothing but the affix.
  feed(e, "$", "999,999", -1, 2);
  e.tick(3);
  feed(e, "$", "1,000,000", -1, 3);
  CHECK(liveGlyph(e, '$')->id == ids[0]);
}

static void textMatchesBySubsequence() {
  MorphEngine e;
  e.setTiming(0.4, 3, 0.15);
  e.setEffect(2);
  e.beginText();
  for (char c : std::string("Continue")) e.addGlyph(static_cast<uint32_t>(c), MorphEngine::Body, MorphEngine::Text, 8, false);
  e.commitText(-1, 0);
  const auto ids = liveIds(e);
  e.beginText();
  for (char c : std::string("Confirm")) e.addGlyph(static_cast<uint32_t>(c), MorphEngine::Body, MorphEngine::Text, 8, false);
  e.commitText(-1, 1);
  const auto after = liveIds(e);
  CHECK(after.size() == 7);
  CHECK(after[0] == ids[0] && after[1] == ids[1] && after[2] == ids[2]); // "Con"
  // Entering text fades and scales; nothing slides.
  const auto* f = liveGlyph(e, 'f');
  CHECK(f && near(f->y, 0) && near(f->scale, 0.95) && near(f->opacity, 0));
  e.tick(1.2); // opacity ramps over [0.25, 0.75]
  f = liveGlyph(e, 'f');
  CHECK(near(f->opacity, 0.5));
  CHECK(countExiting(e) > 0);
  e.tick(1.4);
  f = liveGlyph(e, 'f');
  CHECK(countExiting(e) == 0);
  CHECK(near(f->scale, 1) && near(f->opacity, 1));
}

static void numericTextSlidesLikeAnAmount() {
  MorphEngine e;
  e.setTiming(0.4, 3, 0.15);
  // A phone mask in text mode: every character arrives as Text.
  e.beginText();
  for (char c : std::string("(555) 123")) e.addGlyph(static_cast<uint32_t>(c), MorphEngine::Body, MorphEngine::Text, 10, false);
  e.commitText(9, 0);
  e.beginText();
  for (char c : std::string("(555) 123-4")) e.addGlyph(static_cast<uint32_t>(c), MorphEngine::Body, MorphEngine::Text, 10, false);
  e.commitText(11, 1);
  const auto* four = liveGlyph(e, '4');
  const auto* dash = liveGlyph(e, '-');
  CHECK(four && four->kind == MorphEngine::Digit && near(four->y, -1));   // digits drop in from above
  CHECK(dash && dash->kind == MorphEngine::Separator && near(dash->y, 1)); // punctuation rises from below
  CHECK(countExiting(e) == 0);                                              // "(", ")" and the space all persisted
  // Real text keeps fading.
  MorphEngine t;
  t.setTiming(0.4, 3, 0.15);
  t.beginText();
  for (char c : std::string("Room 12")) t.addGlyph(static_cast<uint32_t>(c), MorphEngine::Body, MorphEngine::Text, 10, false);
  t.commitText(7, 0);
  t.beginText();
  for (char c : std::string("Room 123")) t.addGlyph(static_cast<uint32_t>(c), MorphEngine::Body, MorphEngine::Text, 10, false);
  t.commitText(8, 1);
  const auto* three = liveGlyph(t, '3');
  CHECK(three && three->kind == MorphEngine::Text && near(three->y, 0) && near(three->scale, 0.95));
}

static void placeholderNeverPersists() {
  MorphEngine e;
  e.setTiming(0.4, 3, 0.15);
  feed(e, "$", "0", 1, 0, 10, 4, true);
  const auto ids = liveIds(e);
  feed(e, "$", "0", 1, 1, 10, 4, false); // the user typed a real 0
  const auto after = liveIds(e);
  CHECK(after[0] == ids[0]);   // the prefix stays
  CHECK(after[1] != ids[1]);   // the placeholder zero leaves, a real one enters
  CHECK(countExiting(e) == 1);
}

static void snapsWithoutMotion() {
  MorphEngine e;
  e.setTiming(0, 0, 0.15);
  feed(e, "", "12", 2, 0);
  feed(e, "", "123", 3, 1);
  CHECK(!e.needsFrames());
  CHECK(countExiting(e) == 0);
  CHECK(near(liveGlyph(e, '3')->opacity, 1));

  MorphEngine r;
  r.setTiming(0.4, 0, 0.15);
  r.setReduceMotion(true);
  feed(r, "", "12", 2, 0);
  feed(r, "", "1", 1, 1);
  CHECK(!r.needsFrames());
  CHECK(r.glyphCount() == 1);
}

static void interruptedEntryLeavesFromWhereItIs() {
  MorphEngine e;
  e.setTiming(0.4, 3, 0.15);
  feed(e, "", "1", 1, 0);
  feed(e, "", "12", 2, 1);
  e.tick(1.05);                 // 2 is half way through its fade-in
  const auto* two = liveGlyph(e, '2');
  CHECK(two && near(two->opacity, 0.5));
  feed(e, "", "1", 1, 1.05);    // backspace before it arrived
  CHECK(countExiting(e) == 1);
  const auto& leaving = e.glyphs()[0];
  CHECK(leaving.exiting && leaving.character == '2');
  CHECK(near(leaving.opacity, 0.5));
  e.tick(1.45);
  CHECK(countExiting(e) == 0);
  CHECK(!e.needsFrames());
}

static void exitingGlyphRidesWithItsNeighbour() {
  MorphEngine e;
  e.setTiming(0.4, 3, 0.15);
  feed(e, "", "12", 2, 0);
  feed(e, "", "2", 0, 1);       // deleted the 1 at the front
  const auto* two = liveGlyph(e, '2');
  CHECK(two && near(two->x, 10));
  e.tick(1.2);
  two = liveGlyph(e, '2');
  CHECK(near(two->x, 5));       // sliding left
  const MorphEngine::Glyph* one = nullptr;
  for (const auto& g : e.glyphs()) if (g.exiting) one = &g;
  CHECK(one && near(one->x, -5)); // the leaving 1 moves with it
}

int main() {
  formatterGroupsAsYouType();
  formatterDecimals();
  formatterLimitsAndValues();
  firstCommitSnaps();
  typingAppendsAnEnteringDigit();
  groupingSeparatorReflows();
  insertInTheMiddleKeepsBothSides();
  placeMatchingSwapsChangedColumns();
  textMatchesBySubsequence();
  numericTextSlidesLikeAnAmount();
  placeholderNeverPersists();
  snapsWithoutMotion();
  interruptedEntryLeavesFromWhereItIs();
  exitingGlyphRidesWithItsNeighbour();
  if (failures == 0) {
    std::printf("MorphEngine: all checks passed\n");
    return 0;
  }
  std::printf("MorphEngine: %d check(s) failed\n", failures);
  return 1;
}
