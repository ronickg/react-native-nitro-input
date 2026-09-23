// Host-side checks for the shared engine. Build & run with `bun run test:cpp`.
#include "RollingEngine.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>

using margelo::nitro::nitroinput::RollingEngine;

static int failures = 0;

#define CHECK(cond)                                                                   \
  do {                                                                                \
    if (!(cond)) {                                                                    \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);                     \
      failures++;                                                                     \
    }                                                                                 \
  } while (0)

static bool near(double a, double b, double eps = 1e-9) {
  return std::fabs(a - b) < eps;
}

static void odometerPositions() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setValue(999.5);
  // units, tens, hundreds all half way through their carry, plus an emerging thousands wheel
  CHECK(e.wheelCount() == 4);
  CHECK(near(e.wheelAt(0).position, 9.5));
  CHECK(near(e.wheelAt(1).position, 9.5));
  CHECK(near(e.wheelAt(2).position, 9.5));
  CHECK(near(e.wheelAt(3).position, 0.5));
  CHECK(near(e.wheelAt(3).width, 0.5));
  CHECK(e.wheelAt(3).blankZero);

  e.setValue(1000);
  CHECK(e.wheelCount() == 4);
  CHECK(near(e.wheelAt(3).position, 1.0));
  CHECK(near(e.wheelAt(3).width, 1.0));
  CHECK(!e.wheelAt(3).blankZero);

  e.setValue(12.5);
  CHECK(e.wheelCount() == 2);
  CHECK(near(e.wheelAt(0).position, 2.5));
  CHECK(near(e.wheelAt(1).position, 1.0));

  e.setValue(-0.5);
  CHECK(near(e.signFactor(), 0.5));
}

static void tickerRollsShortestPathInDirection() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(0.5, /* linear */ 0, 0.15, 0, 0);
  e.animateTo(1234, 0);   // first show: snap
  CHECK(!e.needsFrames());
  CHECK(near(e.wheelAt(0).position, 4));

  e.animateTo(1239, 0);   // increasing: units 4 → 9
  CHECK(e.needsFrames());
  e.tick(0.25);
  CHECK(near(e.wheelAt(0).position, 6.5));
  CHECK(near(e.wheelAt(1).position, 3));
  e.tick(0.5);
  CHECK(!e.needsFrames());
  CHECK(near(e.wheelAt(0).position, 9));
  CHECK(e.targetDigit(0) == 9 && e.targetDigit(3) == 1);

  e.animateTo(1242, 0);   // increasing past 9: units 9 → 12 (wraps to 2), tens 3 → 4
  e.tick(0.25);
  CHECK(near(e.wheelAt(0).position, 10.5));
  e.tick(0.5);
  CHECK(near(e.wheelAt(0).position, 2));
  CHECK(near(e.wheelAt(1).position, 4));

  e.animateTo(1238, 0);   // decreasing: units 2 → -2 (wraps to 8), tens 4 → 3
  e.tick(0.5);
  CHECK(near(e.wheelAt(0).position, 8));
  CHECK(near(e.wheelAt(1).position, 3));

  e.setTiming(0.5, 0, 0.15, 0, /* up */ 1);
  e.animateTo(1230, 0);   // forced up although the value decreased: 8 → 10
  e.tick(0.25);
  CHECK(near(e.wheelAt(0).position, 9));
}

static void wheelsAppearAndDisappear() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(1, 0, 0.15, 0, 0);
  e.animateTo(999, 0);
  e.animateTo(1000, 0);
  CHECK(e.wheelCount() == 4);
  CHECK(e.wheelAt(3).linear);
  CHECK(near(e.wheelAt(3).position, -1));  // blank
  CHECK(near(e.wheelAt(3).width, 0));
  e.tick(0.5);
  CHECK(near(e.wheelAt(3).position, 0));   // half way from blank to 1
  CHECK(near(e.wheelAt(3).width, 0.5));
  e.tick(1);
  CHECK(e.wheelCount() == 4);
  CHECK(near(e.wheelAt(3).position, 1));
  CHECK(e.settledPowerCount() == 4);

  e.animateTo(999, 0);
  e.tick(1);
  CHECK(e.wheelCount() == 3);
  CHECK(e.settledPowerCount() == 3);
}

static void staggerDoesNotStarveOnRetarget() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(0.2, 0, 0.15, /* stagger */ 0.1, 0);
  e.animateTo(0, 0);
  e.animateTo(999, 0);           // hundreds wheel scheduled for t = 0.2
  e.tick(0.05);
  e.animateTo(888, 0.05);        // re-target before the hundreds wheel started
  e.tick(0.22);                  // 0.02 after its original start: it must have left "blank" (-1)
  CHECK(e.wheelAt(2).position > -1 + 1e-9);
  CHECK(e.wheelAt(2).position < 0);
  e.tick(2);
  CHECK(!e.needsFrames());
  CHECK(near(e.wheelAt(2).position, 8));
}

static void rapidRetargetsKeepRolling() {
  // A new target every frame with the default easeInOut curve: restarting the
  // curve from rest each time would leave the wheel visually frozen. A roll
  // that re-targets a moving wheel must keep it moving.
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(0.5, /* easeInOut */ 3, 0.15, 0, 0);
  e.animateTo(0, 0);
  e.animateTo(5, 0);
  double now = 0;
  double travelled = 0;
  double last = e.wheelAt(0).position;
  for (int frame = 1; frame <= 30; frame++) {
    now = frame / 60.0;
    e.tick(now);
    travelled += std::fabs(e.wheelAt(0).position - last);
    last = e.wheelAt(0).position;
    e.animateTo(5 + (frame % 2), now);  // 5 → 6 → 5 → 6 … every frame
  }
  CHECK(travelled > 1.0);              // it visibly rolled during half a second
  // A single, uninterrupted roll still uses the full ease-in-out curve.
  RollingEngine f;
  f.setFormat(0, 1);
  f.setTiming(0.5, 3, 0.15, 0, 0);
  f.animateTo(0, 0);
  f.animateTo(5, 0);
  f.tick(0.05);
  CHECK(f.wheelAt(0).position < 0.1);  // barely moved at 10 % of an ease-in start
}

static void loadingFadeAndReduceMotion() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.animateTo(5, 0);
  e.setLoading(true, 0);
  CHECK(e.needsFrames());
  e.tick(0.125);
  CHECK(near(e.loadingProgress(), 0.5));
  e.tick(0.3);
  CHECK(near(e.loadingProgress(), 1));
  CHECK(e.needsFrames());                      // the glint keeps sweeping
  CHECK(near(e.shimmerPhase(0.95 * 1.5, 0.95), 0.5));
  e.setReduceMotion(true);
  CHECK(!e.needsFrames());                     // frozen glint needs no frames
  CHECK(near(e.shimmerPhase(3, 0.95), 0));
  e.setLoading(false, 1);
  e.tick(1.25);
  CHECK(near(e.loadingProgress(), 0));

  e.setTiming(0.5, 0, 0.15, 0, 0);
  e.animateTo(7, 2);                           // reduce motion: snaps
  CHECK(!e.needsFrames());
  CHECK(near(e.wheelAt(0).position, 7));
}

static void settledTargetForAccessibility() {
  RollingEngine e;
  e.setFormat(1, 1);
  e.animateTo(-1234.56, 0);
  CHECK(e.settledNegative());
  CHECK(e.settledPowerCount() == 5);           // 1234.6 → digits 6,4,3,2,1
  CHECK(e.targetDigit(0) == 6);
  CHECK(e.targetDigit(1) == 4);
  CHECK(e.targetDigit(4) == 1);
  e.setFormat(2, 3);                           // 001234.56 → 8 wheels
  CHECK(e.settledPowerCount() == 6);
  CHECK(e.targetDigit(0) == 6 && e.targetDigit(1) == 5);
  e.reset();
  CHECK(!e.hasShownValue() && e.wheelCount() == 0 && e.settledPowerCount() == 1);
}

static void jackpotRevealCountsUpAndLands() {
  RollingEngine e;
  e.setFormat(2, 1);
  e.holdReveal(50000);                          // "$50,000.00" held at "$0.00"
  CHECK(e.hasShownValue());
  CHECK(e.wheelCount() == 7);                   // layout is the target's from the first frame
  CHECK(e.settledPowerCount() == 7);
  CHECK(near(e.wheelAt(0).position, 0) && near(e.wheelAt(0).width, 1));   // cents never blank
  CHECK(near(e.wheelAt(2).position, 0) && near(e.wheelAt(2).width, 1));   // units digit never blank
  CHECK(near(e.wheelAt(3).width, 0) && e.wheelAt(3).linear);              // tens hidden
  CHECK(near(e.wheelAt(6).width, 0));
  CHECK(!e.needsFrames());
  CHECK(!e.isRevealing());

  e.reveal(50000, 10);
  CHECK(e.isRevealing() && e.isRolling() && e.needsFrames());
  // The digits on stage read as one number; hidden wheels must form a leading run
  // and every visible digit is a whole glyph (a swap, no roll).
  auto shown = [&](int* visibleOut) {
    double count = 0;
    int visible = 0;
    for (int p = e.wheelCount() - 1; p >= 0; p--) {
      const auto w = e.wheelAt(p);
      if (w.width > 0) {
        visible++;
        CHECK(near(w.position, std::floor(w.position)));
        count = count * 10 + w.position;
      } else {
        CHECK(visible == 0);
      }
    }
    if (visibleOut) *visibleOut = visible;
    return count;
  };
  double previous = 0;
  int visibleEarly = 0;
  double swellStart = 0;
  for (int i = 1; i <= 21; i++) {
    e.tick(10 + 0.1 * i);
    int visible = 0;
    const double count = shown(&visible);
    CHECK(count >= previous);                   // the count only ever grows
    previous = count;
    if (i == 1) {
      visibleEarly = visible;
      swellStart = e.revealScale();
    }
    CHECK(e.revealScale() <= 1 + 1e-9);         // no pop while counting, only the growth
  }
  CHECK(visibleEarly < 7);                      // still growing into the label early on
  CHECK(swellStart < 0.82 && e.revealScale() > swellStart);   // opens 20 % smaller and grows as it climbs
  CHECK(previous < 5000000 && previous > 4000000);   // braking into the target
  e.tick(12.2 + 1e-6);
  CHECK(near(shown(nullptr), 5000000));         // landed on the target at t == 1
  CHECK(!e.isRolling());                        // the count is done…
  CHECK(e.isRevealing() && e.needsFrames());    // …but the landing pop still rings out
  e.tick(12.2 + 0.1);                           // the punch's peak
  CHECK(e.revealScale() > 1.11 && e.revealScale() < 1.13);
  e.tick(12.2 + 0.36);                          // settling, never under the resting size
  CHECK(e.revealScale() > 1 && e.revealScale() < 1.06);
  e.tick(13.1);
  CHECK(!e.isRevealing() && !e.needsFrames());
  CHECK(near(e.revealScale(), 1));
  CHECK(e.wheelAt(6).position == 5 && near(e.wheelAt(6).width, 1));
  CHECK(e.targetDigit(6) == 5 && e.targetDigit(0) == 0);
}

static void jackpotRevealSpinsReelsAndLocksLeftToRight() {
  RollingEngine e;
  e.setFormat(2, 1);
  e.setRevealTiming(2.2, 0.07, /* spin */ 1, 0.2);
  e.reveal(50000, 0);                           // "$50,000.00": seven reels
  CHECK(e.wheelCount() == 7);
  for (int p = 0; p < 7; p++) {
    CHECK(near(e.wheelAt(p).width, 1));         // every reel on stage from the first frame
    CHECK(!e.wheelAt(p).linear);
  }
  // Free spin: every reel moves at the same speed.
  const double before = e.wheelAt(6).position;
  e.tick(0.1);
  CHECK(near(e.wheelAt(6).position - before, 2.4, 1e-6));
  CHECK(near(e.wheelAt(0).position - e.wheelAt(0).position, 0));
  // Reels lock from the left, the last a clunk short of the duration:
  // lead = (2.2 - 0.2) - 6 * 0.2 = 0.8 s, then one every 0.2 s.
  const int digits[7] = {0, 0, 0, 0, 0, 0, 5};  // powers 0..6 of 5000000
  e.tick(1.0 + 0.25);                           // leftmost locked (its bounce is over), the rest still moving
  auto landed = [&](int power) {
    const double pos = e.wheelAt(power).position;
    return near(std::fmod(pos, 10.0), digits[power], 1e-6);
  };
  CHECK(landed(6));
  const double moving = e.wheelAt(0).position;
  e.tick(1.3);
  CHECK(e.wheelAt(0).position > moving);
  e.tick(2.2 + 0.25);
  for (int p = 0; p < 7; p++) {
    CHECK(landed(p));
  }
  CHECK(!e.isRolling() && e.isRevealing());     // the last reel is down; the pop rings out
  e.tick(3.1);
  CHECK(!e.isRevealing());
  CHECK(e.wheelAt(6).position == 5 && e.wheelAt(0).position == 0);

  // A reel never turns backwards while braking, and the lock bounces forward
  // then settles - all of it inside the duration, so nothing is still moving
  // once the reveal is over.
  RollingEngine m;
  m.setFormat(0, 1);
  m.setRevealTiming(1.0, 0, 1, 0.1);
  m.reveal(7, 0);
  double previous = -1;
  for (int i = 1; i <= 80; i++) {               // ... up to the lock at 1.0 - 0.2
    m.tick(i * 0.01);
    const double pos = m.wheelAt(0).position;
    if (i * 0.01 > 0.02) {
      CHECK(pos >= previous - 1e-9);
    }
    previous = pos;
  }
  const double locked = previous;               // on the digit, the instant it locks
  double peak = locked;
  for (int i = 81; i < 100; i++) {              // the clunk: past the digit and back
    m.tick(i * 0.01);
    peak = std::max(peak, m.wheelAt(0).position);
  }
  CHECK(peak > locked + 0.05);                  // it really did overshoot
  m.tick(1.0);
  CHECK(!m.isRevealing());                      // and with no pop, the duration is the end of it
  CHECK(near(std::fmod(locked, 10.0), 7) && near(m.wheelAt(0).position, 7));

  // Many reels squeeze their stagger into the duration; the lead never drops below 30 %.
  RollingEngine w;
  w.setFormat(0, 12);
  w.setRevealTiming(1.0, 0, 1, 0.5);
  w.reveal(123456789012.0, 0);
  w.tick(0.29);
  CHECK(w.isRolling());
  w.tick(1.0);
  CHECK(!w.isRolling());                        // every reel is down at the duration…
  CHECK(!w.isRevealing());                      // …clunk included, with no pop to ring out
}

static void jackpotRevealMilestonesPunchAndHold() {
  RollingEngine e;
  e.setFormat(2, 1);
  e.setRevealTiming(2.0, 0.12, 0, 0.2);
  e.addRevealMilestone(25000);                  // out of order and one beyond the target: sorted, dropped
  e.addRevealMilestone(1000);
  e.addRevealMilestone(80000);
  e.setRevealMilestoneHold(0.5);
  e.reveal(50000, 0);
  CHECK(e.revealMilestonesReached() == 0);
  CHECK(near(e.revealTotalSeconds(), 2.0 + 2 * 0.5 + 0.8));

  auto shown = [&]() {
    double count = 0;
    for (int p = e.wheelCount() - 1; p >= 0; p--) {
      const auto w = e.wheelAt(p);
      if (w.width > 0) count = count * 10 + w.position;
    }
    return count;
  };
  // Walk the reveal: find when the first milestone is reached, check the hold and the punch.
  double reachedAt = -1;
  double afterHold = 0, midTier = 0, lateTier = 0;
  double punchPeak = 0, punchSettled = 0;
  for (int i = 1; i <= 400; i++) {
    const double now = i * 0.01;
    e.tick(now);
    if (reachedAt < 0 && e.revealMilestonesReached() == 1) {
      reachedAt = now;
      CHECK(near(shown(), 100000));             // sits exactly on $1,000.00…
    }
    if (reachedAt > 0 && now < reachedAt + 0.45) {
      CHECK(near(shown(), 100000));             // …for the whole hold
      if (near(now, reachedAt + 0.1, 1e-6)) punchPeak = e.revealScale();
      if (near(now, reachedAt + 0.44, 1e-6)) punchSettled = e.revealScale();
    }
    if (reachedAt > 0 && near(now, reachedAt + 0.6, 1e-6)) afterHold = shown();
    if (reachedAt > 0 && near(now, reachedAt + 0.8, 1e-6)) midTier = shown();
    if (reachedAt > 0 && near(now, reachedAt + 0.9, 1e-6)) lateTier = shown();
  }
  // Tiers share the duration equally: $1,000 lands at 2.0 / 3 s.
  CHECK(near(reachedAt, 0.67, 0.011));
  // The milestone punch (75 % of the landing pop) rides on top of the still
  // growing figure and has mostly settled by the end of the hold.
  CHECK(punchPeak > punchSettled * 1.03 && punchPeak < punchSettled * 1.11);
  CHECK(punchSettled < 1);                      // still growing towards full size
  // Out of the hold the counter ramps up: it covers far more of the
  // $1,000 → $25,000 tier in its middle tenth of a second than in its first,
  // then runs at a steady rate.
  CHECK(afterHold > 100000 && afterHold < 2500000);
  CHECK(midTier - afterHold > 3 * (afterHold - 100000));
  CHECK(lateTier > midTier);
  CHECK(near(lateTier - midTier, (midTier - afterHold) / 2, (midTier - afterHold) * 0.15));   // linear middle
  // The tally crawls into the next milestone: the last tenth of the tier covers
  // far less than the middle tenth did.
  {
    RollingEngine c;
    c.setFormat(0, 1);
    c.setRevealTiming(1.0, 0, 0, 0.2);
    c.reveal(100000, 0);
    auto shownOf = [&]() {
      double count = 0;
      for (int p = c.wheelCount() - 1; p >= 0; p--) {
        const auto w = c.wheelAt(p);
        if (w.width > 0) count = count * 10 + w.position;
      }
      return count;
    };
    c.tick(0.40); const double a = shownOf();
    c.tick(0.50); const double b = shownOf();
    c.tick(0.90); const double d = shownOf();
    c.tick(1.00); const double e2 = shownOf();
    CHECK(near(e2, 100000));
    CHECK(e2 - d < (b - a) / 3);
  }
  CHECK(e.revealMilestonesReached() == 2);      // $25,000 too; $80,000 never
  CHECK(!e.isRevealing());
  CHECK(near(shown(), 5000000));

  RollingEngine s;                              // the spin style ignores milestones
  s.setFormat(0, 1);
  s.setRevealTiming(1.0, 0, 1, 0.1);
  s.addRevealMilestone(5);
  s.setRevealMilestoneHold(1.0);
  s.reveal(9, 0);
  CHECK(near(s.revealTotalSeconds(), 1.0));     // the duration itself: no hold, and the clunk fits inside
  s.tick(1.3);
  CHECK(!s.isRevealing() && s.revealMilestonesReached() == 0);
}

static void jackpotRevealEdgeCases() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setRevealTiming(1.0, 0, 0, 0.2);             // no pop: done exactly at the duration
  e.reveal(7, 0);
  e.tick(0.5);
  CHECK(e.wheelCount() == 1 && e.wheelAt(0).width == 1);
  CHECK(e.wheelAt(0).position >= 1);             // ceil: left 0 on the first moving frame
  e.tick(1.0);
  CHECK(!e.isRevealing() && near(e.wheelAt(0).position, 7));

  e.reveal(-1234, 2);                            // negative: sign shown throughout
  CHECK(near(e.signFactor(), 1));
  e.reveal(9999, 2.5);                           // re-target mid-count keeps the clock
  CHECK(e.isRevealing() && e.targetValue() == 9999 && e.settledPowerCount() == 4);
  e.tick(3.0);
  CHECK(!e.isRevealing() && near(e.wheelAt(3).position, 9));

  e.setTiming(0.5, 0, 0.15, 0, 0);
  e.animateTo(10000, 4);                         // a normal roll after the reveal
  CHECK(e.isRolling() && !e.isRevealing());
  e.tick(4.5);
  CHECK(near(e.wheelAt(4).position, 1));

  e.setReduceMotion(true);
  e.reveal(42, 5);                               // Reduce Motion snaps to the target
  CHECK(!e.isRevealing() && !e.needsFrames());
  CHECK(e.wheelCount() == 2 && near(e.wheelAt(1).position, 4));

  RollingEngine h;
  h.holdReveal(1234);                            // a format change while held keeps the opening frame
  h.setFormat(2, 1);
  CHECK(h.wheelCount() == 6 && h.wheelAt(3).width == 0 && h.wheelAt(2).width == 1);
  CHECK(!h.isRevealing());

  RollingEngine z;
  z.setFormat(0, 3);                             // "000": zero padding never blanks
  z.holdReveal(0);
  CHECK(z.wheelCount() == 3 && z.wheelAt(2).width == 1);
  z.reveal(0, 0);
  z.tick(1);
  CHECK(z.wheelCount() == 3 && near(z.wheelAt(0).position, 0));
  z.reset();
  CHECK(!z.isRevealing() && near(z.revealScale(), 1));
}

// `setValue` used to clamp the scaled magnitude at 10^15 while `animateTo`
// clamped at 10^17, so a jump and a roll to one figure showed different digits
// (with 9 fraction digits, anything above 10^6 collapsed to "1,000,000").
static void jumpAndRollAgreeOnLargeValues() {
  RollingEngine jump;
  jump.setFormat(9, 1);
  jump.setValue(123456.5);
  RollingEngine roll;
  roll.setFormat(9, 1);
  roll.animateTo(123456.5, 0);
  CHECK(jump.wheelCount() == roll.wheelCount());
  CHECK(jump.wheelCount() == 15);
  for (int i = 0; i < jump.wheelCount(); i++) {
    CHECK(near(jump.wheelAt(i).position, roll.wheelAt(i).position));
  }
  CHECK(near(jump.wheelAt(14).position, 1) && near(jump.wheelAt(9).position, 6) && near(jump.wheelAt(8).position, 5));

  RollingEngine big;
  big.setFormat(0, 1);
  big.setValue(2e15);                            // exactly representable, above the old 10^15 clamp
  CHECK(big.wheelCount() == 16 && near(big.wheelAt(15).position, 2));
  big.animateTo(2e15, 0);
  CHECK(big.wheelCount() == 16 && near(big.wheelAt(15).position, 2));

  RollingEngine over;
  over.setFormat(9, 1);
  over.setValue(1e12);                           // 10^21 scaled: clamped to 10^17 on both paths, never more than 18 wheels
  RollingEngine overRoll;
  overRoll.setFormat(9, 1);
  overRoll.animateTo(1e12, 0);
  CHECK(over.wheelCount() == overRoll.wheelCount() && over.wheelCount() <= 18);
}

// The stagger's longest delay is fixed when the roll is built, so a tick
// finishes exactly when the last wheel's roll ends.
static void staggeredRollFinishesAfterLastWheel() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(0.5, 0, 0.15, /* stagger */ 0.1, 0);
  e.animateTo(0, 0);
  e.animateTo(999, 0);                           // hundreds wheel starts at 0.2, ends at 0.7
  e.tick(0.69);
  CHECK(e.needsFrames());
  e.tick(0.7);
  CHECK(!e.needsFrames());
  CHECK(near(e.wheelAt(2).position, 9));
}

static void numericTransitionSwapsGlyphsInPlace() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(0.5, /* linear */ 0, 0.15, 0, 0);
  e.setTransition(1);
  e.animateTo(1234, 0);   // first show: snap
  CHECK(!e.needsFrames());
  CHECK(near(e.wheelAt(0).blend, 1));

  e.animateTo(1239, 0);   // increasing: units 4 → 9, the rest untouched
  CHECK(e.needsFrames());
  CHECK(e.isRolling());
  RollingEngine::Wheel units = e.wheelAt(0);
  CHECK(near(units.fromGlyph, 4));
  CHECK(near(units.toGlyph, 9));
  CHECK(near(units.blend, 0));
  CHECK(!units.fromAbove);          // a value that grew: the 9 comes up from below
  CHECK(near(units.focus, 0));
  CHECK(near(units.grow, 0));
  CHECK(near(units.position, 9));   // the position is the digit arriving, never a glyph in between
  CHECK(near(e.wheelAt(1).blend, 1));
  CHECK(near(e.wheelAt(3).blend, 1));
  CHECK(near(e.wheelAt(1).position, 3));

  e.tick(0.1);
  CHECK(e.wheelAt(0).blend > 0.1 && e.wheelAt(0).blend < 0.9);   // on its way
  CHECK(e.wheelAt(0).grow > 0.1 && e.wheelAt(0).grow < 0.9);
  CHECK(e.wheelAt(0).focus > 0 && e.wheelAt(0).focus < 0.7);
  e.tick(0.25);
  CHECK(e.wheelAt(0).blend > 0.95);       // landed (and overshooting) half way through
  CHECK(e.wheelAt(0).grow > 0.8 && e.wheelAt(0).grow < 1);
  CHECK(e.wheelAt(0).focus < 0.98);       // still coming into focus
  CHECK(e.needsFrames());
  CHECK(near(e.wheelAt(0).position, 9));
  e.tick(0.5);
  CHECK(e.needsFrames());                 // the position spring rings out past the duration
  e.tick(0.5 * RollingEngine::kNumericTail);
  CHECK(!e.needsFrames());
  CHECK(near(e.wheelAt(0).blend, 1));
  CHECK(near(e.wheelAt(0).focus, 1));
  CHECK(near(e.wheelAt(0).grow, 1));
  CHECK(near(e.wheelAt(0).position, 9));
  CHECK(near(e.wheelAt(0).fromGlyph, -1));   // settled: no pair to draw

  e.animateTo(1230, 0.5);   // decreasing: 9 → 0 arrives from above
  units = e.wheelAt(0);
  CHECK(near(units.fromGlyph, 9));
  CHECK(near(units.toGlyph, 0));
  CHECK(units.fromAbove);
  e.tick(1);
  CHECK(near(e.wheelAt(0).position, 0));
}

static void numericTransitionCascadesLeftToRight() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(0.5, /* linear */ 0, 0.15, /* stagger: the whole cascade's span */ 0.3, 0);
  e.setTransition(1);
  e.animateTo(1111, 0);
  e.animateTo(2222, 0);
  e.tick(0.05);
  // Leftmost first: four columns change, spread over 0.3 s (0, 0.1, 0.2,
  // 0.3 s), so at 50 ms only the thousands wheel has started.
  CHECK(e.wheelAt(3).blend > 0);
  CHECK(near(e.wheelAt(2).blend, 0));
  CHECK(near(e.wheelAt(0).blend, 0));
  e.tick(0.35);
  CHECK(e.wheelAt(3).blend > 0.9);
  CHECK(e.wheelAt(3).focus < 1);
  CHECK(e.wheelAt(0).blend > 0 && e.wheelAt(0).blend < 0.5);
  CHECK(e.needsFrames());
  e.tick(0.3 + 0.5 * RollingEngine::kNumericTail);   // the last wheel's delay + the transition
  CHECK(!e.needsFrames());
  CHECK(near(e.wheelAt(0).blend, 1));
  CHECK(near(e.wheelAt(0).position, 2));

  // Only the wheels that change take part in the cascade: a units digit
  // ticking over starts at once, and 2222 → 2255 spreads the span over two.
  e.animateTo(2223, 1);
  e.tick(1.05);
  CHECK(e.wheelAt(0).blend > 0);
  e.tick(2);
  e.animateTo(2255, 2);
  e.tick(2.05);
  CHECK(e.wheelAt(1).blend > 0);
  CHECK(near(e.wheelAt(0).blend, 0));   // its turn comes 0.3 s in
  CHECK(near(e.wheelAt(3).blend, 1));
  e.tick(2.35);
  CHECK(e.wheelAt(0).blend > 0);
}

static void numericTransitionGrowsAndShrinksColumns() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(0.5, /* linear */ 0, 0.15, 0, 0);
  e.setTransition(1);
  e.animateTo(99, 0);
  e.animateTo(100, 0);
  CHECK(e.wheelCount() == 3);
  // The new hundreds column opens while its "1" arrives from blank.
  CHECK(near(e.wheelAt(2).fromGlyph, -1));
  CHECK(near(e.wheelAt(2).toGlyph, 1));
  CHECK(near(e.wheelAt(2).width, 0));
  CHECK(near(e.wheelAt(0).fromGlyph, 9));
  CHECK(near(e.wheelAt(0).toGlyph, 0));
  e.tick(0.1);
  // The column opens on the glyph's size-and-opacity spring (the easing is not consulted).
  CHECK(e.wheelAt(2).width > 0.4 && e.wheelAt(2).width < 0.7);
  CHECK(near(e.wheelAt(2).width, e.wheelAt(2).grow));
  CHECK(e.wheelAt(2).blend > 0 && e.wheelAt(2).blend < 1);   // the glyph on its way
  e.tick(0.25);
  CHECK(e.wheelAt(2).width > 0.9 && e.wheelAt(2).width < 1);
  e.tick(0.5);
  CHECK(e.wheelCount() == 3);
  CHECK(near(e.wheelAt(2).width, 1));
  CHECK(near(e.wheelAt(2).position, 1));
  CHECK(e.settledPowerCount() == 3);

  e.animateTo(99, 1);
  CHECK(e.wheelCount() == 3);
  // The hundreds column closes as its "1" leaves for blank.
  CHECK(near(e.wheelAt(2).fromGlyph, 1));
  CHECK(near(e.wheelAt(2).toGlyph, -1));
  CHECK(near(e.wheelAt(2).width, 1));
  CHECK(e.wheelAt(2).fromAbove);
  e.tick(1.25);
  CHECK(e.wheelAt(2).width < 0.15);   // closed as its glyph left, no gap behind it
  e.tick(1 + 0.5 * RollingEngine::kNumericTail);
  CHECK(e.wheelCount() == 2);
  CHECK(near(e.wheelAt(1).position, 9));
  CHECK(near(e.wheelAt(0).position, 9));
}

static void numericTransitionRetargetsFromTheArrivingGlyph() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(0.5, /* linear */ 0, 0.15, 0, 0);
  e.setTransition(1);
  e.animateTo(5, 0);
  e.animateTo(6, 0);
  e.tick(0.1);
  CHECK(e.wheelAt(0).blend > 0.2 && e.wheelAt(0).blend < 0.9);
  e.animateTo(7, 0.1);   // mid-swap: the 6 that was arriving is what leaves now
  CHECK(near(e.wheelAt(0).fromGlyph, 6));
  CHECK(near(e.wheelAt(0).toGlyph, 7));
  CHECK(near(e.wheelAt(0).blend, 0));
  e.tick(0.1 + 0.5 * RollingEngine::kNumericTail);
  CHECK(near(e.wheelAt(0).position, 7));
  CHECK(!e.needsFrames());

  // Reduce Motion snaps: no pair to draw.
  e.setReduceMotion(true);
  e.animateTo(8, 1);
  CHECK(!e.needsFrames());
  CHECK(near(e.wheelAt(0).position, 8));
  CHECK(near(e.wheelAt(0).blend, 1));
  e.setReduceMotion(false);

  // Back to the roll: a wheel left mid-swap rolls on from the glyph it was arriving at.
  e.animateTo(9, 2);
  e.tick(2.25);
  e.setTransition(0);
  e.animateTo(10, 2.25);
  CHECK(e.wheelCount() == 2);
  CHECK(near(e.wheelAt(0).blend, 1));
  CHECK(near(e.wheelAt(0).fromGlyph, -1));
  e.tick(2.5);
  CHECK(near(e.wheelAt(0).position, 9.5));   // 9 → 0 rolling up through the wrap
  e.tick(3);
  CHECK(near(e.wheelAt(0).position, 0));
  CHECK(near(e.wheelAt(1).position, 1));
  CHECK(!e.needsFrames());
}

static void scrambleShowsRandomDigitsUntilItLocks() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(0.5, /* linear */ 0, 0.15, 0, 0);
  e.setTransition(2);
  e.animateTo(4, 0);
  e.animateTo(7, 0);
  CHECK(e.needsFrames());
  int distinct = 0;
  double last = -1;
  bool sawEndpoints = false;
  for (double t = 0.0; t < 0.5; t += 0.045) {
    e.tick(t);
    const RollingEngine::Wheel w = e.wheelAt(0);
    CHECK(near(w.blend, 1));                 // nothing for a renderer to blend
    CHECK(near(w.position, std::floor(w.position)));   // always a whole glyph
    if (w.position == 4 || w.position == 7) sawEndpoints = true;
    if (w.position != last) distinct++;
    last = w.position;
  }
  CHECK(distinct >= 5);
  CHECK(!sawEndpoints);
  // Not a counter: the digits do not step by one.
  {
    RollingEngine s;
    s.setFormat(0, 1);
    s.setTiming(1, 0, 0.15, 0, 0);
    s.setTransition(2);
    s.animateTo(1, 0);
    s.animateTo(2, 0);
    int increments = 0;
    double previous = -1;
    for (double t = 0; t < 0.9; t += 0.045) {
      s.tick(t);
      const double g = s.wheelAt(0).position;
      if (previous >= 0 && std::fmod(g - previous + 10, 10) == 1) increments++;
      previous = g;
    }
    CHECK(increments < 8);
  }
  e.tick(0.5);
  CHECK(!e.needsFrames());
  CHECK(near(e.wheelAt(0).position, 7));

  // Unchanged wheels never scramble.
  e.animateTo(17, 1);
  e.tick(2);
  e.animateTo(18, 2);
  e.tick(2.1);
  CHECK(near(e.wheelAt(1).position, 1));
  CHECK(e.wheelAt(0).position != 8);
}

static void changeFlashAndPop() {
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(0.2, /* linear */ 0, 0.15, 0, 0);
  e.setFlash(0.5);
  e.setPopOnChange(0.1);
  e.animateTo(10, 0);   // the first value: no flash, no pop
  CHECK(near(e.wheelAt(0).flash, 0));
  CHECK(near(e.revealScale(), 1));
  CHECK(!e.needsFrames());

  e.animateTo(15, 1);   // the units change and grow: units flash up, tens don't
  CHECK(near(e.wheelAt(0).flash, 1));
  CHECK(e.wheelAt(0).flashUp);
  CHECK(near(e.wheelAt(1).flash, 0));
  e.tick(1.1);
  CHECK(e.revealScale() > 1.05);   // the punch peaks at 0.1 s
  CHECK(near(e.wheelAt(0).flash, 1)); // lit for the whole roll (0.2 s)
  e.tick(1.19);
  CHECK(near(e.wheelAt(0).flash, 1));
  e.tick(1.25);
  CHECK(!e.isRolling());
  CHECK(e.needsFrames());          // the flash and the pop are still fading
  CHECK(e.wheelAt(0).flash > 0.3);
  CHECK(e.wheelAt(0).flash < 0.9);
  e.tick(2.6);
  CHECK(near(e.wheelAt(0).flash, 0));
  CHECK(near(e.revealScale(), 1));
  CHECK(!e.needsFrames());

  // Down: flashDown. A snap (Reduce Motion) still flashes; a jump never does.
  e.setReduceMotion(true);
  e.animateTo(12, 3);
  CHECK(near(e.wheelAt(0).flash, 1));
  CHECK(!e.wheelAt(0).flashUp);
  CHECK(near(e.wheelAt(1).flash, 0));
  e.setReduceMotion(false);
  e.tick(4);
  e.setValue(99);
  e.tick(4.01);
  CHECK(near(e.wheelAt(0).flash, 0));
  CHECK(near(e.wheelAt(1).flash, 0));

  // Off by default.
  RollingEngine quiet;
  quiet.setFormat(0, 1);
  quiet.setTiming(0.2, 0, 0.15, 0, 0);
  quiet.animateTo(1, 0);
  quiet.animateTo(2, 1);
  quiet.tick(1.05);
  CHECK(near(quiet.wheelAt(0).flash, 0));
  CHECK(near(quiet.revealScale(), 1));
  quiet.tick(1.25);
  CHECK(!quiet.needsFrames());
}

static void numericTransitionCarriesASwapAcrossARetarget() {
  // Typing: 1 → 12 → 124, a new leading column each time, re-targeted
  // before the last one has opened. A wheel still swapping to the glyph it
  // keeps carries on: it is not cut out of its swap (which drew it as a
  // sliver of the half-open column), nor restarted.
  RollingEngine e;
  e.setFormat(0, 1);
  e.setTiming(0.5, /* linear */ 0, 0.15, 0, 0);
  e.setTransition(1);
  e.animateTo(1, 0);
  e.animateTo(12, 0);
  CHECK(near(e.wheelAt(1).fromGlyph, -1));
  CHECK(near(e.wheelAt(1).toGlyph, 1));
  e.tick(0.1);
  const RollingEngine::Wheel before = e.wheelAt(1);
  CHECK(before.width > 0 && before.width < 1);
  CHECK(before.grow > 0 && before.grow < 1);

  e.animateTo(13, 0.1);   // the tens column keeps its 1
  RollingEngine::Wheel tens = e.wheelAt(1);
  CHECK(near(tens.fromGlyph, -1));        // still arriving from blank
  CHECK(near(tens.toGlyph, 1));
  CHECK(tens.blend < 1);                  // still swapping, where it was
  CHECK(near(tens.grow, before.grow));
  CHECK(near(tens.focus, before.focus));
  CHECK(near(tens.width, before.width));
  CHECK(near(e.wheelAt(0).fromGlyph, 2)); // the units swap as usual
  CHECK(near(e.wheelAt(0).toGlyph, 3));

  e.tick(0.2);
  CHECK(e.wheelAt(1).grow > before.grow);  // and runs on from there
  e.tick(0.1 + 0.5 * RollingEngine::kNumericTail);
  CHECK(near(e.wheelAt(1).blend, 1));
  CHECK(near(e.wheelAt(1).width, 1));
  CHECK(near(e.wheelAt(1).position, 1));
  CHECK(near(e.wheelAt(0).position, 3));
  CHECK(!e.needsFrames());

  // A wheel that has finished its swap is left alone by the next target.
  e.animateTo(14, 1);
  CHECK(near(e.wheelAt(1).blend, 1));
  CHECK(near(e.wheelAt(1).fromGlyph, -1));
}

static void textChangesSwapLikeTheDigits() {
  RollingEngine e;
  e.setFormat(2, 1);
  e.setTiming(0.5, /* linear */ 0, 0.15, 0, 0);
  e.setTransition(1);
  // Nothing on screen yet: a new prefix just appears.
  e.changeText(RollingEngine::PrefixText, 0);
  CHECK(!e.textChange(RollingEngine::PrefixText).active);
  CHECK(!e.needsFrames());

  e.animateTo(12.5, 0);
  e.changeText(RollingEngine::PrefixText, 1);
  RollingEngine::TextChange t = e.textChange(RollingEngine::PrefixText);
  CHECK(t.active);
  CHECK(near(t.grow, 0));      // the new text arrives from nothing
  CHECK(near(t.focus, 0));     // fully blurred
  CHECK(near(t.blurOut, 0));   // the old one still sharp
  CHECK(e.needsFrames());
  CHECK(!e.textChange(RollingEngine::SuffixText).active);

  e.tick(1.15);
  t = e.textChange(RollingEngine::PrefixText);
  CHECK(t.grow > 0.2 && t.grow < 1);
  CHECK(t.focus > 0 && t.focus < 1);
  CHECK(t.blurOut > t.grow);   // the old text blurs away sooner than the new one arrives

  // Changed again mid-swap: it starts over.
  e.changeText(RollingEngine::PrefixText, 1.15);
  CHECK(near(e.textChange(RollingEngine::PrefixText).grow, 0));

  e.tick(1.15 + 0.5 * RollingEngine::kNumericTail);
  t = e.textChange(RollingEngine::PrefixText);
  CHECK(!t.active);
  CHECK(near(t.grow, 1));
  CHECK(near(t.focus, 1));
  CHECK(!e.needsFrames());

  // Reduce Motion snaps.
  e.setReduceMotion(true);
  e.changeText(RollingEngine::DecimalText, 3);
  CHECK(!e.textChange(RollingEngine::DecimalText).active);
  e.setReduceMotion(false);

  // Out-of-range slots are ignored.
  e.changeText(7, 3);
  CHECK(!e.textChange(7).active);

  e.reset();
  CHECK(!e.textChange(RollingEngine::PrefixText).active);
}

static void numericFormatChangesPlay() {
  RollingEngine e;
  e.setFormat(2, 1);
  e.setTiming(0.5, /* linear */ 0, 0.15, 0, 0);
  e.setTransition(1);
  e.animateTo(9587.05, 0);   // "9,587.05": wheels 5 0 7 8 5 9
  CHECK(e.wheelCount() == 6);
  CHECK(e.displayFractionDigits() == 2);
  CHECK(near(e.decimalFactor(), 1));

  // To no decimals (a currency without cents): the two decimal columns close
  // on the right while the integer digits keep their place value.
  e.changeFormat(0, 1, 1);
  CHECK(e.displayFractionDigits() == 2);   // still laid out while they close
  CHECK(e.wheelCount() == 6);
  CHECK(near(e.wheelAt(0).toGlyph, -1));   // the 5 leaves
  CHECK(near(e.wheelAt(1).toGlyph, -1));   // the 0 leaves
  CHECK(near(e.wheelAt(0).width, 1));
  CHECK(near(e.wheelAt(2).blend, 1));      // the 7 of 9,587 stays where it is
  e.animateTo(1856853, 1);                 // and the new value arrives with them
  CHECK(e.displayFractionDigits() == 2);
  CHECK(near(e.wheelAt(0).toGlyph, -1));
  CHECK(near(e.wheelAt(2).toGlyph, 3));    // units
  CHECK(near(e.wheelAt(8).toGlyph, 1));    // millions
  e.tick(1.25);
  CHECK(e.wheelAt(0).width < 1 && e.wheelAt(0).width > 0);
  CHECK(e.decimalFactor() < 1 && e.decimalFactor() > 0);
  e.tick(1 + 0.5 * RollingEngine::kNumericTail + 0.01);
  CHECK(!e.needsFrames());
  CHECK(e.displayFractionDigits() == 0);
  CHECK(e.wheelCount() == 7);              // 1,856,853
  CHECK(near(e.wheelAt(0).position, 3));
  CHECK(near(e.wheelAt(6).position, 1));
  CHECK(near(e.decimalFactor(), 0));

  // Back to two decimals: new columns open blank below the units and swap
  // their digits in, the separator easing in.
  e.changeFormat(2, 1, 3);
  CHECK(e.displayFractionDigits() == 2);
  CHECK(e.wheelCount() == 9);
  CHECK(near(e.wheelAt(0).width, 0));
  CHECK(near(e.wheelAt(0).fromGlyph, -1));
  CHECK(near(e.wheelAt(0).toGlyph, 0));    // 1,856,853.00
  CHECK(near(e.wheelAt(2).blend, 1));      // the units 3 is not part of it
  CHECK(near(e.decimalFactor(), 0));
  e.tick(3.25);
  CHECK(e.decimalFactor() > 0 && e.decimalFactor() < 1);
  e.tick(3 + 0.5 * RollingEngine::kNumericTail + 0.01);
  CHECK(e.wheelCount() == 9);
  CHECK(near(e.wheelAt(0).width, 1));
  CHECK(near(e.decimalFactor(), 1));

  // The roll still snaps.
  e.setTransition(0);
  e.changeFormat(0, 1, 5);
  CHECK(!e.needsFrames());
  CHECK(e.wheelCount() == 7);
  CHECK(e.displayFractionDigits() == 0);
}

int main() {
  odometerPositions();
  tickerRollsShortestPathInDirection();
  wheelsAppearAndDisappear();
  staggerDoesNotStarveOnRetarget();
  rapidRetargetsKeepRolling();
  loadingFadeAndReduceMotion();
  settledTargetForAccessibility();
  jackpotRevealCountsUpAndLands();
  jackpotRevealSpinsReelsAndLocksLeftToRight();
  jackpotRevealMilestonesPunchAndHold();
  jackpotRevealEdgeCases();
  jumpAndRollAgreeOnLargeValues();
  staggeredRollFinishesAfterLastWheel();
  numericTransitionSwapsGlyphsInPlace();
  numericTransitionCascadesLeftToRight();
  numericTransitionGrowsAndShrinksColumns();
  numericTransitionRetargetsFromTheArrivingGlyph();
  numericTransitionCarriesASwapAcrossARetarget();
  textChangesSwapLikeTheDigits();
  numericFormatChangesPlay();
  scrambleShowsRandomDigitsUntilItLocks();
  changeFlashAndPop();
  if (failures == 0) {
    std::printf("RollingEngine: all checks passed\n");
    return 0;
  }
  std::printf("RollingEngine: %d check(s) failed\n", failures);
  return 1;
}
