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
/// Upper bound of |value| × 10^fractionDigits, shared by `setValue` and
/// `animateTo` so a jump and a roll to the same figure show the same digits.
/// 10^17 still fits the 18 wheels; beyond 2^53 a double has no exact integers
/// anyway.
constexpr double kMaxMagnitude = 1e17;
constexpr double kLoadingFadeSeconds = 0.25;
constexpr double kPi = 3.14159265358979323846;

// Jackpot reveal. The count is a slot's win tally, a rank at a time (US
// 9,495,843 sets seconds per win rank; US 9,111,423 derives the speed from
// the remaining count, so it slows into the final value, and shows the win
// meter enlarged during a big win's increment): the counter winds up out of
// the rank's start, runs at a constant rate (the low digits blur) and crawls
// into the rank's boundary so the milestone is readable as it lands.
// `kTallyRampIn` / `kTallyRampOut` are the fractions of a tier spent winding
// up and crawling; the final tier crawls longer. The figure grows over the
// count (`revealGrow_`), and every punch is one overshoot that settles back
// without ever dipping under the resting size (a spring that rang out under
// the size read as the figure shrinking): a pulse peaking `kPunchPeakSeconds`
// after the kick and gone by the tail.
constexpr double kTallyRampIn = 0.25;
constexpr double kTallyRampOut = 0.35;
constexpr double kTallyFinalRampOut = 0.45;
constexpr double kPunchPeakSeconds = 0.1;
constexpr double kRevealTailSeconds = 0.8;
/// A milestone punch relative to the landing pop.
constexpr double kMilestonePunch = 0.75;

// Spin-style reels. A reel free-spins at `kReelSpeed` digits per second, the
// brake takes `kReelBrakeSeconds` to bring it from full speed to a standstill
// exactly on its digit (a Hermite curve with the spin velocity going in and
// zero coming out, over 4–14 digits of travel so it only ever decelerates),
// and the lock overshoots by `kReelBounceDigits` for `kReelBounceSeconds`,
// the mechanical clunk of a reel catching its stop. The first reel locks no
// earlier than `kReelMinLead` of the duration so every reel is seen spinning,
// and the last locks a clunk short of the end so the whole figure is still by
// the duration — otherwise the rightmost reel hops on alone after every other
// digit has stopped, which reads as a glitch rather than as machinery.
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
  uint64_t magnitude = static_cast<uint64_t>(std::min(scaled, kMaxMagnitude));
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

void RollingEngine::setTransition(int transition) {
  transitionStyle_ = transition >= 0 && transition <= 2 ? transition : 0;
}

void RollingEngine::setFlash(double seconds) {
  flashSeconds_ = std::max(0.0, seconds);
}

void RollingEngine::setPopOnChange(double overshoot) {
  popOnChange_ = clamp01(overshoot);
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
  scaled = std::min(scaled, kMaxMagnitude);
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
  if (!hasShownValue_ || duration_ <= 0 || reduceMotion_) {
    // A snap changes the digits at once; the flash and the pop still say so.
    const bool first = !hasShownValue_;
    std::vector<int> before;
    for (const Wheel& w : wheels_) {
      before.push_back(shownGlyph(w));
    }
    snap(target);
    if (!first) {
      flashes_.resize(wheels_.size());
      for (size_t i = 0; i < wheels_.size(); i++) {
        const int was = i < before.size() ? before[i] : -1;
        if (was != shownGlyph(wheels_[i])) {
          flashes_[i] = Flash{now, 0, increasing};
        }
      }
      if (popOnChange_ > 0) {
        popStart_ = now;
      }
      applyEffects(now);
    }
    return;
  }
  const int mandatory = minimumIntegerDigits_ + fractionDigits_;
  const int currentCount = static_cast<int>(wheels_.size());
  const int count = std::max(currentCount, target.powerCount);

  Transition next;
  next.active = true;
  next.start = now;
  // The numeric transition rings its position spring out past the duration.
  next.duration = transitionStyle_ == 1 ? duration_ * kNumericTail : duration_;
  next.fromMotion = transition_.active;
  next.style = transitionStyle_;
  next.numeric = transitionStyle_ != 0;
  next.wheels.reserve(static_cast<size_t>(count));
  next.finals.reserve(static_cast<size_t>(target.powerCount));
  next.delays.reserve(static_cast<size_t>(count));

  if (next.numeric) {
    planNumeric(next, target, increasing, count, mandatory);
  } else {
    planRoll(next, target, increasing, count, mandatory);
  }

  // Stagger: a roll cascades from the least significant wheel up, like a
  // carry. The numeric transition cascades from the leftmost digit to the
  // right, the way the effect moves on iOS, and only across the wheels that
  // change: a units digit ticking over does not wait for three columns that
  // stay put.
  std::vector<int> ranks(static_cast<size_t>(count), 0);
  int changing = 0;
  if (next.numeric) {
    for (int power = count - 1; power >= 0; power--) {
      if (next.wheels[static_cast<size_t>(power)].from.blend < 1) {
        ranks[static_cast<size_t>(power)] = changing++;
      }
    }
  } else {
    for (int power = 0; power < count; power++) {
      ranks[static_cast<size_t>(power)] = power;
    }
  }
  for (int power = 0; power < count; power++) {
    // When re-targeting mid-roll, a wheel that hasn't started yet keeps its
    // original start time instead of being pushed back again, so rapid
    // updates can't starve it.
    // A roll's stagger is per wheel; the numeric cascade's is the whole
    // span, shared out over the columns that change.
    double delay = next.numeric
        ? (changing > 1 ? stagger_ * static_cast<double>(ranks[static_cast<size_t>(power)]) / static_cast<double>(changing - 1) : 0.0)
        : stagger_ * static_cast<double>(ranks[static_cast<size_t>(power)]);
    if (transition_.active && power < static_cast<int>(transition_.delays.size())) {
      const double pending = std::max(0.0, (transition_.start + transition_.delays[static_cast<size_t>(power)]) - now);
      delay = std::min(delay, pending);
    }
    next.delays.push_back(delay);
    next.maxDelay = std::max(next.maxDelay, delay);
  }
  next.signFrom = signFactor_;
  next.signTo = target.negative ? 1.0 : 0.0;

  // The change flash lights every wheel whose glyph changes; the pop kicks once.
  flashes_.resize(static_cast<size_t>(count));
  bool anyChange = false;
  for (int power = 0; power < count; power++) {
    const WheelTransition& wt = next.wheels[static_cast<size_t>(power)];
    const bool changes = next.numeric ? wt.from.blend < 1 : (wt.from.position != wt.to.position || wt.from.width != wt.to.width);
    if (changes) {
      // Lit until the wheel has landed: its delay, then the transition.
      flashes_[static_cast<size_t>(power)] = Flash{now, next.delays[static_cast<size_t>(power)] + next.duration, increasing};
      anyChange = true;
    }
  }
  if (anyChange && popOnChange_ > 0) {
    popStart_ = now;
  }

  transition_ = std::move(next);
  apply(0);
  applyEffects(now);
  settle(target);
}

void RollingEngine::planRoll(Transition& next, const Target& target, bool increasing, int count, int mandatory) const {
  const int currentCount = static_cast<int>(wheels_.size());
  for (int power = 0; power < count; power++) {
    const Wheel current = power < currentCount ? wheels_[static_cast<size_t>(power)] : Wheel{-1.0, 0.0, true, false};
    Wheel from = current;
    // A wheel the numeric transition left mid-swap rolls on from the glyph it was arriving at.
    if (current.blend < 1) {
      from.position = std::max(0.0, current.toGlyph);
      from.linear = current.toGlyph < 0;
    }
    from.blend = 1;
    Wheel to;
    if (power < target.powerCount) {
      const double digit = static_cast<double>(target.digit(power));
      const bool isEdge = power >= mandatory && (power >= currentCount || current.width < 1.0 || from.linear || current.blankZero);
      if (isEdge) {
        // Appearing (or still appearing) wheel: linear strip blank → digit.
        if (!from.linear) {
          from.position = wrap(from.position);
        }
        from.linear = true;
        to = Wheel{digit, 1.0, true, current.blankZero};
      } else {
        // Interior wheel: shortest roll in the direction of the change.
        const double base = wrap(from.position);
        from.position = base;
        from.linear = false;
        const double delta = increasing ? wrap(digit - base) : -wrap(base - digit);
        to = Wheel{base + delta, 1.0, false, false};
      }
      next.finals.push_back(Wheel{digit, 1.0, false, false});
    } else {
      // Disappearing wheel: roll down to blank while shrinking.
      if (!from.linear) {
        from.position = wrap(from.position);
      }
      from.linear = true;
      to = Wheel{-1.0, 0.0, true, current.blankZero};
    }
    next.wheels.push_back(WheelTransition{from, to});
  }
}

int RollingEngine::shownGlyph(const Wheel& wheel) {
  if (wheel.blend < 1) {
    return static_cast<int>(wheel.toGlyph);
  }
  if (wheel.linear && wheel.position < -0.5) {
    return -1;
  }
  const int digit = static_cast<int>(std::llround(wrap(wheel.position))) % 10;
  if (wheel.blankZero && digit == 0) {
    return -1;
  }
  return digit;
}

void RollingEngine::planNumeric(Transition& next, const Target& target, bool increasing, int count, int mandatory) const {
  (void)mandatory;
  const int currentCount = static_cast<int>(wheels_.size());
  for (int power = 0; power < count; power++) {
    const Wheel current = power < currentCount ? wheels_[static_cast<size_t>(power)] : Wheel{-1.0, 0.0, true, false};
    // The glyph the wheel shows, or was arriving at when re-targeted: that is
    // the one that leaves now.
    const int showing = power < currentCount ? shownGlyph(current) : -1;
    Wheel from;
    Wheel to;
    from.width = current.width;
    from.fromGlyph = static_cast<double>(showing);
    // A value that grew moves the glyphs up (the new one arrives from below).
    from.fromAbove = !increasing;
    from.linear = false;
    from.blankZero = false;
    if (power < target.powerCount) {
      const int digit = target.digit(power);
      from.toGlyph = static_cast<double>(digit);
      from.position = static_cast<double>(digit);
      to = Wheel{static_cast<double>(digit), 1.0, false, false};
      next.finals.push_back(Wheel{static_cast<double>(digit), 1.0, false, false});
    } else {
      // Disappearing wheel: its glyph leaves and the column closes.
      from.toGlyph = -1;
      from.position = static_cast<double>(std::max(0, showing));
      to = Wheel{from.position, 0.0, false, false};
    }
    // A wheel whose glyph does not change is not part of the transition (it
    // may still be growing to full width).
    from.blend = showing == static_cast<int>(from.toGlyph) ? 1.0 : 0.0;
    next.wheels.push_back(WheelTransition{from, to});
  }
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
  const double holds = revealStyle_ == 1 ? 0 : revealMilestoneHold_ * static_cast<double>(reveal_.milestoneTimes.size());
  // The reels need no tail of their own: the last clunk ends on the duration.
  return revealDuration_ + holds + popTail;
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

/// One punch: rises to `overshoot` at kPunchPeakSeconds and eases back to
/// zero (x·e^(1−x)), never negative, ~2 % of the peak left at the tail.
double RollingEngine::punch(double tau, double overshoot) {
  if (tau <= 0 || overshoot <= 0) {
    return 0;
  }
  const double x = tau / kPunchPeakSeconds;
  return overshoot * x * std::exp(1 - x);
}

void RollingEngine::setRevealGrow(double grow) {
  revealGrow_ = clamp01(grow);
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
  // Reel k (from the left) locks at lead + k * stagger. The last one locks a
  // clunk short of the duration, so its bounce is spent by the time the figure
  // pops. The stagger shrinks when the reels wouldn't fit between the earliest
  // lead and that last lock; the lead is still at least kReelMinLead.
  const double last = std::max(0.0, revealDuration_ - kReelBounceSeconds);
  double stagger = revealStagger_;
  const double room = std::max(0.0, last - revealDuration_ * kReelMinLead);
  if (count > 1 && stagger * (count - 1) > room) {
    stagger = room / (count - 1);
  }
  const double lead = last - stagger * (count - 1);
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

/// Clock fraction → value fraction of one tally run. The counter's rate winds
/// up linearly over `rampIn`, holds steady, then falls off quadratically over
/// `rampOut`, so the count is linear in the middle like a slot's tally and
/// crawls the last stretch into its target instead of slamming into it.
double RollingEngine::tally(double t, double rampIn, double rampOut) {
  if (t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  const double area = rampIn / 2 + (1 - rampIn - rampOut) + rampOut / 3;
  double distance;
  if (t < rampIn) {
    distance = t * t / (2 * rampIn);
  } else if (t < 1 - rampOut) {
    distance = rampIn / 2 + (t - rampIn);
  } else {
    const double rest = 1 - t;
    distance = area - rest * rest * rest / (3 * rampOut * rampOut);
  }
  return distance / area;
}

void RollingEngine::applyReveal(double elapsed) {
  const bool spin = revealStyle_ == 1 && !reveal_.holding;
  // The scale: the figure's size as the count grows, times the punches. A
  // closed form of the clock, so the whole timeline is deterministic.
  double base = 1;
  double punches = 0;
  if (spin) {
    applyRevealSpin(elapsed);
    reveal_.counting = elapsed < revealDuration_;
    punches += punch(elapsed - revealDuration_, revealBounce_);
  } else {
    applyRevealCount(elapsed);
    // The figure opens smaller and grows with the tally, the way a big win's
    // meter is enlarged as it climbs; each milestone punches when reached and
    // the landing punches hardest. The count has finished once the curve and
    // every hold are behind us.
    const double hold = revealMilestoneHold_;
    const size_t reached = static_cast<size_t>(reveal_.milestonesReached);
    for (size_t i = 0; i < reached; i++) {
      const double wall = reveal_.milestoneTimes[i] + hold * static_cast<double>(i);
      punches += punch(elapsed - wall, revealBounce_ * kMilestonePunch);
    }
    const double end = revealDuration_ + hold * static_cast<double>(reveal_.milestoneTimes.size());
    reveal_.counting = elapsed < end;
    if (!reveal_.holding) {
      base = 1 - revealGrow_ * (1 - clamp01(end > 0 ? elapsed / end : 1.0));
    }
    punches += punch(elapsed - end, revealBounce_);
  }
  signFactor_ = reveal_.target.negative ? 1.0 : 0.0;
  revealScale_ = base * (1 + punches);
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

  // The count: a slot's tally. One tier at a time (the whole figure is one
  // tier without milestones), each running linearly in value at a constant
  // rate, winding up out of the tier's start and crawling into its end, so it
  // reads slow → fast → slow and lands squarely on every milestone. The
  // final tier crawls longer so the total is readable as it arrives.
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
    const double rampOut = tier == tiers - 1 ? kTallyFinalRampOut : kTallyRampOut;
    // ceil, not floor: the count leaves its start on the first moving frame.
    count = std::min(hi, std::ceil(lo + (hi - lo) * tally(u, kTallyRampIn, rampOut)));
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
  wheels_.resize(tr.wheels.size());
  for (size_t i = 0; i < tr.wheels.size(); i++) {
    const WheelTransition& wt = tr.wheels[i];
    const double delay = i < tr.delays.size() ? tr.delays[i] : 0;
    const double raw = tr.duration > 0 ? clamp01((elapsed - delay) / tr.duration) : 1.0;
    // The numeric transition's tail is only its position spring ringing out:
    // a column opens and closes over the duration itself.
    const double span = tr.style == 1 ? tr.duration / kNumericTail : tr.duration;
    const double rawSpan = span > 0 ? clamp01((elapsed - delay) / span) : 1.0;
    const double t = tr.fromMotion ? easeFromMotion(rawSpan) : ease(rawSpan);
    Wheel& w = wheels_[i];
    w.width = clamp01(wt.from.width + (wt.to.width - wt.from.width) * t);
    w.linear = wt.from.linear;
    w.blankZero = wt.from.blankZero;
    if (tr.numeric && wt.from.blend >= 1) {
      // A wheel whose glyph does not change (it may still be growing to full width).
      w.position = wt.from.position;
      w.fromGlyph = -1;
      w.toGlyph = -1;
      w.blend = 1;
      w.focus = 1;
      w.grow = 1;
    } else if (tr.style == 2) {
      // Scramble: a different digit every step until the wheel locks.
      const int from = static_cast<int>(wt.from.fromGlyph);
      const int to = static_cast<int>(wt.from.toGlyph);
      if (raw >= 1) {
        w.position = static_cast<double>(std::max(0, to));
      } else {
        const uint64_t step = static_cast<uint64_t>(std::max(0.0, elapsed - delay) / kScrambleStepSeconds);
        // A mixed hash of the step and the wheel (a plain multiply mod 10 is a counter).
        uint64_t h = step * 2654435761ULL + static_cast<uint64_t>(i) * 40503ULL + 7ULL;
        h ^= h >> 13;
        h *= 0x5bd1e995ULL;
        h ^= h >> 15;
        int glyph = static_cast<int>(h % 10);
        // Never sit on the digit the wheel is leaving or arriving at: it would read as a stall.
        while (glyph == from || glyph == to) {
          glyph = (glyph + 1) % 10;
        }
        w.position = static_cast<double>(glyph);
      }
      w.fromGlyph = -1;
      w.toGlyph = -1;
      w.blend = 1;
      w.focus = 1;
      w.grow = 1;
    } else if (tr.numeric) {
      // Numeric: the glyphs swap in place; the position is the digit
      // arriving and the three clocks say how far the swap is (see the header).
      w.position = wt.from.position;
      w.fromGlyph = wt.from.fromGlyph;
      w.toGlyph = wt.from.toGlyph;
      w.fromAbove = wt.from.fromAbove;
      if (raw >= 1 || tr.duration <= 0) {
        w.blend = 1;
        w.grow = 1;
        w.focus = 1;
        w.blurOut = 1;
      } else {
        const double local = std::max(0.0, elapsed - delay);
        const double d = tr.duration / kNumericTail;
        w.blend = damped(local, kNumericPositionZeta, d);
        w.grow = damped(local, 1.0, kNumericGrowSettle * d);
        w.focus = damped(local, kNumericFocusZeta, kNumericFocusSettle * d);
        w.blurOut = damped(local, 1.0, kNumericBlurOutSettle * d);
      }
    } else {
      w.position = wt.from.position + (wt.to.position - wt.from.position) * t;
      w.fromGlyph = -1;
      w.toGlyph = -1;
      w.blend = 1;
      w.focus = 1;
      w.grow = 1;
    }
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

void RollingEngine::applyEffects(double now) {
  lastNow_ = now;
  bool active = false;
  if (flashes_.size() < wheels_.size()) {
    flashes_.resize(wheels_.size());
  }
  for (size_t i = 0; i < wheels_.size(); i++) {
    Wheel& w = wheels_[i];
    const Flash& f = flashes_[i];
    if (flashSeconds_ <= 0 || f.start < 0) {
      w.flash = 0;
      continue;
    }
    // Lights at once, holds while the wheel moves, fades with a tail.
    const double lit = now - f.start;
    const double u = lit < f.hold ? 0 : clamp01((lit - f.hold) / flashSeconds_);
    w.flash = std::pow(1 - u, 1.5);
    w.flashUp = f.up;
    if (u < 1) {
      active = true;
    }
  }
  if (popStart_ >= 0 && popOnChange_ > 0) {
    const double tau = now - popStart_;
    const double p = punch(tau, popOnChange_);
    popScale_ = 1 + p;
    if (tau < kPunchPeakSeconds * 8) {
      active = true;
    } else {
      popScale_ = 1;
      popStart_ = -1;
    }
  } else {
    popScale_ = 1;
  }
  effectsActive_ = active;
}

bool RollingEngine::tick(double now) {
  if (transition_.active) {
    const double elapsed = now - transition_.start;
    if (elapsed >= transition_.duration + transition_.maxDelay) {
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
  applyEffects(now);
  return needsFrames();
}

bool RollingEngine::needsFrames() const {
  const bool sweeping = loadingProgress_ > 0 && !reduceMotion_;
  return transition_.active || reveal_.active || loadingFadeActive_ || sweeping || effectsActive_;
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

double RollingEngine::damped(double t, double zeta, double settle) {
  if (t <= 0 || settle <= 0) {
    return 0;
  }
  const double z = std::min(1.0, std::max(0.05, zeta));
  if (z >= 0.999) {
    // Critically damped: 1 - (1 + kt) e^{-kt} is within 2 % of 1 at kt ≈ 5.83.
    const double k = 5.83 / settle;
    return 1 - (1 + k * t) * std::exp(-k * t);
  }
  // Underdamped: the envelope e^{-ζωt} is within 2 % at ζωt = 4.
  const double omega = 4.0 / (z * settle);
  const double k = z * omega;
  const double wd = omega * std::sqrt(1 - z * z);
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
  transitionStyle_ = 0;
  flashSeconds_ = 0;
  popOnChange_ = 0;
  flashes_.clear();
  popStart_ = -1;
  popScale_ = 1;
  lastNow_ = 0;
  effectsActive_ = false;
  revealDuration_ = 2.2;
  revealBounce_ = 0.12;
  revealStyle_ = 0;
  revealStagger_ = 0.2;
  revealGrow_ = 0.2;
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
