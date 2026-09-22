//
//  MaskEngine.cpp
//  NitroInput
//

#include "MaskEngine.hpp"

#include "AmountFormatter.hpp"

#include <algorithm>
#include <optional>

namespace margelo::nitro::nitroinput {

namespace {

using CodePoints = std::vector<uint32_t>;

bool isDigit(uint32_t c) {
  return c >= '0' && c <= '9';
}

bool isLetter(uint32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
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
    // Mandatory before optional, order otherwise preserved.
    std::stable_partition(piece.begin(), piece.end(), [](uint32_t c) { return !isOptionalSlot(c); });
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

bool MaskEngine::setFormat(const std::string& format, const std::vector<Notation>& notations) {
  compiled_.reset();
  if (format.empty()) return false;

  auto next = std::make_unique<Compiled>();
  next->notations = notations;

  // A notation may not redefine a built-in slot character - the compiler would
  // never reach it, so the caller's intent could not be honoured.
  for (const Notation& notation : next->notations) {
    if (isReservedSlot(notation.character) || notation.characterSet.empty()) return false;
  }

  CodePoints sanitized;
  if (!sanitize(AmountFormatter::decode(format), &sanitized)) return false;

  bool ok = true;
  const State* initial = compile(*next, sanitized, 0, false, false, 0, &ok);
  if (!ok || initial == nullptr) return false;

  next->initial = initial;
  compiled_ = std::move(next);
  return true;
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

  const CodePoints input = AmountFormatter::decode(text);
  const int caretPosition = std::clamp(caret, 0, static_cast<int>(input.size()));

  const auto insertionAffectsCaret = [&](size_t at) {
    return caretForward ? static_cast<int>(at) < caretPosition : static_cast<int>(at) <= caretPosition;
  };
  const auto deletionAffectsCaret = [&](size_t at) { return static_cast<int>(at) < caretPosition; };

  CodePoints formatted;
  CodePoints extracted;
  int modifiedCaret = caretPosition;
  int affinity = 0;
  const State* state = compiled_->initial;
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
  // caret after the space, ready for the next digit.
  //
  // The engine this is modelled on gates this on `insertionAffectsCaret`, which
  // is `index < caret` under forward gravity. The walk only ends when the index
  // has reached the end of the input, and the caret can never be past that, so
  // that test is always false and its loop is unreachable: constants only turn
  // up retroactively, when the next value character arrives. Running both side
  // by side on "+1 ([000]) [000]-[0000]":
  //
  //     typed     reference        here
  //     212       "+1 (212"        "+1 (212) "
  //     212555    "+1 (212) 555"   "+1 (212) 555-"
  //
  // Gate it on the caret instead, which is the behaviour that was always
  // described (and their issues #148 and #31).
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
      placeholderTail.push_back(s->placeholderCharacter());
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
  const CodePoints inserted = AmountFormatter::decode(replacement);

  CodePoints spliced(text.begin(), text.begin() + start);
  spliced.insert(spliced.end(), inserted.begin(), inserted.end());
  spliced.insert(spliced.end(), text.begin() + end, text.end());

  const int caret = start + static_cast<int>(inserted.size());
  // Typing runs forward and may autocomplete; deleting runs backward and may
  // auto-skip. Doing both at once would fight itself.
  const bool deleting = inserted.empty();
  return apply(AmountFormatter::encode(spliced), caret, !deleting, !deleting && autocomplete, deleting && autoSkip);
}

} // namespace margelo::nitro::nitroinput
