import Foundation

// Host test for ios/CodePointOffsets.swift: `bun run test:swift`.
// UITextField's text is a bridged NSString, so every case runs on a native
// Swift string and on a bridged one.

@main
enum CodePointOffsetsTest {
  static var failures = 0
  static var checks = 0

  static func expect(_ got: Int, _ want: Int, _ what: @autoclosure () -> String) {
    checks += 1
    if got != want {
      failures += 1
      print("FAIL \(what()): got \(got), want \(want)")
    }
  }

  static func variants(_ s: String) -> [String] { [s, NSMutableString(string: s) as String] }

  static func main() {
    // The production crash: a UTF-16 offset inside the first code point's
    // surrogate pair. This trapped (EXC_BREAKPOINT) before the fix.
    for s in variants("😀ab") {
      expect(CodePointOffsets.codePoint(in: s, utf16: 0), 0, "😀ab @0")
      expect(CodePointOffsets.codePoint(in: s, utf16: 1), 0, "😀ab @1 (mid-surrogate)")
      expect(CodePointOffsets.codePoint(in: s, utf16: 2), 1, "😀ab @2")
      expect(CodePointOffsets.codePoint(in: s, utf16: 4), 3, "😀ab @4")
    }
    // Inside a later pair it used to count one too few (0 here).
    for s in variants("a😀b😀") {
      expect(CodePointOffsets.codePoint(in: s, utf16: 2), 1, "a😀b😀 @2 (mid-surrogate)")
      expect(CodePointOffsets.codePoint(in: s, utf16: 5), 3, "a😀b😀 @5 (mid-surrogate)")
      expect(CodePointOffsets.codePoint(in: s, utf16: 6), 4, "a😀b😀 @6")
    }
    // Out of range clamps.
    for s in variants("ab") {
      expect(CodePointOffsets.codePoint(in: s, utf16: -3), 0, "ab @-3")
      expect(CodePointOffsets.codePoint(in: s, utf16: 9), 2, "ab @9")
    }
    // A lone surrogate (a bridged NSString can hold one mid-edit) is one unit.
    let lone = NSString(characters: [0xD83D, 0x61], length: 2) as String
    expect(CodePointOffsets.codePoint(in: lone, utf16: 1), 1, "lone @1")
    expect(CodePointOffsets.codePoint(in: lone, utf16: 2), 2, "lone @2")

    // Every offset of strings UIKit edits around: skin tones, ZWJ families,
    // flags, combining marks, CJK. Monotonic, rounds down inside a pair, and
    // agrees with utf16(in:codePoint:) on every scalar boundary.
    let samples = ["", "a", "😀", "👍🏽x", "👨‍👩‍👧‍👦", "🇿🇦🇺🇸", "é", "e\u{301}", "日本語😀", "a😀😀😀z"]
    for sample in samples {
      for s in variants(sample) {
        let n = s.utf16.count
        var boundaries = Set<Int>()
        var units = 0
        boundaries.insert(0)
        for scalar in s.unicodeScalars { units += scalar.utf16.count; boundaries.insert(units) }
        var previous = 0
        for offset in 0...n {
          let got = CodePointOffsets.codePoint(in: s, utf16: offset)
          let back = CodePointOffsets.utf16(in: s, codePoint: got)
          checks += 1
          if got < previous || back > offset || (boundaries.contains(offset) && back != offset) {
            failures += 1
            print("FAIL \(sample.debugDescription) @\(offset): \(got) -> \(back)")
          }
          previous = got
        }
        expect(CodePointOffsets.codePoint(in: s, utf16: n), s.unicodeScalars.count, "\(sample.debugDescription) end")
        expect(CodePointOffsets.utf16(in: s, codePoint: 99), n, "\(sample.debugDescription) utf16 clamp")
      }
    }

    print("CodePointOffsetsTest: \(checks) checks, \(failures) failures")
    if failures > 0 { exit(1) }
  }
}
