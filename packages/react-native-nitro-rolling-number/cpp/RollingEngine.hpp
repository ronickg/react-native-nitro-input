//
//  RollingEngine.hpp
//  NitroRollingNumber
//
//  The platform-independent state machine behind the rolling number view.
//  Both native views (RollingNumberView.swift, RollingNumberView.kt) feed it
//  values and time, and draw whatever it reports: one "wheel" per digit with a
//  continuous position on a 0–9 strip (or, in the numeric transition, a glyph
//  swapping in place), the sign factor, the loading fade and the shimmer
//  phase. No rendering, no fonts, no threading in here.
//
//  Time is in seconds on any monotonic clock (CACurrentMediaTime,
//  Choreographer frame time). The API deliberately uses plain ints/doubles so
//  it imports cleanly into Swift (C++ interop) and bridges trivially over JNI.
//

#pragma once

#include <cstdint>
#include <vector>

namespace margelo::nitro::nitrorollingnumber {

class RollingEngine final {
public:
  struct Wheel {
    /// Glyph index on the strip. Interior wheels wrap modulo 10; linear wheels
    /// use -1 for "blank" and never wrap.
    double position;
    /// Horizontal extent, 0…1. Wheels appear/disappear by growing/shrinking.
    double width;
    /// The strip is [blank, 0, 1, …, 9] (appearing/disappearing wheels).
    bool linear;
    /// Glyph 0 is drawn blank (the emerging odometer wheel).
    bool blankZero;

    // The numeric transition (`setTransition(1)`, after SwiftUI's
    // `.contentTransition(.numericText())`): a wheel swaps its glyph in place
    // instead of rolling through the ones between. `blend` runs 0 → 1 from
    // `fromGlyph` to `toGlyph` (a digit, or -1 for blank) and is 1 for a wheel
    // that is settled or not part of the change; while it is below 1 a
    // renderer draws the two glyphs as `kNumeric*` below describes and ignores
    // `position`. `fromAbove`: the new glyph arrives from above and the old one
    // leaves downwards (a value that grew); otherwise mirrored.
    double fromGlyph = -1;
    double toGlyph = -1;
    double blend = 1;
    bool fromAbove = true;
    /// The change flash (`setFlash`): 1 the moment this wheel's glyph changed,
    /// fading to 0; a renderer tints the glyph towards the up or the down
    /// colour by this much. `flashUp`: the value grew.
    double flash = 0;
    bool flashUp = true;
  };

  // The numeric transition as the renderers draw it, in line heights, so all
  // three (Core Animation, Canvas, the docs' canvas) agree. With b = `blend`
  // and d = +1 when `fromAbove`, else -1:
  //   leaving glyph:  offset d · kNumericOffset · b,        scale 1 → kNumericScale,  alpha 1 → 0
  //   arriving glyph: offset -d · kNumericOffset · (1 - b), scale kNumericScale → 1, alpha 0 → 1
  // both scaled about their centre, the leaving one blurring in as it goes
  // (blur = min(1, 2b)) and the arriving one coming into focus (blur = 1 - b),
  // with kNumericBlur line heights of blur radius at full blur. The figures
  // are ours, chosen against the effect on an iPhone: a glyph appears a bit
  // under half a line height away along the axis, a little small and out of
  // focus, and resolves into place; the one it replaces softens first, then
  // fades and shrinks as it goes.
  static constexpr double kNumericOffset = 0.4;
  static constexpr double kNumericScale = 0.6;
  static constexpr double kNumericBlur = 0.16;

  // The scramble (2) is planned like the numeric transition but the wheel
  // shows a different random digit every kScrambleStepSeconds until it locks
  // on its target; `position` is that digit and `blend` stays 1, so a
  // renderer needs nothing new.
  static constexpr double kScrambleStepSeconds = 0.045;

  // Easing: 0 linear, 1 easeIn, 2 easeOut, 3 easeInOut, 4 spring.
  // Direction: 0 auto (sign of the change), 1 up, 2 down.
  // Transition: 0 roll (the odometer), 1 numeric (glyphs swap in place),
  // 2 scramble.

  RollingEngine();

  // MARK: Configuration

  /// Digits after the decimal separator (0…9) and zero-padding of the integer
  /// part (1…15). Snaps to the current target when they change.
  void setFormat(int fractionDigits, int minimumIntegerDigits);
  void setTiming(double durationSeconds, int easing, double bounce, double staggerSeconds, int direction);
  /// How a value change plays: 0 rolls every digit through the ones between
  /// (the odometer), 1 swaps each changed glyph in place (the numeric
  /// transition), 2 scrambles each changed digit until it locks. In the
  /// numeric transition the stagger runs from the leftmost digit to the
  /// right, the way the effect cascades on iOS, and the direction decides
  /// which way the glyphs move. Takes effect from the next `animateTo`.
  void setTransition(int transition);
  int transition() const { return transitionStyle_; }
  /// The change flash: every digit whose glyph changes lights up and fades
  /// back over `seconds` (`Wheel::flash`). 0 turns it off. A jump
  /// (`setValue`) never flashes; a reveal's count never does either.
  void setFlash(double seconds);
  /// A punch of the whole figure on every value change, `overshoot` 0 (none)
  /// to 1, rung out like the reveal's landing pop; part of `revealScale()`.
  void setPopOnChange(double overshoot);
  /// Reduce Motion / "remove animations": rolls snap and the shimmer freezes.
  void setReduceMotion(bool reduceMotion);

  // MARK: Commands

  /// Shows `value` immediately with continuously positioned wheels (odometer
  /// carry rule). Cancels any running roll.
  ///
  /// Both this and `animateTo` work on |value| × 10^fractionDigits, clamped to
  /// `kMaxMagnitude` (10^17, 18 wheels at most); a double only carries exact
  /// integers up to 2^53, so figures beyond that lose their low digits either way.
  void setValue(double value);
  /// Rolls every wheel to `value` (shortest path in the roll direction,
  /// blank↔digit for appearing/disappearing wheels), or, in the numeric
  /// transition, swaps every changed glyph in place. Snaps when nothing has
  /// been shown yet, the duration is 0, or Reduce Motion is on.
  void animateTo(double value, double now);
  /// Toggles the loading glint with a 250 ms cross-fade.
  void setLoading(bool loading, double now);
  /// Advances the roll, the reveal and the loading fade to `now`. Returns `needsFrames()`.
  bool tick(double now);
  /// Back to the pristine state (view recycling).
  void reset();

  // MARK: Jackpot reveal
  //
  // Two casino "you won" presentations, both landing with a pop (a velocity
  // kick on `revealScale()` rung out by a damped spring):
  //
  // - Style 0, count (the win-meter rollup): the figure opens at 0 and
  //   tallies up to the target like a slot's win counter: it takes off at
  //   once, runs at a constant rate and brakes into the total (and into each
  //   milestone, tier by tier, when there are milestones), swelling slightly
  //   as it climbs. Digits swap in place (the count's own speed is the
  //   animation, there is no roll) and leading digits appear as the count
  //   reaches their place; the layout is the target's from the first frame,
  //   so nothing reflows.
  // - Style 1, spin (the jackpot reels): every digit spins like a slot reel,
  //   then the reels brake and lock one at a time from the left, each with a
  //   small mechanical bounce, the last one landing at the duration.

  /// Timing of a reveal: the total duration, the landing pop's peak overshoot
  /// (`0` = no pop), the style (0 count, 1 spin) and, for the spin style, the
  /// delay between reel stops (shortened when the reels don't fit the
  /// duration). Defaults: 2.2 s, 0.12, count, 0.2 s.
  void setRevealTiming(double durationSeconds, double bounce, int style, double staggerSeconds);
  /// Count style: how much smaller the figure opens, as a fraction of its
  /// size, growing to full size over the count (`0` = no growth). Default 0.2.
  void setRevealGrow(double grow);
  /// Shows the opening frame of a reveal for `value`: its layout with the
  /// mandatory digits at 0 and every other digit blank ("$0", "$0.00").
  /// Cancels any roll.
  void holdReveal(double value);
  /// Counts from 0 up to `value`. Snaps when the duration is 0 or Reduce
  /// Motion is on. Called while a reveal is running it re-targets the count.
  void reveal(double value, double now);
  /// True while a reveal counts or its landing pop rings out.
  bool isRevealing() const { return reveal_.active; }
  /// Scale of the figure about its centre: a reveal's growth times its
  /// punches, times the change pop (`setPopOnChange`); 1 when idle.
  double revealScale() const { return revealScale_ * popScale_; }
  /// Wall-clock length of a whole reveal (count, milestone holds, landing pop).
  double revealTotalSeconds() const;

  // Milestones of a count-style reveal: the win tiers of a casino rollup
  // ("Big win" → "Mega win" → "Epic win"). When the count reaches one it
  // punches (a smaller landing pop) and pauses on it for the hold while
  // `revealMilestonesReached()` advances, so the app can slam its banner in
  // on the beat. Values are in the figure's units, ascending; ones at or
  // above the target are ignored. The spin style has no count and ignores them.

  void clearRevealMilestones();
  void addRevealMilestone(double value);
  /// Pause on each milestone, in seconds (0 = punch without stopping).
  void setRevealMilestoneHold(double holdSeconds);
  /// How many milestones the running (or finished) reveal has reached.
  int revealMilestonesReached() const { return reveal_.milestonesReached; }
  /// The value (in the figure's units) of the reveal's `index`-th usable milestone.
  double revealMilestoneValue(int index) const;

  // MARK: Render state

  const std::vector<Wheel>& wheels() const { return wheels_; }
  int wheelCount() const { return static_cast<int>(wheels_.size()); }
  Wheel wheelAt(int index) const { return wheels_[static_cast<size_t>(index)]; }
  double signFactor() const { return signFactor_; }
  /// 0 = normal, 1 = fully in loading mode.
  double loadingProgress() const { return loadingProgress_; }
  bool loading() const { return loading_; }
  /// Sweep progress 0…1 for a glint with the given period; 0 under Reduce Motion.
  double shimmerPhase(double now, double periodSeconds) const;
  /// Whether anything is still moving (roll, fade, or an active glint).
  bool needsFrames() const;
  /// True while a roll (`animateTo`) or a reveal's count is in progress; false
  /// for the loading fade or a reveal's landing pop alone.
  bool isRolling() const;

  // MARK: Settled target (intrinsic size, accessibility)

  double targetValue() const { return targetValue_; }
  bool hasShownValue() const { return hasShownValue_; }
  int settledPowerCount() const { return settledPowerCount_; }
  bool settledNegative() const { return settledNegative_; }
  /// Digit of the rounded target at 10^power (power 0 = least significant).
  int targetDigit(int power) const;
  int fractionDigits() const { return fractionDigits_; }
  int minimumIntegerDigits() const { return minimumIntegerDigits_; }

private:
  struct Target {
    uint64_t magnitude; // |value| * 10^fractionDigits, rounded
    bool negative;
    int powerCount;
    int digit(int power) const;
  };
  struct WheelTransition {
    Wheel from;
    Wheel to;
  };
  struct Transition {
    bool active = false;
    double start = 0;
    double duration = 0;
    std::vector<double> delays; // per wheel, least significant first
    /// The largest entry of `delays`, so a tick needn't scan them.
    double maxDelay = 0;
    std::vector<WheelTransition> wheels;
    double signFrom = 0;
    double signTo = 0;
    std::vector<Wheel> finals;
    /// True when this roll re-targeted wheels that were already moving. Such a
    /// roll skips the ease-in half of the curve so rapid updates keep flowing
    /// instead of restarting from rest on every call.
    bool fromMotion = false;
    /// The transition style this was planned with (see `setTransition`).
    int style = 0;
    /// Any glyph-swap style: wheels blend between glyphs instead of rolling.
    bool numeric = false;
  };
  /// One wheel's change flash: when its glyph last changed, and which way.
  struct Flash {
    double start = -1;
    bool up = true;
  };

  /// One slot reel of a spin-style reveal (index 0 is the leftmost digit).
  struct Reel {
    /// Strip position while free-spinning is `phase + speed * elapsed`.
    double phase;
    /// When the brake engages and when the reel has locked.
    double brakeStart;
    double stop;
    /// Position at `brakeStart` and the distance braked over, ending on the digit.
    double from;
    double travel;
  };
  struct Reveal {
    bool active = false;
    /// True while the count / the reels are still moving (not during the landing pop).
    bool counting = false;
    /// True while the opening frame is held (`holdReveal`), so a format change
    /// re-holds it instead of snapping to the full target.
    bool holding = false;
    double start = 0;
    Target target{0, false, 1};
    std::vector<Reel> reels; // spin style only, leftmost first
    /// Count style: for each usable milestone, its magnitude and the curve
    /// time (seconds into the count) at which the count reaches it.
    std::vector<double> milestoneMagnitudes;
    std::vector<double> milestoneTimes;
    int milestonesReached = 0;
  };

  Target makeTarget(double value) const;
  void snap(const Target& target);
  void settle(const Target& target);
  /// The digit a wheel shows, or is arriving at: -1 for blank.
  static int shownGlyph(const Wheel& wheel);
  void planRoll(Transition& next, const Target& target, bool increasing, int count, int mandatory) const;
  void planNumeric(Transition& next, const Target& target, bool increasing, int count, int mandatory) const;
  void apply(double elapsed);
  /// The flash and the pop follow the clock, not the transition: they keep
  /// fading after a roll has finished or a snap had none.
  void applyEffects(double now);
  void finish();
  void cancelReveal();
  void planReels();
  void planMilestones();
  void applyReveal(double elapsed);
  void applyRevealCount(double elapsed);
  void applyRevealSpin(double elapsed);
  /// A punch `tau` seconds after its kick: one overshoot peaking at `overshoot`, then settling.
  static double punch(double tau, double overshoot);
  /// One tally run: constant-rate count with a ramp in and a brake out.
  static double tally(double t, double rampIn, double rampOut);
  double ease(double t) const;
  /// The curve used when re-targeting mid-roll: the ease-in curves collapse to
  /// their ease-out / linear counterparts so a wheel in motion never stalls.
  double easeFromMotion(double t) const;
  static double spring(double t, double bounce);
  static double wrap(double x);
  static int digitCount(uint64_t n);

  // configuration
  int fractionDigits_ = 0;
  int minimumIntegerDigits_ = 1;
  double duration_ = 0.5;
  int easing_ = 3;
  double bounce_ = 0.15;
  double stagger_ = 0;
  int direction_ = 0;
  int transitionStyle_ = 0;
  double flashSeconds_ = 0;
  double popOnChange_ = 0;
  bool reduceMotion_ = false;
  double revealDuration_ = 2.2;
  double revealBounce_ = 0.12;
  int revealStyle_ = 0;
  double revealStagger_ = 0.2;
  double revealGrow_ = 0.2;
  std::vector<double> revealMilestones_;
  double revealMilestoneHold_ = 0;

  // state
  std::vector<Wheel> wheels_;
  double signFactor_ = 0;
  bool hasShownValue_ = false;
  double targetValue_ = 0;
  Target target_{0, false, 1};
  int settledPowerCount_ = 1;
  bool settledNegative_ = false;
  Transition transition_;
  Reveal reveal_;
  double revealScale_ = 1;
  /// Per wheel (least significant first), kept across transitions.
  std::vector<Flash> flashes_;
  double popStart_ = -1;
  double popScale_ = 1;
  /// The clock of the last `tick`, for `needsFrames` on the effects.
  double lastNow_ = 0;
  bool effectsActive_ = false;

  bool loading_ = false;
  double loadingProgress_ = 0;
  bool loadingFadeActive_ = false;
  double loadingFadeFrom_ = 0;
  double loadingFadeStart_ = 0;
  double shimmerStart_ = 0;
};

} // namespace margelo::nitro::nitrorollingnumber
