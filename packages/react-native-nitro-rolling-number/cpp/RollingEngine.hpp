//
//  RollingEngine.hpp
//  NitroRollingNumber
//
//  The platform-independent state machine behind the rolling number view.
//  Both native views (RollingNumberView.swift, RollingNumberView.kt) feed it
//  values and time, and draw whatever it reports: one "wheel" per digit with a
//  continuous position on a 0–9 strip, the sign factor, the loading fade and
//  the shimmer phase. No rendering, no fonts, no threading in here.
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
  };

  // Easing: 0 linear, 1 easeIn, 2 easeOut, 3 easeInOut, 4 spring.
  // Direction: 0 auto (sign of the change), 1 up, 2 down.

  RollingEngine();

  // MARK: Configuration

  /// Digits after the decimal separator (0…9) and zero-padding of the integer
  /// part (1…15). Snaps to the current target when they change.
  void setFormat(int fractionDigits, int minimumIntegerDigits);
  void setTiming(double durationSeconds, int easing, double bounce, double staggerSeconds, int direction);
  /// Reduce Motion / "remove animations": rolls snap and the shimmer freezes.
  void setReduceMotion(bool reduceMotion);

  // MARK: Commands

  /// Shows `value` immediately with continuously positioned wheels (odometer
  /// carry rule). Cancels any running roll.
  void setValue(double value);
  /// Rolls every wheel to `value` (shortest path in the roll direction,
  /// blank↔digit for appearing/disappearing wheels). Snaps when nothing has
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
  // - Style 0, count (the win-meter rollup): the figure opens at 0 and counts
  //   itself up to the target in one decelerating sweep, exponential in value
  //   so tens, hundreds and thousands each get the same screen time. Digits
  //   swap in place (the count's own speed is the animation, there is no
  //   roll) and leading digits appear as the count reaches their place; the
  //   layout is the target's from the first frame, so nothing reflows.
  // - Style 1, spin (the jackpot reels): every digit spins like a slot reel,
  //   then the reels brake and lock one at a time from the left, each with a
  //   small mechanical bounce, the last one landing at the duration.

  /// Timing of a reveal: the total duration, the landing pop's peak overshoot
  /// (`0` = no pop), the style (0 count, 1 spin) and, for the spin style, the
  /// delay between reel stops (shortened when the reels don't fit the
  /// duration). Defaults: 2.2 s, 0.07, count, 0.2 s.
  void setRevealTiming(double durationSeconds, double bounce, int style, double staggerSeconds);
  /// Shows the opening frame of a reveal for `value`: its layout with the
  /// mandatory digits at 0 and every other digit blank ("$0", "$0.00").
  /// Cancels any roll.
  void holdReveal(double value);
  /// Counts from 0 up to `value`. Snaps when the duration is 0 or Reduce
  /// Motion is on. Called while a reveal is running it re-targets the count.
  void reveal(double value, double now);
  /// True while a reveal counts or its landing pop rings out.
  bool isRevealing() const { return reveal_.active; }
  /// Scale of the landing pop, about the figure's centre; 1 when idle.
  double revealScale() const { return revealScale_; }
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
    std::vector<WheelTransition> wheels;
    double signFrom = 0;
    double signTo = 0;
    std::vector<Wheel> finals;
    /// True when this roll re-targeted wheels that were already moving. Such a
    /// roll skips the ease-in half of the curve so rapid updates keep flowing
    /// instead of restarting from rest on every call.
    bool fromMotion = false;
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
  void apply(double elapsed);
  void finish();
  void cancelReveal();
  void planReels();
  void planMilestones();
  void applyReveal(double elapsed);
  void applyRevealCount(double elapsed);
  void applyRevealSpin(double elapsed);
  /// The spring impulse of a punch `tau` seconds after it was kicked, scaled to peak at `overshoot`.
  static double punch(double tau, double overshoot);
  /// The reveal's count as a fraction of the target at clock fraction `t`.
  static double revealFraction(double t, double magnitude);
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
  bool reduceMotion_ = false;
  double revealDuration_ = 2.2;
  double revealBounce_ = 0.07;
  int revealStyle_ = 0;
  double revealStagger_ = 0.2;
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

  bool loading_ = false;
  double loadingProgress_ = 0;
  bool loadingFadeActive_ = false;
  double loadingFadeFrom_ = 0;
  double loadingFadeStart_ = 0;
  double shimmerStart_ = 0;
};

} // namespace margelo::nitro::nitrorollingnumber
