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
  };

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
  };

  static const State* compile(Compiled& out, const std::vector<uint32_t>& format, size_t index, bool valuable,
                              bool fixed, uint32_t lastCharacter, bool* ok);
  static bool classOf(const Compiled& compiled, uint32_t formatCharacter, CharClass* cls, const Notation** notation);
  static bool inheritedClass(const Compiled& compiled, uint32_t lastCharacter, CharClass* cls,
                             const Notation** notation);

  std::shared_ptr<const Compiled> compiled_;
  std::vector<Notation> staged_;
};

} // namespace margelo::nitro::nitroinput
