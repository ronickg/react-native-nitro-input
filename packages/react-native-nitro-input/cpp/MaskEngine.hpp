//
//  MaskEngine.hpp
//  NitroInput
//
//  Pattern masking for `mode="mask"`: turns an edit on masked text into the
//  next masked text and caret, synchronously and on the native side, the same
//  way `AmountFormatter` does it for amounts.
//
//  The format is compiled once into a chain of states, and every edit is one
//  left-to-right walk over that chain which produces, in a single pass: the
//  formatted text, the extracted (raw) value, the caret, the tail placeholder
//  and whether every mandatory slot is filled.
//
//  Notation
//    [0] mandatory digit        [9] optional digit
//    [A] mandatory letter       [a] optional letter
//    [_] mandatory alphanumeric [-] optional alphanumeric
//    […] ellipsis, an unbounded run of the preceding type
//    {…} a fixed block: literal characters that count towards the value
//    x   a literal outside brackets: shown, but not part of the value
//    \   escapes the next character
//  plus any number of caller-supplied `Notation`s.
//
//  Around the walk
//    - Input is case-folded and character-mapped first (`setTextCase`,
//      `addCharacterMapping`), so the caret never moves because of it.
//    - Alternative formats (`addAffinityFormat`) are each tried and the one
//      the `AffinityStrategy` scores best wins; the primary wins ties.
//    - A paste that repeats the mask's own leading constants ("+63…" into
//      "+63 [000]…") loses them, when keeping them would overflow the mask.
//
//  The algorithm follows RedMadRobot's input-mask (MIT), by way of
//  react-native-advanced-input-mask. It differs from both in three ways that
//  matter: it works in code points rather than UTF-16 units (so an astral
//  character is never split in half), a bad format is reported rather than
//  thrown, and the format sanitizer implements the rule rather than the
//  string-rewriting that happened to express it.
//
//  Strings are UTF-8; offsets count code points. Shared by both platforms.
//

#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace margelo::nitro::nitroinput {

class MaskEngine final {
public:
  /// A caller-defined slot character, e.g. {'$', "0123456789", false}.
  struct Notation {
    uint32_t character = 0;
    std::vector<uint32_t> characterSet;
    bool isOptional = false;
  };

  struct Result {
    /// The masked text.
    std::string formattedText;
    /// Caret offset into `formattedText`, in code points.
    int caret = 0;
    /// Only the characters the user contributed, without free literals.
    std::string extractedValue;
    /// What is still missing, e.g. "0-0000" - for drawing a ghost tail.
    std::string tailPlaceholder;
    /// Every mandatory slot is filled.
    bool complete = false;
    /// How well the input fitted: +1 per accepted character, -1 per rejected.
    int affinity = 0;
    /// Which format produced this: 0 the primary, 1… the affinity formats in
    /// the order they were added.
    int formatIndex = 0;
  };

  /// How input letters are cased before masking.
  static constexpr int kTextCaseNone = 0;
  static constexpr int kTextCaseUpper = 1;
  static constexpr int kTextCaseLower = 2;

  /// How the best of several formats is chosen (RedMadRobot's strategies).
  /// Whole string: accepted minus rejected characters.
  static constexpr int kAffinityWholeString = 0;
  /// Prefix: how many leading characters the input and the result share.
  static constexpr int kAffinityPrefix = 1;
  /// Capacity: fits the formatted text into the format, best the fullest.
  static constexpr int kAffinityCapacity = 2;
  /// Extracted value capacity: the same for the extracted value.
  static constexpr int kAffinityExtractedValueCapacity = 3;

  /// Freely copyable: a compiled mask is immutable and shared, so a copy is a
  /// refcount bump. That also lets Swift and Kotlin hold one as a plain value.
  MaskEngine();
  ~MaskEngine();
  MaskEngine(const MaskEngine&);
  MaskEngine& operator=(const MaskEngine&);
  MaskEngine(MaskEngine&&) noexcept;
  MaskEngine& operator=(MaskEngine&&) noexcept;

  /// Compiles `format`. Returns false and leaves the engine inactive when the
  /// format is malformed (unbalanced brackets, or a slot character with no
  /// notation) - a text field must keep working, so this never throws.
  bool setFormat(const std::string& format, const std::vector<Notation>& notations);

  /// Compiles `format` with whatever notations were staged by `addNotation`.
  bool setFormat(const std::string& format);

  /// Stages notations for the next `setFormat`. Swift/C++ interop and JNI both
  /// handle scalars and strings far better than a vector of structs, so the
  /// platform views build the list one call at a time: `clearNotations()`,
  /// then `addNotation(...)` per slot, then `setFormat(pattern)`.
  void clearNotations();
  /// `character` is a slot character (its first code point is used);
  /// `characterSet` is every character that slot accepts.
  void addNotation(const std::string& character, const std::string& characterSet, bool isOptional);

  /// Stages alternative formats for the next `setFormat`, compiled with the
  /// same notations. A malformed one is skipped rather than failing the rest.
  void clearAffinityFormats();
  void addAffinityFormat(const std::string& format);
  /// One of the `kAffinity…` constants. Default: whole string.
  void setAffinityStrategy(int strategy);

  /// One of the `kTextCase…` constants, applied to input before masking.
  void setTextCase(int textCase);
  /// Replaces `from` with `to` in the input before masking, e.g. a Cyrillic
  /// "С" with a Latin "C", or "," with "." for a decimal mask. Each is one
  /// character (its first code point); an empty `to` drops the character.
  void clearCharacterMap();
  void addCharacterMapping(const std::string& from, const std::string& to);

  /// The character the tail placeholder shows for each empty slot, e.g. "_".
  /// Empty (the default): the slot's own notation character ("0", "a", "-").
  void setSlotPlaceholder(const std::string& character);

  /// False until a valid format has been set; `apply` then passes text through.
  bool isActive() const;

  /// Masks `text` whole. `caret` is a code point offset into `text`;
  /// `caretForward` biases the caret to the right of an inserted character,
  /// which is what you want after typing and not after deleting.
  Result apply(const std::string& text, int caret, bool caretForward, bool autocomplete, bool autoSkip) const;

  /// Replaces code points [start, end) of `current` with `replacement` and
  /// re-masks. Picks the caret gravity from the edit: forward with
  /// autocompletion when something was typed or pasted, backward with
  /// auto-skipping when something was deleted.
  Result applyEdit(const std::string& current, int start, int end, const std::string& replacement, bool autocomplete,
                   bool autoSkip) const;

public:
  /// Implementation detail, public only so the compiler's helpers can name it.
  /// The state chain and its transitions are defined in the .cpp.
  enum class Slot : uint8_t { Free, Fixed, Value, OptionalValue, EndOfLine };
  enum class CharClass : uint8_t { Numeric, Literal, AlphaNumeric, Custom };
  struct State;
  struct Step;

private:
  /// A compiled mask. Heap-allocated and never mutated after `setFormat`
  /// returns, so the pointers the states hold into `notations` stay valid for
  /// as long as any copy of the engine does.
  struct Compiled {
    std::vector<std::unique_ptr<State>> arena;
    const State* initial = nullptr;
    std::vector<Notation> notations;
    /// Characters the format can hold at most (literals included), and value
    /// characters; `kUnbounded` with an ellipsis.
    int textCapacity = 0;
    int valueCapacity = 0;
    /// The constants before the first slot, e.g. "+63 " for "+63 [000]".
    std::vector<uint32_t> leadingConstants;
  };
  static constexpr int kUnbounded = 1 << 30;

  static std::shared_ptr<const Compiled> compileFormat(const std::string& format,
                                                        const std::vector<Notation>& notations);
  Result applyCompiled(const Compiled& compiled, const std::vector<uint32_t>& input, int caret, bool caretForward,
                       bool autocomplete, bool autoSkip) const;
  std::vector<uint32_t> prepareInput(const std::vector<uint32_t>& input, int* caret) const;
  int score(const Compiled& compiled, const Result& result, const std::vector<uint32_t>& text,
            const std::vector<uint32_t>& values) const;
  std::vector<uint32_t> withoutRepeatedPrefix(const std::vector<uint32_t>& text, int start, int end,
                                              const std::vector<uint32_t>& inserted) const;

  static const State* compile(Compiled& out, const std::vector<uint32_t>& format, size_t index, bool valuable,
                              bool fixed, uint32_t lastCharacter, bool* ok);
  static bool classOf(const Compiled& compiled, uint32_t formatCharacter, CharClass* cls, const Notation** notation);
  static bool inheritedClass(const Compiled& compiled, uint32_t lastCharacter, CharClass* cls,
                             const Notation** notation);

  std::shared_ptr<const Compiled> compiled_;
  std::vector<std::shared_ptr<const Compiled>> alternatives_;
  std::vector<Notation> staged_;
  std::vector<std::string> stagedAffinityFormats_;
  int affinityStrategy_ = kAffinityWholeString;
  int textCase_ = kTextCaseNone;
  std::vector<std::pair<uint32_t, uint32_t>> characterMap_; // to == 0: drop
  uint32_t slotPlaceholder_ = 0;
};

} // namespace margelo::nitro::nitroinput
