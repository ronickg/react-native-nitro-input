// Host-side checks for the shared engine. Build & run with `bun run test:cpp`.
#include "RollingEngine.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>

using margelo::nitro::nitrorollingnumber::RollingEngine;

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
  int visibleAtQuarter = 0;
  for (int i = 1; i <= 21; i++) {
    e.tick(10 + 0.1 * i);
    int visible = 0;
    const double count = shown(&visible);
    CHECK(count >= previous);                   // the count only ever grows
    previous = count;
    if (i == 5) visibleAtQuarter = visible;
    CHECK(near(e.revealScale(), 1));            // no pop while counting
  }
  CHECK(visibleAtQuarter < 7);                  // still growing into the label a quarter of the way
  CHECK(previous < 5000000 && previous > 4000000);   // decelerating into the target
  e.tick(12.2 + 1e-6);
  CHECK(near(shown(nullptr), 5000000));         // landed on the target at t == 1
  CHECK(!e.isRolling());                        // the count is done…
  CHECK(e.isRevealing() && e.needsFrames());    // …but the landing pop still rings out
  e.tick(12.2 + 0.0961);                        // the spring's first peak
  CHECK(e.revealScale() > 1.06 && e.revealScale() < 1.08);
  e.tick(12.2 + 0.36);                          // the dip under
  CHECK(e.revealScale() < 1);
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
  // Reels lock from the left: lead = 2.2 - 6 * 0.2 = 1.0 s, then one every 0.2 s.
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

  // A reel never turns backwards while braking, and the lock bounces forward then settles.
  RollingEngine m;
  m.setFormat(0, 1);
  m.setRevealTiming(1.0, 0, 1, 0.1);
  m.reveal(7, 0);
  double previous = -1;
  bool bounced = false;
  for (int i = 1; i <= 100; i++) {
    m.tick(i * 0.01);
    const double pos = m.wheelAt(0).position;
    if (i * 0.01 < 1.0 && i * 0.01 > 0.02) {
      CHECK(pos >= previous - 1e-9);
    }
    previous = pos;
  }
  const double locked = m.wheelAt(0).position;
  m.tick(1.1);
  if (m.wheelAt(0).position > locked + 0.05) bounced = true;
  CHECK(m.isRevealing());                       // the reel's bounce outlasts the duration even without a pop
  m.tick(1.3);
  CHECK(bounced && !m.isRevealing());
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
  w.tick(1.25);
  CHECK(!w.isRevealing());                      // …and the last bounce is over 0.2 s later
}

static void jackpotRevealMilestonesPunchAndHold() {
  RollingEngine e;
  e.setFormat(2, 1);
  e.setRevealTiming(2.0, 0.07, 0, 0.2);
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
  for (int i = 1; i <= 400; i++) {
    const double now = i * 0.01;
    e.tick(now);
    if (reachedAt < 0 && e.revealMilestonesReached() == 1) {
      reachedAt = now;
      CHECK(near(shown(), 100000));             // sits exactly on $1,000.00…
    }
    if (reachedAt > 0 && now < reachedAt + 0.45) {
      CHECK(near(shown(), 100000));             // …for the whole hold
      if (now > reachedAt + 0.08 && now < reachedAt + 0.12) {
        CHECK(e.revealScale() > 1.03);          // punching meanwhile (75 % of the landing pop)
      }
    }
    if (reachedAt > 0 && near(now, reachedAt + 0.6, 1e-6)) afterHold = shown();
    if (reachedAt > 0 && near(now, reachedAt + 0.8, 1e-6)) midTier = shown();
    if (reachedAt > 0 && near(now, reachedAt + 0.9, 1e-6)) lateTier = shown();
  }
  // Tiers share the duration equally: $1,000 lands at 2.0 / 3 s.
  CHECK(near(reachedAt, 0.67, 0.011));
  // Out of the hold the counter accelerates: it covers far more of the
  // $1,000 → $25,000 tier in its middle tenth of a second than in its first.
  CHECK(afterHold > 100000 && afterHold < 2500000);
  CHECK(midTier - afterHold > 4 * (afterHold - 100000));
  CHECK(lateTier > midTier);
  CHECK(e.revealMilestonesReached() == 2);      // $25,000 too; $80,000 never
  CHECK(!e.isRevealing());
  CHECK(near(shown(), 5000000));

  RollingEngine s;                              // the spin style ignores milestones
  s.setFormat(0, 1);
  s.setRevealTiming(1.0, 0, 1, 0.1);
  s.addRevealMilestone(5);
  s.setRevealMilestoneHold(1.0);
  s.reveal(9, 0);
  CHECK(near(s.revealTotalSeconds(), 1.2));
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
  if (failures == 0) {
    std::printf("RollingEngine: all checks passed\n");
    return 0;
  }
  std::printf("RollingEngine: %d check(s) failed\n", failures);
  return 1;
}
