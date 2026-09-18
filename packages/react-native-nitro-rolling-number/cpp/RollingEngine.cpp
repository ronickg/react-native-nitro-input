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

// Jackpot reveal. The count multiplies by `spread` across the sweep (capped by
// the target's own size so a small figure counts near-linearly instead of
// dwelling on single digits). The landing is the impulse response of an
// underdamped spring (damping ratio ≈ 0.42), rung out over the tail.
constexpr double kRevealSpread = 200;
constexpr double kRevealSpreadMin = 2;
constexpr double kRevealStiffness = 170;
constexpr double kRevealDamping = 11;
constexpr double kRevealTailSeconds = 0.8;
/// A milestone punch relative to the landing pop.
constexpr double kMilestonePunch = 0.75;

// Spin-style reels. A reel free-spins at `kReelSpeed` digits per second, the
// brake takes `kReelBrakeSeconds` to bring it from full speed to a standstill
// exactly on its digit (a Hermite curve with the spin velocity going in and
// zero coming out, over 4–14 digits of travel so it only ever decelerates),
// and the lock overshoots by `kReelBounceDigits` for `kReelBounceSeconds`,
// the mechanical clunk of a reel catching its stop. The first reel locks no
// earlier than `kReelMinLead` of the duration so every reel is seen spinning.
constexpr double kReelSpeed = 24;
constexpr double kReelBrakeSeconds = 0.5;
constexpr double kReelBounceDigits = 0.15;
constexpr double kReelBounceSeconds = 0.2;
constexpr double kReelMinLead = 0.3;

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
    if (reveal_.holding) {
      holdReveal(targetValue_);
    } else {
      snap(makeTarget(targetValue_));
    }
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
  cancelReveal();
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
  cancelReveal();
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
  next.fromMotion = transition_.active;
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
  cancelReveal();
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

// MARK: - Jackpot reveal

void RollingEngine::setRevealTiming(double durationSeconds, double bounce, int style, double staggerSeconds) {
  revealDuration_ = std::max(0.0, durationSeconds);
  revealBounce_ = clamp01(bounce);
  revealStyle_ = style == 1 ? 1 : 0;
  revealStagger_ = std::max(0.0, staggerSeconds);
}

double RollingEngine::revealTotalSeconds() const {
  const double popTail = revealBounce_ > 0 ? kRevealTailSeconds : 0;
  const double reelTail = revealStyle_ == 1 ? kReelBounceSeconds : 0;
  const double holds = revealStyle_ == 1 ? 0 : revealMilestoneHold_ * static_cast<double>(reveal_.milestoneTimes.size());
  return revealDuration_ + holds + std::max(popTail, reelTail);
}

void RollingEngine::clearRevealMilestones() {
  revealMilestones_.clear();
}

void RollingEngine::addRevealMilestone(double value) {
  if (std::isfinite(value)) {
    revealMilestones_.push_back(value);
  }
}

void RollingEngine::setRevealMilestoneHold(double holdSeconds) {
  revealMilestoneHold_ = std::max(0.0, holdSeconds);
}

double RollingEngine::revealMilestoneValue(int index) const {
  if (index < 0 || index >= static_cast<int>(reveal_.milestoneMagnitudes.size())) {
    return 0;
  }
  return reveal_.milestoneMagnitudes[static_cast<size_t>(index)] / static_cast<double>(kPow10[fractionDigits_]);
}

/// Stops a reveal. `milestonesReached` survives so the view can still see a
/// milestone that was reached on the reveal's very last tick.
void RollingEngine::cancelReveal() {
  reveal_.active = false;
  reveal_.counting = false;
  reveal_.holding = false;
  revealScale_ = 1;
}

double RollingEngine::punch(double tau, double overshoot) {
  if (tau <= 0 || overshoot <= 0) {
    return 0;
  }
  const double a = kRevealDamping / 2;
  const double wd = std::sqrt(kRevealStiffness - a * a);
  // Scale the kick so the first peak overshoots by exactly `overshoot`.
  const double peakTau = std::atan(wd / a) / wd;
  const double peakGain = std::exp(-a * peakTau) * std::sin(wd * peakTau) / wd;
  const double kick = overshoot / peakGain;
  return kick * std::exp(-a * tau) * std::sin(wd * tau) / wd;
}

/// Resolves the milestones for the target. Like a slot's tiered rollup, the
/// count then runs tier by tier: every tier gets an equal share of the
/// duration whatever its size (the counter simply runs faster in a bigger
/// tier), decelerates into its milestone, punches, pauses for the hold and
/// accelerates again into the next one.
void RollingEngine::planMilestones() {
  reveal_.milestoneMagnitudes.clear();
  reveal_.milestoneTimes.clear();
  reveal_.milestonesReached = 0;
  const double magnitude = static_cast<double>(reveal_.target.magnitude);
  if (magnitude <= 0 || revealDuration_ <= 0 || reduceMotion_) {
    return;
  }
  std::vector<double> sorted = revealMilestones_;
  std::sort(sorted.begin(), sorted.end());
  for (double value : sorted) {
    const double m = std::round(std::fabs(value) * static_cast<double>(kPow10[fractionDigits_]));
    if (m <= 0 || m >= magnitude) {
      continue;
    }
    if (!reveal_.milestoneMagnitudes.empty() && m <= reveal_.milestoneMagnitudes.back()) {
      continue;
    }
    reveal_.milestoneMagnitudes.push_back(m);
  }
  const double segment = revealDuration_ / static_cast<double>(reveal_.milestoneMagnitudes.size() + 1);
  for (size_t i = 0; i < reveal_.milestoneMagnitudes.size(); i++) {
    reveal_.milestoneTimes.push_back(segment * static_cast<double>(i + 1));
  }
}

void RollingEngine::holdReveal(double value) {
  transition_.active = false;
  cancelReveal();
  targetValue_ = value;
  hasShownValue_ = true;
  reveal_.holding = true;
  reveal_.milestonesReached = 0;
  reveal_.milestoneTimes.clear();
  reveal_.milestoneMagnitudes.clear();
  reveal_.target = makeTarget(value);
  reveal_.start = 0;
  applyReveal(0);
  settle(reveal_.target);
}

void RollingEngine::reveal(double value, double now) {
  transition_.active = false;
  targetValue_ = value;
  const Target target = makeTarget(value);
  if (revealDuration_ <= 0 || reduceMotion_) {
    snap(target);
    return;
  }
  if (!reveal_.active) {
    reveal_.start = now;
  }
  reveal_.active = true;
  reveal_.holding = false;
  reveal_.target = target;
  reveal_.milestonesReached = 0;
  reveal_.milestoneTimes.clear();
  reveal_.milestoneMagnitudes.clear();
  hasShownValue_ = true;
  if (revealStyle_ == 1) {
    planReels();
  } else {
    planMilestones();
  }
  applyReveal(now - reveal_.start);
  settle(target);
}

/// Lays out the spin-style reels: stop times from the left, then for each reel
/// the brake window and the braking distance that ends on its digit.
void RollingEngine::planReels() {
  const Target& target = reveal_.target;
  const int count = target.powerCount;
  // Reel k (from the left) locks at lead + k * stagger; the stagger shrinks
  // when the reels wouldn't fit, and the lead is at least kReelMinLead.
  double stagger = revealStagger_;
  const double room = revealDuration_ * (1 - kReelMinLead);
  if (count > 1 && stagger * (count - 1) > room) {
    stagger = room / (count - 1);
  }
  const double lead = revealDuration_ - stagger * (count - 1);
  reveal_.reels.assign(static_cast<size_t>(count), Reel{});
  for (int k = 0; k < count; k++) {
    Reel& reel = reveal_.reels[static_cast<size_t>(k)];
    const int power = count - 1 - k;
    // Different starting digits per reel, so the spinning columns don't move in unison.
    reel.phase = std::fmod(static_cast<double>(k) * 3.7 + 0.5, 10.0);
    reel.stop = lead + stagger * k;
    reel.brakeStart = std::max(0.0, reel.stop - kReelBrakeSeconds);
    reel.from = reel.phase + kReelSpeed * reel.brakeStart;
    // Brake over the occurrence of the digit 4–14 strip positions ahead: with
    // 12 digits of free travel per brake window the curve never reverses.
    const double digit = static_cast<double>(target.digit(power));
    double travel = wrap(digit - reel.from);
    if (travel < 4) {
      travel += 10;
    }
    reel.travel = travel;
  }
}

/// Clock fraction → value fraction: exponential growth (a straight line in
/// magnitude, so the count multiplies at a steady rate) on a quad-eased clock,
/// so the multiplication decelerates into the target.
double RollingEngine::revealFraction(double t, double magnitude) {
  if (t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  const double spread = std::min(kRevealSpread, std::max(kRevealSpreadMin, magnitude / 10));
  const double eased = 1 - (1 - t) * (1 - t);
  return (std::pow(spread, eased) - 1) / (spread - 1);
}

void RollingEngine::applyReveal(double elapsed) {
  const bool spin = revealStyle_ == 1 && !reveal_.holding;
  // The landing bounce: a velocity kick at the settle, rung out by the spring.
  // Closed form, so the whole timeline is a pure function of the clock.
  double scale = 1;
  if (spin) {
    applyRevealSpin(elapsed);
    reveal_.counting = elapsed < revealDuration_;
    scale += punch(elapsed - revealDuration_, revealBounce_);
  } else {
    applyRevealCount(elapsed);
    // Each milestone punches when reached; the count has finished once the
    // curve and every hold are behind us.
    const double hold = revealMilestoneHold_;
    const size_t reached = static_cast<size_t>(reveal_.milestonesReached);
    for (size_t i = 0; i < reached; i++) {
      const double wall = reveal_.milestoneTimes[i] + hold * static_cast<double>(i);
      scale += punch(elapsed - wall, revealBounce_ * kMilestonePunch);
    }
    const double end = revealDuration_ + hold * static_cast<double>(reveal_.milestoneTimes.size());
    reveal_.counting = elapsed < end;
    scale += punch(elapsed - end, revealBounce_);
  }
  signFactor_ = reveal_.target.negative ? 1.0 : 0.0;
  revealScale_ = scale;
}

void RollingEngine::applyRevealCount(double elapsed) {
  const Target& target = reveal_.target;
  const double magnitude = static_cast<double>(target.magnitude);

  // Wall time → curve time: the clock stands still on each milestone for the
  // hold, and the count sits exactly on the milestone meanwhile.
  double curve = elapsed;
  int reached = 0;
  double heldAt = -1;
  const double hold = revealMilestoneHold_;
  for (size_t i = 0; i < reveal_.milestoneTimes.size(); i++) {
    const double wall = reveal_.milestoneTimes[i] + hold * static_cast<double>(i);
    if (elapsed < wall) {
      break;
    }
    reached = static_cast<int>(i) + 1;
    const double consumed = std::min(hold, elapsed - wall);
    curve -= consumed;
    if (consumed < hold) {
      heldAt = reveal_.milestoneMagnitudes[i];
    }
  }
  reveal_.milestonesReached = std::max(reveal_.milestonesReached, reached);

  // The count. Without milestones, one exponential sweep from 0 (see
  // revealFraction). With them, one tier at a time: the first opens from 0 on
  // that same sweep, the others run linearly in value on an ease-in-out clock,
  // so the counter accelerates out of a milestone and decelerates into the next.
  double count;
  if (heldAt >= 0) {
    count = heldAt;
  } else {
    const size_t tiers = reveal_.milestoneMagnitudes.size() + 1;
    const double segment = revealDuration_ > 0 ? revealDuration_ / static_cast<double>(tiers) : 0;
    size_t tier = segment > 0 ? static_cast<size_t>(std::floor(curve / segment)) : tiers - 1;
    tier = std::min(tier, tiers - 1);
    const double u = segment > 0 ? clamp01((curve - segment * static_cast<double>(tier)) / segment) : 1.0;
    const double lo = tier == 0 ? 0 : reveal_.milestoneMagnitudes[tier - 1];
    const double hi = tier == tiers - 1 ? magnitude : reveal_.milestoneMagnitudes[tier];
    if (tier == 0) {
      // ceil, not floor: the count leaves 0 on its first moving frame instead
      // of holding a small target frozen through the curve's slow opening.
      count = std::ceil(hi * revealFraction(u, hi));
    } else {
      const double eased = u < 0.5 ? 4 * u * u * u : 1 - std::pow(-2 * u + 2, 3) / 2;
      count = std::min(hi, std::ceil(lo + (hi - lo) * eased));
    }
  }
  const int mandatory = std::min(kMaxPowerCount, minimumIntegerDigits_ + fractionDigits_);
  const size_t powerCount = static_cast<size_t>(target.powerCount);

  wheels_.resize(powerCount);
  for (size_t power = 0; power < powerCount; power++) {
    const double p10 = static_cast<double>(kPow10[power]);
    // A digit left of the count's leading digit stays blank (no leading zeros),
    // except the mandatory fraction / zero-padded digits.
    const bool hidden = static_cast<int>(power) >= mandatory && count < p10;
    if (hidden) {
      wheels_[power] = Wheel{-1.0, 0.0, true, false};
    } else {
      wheels_[power] = Wheel{std::fmod(std::floor(count / p10), 10.0), 1.0, false, false};
    }
  }
}

void RollingEngine::applyRevealSpin(double elapsed) {
  const size_t powerCount = static_cast<size_t>(reveal_.target.powerCount);
  if (reveal_.reels.size() != powerCount) {
    planReels();
  }
  wheels_.resize(powerCount);
  for (size_t power = 0; power < powerCount; power++) {
    const Reel& reel = reveal_.reels[powerCount - 1 - power];
    double position;
    if (elapsed < reel.brakeStart) {
      position = reel.phase + kReelSpeed * elapsed;
    } else if (elapsed < reel.stop) {
      // Cubic Hermite from full speed to a standstill on the digit.
      const double window = reel.stop - reel.brakeStart;
      const double s = window > 0 ? clamp01((elapsed - reel.brakeStart) / window) : 1.0;
      const double v = kReelSpeed * window;
      const double d = reel.travel;
      position = reel.from + v * s + (3 * d - 2 * v) * s * s + (v - 2 * d) * s * s * s;
    } else {
      // Locked, with the catch's bounce: past the digit and back.
      const double tau = elapsed - reel.stop;
      position = reel.from + reel.travel;
      if (tau < kReelBounceSeconds) {
        position += kReelBounceDigits * std::sin(kPi * tau / kReelBounceSeconds);
      }
    }
    wheels_[power] = Wheel{position, 1.0, false, false};
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
    const double t = tr.fromMotion ? easeFromMotion(raw) : ease(raw);
    Wheel& w = wheels_[i];
    w.position = wt.from.position + (wt.to.position - wt.from.position) * t;
    w.width = clamp01(wt.from.width + (wt.to.width - wt.from.width) * t);
    w.linear = wt.from.linear;
    w.blankZero = wt.from.blankZero;
  }
  const double signRaw = tr.duration > 0 ? clamp01(elapsed / tr.duration) : 1.0;
  const double signT = tr.fromMotion ? easeFromMotion(signRaw) : ease(signRaw);
  signFactor_ = clamp01(tr.signFrom + (tr.signTo - tr.signFrom) * signT);
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
  if (reveal_.active) {
    const double elapsed = now - reveal_.start;
    if (elapsed >= revealTotalSeconds()) {
      const Target target = reveal_.target;
      snap(target);
    } else {
      applyReveal(elapsed);
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
  return transition_.active || reveal_.active || loadingFadeActive_ || sweeping;
}

bool RollingEngine::isRolling() const {
  return transition_.active || reveal_.counting;
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

double RollingEngine::easeFromMotion(double t) const {
  switch (easing_) {
    case 0:
    case 1:
      return t;                      // linear / easeIn: keep the wheel moving at a steady pace
    case 4:
      return spring(t, bounce_);     // the spring already starts with velocity
    default:
      return 1 - std::pow(1 - t, 3); // easeOut / easeInOut: decelerate into the new target
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
  revealDuration_ = 2.2;
  revealBounce_ = 0.07;
  revealStyle_ = 0;
  revealStagger_ = 0.2;
  revealMilestones_.clear();
  revealMilestoneHold_ = 0;
  reveal_ = Reveal{};
  revealScale_ = 1;
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
