// Host-side checks for the pattern mask. Build & run with `bun run test:cpp`.
#include "MaskEngine.hpp"

#include <cstdio>
#include <string>
#include <vector>

using margelo::nitro::nitroinput::MaskEngine;

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

#define CHECK_EQ_INT(actual, expected)                                                 \
  do {                                                                                 \
    const int a_ = static_cast<int>(actual);                                           \
    const int e_ = static_cast<int>(expected);                                         \
    if (a_ != e_) {                                                                    \
      std::printf("FAIL %s:%d: %s == %d, expected %d\n", __FILE__, __LINE__, #actual,  \
                  a_, e_);                                                             \
      failures++;                                                                      \
    }                                                                                  \
  } while (0)

static MaskEngine make(const std::string& format, const std::vector<MaskEngine::Notation>& notations = {}) {
  MaskEngine engine;
  CHECK(engine.setFormat(format, notations));
  return engine;
}

/// Types `keys` one at a time at the caret, like a keyboard.
static MaskEngine::Result type(const MaskEngine& engine, const std::string& keys, bool autocomplete = true) {
  MaskEngine::Result state;
  for (char k : keys) {
    state = engine.applyEdit(state.formattedText, state.caret, state.caret, std::string(1, k), autocomplete, false);
  }
  return state;
}

// MARK: - Notation

static void mandatoryAndOptionalSlots() {
  const MaskEngine digits = make("[000]");
  CHECK_EQ_STR(type(digits, "123").formattedText, "123");
  // Letters are rejected by a numeric slot.
  CHECK_EQ_STR(type(digits, "1a2").formattedText, "12");
  // Past the end nothing more is taken.
  CHECK_EQ_STR(type(digits, "12345").formattedText, "123");

  const MaskEngine letters = make("[AAA]");
  CHECK_EQ_STR(type(letters, "abc").formattedText, "abc");
  CHECK_EQ_STR(type(letters, "a1b").formattedText, "ab");

  const MaskEngine mixed = make("[___]");
  CHECK_EQ_STR(type(mixed, "a1b").formattedText, "a1b");
  CHECK_EQ_STR(type(mixed, "a-b").formattedText, "ab");

  // [00099] takes three to five digits.
  const MaskEngine some = make("[00099]");
  CHECK_EQ_STR(type(some, "12").formattedText, "12");
  CHECK(!type(some, "12").complete);
  CHECK(type(some, "123").complete);
  CHECK_EQ_STR(type(some, "12345").formattedText, "12345");
  CHECK_EQ_STR(type(some, "123456").formattedText, "12345");
}

static void ellipsisTakesEverything() {
  const MaskEngine engine = make("[000…]");
  CHECK_EQ_STR(type(engine, "1234567890123").formattedText, "1234567890123");
  CHECK(type(engine, "123").complete);
  // The inherited type is still enforced.
  CHECK_EQ_STR(type(engine, "12ab34").formattedText, "1234");

  const MaskEngine letters = make("[AA…]");
  CHECK_EQ_STR(type(letters, "abcdef").formattedText, "abcdef");
  CHECK_EQ_STR(type(letters, "ab12cd").formattedText, "abcd");
}

static void fixedAndFreeLiterals() {
  // {} is part of the value, a bare literal is not.
  const MaskEngine date = make("[00]{.}[00]{.}[0000]");
  const MaskEngine::Result full = type(date, "24122026");
  CHECK_EQ_STR(full.formattedText, "24.12.2026");
  CHECK_EQ_STR(full.extractedValue, "24.12.2026");

  const MaskEngine phone = make("+1 ([000]) [000]-[0000]");
  const MaskEngine::Result dialled = type(phone, "2125551234");
  CHECK_EQ_STR(dialled.formattedText, "+1 (212) 555-1234");
  CHECK_EQ_STR(dialled.extractedValue, "2125551234");
  CHECK(dialled.complete);
}

static void escapesAreLiteral() {
  const MaskEngine engine = make("\\[[00]\\]");
  CHECK_EQ_STR(type(engine, "42").formattedText, "[42]");
}

// MARK: - Autocomplete and autoskip

static void autocompleteInsertsConstants() {
  const MaskEngine phone = make("+1 ([000]) [000]-[0000]");
  // The leading constants appear before the first digit is even placed.
  const MaskEngine::Result one = type(phone, "2");
  CHECK_EQ_STR(one.formattedText, "+1 (2");
  CHECK_EQ_INT(one.caret, 5);

  const MaskEngine::Result three = type(phone, "212");
  CHECK_EQ_STR(three.formattedText, "+1 (212) ");
  CHECK_EQ_INT(three.caret, 9);
}

static void autocompleteCanBeTurnedOff() {
  const MaskEngine phone = make("+1 ([000]) [000]-[0000]");
  const MaskEngine::Result one = type(phone, "2", /* autocomplete */ false);
  CHECK_EQ_STR(one.formattedText, "+1 (2");
  // Without autocomplete the trailing ") " is not added.
  const MaskEngine::Result three = type(phone, "212", /* autocomplete */ false);
  CHECK_EQ_STR(three.formattedText, "+1 (212");
}

static void autoSkipErasesTrailingConstants() {
  const MaskEngine phone = make("+1 ([000]) [000]-[0000]");
  const MaskEngine::Result three = type(phone, "212");
  CHECK_EQ_STR(three.formattedText, "+1 (212) ");
  CHECK_EQ_INT(three.caret, 9);

  // Backspace at the end walks back over the constants autocomplete added,
  // leaving the caret against the last digit rather than stranded after ") ".
  const MaskEngine::Result back = phone.applyEdit(three.formattedText, three.caret - 1, three.caret, "", true, true);
  CHECK_EQ_STR(back.formattedText, "+1 (212");
  CHECK_EQ_INT(back.caret, 7);
  // The next backspace then takes the digit itself.
  const MaskEngine::Result again = phone.applyEdit(back.formattedText, back.caret - 1, back.caret, "", true, true);
  CHECK_EQ_STR(again.formattedText, "+1 (21");

  // Without autoSkip the mask puts the constant straight back, so backspacing
  // at the end of a run cannot get past it.
  const MaskEngine::Result plain = phone.applyEdit(three.formattedText, three.caret - 1, three.caret, "", true, false);
  CHECK_EQ_STR(plain.formattedText, "+1 (212)");
}

// MARK: - The four outputs

static void extractedValueDropsFreeLiterals() {
  const MaskEngine phone = make("+1 ([000]) [000]-[0000]");
  const MaskEngine::Result r = type(phone, "2125551234");
  CHECK_EQ_STR(r.extractedValue, "2125551234");

  // A {} block counts towards the value, a bare literal does not.
  const MaskEngine iban = make("GB[00] [____] [0000]");
  const MaskEngine::Result g = type(iban, "12abcd3456");
  CHECK_EQ_STR(g.formattedText, "GB12 abcd 3456");
  CHECK_EQ_STR(g.extractedValue, "12abcd3456");
}

static void completeTracksMandatorySlots() {
  const MaskEngine phone = make("+1 ([000]) [000]-[0000]");
  CHECK(!type(phone, "212555").complete);
  CHECK(type(phone, "2125551234").complete);

  const MaskEngine optionalTail = make("[00][99]");
  CHECK(type(optionalTail, "12").complete);
  CHECK(type(optionalTail, "1234").complete);
  CHECK(!type(optionalTail, "1").complete);
}

static void tailPlaceholderShowsWhatIsMissing() {
  const MaskEngine phone = make("+1 ([000]) [000]-[0000]");
  CHECK_EQ_STR(type(phone, "212").tailPlaceholder, "000-0000");
  CHECK_EQ_STR(type(phone, "2125551234").tailPlaceholder, "");

  const MaskEngine date = make("[00]{/}[00]");
  CHECK_EQ_STR(type(date, "12").tailPlaceholder, "00");
}

// MARK: - Caret

static void caretFollowsTheTypedCharacter() {
  const MaskEngine phone = make("+1 ([000]) [000]-[0000]");
  const MaskEngine::Result r = type(phone, "212555");
  // The "-" is autocompleted along with ") ", so the caret sits ready for the
  // next digit rather than in front of a separator the user must type past.
  CHECK_EQ_STR(r.formattedText, "+1 (212) 555-");
  CHECK_EQ_INT(r.caret, 13);
}

static void caretSurvivesAnInsertInTheMiddle() {
  const MaskEngine card = make("[0000] [0000] [0000] [0000]");
  const MaskEngine::Result full = type(card, "1234567890123456");
  CHECK_EQ_STR(full.formattedText, "1234 5678 9012 3456");
  // Insert a digit at the very front: everything shifts right by one.
  const MaskEngine::Result shifted = card.applyEdit(full.formattedText, 0, 0, "9", true, false);
  CHECK_EQ_STR(shifted.formattedText, "9123 4567 8901 2345");
  CHECK_EQ_INT(shifted.caret, 1);
}

static void deletingPullsTheCaretBack() {
  const MaskEngine card = make("[0000] [0000]");
  const MaskEngine::Result full = type(card, "12345678");
  CHECK_EQ_STR(full.formattedText, "1234 5678");
  // Delete the "3": the tail closes up.
  const MaskEngine::Result cut = card.applyEdit(full.formattedText, 2, 3, "", true, false);
  CHECK_EQ_STR(cut.formattedText, "1245 678");
  CHECK_EQ_INT(cut.caret, 2);
}

// MARK: - Sanitizer

static void blocksAreNormalized() {
  // Optional digits sort behind mandatory ones: [9900] means [0099].
  const MaskEngine engine = make("[9900]");
  // That the two mandatory slots came first is what `complete` proves.
  CHECK(type(engine, "12").complete);
  CHECK(!make("[0099]").isActive() == false);

  // A block that mixes groups is split: [00AA] is [00] then [AA].
  const MaskEngine split = make("[00AA]");
  CHECK_EQ_STR(type(split, "12ab").formattedText, "12ab");
  CHECK_EQ_STR(type(split, "ab12").formattedText, "12");
}

static void badFormatsAreRejectedNotThrown() {
  MaskEngine engine;
  CHECK(!engine.setFormat("[[000]"));   // nested open
  CHECK(!engine.setFormat("[000"));     // never closed
  CHECK(!engine.setFormat("000]"));     // closed with no open
  CHECK(!engine.setFormat("[0}0]"));    // mismatched
  CHECK(!engine.setFormat("[Z]"));      // no notation for Z
  CHECK(!engine.setFormat(""));         // empty
  CHECK(!engine.isActive());
  // An inactive engine passes text straight through rather than eating it.
  const MaskEngine::Result r = engine.apply("anything", 3, true, true, false);
  CHECK_EQ_STR(r.formattedText, "anything");
  CHECK_EQ_INT(r.caret, 3);
  // ...and it recovers once given a good format.
  CHECK(engine.setFormat("[000]"));
  CHECK(engine.isActive());
  CHECK_EQ_STR(type(engine, "123").formattedText, "123");
}

// MARK: - Custom notations

static void customNotations() {
  MaskEngine::Notation hex{'H', {'0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'},
                           false};
  const MaskEngine engine = make("#[HHHHHH]", {hex});
  CHECK_EQ_STR(type(engine, "1a2b3c").formattedText, "#1a2b3c");
  CHECK_EQ_STR(type(engine, "1z2").formattedText, "#12");

  // An optional custom notation may be skipped.
  MaskEngine::Notation maybe{'h', {'x', 'y'}, true};
  const MaskEngine optional = make("[0h0]", {maybe});
  CHECK_EQ_STR(type(optional, "1x2").formattedText, "1x2");
  CHECK_EQ_STR(type(optional, "12").formattedText, "12");

  // A notation may not shadow a built-in slot character.
  MaskEngine bad;
  CHECK(!bad.setFormat("[0]", {MaskEngine::Notation{'0', {'a'}, false}}));
  // Nor be empty.
  CHECK(!bad.setFormat("[Q]", {MaskEngine::Notation{'Q', {}, false}}));
}

// MARK: - Unicode

/// The engine this one is modelled on iterates UTF-16 code units, so an astral
/// character is split into surrogate halves. This one counts code points.
static void astralCharactersAreNotSplit() {
  // A notation whose set holds astral characters. Iterating UTF-16 units would
  // see two surrogate halves here and match neither.
  MaskEngine::Notation faces{'F', {0x1F600, 0x1F601}, false};
  const MaskEngine engine = make("[FF]", {faces});
  const MaskEngine::Result r = type(engine, "");
  CHECK_EQ_STR(r.formattedText, "");
  const MaskEngine::Result one =
      engine.applyEdit("", 0, 0, "\xF0\x9F\x98\x80", true, false); // 😀
  CHECK_EQ_STR(one.formattedText, "\xF0\x9F\x98\x80");
  CHECK_EQ_INT(one.caret, 1); // one code point, not two UTF-16 units
  const MaskEngine::Result two =
      engine.applyEdit(one.formattedText, 1, 1, "\xF0\x9F\x98\x81", true, false); // 😁
  CHECK_EQ_STR(two.formattedText, "\xF0\x9F\x98\x80\xF0\x9F\x98\x81");
  CHECK_EQ_INT(two.caret, 2);
  CHECK(two.complete);

  // A multi-byte literal survives round-tripping too.
  const MaskEngine euro = make("€[000]");
  const MaskEngine::Result price = type(euro, "123");
  CHECK_EQ_STR(price.formattedText, "€123");
  CHECK_EQ_INT(price.caret, 4);
}

// MARK: - Cookbook patterns from the README this was modelled on

static void cookbookPatterns() {
  CHECK_EQ_STR(type(make("[0000] [000000] [00000]"), "371449635398431").formattedText, "3714 496353 98431");
  CHECK_EQ_STR(type(make("[00]{/}[00]"), "1226").formattedText, "12/26");
  CHECK_EQ_STR(type(make("BE[00] [0000] [0000] [0000]"), "6853901234567").formattedText,
               "BE68 5390 1234 567");
  CHECK_EQ_STR(type(make("GB[00] [____] [0000] [0000] [0000] [00]"), "29NWBK60161331926819").formattedText,
               "GB29 NWBK 6016 1331 9268 19");
  CHECK_EQ_STR(type(make("[00]{.}[00]{.}[9900]"), "24122026").formattedText, "24.12.2026");
}

/// A copy shares the compiled mask. The states hold pointers into the
/// notation storage, so the copy has to keep that alive on its own.
static void copiesShareTheCompiledMask() {
  MaskEngine::Notation hex{'H', {'0', '1', 'a', 'b'}, false};
  MaskEngine copy;
  {
    MaskEngine original;
    CHECK(original.setFormat("[HH]", {hex}));
    copy = original; // copy-assign, then let the original go
  }
  CHECK(copy.isActive());
  CHECK_EQ_STR(type(copy, "ab").formattedText, "ab");
  CHECK_EQ_STR(type(copy, "az").formattedText, "a");

  // Re-compiling one does not disturb the other.
  MaskEngine other = copy;
  CHECK(other.setFormat("[000]"));
  CHECK_EQ_STR(type(other, "123").formattedText, "123");
  CHECK_EQ_STR(type(copy, "ab").formattedText, "ab");

  // A failed setFormat leaves the engine inactive rather than half-compiled.
  MaskEngine broken = copy;
  CHECK(!broken.setFormat("[[0]"));
  CHECK(!broken.isActive());
  CHECK(copy.isActive());
}

/// The staged-notation path the platform views use, which only ever passes
/// strings and bools across the language boundary.
static void stagedNotationsMatchTheVectorForm() {
  MaskEngine staged;
  staged.clearNotations();
  staged.addNotation("H", "0123456789abcdef", false);
  CHECK(staged.setFormat("#[HHH]"));
  CHECK_EQ_STR(type(staged, "1af").formattedText, "#1af");
  CHECK_EQ_STR(type(staged, "1zf").formattedText, "#1f");
  // Staging is cleared, not accumulated, between formats.
  staged.clearNotations();
  CHECK(!staged.setFormat("#[HHH]"));
  CHECK(!staged.isActive());
  // An empty or multi-character name is ignored rather than corrupting the list.
  staged.clearNotations();
  staged.addNotation("", "abc", false);
  CHECK(!staged.setFormat("[Q]"));
}

// An empty input never gains the mask's leading literals, whatever
// `autocomplete` says: `clear()`, `setText("")` and an empty prop leave the
// field showing its placeholder, the same as deleting everything by hand.
static void emptyInputStaysEmpty() {
  MaskEngine engine;
  CHECK(engine.setFormat("+1 ([000]) [000]-[0000]"));
  const auto autocompleted = engine.apply("", 0, true, true, false);
  CHECK(autocompleted.formattedText.empty());
  CHECK(autocompleted.extractedValue.empty());
  CHECK(autocompleted.tailPlaceholder == "+1 (000) 000-0000");
  CHECK(!autocompleted.complete);
  CHECK(autocompleted.caret == 0);
  // The first character still pulls the literals in front of it.
  CHECK(engine.apply("5", 1, true, true, false).formattedText == "+1 (5");
  // And deleting it takes them out again, as before.
  CHECK(engine.applyEdit("+1 (5", 4, 5, "", true, true).formattedText.empty());
}

int main() {
  copiesShareTheCompiledMask();
  stagedNotationsMatchTheVectorForm();
  emptyInputStaysEmpty();
  mandatoryAndOptionalSlots();
  ellipsisTakesEverything();
  fixedAndFreeLiterals();
  escapesAreLiteral();
  autocompleteInsertsConstants();
  autocompleteCanBeTurnedOff();
  autoSkipErasesTrailingConstants();
  extractedValueDropsFreeLiterals();
  completeTracksMandatorySlots();
  tailPlaceholderShowsWhatIsMissing();
  caretFollowsTheTypedCharacter();
  caretSurvivesAnInsertInTheMiddle();
  deletingPullsTheCaretBack();
  blocksAreNormalized();
  badFormatsAreRejectedNotThrown();
  customNotations();
  astralCharactersAreNotSplit();
  cookbookPatterns();
  if (failures == 0) {
    std::printf("MaskEngine: all checks passed\n");
    return 0;
  }
  std::printf("MaskEngine: %d check(s) failed\n", failures);
  return 1;
}
