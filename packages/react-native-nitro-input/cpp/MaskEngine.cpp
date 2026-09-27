//
//  MaskEngine.cpp
//  NitroInput
//

#include "MaskEngine.hpp"

#include "AmountFormatter.hpp"

#include <algorithm>
#include <climits>
#include <optional>

namespace margelo::nitro::nitroinput {

namespace {

using CodePoints = std::vector<uint32_t>;

bool isDigit(uint32_t c) {
  return c >= '0' && c <= '9';
}

/// Letters a `[A]`/`[a]` slot takes: ASCII and the alphabetic blocks of the
/// scripts people type into forms (Latin with its diacritics, Greek,
/// Cyrillic, Armenian, Hebrew, Arabic, Devanagari, Thai, Hangul, kana and CJK
/// ideographs). Not a full Unicode letter table - that would outweigh the
/// engine - but no longer ASCII only, which refused every Cyrillic name.
bool isLetter(uint32_t c) {
  if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) return true;
  if (c < 0xC0) return false;
  if (c <= 0x24F) return c != 0xD7 && c != 0xF7;  // Latin-1 letters, Latin Extended-A/B
  if (c >= 0x370 && c <= 0x3FF) return c >= 0x386 && c != 0x387 && c != 0x3F6;  // Greek
  if (c >= 0x400 && c <= 0x52F) return (c < 0x482 || c > 0x489);  // Cyrillic (+ supplement)
  if (c >= 0x531 && c <= 0x587) return c <= 0x556 || c >= 0x561;  // Armenian
  if (c >= 0x5D0 && c <= 0x5EA) return true;                      // Hebrew
  if (c >= 0x620 && c <= 0x64A) return true;                      // Arabic
  if (c >= 0x904 && c <= 0x939) return true;                      // Devanagari
  if (c >= 0xE01 && c <= 0xE30) return true;                      // Thai
  if (c >= 0x1E00 && c <= 0x1EFF) return true;                    // Latin Extended Additional (Vietnamese)
  if (c >= 0x3041 && c <= 0x30FA) return c != 0x30A0;             // Hiragana, Katakana
  if (c >= 0x4E00 && c <= 0x9FFF) return true;                    // CJK ideographs
  if (c >= 0xAC00 && c <= 0xD7A3) return true;                    // Hangul syllables
  return false;
}

/// Upper- and lower-case counterparts for the cased scripts `isLetter` knows.
/// Anything else maps to itself.
uint32_t toUpper(uint32_t c) {
  if (c >= 'a' && c <= 'z') return c - 32;
  if (c < 0xE0) return c;
  if (c == 0xFF) return 0x178;                                     // ÿ → Ÿ
  if (c <= 0xFE) return c == 0xF7 ? c : c - 32;                    // Latin-1
  if (c >= 0x100 && c <= 0x17F) {                                  // Latin Extended-A
    if ((c >= 0x139 && c <= 0x148) || (c >= 0x179 && c <= 0x17E)) return (c % 2 == 0) ? c - 1 : c;
    if (c == 0x131 || c == 0x138 || c == 0x149 || c == 0x17F) return c;
    return (c % 2 == 1) ? c - 1 : c;
  }
  if (c >= 0x3B1 && c <= 0x3C9) return c == 0x3C2 ? 0x3A3 : c - 32;  // Greek (final sigma → Σ)
  if (c >= 0x430 && c <= 0x44F) return c - 32;                     // Cyrillic
  if (c >= 0x450 && c <= 0x45F) return c - 80;
  if ((c >= 0x460 && c <= 0x481) || (c >= 0x48A && c <= 0x4BF)) return (c % 2 == 1) ? c - 1 : c;
  if (c >= 0x561 && c <= 0x586) return c - 48;                     // Armenian
  if (c >= 0x1E00 && c <= 0x1EFF) return (c % 2 == 1) ? c - 1 : c;  // Vietnamese and co.
  return c;
}

uint32_t toLower(uint32_t c) {
  if (c >= 'A' && c <= 'Z') return c + 32;
  if (c < 0xC0) return c;
  if (c <= 0xDE) return c == 0xD7 ? c : c + 32;                    // Latin-1
  if (c == 0x178) return 0xFF;                                     // Ÿ → ÿ
  if (c >= 0x100 && c <= 0x17F) {                                  // Latin Extended-A
    if ((c >= 0x139 && c <= 0x148) || (c >= 0x179 && c <= 0x17E)) return (c % 2 == 1) ? c + 1 : c;
    if (c == 0x130 || c == 0x131 || c == 0x138 || c == 0x149 || c == 0x17F) return c;
    return (c % 2 == 0) ? c + 1 : c;
  }
  if (c >= 0x391 && c <= 0x3A9 && c != 0x3A2) return c + 32;       // Greek
  if (c >= 0x410 && c <= 0x42F) return c + 32;                     // Cyrillic
  if (c >= 0x400 && c <= 0x40F) return c + 80;
  if ((c >= 0x460 && c <= 0x481) || (c >= 0x48A && c <= 0x4BF)) return (c % 2 == 0) ? c + 1 : c;
  if (c >= 0x531 && c <= 0x556) return c + 48;                     // Armenian
  if (c >= 0x1E00 && c <= 0x1EFF) return (c % 2 == 0) ? c + 1 : c;
  return c;
}

constexpr uint32_t kEllipsis = 0x2026; // …
constexpr uint32_t kEscape = '\\';

/// The slot characters with a built-in meaning. A custom notation may not
/// shadow one of these.
bool isReservedSlot(uint32_t c) {
  return c == '0' || c == '9' || c == 'A' || c == 'a' || c == '_' || c == '-' || c == kEllipsis;
}

bool isOptionalSlot(uint32_t c) {
  return c == '9' || c == 'a' || c == '-';
}

/// Which of the three built-in groups a slot character belongs to. Mixing
/// groups inside one `[]` block is what the sanitizer splits apart.
int slotGroup(uint32_t c) {
  if (c == '0' || c == '9') return 0;  // numeric
  if (c == 'A' || c == 'a') return 1;  // literal
  if (c == '_' || c == '-') return 2;  // alphanumeric
  return -1;
}

} // namespace

// MARK: - State

struct MaskEngine::State {
  Slot slot = Slot::EndOfLine;
  const State* child = nullptr;
  /// Free and Fixed: the character this state stands for.
  uint32_t ownCharacter = 0;
  /// Value and OptionalValue.
  CharClass cls = CharClass::AlphaNumeric;
  const Notation* notation = nullptr;
  bool elliptical = false;

  const State* nextState() const {
    // An ellipsis never advances: it accepts its type forever.
    return elliptical ? this : child;
  }

  bool accepts(uint32_t c) const {
    switch (cls) {
      case CharClass::Numeric:
        return isDigit(c);
      case CharClass::Literal:
        return isLetter(c);
      case CharClass::AlphaNumeric:
        return isDigit(c) || isLetter(c);
      case CharClass::Custom:
        if (notation == nullptr) return false;
        return std::find(notation->characterSet.begin(), notation->characterSet.end(), c) !=
               notation->characterSet.end();
    }
    return false;
  }

  /// The character shown for this slot when nothing has been typed into it.
  uint32_t placeholderCharacter() const {
    switch (cls) {
      case CharClass::Numeric:
        return '0';
      case CharClass::Literal:
        return 'a';
      case CharClass::AlphaNumeric:
        return '-';
      case CharClass::Custom:
        return notation != nullptr ? notation->character : '-';
    }
    return '-';
  }
};

/// One transition. `pass` means the input character was consumed.
struct MaskEngine::Step {
  const State* state = nullptr;
  std::optional<uint32_t> insert;
  std::optional<uint32_t> value;
  bool pass = false;
};

namespace {

using State = MaskEngine::State;
using Step = MaskEngine::Step;

/// The transition for `c`, or nothing when the state refuses it outright
/// (only a mandatory Value does that - everything else steps over itself).
std::optional<Step> accept(const State* state, uint32_t c) {
  switch (state->slot) {
    case MaskEngine::Slot::Free:
      if (state->ownCharacter == c) {
        return Step{state->nextState(), c, std::nullopt, true};
      }
      return Step{state->nextState(), state->ownCharacter, std::nullopt, false};
    case MaskEngine::Slot::Fixed:
      if (state->ownCharacter == c) {
        return Step{state->nextState(), c, c, true};
      }
      return Step{state->nextState(), state->ownCharacter, state->ownCharacter, false};
    case MaskEngine::Slot::Value:
      if (state->accepts(c)) {
        return Step{state->nextState(), c, c, true};
      }
      return std::nullopt;
    case MaskEngine::Slot::OptionalValue:
      if (state->accepts(c)) {
        return Step{state->nextState(), c, c, true};
      }
      return Step{state->nextState(), std::nullopt, std::nullopt, false};
    case MaskEngine::Slot::EndOfLine:
      return std::nullopt;
  }
  return std::nullopt;
}

/// What this state would emit on its own, with no input left.
std::optional<Step> autocompleteOf(const State* state) {
  switch (state->slot) {
    case MaskEngine::Slot::Free:
      return Step{state->nextState(), state->ownCharacter, std::nullopt, false};
    case MaskEngine::Slot::Fixed:
      return Step{state->nextState(), state->ownCharacter, state->ownCharacter, false};
    default:
      return std::nullopt;
  }
}

bool noMandatoryLeft(const State* state) {
  while (state != nullptr) {
    switch (state->slot) {
      case MaskEngine::Slot::EndOfLine:
        return true;
      case MaskEngine::Slot::Value:
        // An ellipsis is satisfied by whatever it already has.
        return state->elliptical;
      case MaskEngine::Slot::Fixed:
        return false;
      default:
        break;
    }
    const State* next = state->nextState();
    if (next == state) return true; // elliptical self-loop
    state = next;
  }
  return true;
}

// MARK: - Format sanitizer

/// Splits `format` into blocks: each `[...]`, each `{...}`, and each run of
/// free characters. Escapes are carried through untouched.
bool splitBlocks(const CodePoints& format, std::vector<CodePoints>* blocks) {
  CodePoints current;
  bool escape = false;
  bool inSquare = false;
  bool inCurly = false;
  for (uint32_t c : format) {
    if (escape) {
      current.push_back(c);
      escape = false;
      continue;
    }
    if (c == kEscape) {
      current.push_back(c);
      escape = true;
      continue;
    }
    if (c == '[' || c == '{') {
      if (inSquare || inCurly) return false; // no nesting
      if (!current.empty()) blocks->push_back(current);
      current.clear();
      current.push_back(c);
      (c == '[' ? inSquare : inCurly) = true;
      continue;
    }
    if (c == ']' || c == '}') {
      const bool matching = (c == ']' && inSquare) || (c == '}' && inCurly);
      if (!matching) return false; // a close with no open
      current.push_back(c);
      blocks->push_back(current);
      current.clear();
      inSquare = false;
      inCurly = false;
      continue;
    }
    current.push_back(c);
  }
  if (escape || inSquare || inCurly) return false;
  if (!current.empty()) blocks->push_back(current);
  return true;
}

/// A `[]` block may only hold one group of slot characters, and within it the
/// mandatory ones come first: `[9900]` means `[0099]`, and `[00AA]` is really
/// `[00]` followed by `[AA]`. Custom notations are left where they are.
void normalizeBlock(const CodePoints& block, std::vector<CodePoints>* out) {
  if (block.size() < 2 || block.front() != '[') {
    out->push_back(block);
    return;
  }
  const CodePoints body(block.begin() + 1, block.end() - 1);

  // Split on a change of built-in group. Custom notations (group -1) stay with
  // whatever run they are in, since we cannot reorder what we cannot classify.
  std::vector<CodePoints> runs;
  CodePoints run;
  int runGroup = -2;
  for (uint32_t c : body) {
    const int group = slotGroup(c);
    if (group >= 0 && runGroup >= 0 && group != runGroup) {
      runs.push_back(run);
      run.clear();
    }
    if (group >= 0) runGroup = group;
    run.push_back(c);
  }
  if (!run.empty()) runs.push_back(run);

  for (CodePoints& piece : runs) {
    // Mandatory before optional, order otherwise preserved - and an ellipsis
    // always last: it repeats the slot in front of it, so `[9…]` moved to
    // `[…9]` would repeat nothing and take letters (upstream sorts by code,
    // which leaves `…` last for the same reason).
    const auto rank = [](uint32_t c) { return c == kEllipsis ? 2 : isOptionalSlot(c) ? 1 : 0; };
    std::stable_sort(piece.begin(), piece.end(), [&](uint32_t a, uint32_t b) { return rank(a) < rank(b); });
    CodePoints wrapped;
    wrapped.reserve(piece.size() + 2);
    wrapped.push_back('[');
    wrapped.insert(wrapped.end(), piece.begin(), piece.end());
    wrapped.push_back(']');
    out->push_back(wrapped);
  }
}

bool sanitize(const CodePoints& format, CodePoints* out) {
  std::vector<CodePoints> blocks;
  if (!splitBlocks(format, &blocks)) return false;
  std::vector<CodePoints> normalized;
  for (const CodePoints& block : blocks) {
    normalizeBlock(block, &normalized);
  }
  for (const CodePoints& block : normalized) {
    out->insert(out->end(), block.begin(), block.end());
  }
  return true;
}

} // namespace

// MARK: - Lifetime

MaskEngine::MaskEngine() = default;
MaskEngine::~MaskEngine() = default;
MaskEngine::MaskEngine(const MaskEngine&) = default;
MaskEngine& MaskEngine::operator=(const MaskEngine&) = default;
MaskEngine::MaskEngine(MaskEngine&&) noexcept = default;
MaskEngine& MaskEngine::operator=(MaskEngine&&) noexcept = default;

bool MaskEngine::isActive() const {
  return compiled_ != nullptr && compiled_->initial != nullptr;
}

namespace {
const MaskEngine::State* makeState(std::vector<std::unique_ptr<MaskEngine::State>>& arena, MaskEngine::State state) {
  arena.push_back(std::make_unique<MaskEngine::State>(state));
  return arena.back().get();
}
} // namespace

// MARK: - Compiler

bool MaskEngine::classOf(const Compiled& compiled, uint32_t formatCharacter, CharClass* cls,
                         const Notation** notation) {
  switch (formatCharacter) {
    case '0':
    case '9':
      *cls = CharClass::Numeric;
      *notation = nullptr;
      return true;
    case 'A':
    case 'a':
      *cls = CharClass::Literal;
      *notation = nullptr;
      return true;
    case '_':
    case '-':
      *cls = CharClass::AlphaNumeric;
      *notation = nullptr;
      return true;
    default:
      break;
  }
  for (const Notation& candidate : compiled.notations) {
    if (candidate.character == formatCharacter) {
      *cls = CharClass::Custom;
      *notation = &candidate;
      return true;
    }
  }
  return false;
}

bool MaskEngine::inheritedClass(const Compiled& compiled, uint32_t lastCharacter, CharClass* cls,
                                const Notation** notation) {
  // `[…]` with nothing before it, or straight after `[`, is alphanumeric.
  if (lastCharacter == 0 || lastCharacter == '[' || lastCharacter == kEllipsis) {
    *cls = CharClass::AlphaNumeric;
    *notation = nullptr;
    return true;
  }
  return classOf(compiled, lastCharacter, cls, notation);
}

const MaskEngine::State* MaskEngine::compile(Compiled& out, const CodePoints& format, size_t index,
                                             bool valuable, bool fixed, uint32_t lastCharacter, bool* ok) {
  if (!*ok) return nullptr;
  if (index >= format.size()) {
    return makeState(out.arena, State{Slot::EndOfLine, nullptr, 0, CharClass::AlphaNumeric, nullptr, false});
  }

  const uint32_t c = format[index];

  if (c == kEscape && lastCharacter != kEscape) {
    // Skip the backslash; the next character is taken literally.
    return compile(out, format, index + 1, valuable, fixed, kEscape, ok);
  }
  if (lastCharacter != kEscape) {
    if (c == '[') return compile(out, format, index + 1, true, false, c, ok);
    if (c == '{') return compile(out, format, index + 1, false, true, c, ok);
    if (c == ']' || c == '}') return compile(out, format, index + 1, false, false, c, ok);
  }

  if (valuable && lastCharacter != kEscape) {
    if (c == kEllipsis) {
      CharClass cls = CharClass::AlphaNumeric;
      const Notation* notation = nullptr;
      if (!inheritedClass(out, lastCharacter, &cls, &notation)) {
        *ok = false;
        return nullptr;
      }
      // Elliptical states swallow the rest of the block, so they have no child.
      return makeState(out.arena, State{Slot::Value, nullptr, 0, cls, notation, true});
    }
    CharClass cls = CharClass::AlphaNumeric;
    const Notation* notation = nullptr;
    if (!classOf(out, c, &cls, &notation)) {
      *ok = false;
      return nullptr;
    }
    const bool optional = isOptionalSlot(c) || (notation != nullptr && notation->isOptional);
    const State* child = compile(out, format, index + 1, true, false, c, ok);
    if (!*ok) return nullptr;
    return makeState(out.arena, State{optional ? Slot::OptionalValue : Slot::Value, child, 0, cls, notation, false});
  }

  const Slot slot = fixed ? Slot::Fixed : Slot::Free;
  const State* child = compile(out, format, index + 1, false, fixed, c, ok);
  if (!*ok) return nullptr;
  return makeState(out.arena, State{slot, child, c, CharClass::AlphaNumeric, nullptr, false});
}

void MaskEngine::clearNotations() {
  staged_.clear();
}

void MaskEngine::addNotation(const std::string& character, const std::string& characterSet, bool isOptional) {
  const CodePoints name = AmountFormatter::decode(character);
  if (name.empty()) return;
  staged_.push_back(Notation{name[0], AmountFormatter::decode(characterSet), isOptional});
}

bool MaskEngine::setFormat(const std::string& format) {
  return setFormat(format, staged_);
}

std::shared_ptr<const MaskEngine::Compiled> MaskEngine::compileFormat(const std::string& format,
                                                                     const std::vector<Notation>& notations) {
  if (format.empty()) return nullptr;

  auto next = std::make_shared<Compiled>();
  next->notations = notations;

  // A notation may not redefine a built-in slot character - the compiler would
  // never reach it, so the caller's intent could not be honoured.
  for (const Notation& notation : next->notations) {
    if (isReservedSlot(notation.character) || notation.characterSet.empty()) return nullptr;
  }

  CodePoints sanitized;
  if (!sanitize(AmountFormatter::decode(format), &sanitized)) return nullptr;

  bool ok = true;
  const State* initial = compile(*next, sanitized, 0, false, false, 0, &ok);
  if (!ok || initial == nullptr) return nullptr;
  next->initial = initial;

  // What the format can hold, for the capacity strategies and the paste rule.
  bool leading = true;
  for (const State* s = initial; s != nullptr && s->slot != Slot::EndOfLine; s = s->child) {
    if (s->elliptical) {
      next->textCapacity = kUnbounded;
      next->valueCapacity = kUnbounded;
      break;
    }
    if (s->slot == Slot::Free || s->slot == Slot::Fixed) {
      if (leading) next->leadingConstants.push_back(s->ownCharacter);
      next->textCapacity += 1;
      if (s->slot == Slot::Fixed) next->valueCapacity += 1;
    } else {
      leading = false;
      next->textCapacity += 1;
      next->valueCapacity += 1;
    }
  }
  return next;
}

bool MaskEngine::setFormat(const std::string& format, const std::vector<Notation>& notations) {
  compiled_.reset();
  alternatives_.clear();
  compiled_ = compileFormat(format, notations);
  if (compiled_ == nullptr) return false;
  for (const std::string& alternative : stagedAffinityFormats_) {
    if (auto compiled = compileFormat(alternative, notations)) alternatives_.push_back(std::move(compiled));
  }
  return true;
}

void MaskEngine::clearAffinityFormats() {
  stagedAffinityFormats_.clear();
}

void MaskEngine::addAffinityFormat(const std::string& format) {
  stagedAffinityFormats_.push_back(format);
}

void MaskEngine::setAffinityStrategy(int strategy) {
  affinityStrategy_ = std::clamp(strategy, kAffinityWholeString, kAffinityExtractedValueCapacity);
}

void MaskEngine::setTextCase(int textCase) {
  textCase_ = std::clamp(textCase, kTextCaseNone, kTextCaseLower);
}

void MaskEngine::clearCharacterMap() {
  characterMap_.clear();
}

void MaskEngine::addCharacterMapping(const std::string& from, const std::string& to) {
  const CodePoints source = AmountFormatter::decode(from);
  if (source.empty()) return;
  const CodePoints target = AmountFormatter::decode(to);
  characterMap_.emplace_back(source[0], target.empty() ? 0 : target[0]);
}

void MaskEngine::setSlotPlaceholder(const std::string& character) {
  const CodePoints decoded = AmountFormatter::decode(character);
  slotPlaceholder_ = decoded.empty() ? 0 : decoded[0];
}

// MARK: - Applying

MaskEngine::Result MaskEngine::apply(const std::string& text, int caret, bool caretForward, bool autocomplete,
                                     bool autoSkip) const {
  if (!isActive()) {
    // No mask: hand the text back untouched so a bad format cannot brick a field.
    const int count = AmountFormatter::codePointCount(text);
    Result passthrough;
    passthrough.formattedText = text;
    passthrough.caret = std::clamp(caret, 0, count);
    passthrough.extractedValue = text;
    passthrough.complete = true;
    return passthrough;
  }
  // Nothing typed, nothing filled: no literal is completed into an empty field
  // (the placeholder shows, as it does after deleting everything), whatever
  // `autocomplete` says. `clear()`, `setText("")` and an empty `value` prop
  // used to leave a mask's leading literals ("+1 (") behind.
  if (text.empty() && autocomplete) {
    return apply(text, caret, caretForward, false, autoSkip);
  }

  int caretPosition = std::clamp(caret, 0, AmountFormatter::codePointCount(text));
  CodePoints input = prepareInput(AmountFormatter::decode(text), &caretPosition);

  if (alternatives_.empty()) {
    return applyCompiled(*compiled_, input, caretPosition, caretForward, autocomplete, autoSkip);
  }

  // With several formats the text still carries the separators whichever one
  // won last time inserted: "3782 8224 6" typed under 4-4-4-4 would count its
  // spaces against the Amex 4-6-5 format and never let it take over. So every
  // format re-masks the value characters alone; each puts its own literals back.
  const std::vector<Notation>& notations = compiled_->notations;
  const auto isValueCharacter = [&](uint32_t c) {
    if (isDigit(c) || isLetter(c)) return true;
    return std::any_of(notations.begin(), notations.end(), [c](const Notation& n) {
      return std::find(n.characterSet.begin(), n.characterSet.end(), c) != n.characterSet.end();
    });
  };
  CodePoints values;
  values.reserve(input.size());
  const int originalCaret = caretPosition;
  for (size_t i = 0; i < input.size(); ++i) {
    if (isValueCharacter(input[i])) {
      values.push_back(input[i]);
    } else if (static_cast<int>(i) < originalCaret) {
      caretPosition -= 1;
    }
  }

  // Ties go to the format that keeps more of what the field already shows -
  // the one whose output shares the longer prefix with the text. The text
  // still carries the separators of whichever format is showing, so that is
  // the incumbent: a 4-6-5 card does not flip back to 4-4-4-4 at the 11th and
  // 12th digit, where the two score the same. With nothing to tell them apart
  // (an empty field, or text both lay out alike) the primary keeps it.
  const auto sharedPrefix = [&](const Result& result) {
    const CodePoints formatted = AmountFormatter::decode(result.formattedText);
    size_t shared = 0;
    while (shared < formatted.size() && shared < input.size() && formatted[shared] == input[shared]) shared++;
    return static_cast<int>(shared);
  };
  Result best = applyCompiled(*compiled_, values, caretPosition, caretForward, autocomplete, autoSkip);
  int bestScore = score(*compiled_, best, input, values);
  int bestShared = sharedPrefix(best);
  for (size_t i = 0; i < alternatives_.size(); ++i) {
    Result candidate = applyCompiled(*alternatives_[i], values, caretPosition, caretForward, autocomplete, autoSkip);
    const int candidateScore = score(*alternatives_[i], candidate, input, values);
    const int candidateShared = sharedPrefix(candidate);
    if (candidateScore > bestScore || (candidateScore == bestScore && candidateShared > bestShared)) {
      bestScore = candidateScore;
      bestShared = candidateShared;
      best = std::move(candidate);
      best.formatIndex = static_cast<int>(i) + 1;
    }
  }
  return best;
}

std::vector<uint32_t> MaskEngine::prepareInput(const std::vector<uint32_t>& input, int* caret) const {
  if (textCase_ == kTextCaseNone && characterMap_.empty()) return input;
  CodePoints out;
  out.reserve(input.size());
  const int originalCaret = *caret;
  for (size_t i = 0; i < input.size(); ++i) {
    uint32_t c = input[i];
    for (const auto& [from, to] : characterMap_) {
      if (c == from) {
        c = to;
        break;
      }
    }
    if (c == 0) {
      // Dropped: everything after it moves left, the caret with it.
      if (static_cast<int>(i) < originalCaret) *caret -= 1;
      continue;
    }
    if (textCase_ == kTextCaseUpper) c = toUpper(c);
    if (textCase_ == kTextCaseLower) c = toLower(c);
    out.push_back(c);
  }
  return out;
}

/// `text` is the input as typed (case-folded and mapped), `values` the same
/// with its separators taken out. Prefix and capacity measure what was typed;
/// value capacity counts what would have to fit, which the result itself
/// cannot tell - it has already dropped whatever overflowed.
int MaskEngine::score(const Compiled& compiled, const Result& result, const std::vector<uint32_t>& text,
                      const std::vector<uint32_t>& values) const {
  switch (affinityStrategy_) {
    case kAffinityPrefix: {
      const CodePoints formatted = AmountFormatter::decode(result.formattedText);
      size_t shared = 0;
      while (shared < formatted.size() && shared < text.size() && formatted[shared] == text[shared]) shared++;
      return static_cast<int>(shared);
    }
    case kAffinityCapacity: {
      const int length = static_cast<int>(text.size());
      return length > compiled.textCapacity ? INT_MIN : length - compiled.textCapacity;
    }
    case kAffinityExtractedValueCapacity: {
      const int length = static_cast<int>(values.size());
      return length > compiled.valueCapacity ? INT_MIN : length - compiled.valueCapacity;
    }
    default:
      return result.affinity;
  }
}

MaskEngine::Result MaskEngine::applyCompiled(const Compiled& compiled, const std::vector<uint32_t>& input,
                                             int caretPosition, bool caretForward, bool autocomplete,
                                             bool autoSkip) const {
  const auto insertionAffectsCaret = [&](size_t at) {
    // RedMadRobot's gravity: typing (forward) moves the caret past a constant
    // inserted right at it, so "11|" + "1" under "[00]{.}[00]" lands after the
    // dot; deleting (backward) leaves the caret in front of it.
    return caretForward ? static_cast<int>(at) <= caretPosition : static_cast<int>(at) < caretPosition;
  };
  const auto deletionAffectsCaret = [&](size_t at) { return static_cast<int>(at) < caretPosition; };

  CodePoints formatted;
  CodePoints extracted;
  int modifiedCaret = caretPosition;
  int affinity = 0;
  const State* state = compiled.initial;
  std::vector<Step> autocompletionStack;

  size_t at = 0;
  bool insAffects = insertionAffectsCaret(at);
  bool delAffects = deletionAffectsCaret(at);
  bool have = at < input.size();
  uint32_t c = have ? input[at++] : 0;

  const auto advance = [&]() {
    insAffects = insertionAffectsCaret(at);
    delAffects = deletionAffectsCaret(at);
    have = at < input.size();
    if (have) c = input[at++];
  };

  while (have) {
    const std::optional<Step> step = accept(state, c);
    if (step.has_value()) {
      if (delAffects) {
        // A null autocomplete resets the run of skippable constants.
        const std::optional<Step> skippable = autocompleteOf(state);
        if (skippable.has_value()) {
          autocompletionStack.push_back(*skippable);
        } else {
          autocompletionStack.clear();
        }
      }
      state = step->state;
      if (step->insert.has_value()) formatted.push_back(*step->insert);
      if (step->value.has_value()) extracted.push_back(*step->value);
      if (step->pass) {
        advance();
        affinity += 1;
      } else {
        if (insAffects && step->insert.has_value()) modifiedCaret += 1;
        affinity -= 1;
      }
    } else {
      if (delAffects) modifiedCaret -= 1;
      advance();
      affinity -= 1;
    }
  }

  // Trailing constants are filled in once the caret has reached the end of the
  // input - typing "212" into "+1 ([000]) [000]" leaves "+1 (212) " with the
  // caret after the space, ready for the next digit. That is RedMadRobot's
  // `insertionAffectsCaret` at the end of the input (`index <= caret` under
  // forward gravity), spelled out.
  const bool caretAtEnd = caretPosition >= static_cast<int>(input.size());
  while (autocomplete && caretAtEnd) {
    const std::optional<Step> step = autocompleteOf(state);
    if (!step.has_value()) break;
    state = step->state;
    if (step->insert.has_value()) {
      formatted.push_back(*step->insert);
      modifiedCaret += 1;
    }
    if (step->value.has_value()) extracted.push_back(*step->value);
  }

  const State* tailState = state;
  CodePoints tail;
  while (autoSkip && !autocompletionStack.empty()) {
    const Step skip = autocompletionStack.back();
    autocompletionStack.pop_back();
    if (static_cast<int>(formatted.size()) == modifiedCaret) {
      if (skip.insert.has_value() && !formatted.empty() && formatted.back() == *skip.insert) {
        formatted.pop_back();
        modifiedCaret -= 1;
      }
      if (skip.value.has_value() && !extracted.empty() && extracted.back() == *skip.value) {
        extracted.pop_back();
      }
    } else if (skip.insert.has_value()) {
      modifiedCaret -= 1;
    }
    tailState = skip.state;
    if (skip.insert.has_value()) {
      tail.assign(1, *skip.insert);
    }
  }

  Result result;
  result.formattedText = AmountFormatter::encode(formatted);
  result.caret = std::clamp(modifiedCaret, 0, static_cast<int>(formatted.size()));
  result.extractedValue = AmountFormatter::encode(extracted);
  result.complete = noMandatoryLeft(state);
  result.affinity = affinity;

  CodePoints placeholderTail = tail;
  for (const State* s = tailState; s != nullptr;) {
    if (s->slot == Slot::EndOfLine) break;
    if (s->slot == Slot::Free || s->slot == Slot::Fixed) {
      placeholderTail.push_back(s->ownCharacter);
    } else if (s->elliptical) {
      break;
    } else {
      placeholderTail.push_back(slotPlaceholder_ != 0 ? slotPlaceholder_ : s->placeholderCharacter());
    }
    s = s->child;
  }
  result.tailPlaceholder = AmountFormatter::encode(placeholderTail);
  return result;
}

MaskEngine::Result MaskEngine::applyEdit(const std::string& current, int start, int end,
                                         const std::string& replacement, bool autocomplete, bool autoSkip) const {
  const CodePoints text = AmountFormatter::decode(current);
  const int count = static_cast<int>(text.size());
  start = std::clamp(start, 0, count);
  end = std::clamp(end, start, count);
  CodePoints inserted = AmountFormatter::decode(replacement);
  if (inserted.size() > 1 && isActive()) inserted = withoutRepeatedPrefix(text, start, end, inserted);

  CodePoints spliced(text.begin(), text.begin() + start);
  spliced.insert(spliced.end(), inserted.begin(), inserted.end());
  spliced.insert(spliced.end(), text.begin() + end, text.end());

  const int caret = start + static_cast<int>(inserted.size());
  // Typing runs forward and may autocomplete; deleting runs backward and may
  // auto-skip. Doing both at once would fight itself.
  const bool deleting = inserted.empty();
  return apply(AmountFormatter::encode(spliced), caret, !deleting, !deleting && autocomplete, deleting && autoSkip);
}

std::vector<uint32_t> MaskEngine::withoutRepeatedPrefix(const std::vector<uint32_t>& text, int start, int end,
                                                       const std::vector<uint32_t>& inserted) const {
  // A paste or autofill that repeats the mask's own leading constants -
  // "+63 912 345 6789" into "+63 [000] [000] [0000]", whose "+63 " the field
  // already shows - would have its "63" taken as the first two digits and its
  // last two cut off. Drop the repeat, but only when the paste lands inside
  // those constants and keeping it would overflow the mask: a value that
  // merely starts with the same digits, and fits, is left alone.
  const auto isValueCharacter = [](uint32_t c) { return isDigit(c) || isLetter(c); };
  const CodePoints& leading = compiled_->leadingConstants;
  if (start > static_cast<int>(leading.size())) return inserted;

  CodePoints repeated;
  for (uint32_t c : leading) {
    if (isValueCharacter(c)) repeated.push_back(c);
  }
  if (repeated.empty()) return inserted;

  const auto countValue = [&](auto from, auto to) {
    return static_cast<int>(std::count_if(from, to, isValueCharacter));
  };
  const int incoming = countValue(inserted.begin(), inserted.end()) + countValue(text.begin() + end, text.end());
  if (incoming <= compiled_->valueCapacity) return inserted;

  size_t matched = 0;
  for (size_t i = 0; i < inserted.size(); ++i) {
    const uint32_t c = inserted[i];
    if (!isValueCharacter(c)) continue;  // "+", spaces, brackets
    if (c != repeated[matched]) return inserted;
    if (++matched == repeated.size()) {
      return CodePoints(inserted.begin() + static_cast<long>(i) + 1, inserted.end());
    }
  }
  return inserted;
}

} // namespace margelo::nitro::nitroinput
