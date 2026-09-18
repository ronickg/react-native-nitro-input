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
  /// Advances the roll and the loading fade to `now`. Returns `needsFrames()`.
  bool tick(double now);
  /// Back to the pristine state (view recycling).
  void reset();

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
  };

  Target makeTarget(double value) const;
  void snap(const Target& target);
  void settle(const Target& target);
  void apply(double elapsed);
  void finish();
  double ease(double t) const;
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

  // state
  std::vector<Wheel> wheels_;
  double signFactor_ = 0;
  bool hasShownValue_ = false;
  double targetValue_ = 0;
  Target target_{0, false, 1};
  int settledPowerCount_ = 1;
  bool settledNegative_ = false;
  Transition transition_;

  bool loading_ = false;
  double loadingProgress_ = 0;
  bool loadingFadeActive_ = false;
  double loadingFadeFrom_ = 0;
  double loadingFadeStart_ = 0;
  double shimmerStart_ = 0;
};

} // namespace margelo::nitro::nitrorollingnumber
