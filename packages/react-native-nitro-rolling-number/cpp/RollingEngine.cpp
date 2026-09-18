//
//  RollingEngine.cpp
//  NitroRollingNumber
//

#include "RollingEngine.hpp"

#include <algorithm>
#include <cmath>

namespace margelo::nitro::nitrorollingnumber {

namespace {

constexpr int kMaxPowerCount = 18;
constexpr double kLoadingFadeSeconds = 0.25;
constexpr double kPi = 3.14159265358979323846;

const uint64_t kPow10[20] = {
    1ULL,
    10ULL,
    100ULL,
    1000ULL,
    10000ULL,
    100000ULL,
    1000000ULL,
    10000000ULL,
    100000000ULL,
    1000000000ULL,
    10000000000ULL,
    100000000000ULL,
    1000000000000ULL,
    10000000000000ULL,
    100000000000000ULL,
    1000000000000000ULL,
    10000000000000000ULL,
    100000000000000000ULL,
    1000000000000000000ULL,
    10000000000000000000ULL,
};

double clamp01(double x) {
  return std::min(1.0, std::max(0.0, x));
}

} // namespace

// MARK: - Target

int RollingEngine::Target::digit(int power) const {
  if (power < 0 || power >= 20) {
    return 0;
  }
  return static_cast<int>((magnitude / kPow10[power]) % 10);
}

RollingEngine::RollingEngine() = default;

int RollingEngine::digitCount(uint64_t n) {
  int count = 1;
  while (n >= 10) {
    n /= 10;
    count += 1;
  }
  return count;
}

double RollingEngine::wrap(double x) {
  double r = std::fmod(x, 10.0);
  return r < 0 ? r + 10.0 : r;
}

RollingEngine::Target RollingEngine::makeTarget(double value) const {
  double scaled = std::round(std::fabs(value) * static_cast<double>(kPow10[fractionDigits_]));
  if (!std::isfinite(scaled)) {
    scaled = 0;
  }
  uint64_t magnitude = static_cast<uint64_t>(std::min(scaled, 1e17));
  uint64_t integerPart = magnitude / kPow10[fractionDigits_];
  int intDigits = std::max(minimumIntegerDigits_, digitCount(integerPart));
  return Target{magnitude, value < 0 && magnitude > 0, std::min(kMaxPowerCount, intDigits + fractionDigits_)};
}

void RollingEngine::settle(const Target& target) {
  target_ = target;
  settledPowerCount_ = target.powerCount;
  settledNegative_ = target.negative;
}

// MARK: - Configuration

void RollingEngine::setFormat(int fractionDigits, int minimumIntegerDigits) {
  int fd = std::min(9, std::max(0, fractionDigits));
  int minInt = std::min(15, std::max(1, minimumIntegerDigits));
  if (fd == fractionDigits_ && minInt == minimumIntegerDigits_) {
    return;
  }
  fractionDigits_ = fd;
  minimumIntegerDigits_ = minInt;
  if (hasShownValue_) {
    snap(makeTarget(targetValue_));
  }
}

void RollingEngine::setTiming(double durationSeconds, int easing, double bounce, double staggerSeconds, int direction) {
  duration_ = std::max(0.0, durationSeconds);
  easing_ = easing;
  bounce_ = bounce;
  stagger_ = std::max(0.0, staggerSeconds);
  direction_ = direction;
}

void RollingEngine::setReduceMotion(bool reduceMotion) {
  reduceMotion_ = reduceMotion;
}

// MARK: - Commands

void RollingEngine::setValue(double value) {
  transition_.active = false;
  targetValue_ = value;
  hasShownValue_ = true;

  const int fd = fractionDigits_;
  double scaled = std::fabs(value) * static_cast<double>(kPow10[fd]);
  if (!std::isfinite(scaled)) {
    scaled = 0;
  }
  scaled = std::min(scaled, 1e15);
  const double whole = std::floor(scaled);
  const uint64_t integerPart = static_cast<uint64_t>(whole) / kPow10[fd];
  const int needed = std::min(kMaxPowerCount, std::max(minimumIntegerDigits_, digitCount(integerPart)) + fd);

  wheels_.clear();
  wheels_.reserve(static_cast<size_t>(needed) + 1);
  for (int power = 0; power <= needed; power++) {
    const double p10 = static_cast<double>(kPow10[power]);
    const double digit = std::fmod(std::floor(scaled / p10), 10.0);
    double carry;
    if (power == 0) {
      carry = scaled - whole;
    } else {
      // A wheel only turns while every lower wheel is on its way from 9 to 0.
      carry = clamp01(std::fmod(scaled, p10) - (p10 - 1));
    }
    if (power == needed) {
      // The next higher wheel emerges (blank → 1) while the carry is in progress.
      if (carry <= 0) {
        break;
      }
      wheels_.push_back(Wheel{carry, carry, false, true});
    } else {
      wheels_.push_back(Wheel{digit + carry, 1.0, false, false});
    }
  }
  signFactor_ = value < 0 ? std::min(1.0, scaled) : 0.0;
  Target target = makeTarget(value);
  target.powerCount = static_cast<int>(wheels_.size());
  target.negative = value < 0;
  settle(target);
}

void RollingEngine::animateTo(double value, double now) {
  const double previous = targetValue_;
  targetValue_ = value;
  const Target target = makeTarget(value);
  if (!hasShownValue_ || duration_ <= 0 || reduceMotion_) {
    snap(target);
    return;
  }

  bool increasing;
  switch (direction_) {
    case 1:
      increasing = true;
      break;
    case 2:
      increasing = false;
      break;
    default:
      increasing = value >= previous;
      break;
  }
  const int mandatory = minimumIntegerDigits_ + fractionDigits_;
  const int currentCount = static_cast<int>(wheels_.size());
  const int count = std::max(currentCount, target.powerCount);

  Transition next;
  next.active = true;
  next.start = now;
  next.duration = duration_;
  next.wheels.reserve(static_cast<size_t>(count));
  next.finals.reserve(static_cast<size_t>(target.powerCount));
  next.delays.reserve(static_cast<size_t>(count));

  for (int power = 0; power < count; power++) {
    const Wheel current = power < currentCount ? wheels_[static_cast<size_t>(power)] : Wheel{-1.0, 0.0, true, false};
    Wheel from = current;
    Wheel to;
    if (power < target.powerCount) {
      const double digit = static_cast<double>(target.digit(power));
      const bool isEdge = power >= mandatory && (power >= currentCount || current.width < 1.0 || current.linear || current.blankZero);
      if (isEdge) {
        // Appearing (or still appearing) wheel: linear strip blank → digit.
        if (!current.linear) {
          from.position = wrap(current.position);
        }
        from.linear = true;
        to = Wheel{digit, 1.0, true, current.blankZero};
      } else {
        // Interior wheel: shortest roll in the direction of the change.
        const double base = wrap(current.position);
        from.position = base;
        from.linear = false;
        const double delta = increasing ? wrap(digit - base) : -wrap(base - digit);
        to = Wheel{base + delta, 1.0, false, false};
      }
      next.finals.push_back(Wheel{digit, 1.0, false, false});
    } else {
      // Disappearing wheel: roll down to blank while shrinking.
      if (!current.linear) {
        from.position = wrap(current.position);
      }
      from.linear = true;
      to = Wheel{-1.0, 0.0, true, current.blankZero};
    }
    next.wheels.push_back(WheelTransition{from, to});

    // Stagger: wheel i normally starts `stagger * i` late. When re-targeting
    // mid-roll, a wheel that hasn't started yet keeps its original start time
    // instead of being pushed back again, so rapid updates can't starve it.
    double delay = stagger_ * static_cast<double>(power);
    if (transition_.active && power < static_cast<int>(transition_.delays.size())) {
      const double pending = std::max(0.0, (transition_.start + transition_.delays[static_cast<size_t>(power)]) - now);
      delay = std::min(delay, pending);
    }
    next.delays.push_back(delay);
  }
  next.signFrom = signFactor_;
  next.signTo = target.negative ? 1.0 : 0.0;

  transition_ = std::move(next);
  apply(0);
  settle(target);
}

void RollingEngine::snap(const Target& target) {
  transition_.active = false;
  wheels_.clear();
  wheels_.reserve(static_cast<size_t>(target.powerCount));
  for (int power = 0; power < target.powerCount; power++) {
    wheels_.push_back(Wheel{static_cast<double>(target.digit(power)), 1.0, false, false});
  }
  signFactor_ = target.negative ? 1.0 : 0.0;
  hasShownValue_ = true;
  settle(target);
}

void RollingEngine::setLoading(bool loading, double now) {
  if (loading == loading_) {
    return;
  }
  loading_ = loading;
  loadingFadeFrom_ = loadingProgress_;
  loadingFadeStart_ = now;
  loadingFadeActive_ = true;
  if (loading) {
    shimmerStart_ = now;
  }
}

// MARK: - Animation

void RollingEngine::apply(double elapsed) {
  const Transition& tr = transition_;
  if (wheels_.size() != tr.wheels.size()) {
    wheels_.resize(tr.wheels.size());
    for (size_t i = 0; i < tr.wheels.size(); i++) {
      wheels_[i] = tr.wheels[i].from;
    }
  }
  for (size_t i = 0; i < tr.wheels.size(); i++) {
    const WheelTransition& wt = tr.wheels[i];
    const double delay = i < tr.delays.size() ? tr.delays[i] : 0;
    const double raw = tr.duration > 0 ? clamp01((elapsed - delay) / tr.duration) : 1.0;
    const double t = ease(raw);
    Wheel& w = wheels_[i];
    w.position = wt.from.position + (wt.to.position - wt.from.position) * t;
    w.width = clamp01(wt.from.width + (wt.to.width - wt.from.width) * t);
    w.linear = wt.from.linear;
    w.blankZero = wt.from.blankZero;
  }
  const double signRaw = tr.duration > 0 ? clamp01(elapsed / tr.duration) : 1.0;
  signFactor_ = clamp01(tr.signFrom + (tr.signTo - tr.signFrom) * ease(signRaw));
}

void RollingEngine::finish() {
  wheels_ = transition_.finals;
  signFactor_ = transition_.signTo;
  transition_.active = false;
}

bool RollingEngine::tick(double now) {
  if (transition_.active) {
    const double elapsed = now - transition_.start;
    double maxDelay = 0;
    for (double d : transition_.delays) {
      maxDelay = std::max(maxDelay, d);
    }
    if (elapsed >= transition_.duration + maxDelay) {
      finish();
    } else {
      apply(elapsed);
    }
  }
  if (loadingFadeActive_) {
    const double target = loading_ ? 1.0 : 0.0;
    const double t = clamp01((now - loadingFadeStart_) / kLoadingFadeSeconds);
    loadingProgress_ = loadingFadeFrom_ + (target - loadingFadeFrom_) * t;
    if (t >= 1) {
      loadingProgress_ = target;
      loadingFadeActive_ = false;
    }
  }
  return needsFrames();
}

bool RollingEngine::needsFrames() const {
  const bool sweeping = loadingProgress_ > 0 && !reduceMotion_;
  return transition_.active || loadingFadeActive_ || sweeping;
}

double RollingEngine::shimmerPhase(double now, double periodSeconds) const {
  if (reduceMotion_) {
    return 0;
  }
  const double period = std::max(0.2, periodSeconds);
  return std::fmod(std::max(0.0, now - shimmerStart_) / period, 1.0);
}

double RollingEngine::ease(double t) const {
  switch (easing_) {
    case 0:
      return t;
    case 1:
      return t * t * t;
    case 2:
      return 1 - std::pow(1 - t, 3);
    case 4:
      return spring(t, bounce_);
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - std::pow(-2 * t + 2, 3) / 2;
  }
}

/// Step response of a damped spring, normalised so it has settled at t == 1.
/// `bounce` maps to the damping ratio like SwiftUI's `.spring(duration:bounce:)`.
double RollingEngine::spring(double t, double bounce) {
  const double zeta = std::min(1.0, std::max(0.05, 1.0 - clamp01(bounce)));
  const double omega = 3.0 * kPi;
  const double k = zeta * omega;
  if (zeta >= 0.999) {
    return 1 - (1 + k * t) * std::exp(-k * t);
  }
  const double wd = omega * std::sqrt(1 - zeta * zeta);
  return 1 - std::exp(-k * t) * (std::cos(wd * t) + (k / wd) * std::sin(wd * t));
}

int RollingEngine::targetDigit(int power) const {
  return target_.digit(power);
}

void RollingEngine::reset() {
  fractionDigits_ = 0;
  minimumIntegerDigits_ = 1;
  duration_ = 0.5;
  easing_ = 3;
  bounce_ = 0.15;
  stagger_ = 0;
  direction_ = 0;
  wheels_.clear();
  signFactor_ = 0;
  hasShownValue_ = false;
  targetValue_ = 0;
  target_ = Target{0, false, 1};
  settledPowerCount_ = 1;
  settledNegative_ = false;
  transition_ = Transition{};
  loading_ = false;
  loadingProgress_ = 0;
  loadingFadeActive_ = false;
  loadingFadeFrom_ = 0;
  loadingFadeStart_ = 0;
  shimmerStart_ = 0;
}

} // namespace margelo::nitro::nitrorollingnumber
