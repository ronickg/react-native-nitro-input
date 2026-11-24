import Foundation

/// UITextField and UITextView speak UTF-16 offsets; the props, callbacks and
/// engines speak code points. Foundation-only, so `bun run test:swift` builds
/// it as a host executable.
enum CodePointOffsets {
  /// The code point offset of a UTF-16 offset. One that lands inside a
  /// surrogate pair counts as the start of that code point, as
  /// `String.replaceSubrange` rounds it. UIKit hands those over (the emoji
  /// keyboard, autocorrect and IME replacements next to an emoji, a caret
  /// left inside a pair). Stepping back from such an index with
  /// `unicodeScalars.index(before:)`, as this used to, trapped when the pair
  /// was the first code point (EXC_BREAKPOINT in
  /// `textField(_:shouldChangeCharactersIn:)`) and counted one too few
  /// anywhere else.
  static func codePoint(in string: String, utf16 offset: Int) -> Int {
    guard offset > 0 else { return 0 }
    var units = 0
    var count = 0
    for scalar in string.unicodeScalars {
      units += scalar.utf16.count
      if units > offset { return count }
      count += 1
    }
    return count
  }

  /// The UTF-16 offset of a code point offset, clamped to the string.
  static func utf16(in string: String, codePoint offset: Int) -> Int {
    let scalars = string.unicodeScalars
    let clamped = min(max(0, offset), scalars.count)
    let index = scalars.index(scalars.startIndex, offsetBy: clamped)
    return string.utf16.distance(from: string.utf16.startIndex, to: index)
  }
}
