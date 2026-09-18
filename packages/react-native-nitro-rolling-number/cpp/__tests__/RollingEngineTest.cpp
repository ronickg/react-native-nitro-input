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

int main() {
  odometerPositions();
  tickerRollsShortestPathInDirection();
  wheelsAppearAndDisappear();
  staggerDoesNotStarveOnRetarget();
  rapidRetargetsKeepRolling();
  loadingFadeAndReduceMotion();
  settledTargetForAccessibility();
  if (failures == 0) {
    std::printf("RollingEngine: all checks passed\n");
    return 0;
  }
  std::printf("RollingEngine: %d check(s) failed\n", failures);
  return 1;
}
