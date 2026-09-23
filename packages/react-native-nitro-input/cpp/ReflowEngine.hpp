//
//  ReflowEngine.hpp
//  NitroInput
//
//  The platform-independent text-reflow state machine behind the input view.
//  Both native views (NitroInputView.swift, NitroInputView.kt) hand it the new
//  text as a list of glyphs (character, role, kind, advance width) plus where
//  the edit happened, and draw whatever it reports: one glyph per character
//  with a position, vertical slide, opacity and scale, including the glyphs
//  that are still on their way out. No rendering, no fonts, no threading.
//
//  Matching follows Torph (https://torph.lochie.me): an edit at a caret pairs
//  the characters on either side of the caret by position (grouping separators
//  aside, which reflow with the magnitude and pair from the units end); a value
//  set without a caret pairs digits by place value and other characters by
//  longest common subsequence. Characters that persist glide to their new
//  place; new ones enter next to their neighbour; removed ones travel with
//  their neighbour while they leave.
//
//  Time is in seconds on any monotonic clock. Plain ints/doubles/strings so it
//  imports into Swift (C++ interop), bridges over JNI and compiles to WebAssembly.
//

#pragma once

#include <cstdint>
#include <vector>

namespace margelo::nitro::nitroinput {

class ReflowEngine final {
public:
  /// What a character is; decides how it enters, leaves and is matched.
  enum Kind : int {
    Text = 0,
    Digit = 1,
    /// Grouping separator: pairs by distance from the units end; enters from below.
    Separator = 2,
    /// Decimal separator: part of the typed sequence; enters from below.
    Decimal = 3,
  };
  /// Where a glyph sits. Prefix and suffix are static decorations around the editable body.
  enum Role : int { Prefix = 0, Body = 1, Suffix = 2 };
  // Easing: 0 expo (cubic-bezier 0.19, 1, 0.22, 1), 1 easeOut, 2 easeInOut, 3 linear, 4 spring.
  // Effect: 0 auto (digits/separators slide, text fades), 1 slide, 2 fade.

  struct Glyph {
    /// Stable identity across updates; a renderer keeps one layer per id.
    int64_t id;
    /// UTF-32 code point.
    uint32_t character;
    int role;
    int kind;
    /// Advance width, in the caller's layout units.
    double width;
    /// Drawn in the placeholder colour.
    bool placeholder;
    /// Left edge, animated.
    double x;
    /// Vertical offset in line heights (the slide), 0 at rest.
    double y;
    /// 0…1.
    double opacity;
    /// About the glyph's centre.
    double scale;
    /// On its way out: drawn, but not part of the text.
    bool exiting;
  };

  /// One glyph of a pending text (see `addGlyph`).
  struct Input {
    uint32_t character;
    int role;
    int kind;
    double width;
    bool placeholder;
  };

  ReflowEngine();

  // MARK: Configuration

  void setTiming(double durationSeconds, int easing, double bounce);
  void setEffect(int effect);
  /// Reduce Motion / "remove animations": every change snaps.
  void setReduceMotion(bool reduceMotion);
  /// A right-to-left layout: the prefix moves to the right edge and the suffix
  /// to the left, while the body stays a left-to-right run (digits read the
  /// same way in every script). Applied to the published frames and `caretX`;
  /// the layout itself is always computed left-to-right.
  void setRightToLeft(bool rightToLeft);

  // MARK: Text

  /// Starts describing the new text. Add every glyph in order (prefix, body,
  /// suffix), then commit.
  void beginText();
  void addGlyph(uint32_t character, int role, int kind, double width, bool placeholder);
  /// `caretIndex`: the body index the edit ended at (caret matching), or -1
  /// when the value was replaced (place matching). The first commit shows the
  /// text without an animation.
  void commitText(int caretIndex, double now);

  // MARK: Frames

  /// Advances every animation. Returns true when something is still moving.
  bool tick(double now);
  bool needsFrames() const;
  bool isAnimating() const { return animating_; }

  // MARK: Render state

  /// Every glyph in draw order, exiting ones included.
  const std::vector<Glyph>& glyphs() const { return glyphs_; }
  int glyphCount() const { return static_cast<int>(glyphs_.size()); }
  Glyph glyphAt(int index) const { return glyphs_[static_cast<size_t>(index)]; }
  /// Width of the whole content (prefix + body + suffix), animated.
  double contentWidth() const { return contentWidth_; }
  /// Width the content settles at.
  double targetWidth() const { return targetWidth_; }
  /// Number of live body glyphs.
  int bodyCount() const;
  /// Left edge of the caret placed before body glyph `index` (`bodyCount()` =
  /// after the last one), following the animation.
  double caretX(int index) const;
  bool hasText() const { return committed_; }

  void reset();

private:
  struct Slot {
    Glyph g;
    double start = 0;
    double fromX = 0, toX = 0;
    double fromY = 0, toY = 0;
    double fromOpacity = 1, toOpacity = 1;
    double fromScale = 1, toScale = 1;
    /// Opacity ramps linearly between these fractions of the duration.
    double fadeFrom = 0, fadeTo = 1;
    /// A glyph entering or leaving rides along with this live glyph.
    int64_t anchorId = -1;
    double anchorBaseX = 0;
    bool entering = false;
    bool slide = false;
    /// Part of a wholly-replaced run: scales about `groupCentre` instead of sliding.
    bool grouped = false;
    /// The run's centre, in layout units, shared by every member.
    double groupCentre = 0;
  };

  /// Scratch for finding wholly-replaced runs, kept between commits so a
  /// keystroke allocates nothing once the buffers have grown.
  std::vector<size_t> runBuf_;
  std::vector<unsigned char> groupFlag_;
  std::vector<double> groupCentre_;


  double ease(double t) const;
  bool slides(int kind) const;
  void snapTo(const std::vector<Input>& inputs);
  void matchBody(const std::vector<Input>& inputs, const std::vector<int>& oldBody, const std::vector<int>& newBody,
                 int caretIndex, std::vector<int>& matchOfNew) const;
  void matchByCaret(const std::vector<Input>& inputs, const std::vector<int>& oldBody, const std::vector<int>& newBody,
                    int caretIndex, std::vector<int>& matchOfNew) const;
  void matchByPlace(const std::vector<Input>& inputs, const std::vector<int>& oldBody, const std::vector<int>& newBody,
                    std::vector<int>& matchOfNew) const;
  void matchBySequence(const std::vector<Input>& inputs, const std::vector<int>& oldIdx, const std::vector<int>& newIdx,
                       std::vector<int>& matchOfNew) const;
  bool same(const Input& in, const Slot& slot) const;
  int slotIndexOf(int64_t id) const;
  /// Copies the slots' frames into `glyphs_`, mirrored when right-to-left.
  void publish();

  /// The horizontal extent of one block of the run (see `Blocks` in the .cpp).
  struct Extent {
    double start = 0;
    double end = 0;
    bool any = false;
  };
  /// The two blocks a caret can sit in - a sign laid out ahead of the prefix,
  /// and the rest of the body - measured over the live glyphs each time a
  /// frame is published, so `caretX` under right-to-left neither allocates
  /// nor re-measures the run on every call.
  struct CaretBlocks {
    Extent sign;
    Extent rest;
  };
  CaretBlocks caretBlocks_;
  /// Scratch for measuring the live glyphs in `publish`, kept so a frame
  /// allocates nothing once it has grown.
  std::vector<Glyph> liveBuf_;

  double duration_ = 0.4;
  int easing_ = 0;
  double bounce_ = 0.15;
  int effect_ = 0;
  bool reduceMotion_ = false;
  bool rightToLeft_ = false;

  std::vector<Input> pending_;
  std::vector<Slot> slots_;
  std::vector<Glyph> glyphs_;
  bool committed_ = false;
  bool animating_ = false;
  double now_ = 0;
  double contentWidth_ = 0;
  double targetWidth_ = 0;
  double widthFrom_ = 0;
  double widthStart_ = 0;
  int64_t nextId_ = 1;
};

} // namespace margelo::nitro::nitroinput
