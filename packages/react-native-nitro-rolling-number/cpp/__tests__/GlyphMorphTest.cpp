// Host-side checks for the morph geometry. Built with the engine tests (`bun run test:cpp`).
#include "GlyphMorph.hpp"

#include <cmath>
#include <cstdio>

using margelo::nitro::nitrorollingnumber::GlyphMorph;

static int morphFailures = 0;

#define MCHECK(cond)                                                                  \
  do {                                                                                \
    if (!(cond)) {                                                                    \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);                     \
      morphFailures++;                                                                \
    }                                                                                 \
  } while (0)

static std::vector<double> square(double x, double y, double s, bool clockwise) {
  std::vector<double> p = {x, y, x + s, y, x + s, y + s, x, y + s};
  if (clockwise) {
    p = {x, y, x, y + s, x + s, y + s, x + s, y};
  }
  return p;
}

int glyphMorphTests() {
  constexpr int D = GlyphMorph::kContourDoubles;
  // A square with a hole (a "0") turns into a plain square (a "1"): the hole closes onto its centre.
  std::vector<double> zero = square(0, 0, 10, false);
  std::vector<double> hole = square(3, 3, 4, true);
  zero.insert(zero.end(), hole.begin(), hole.end());
  const std::vector<double> a = GlyphMorph::normalize(zero, {4, 4});
  MCHECK(a.size() == static_cast<size_t>(2 * D));
  // Largest first, starting at the top-left, each keeping its own winding (the hole runs against the outer).
  MCHECK(std::fabs(a[0] - 0) < 1e-9 && std::fabs(a[1] - 0) < 1e-9);
  MCHECK(std::fabs(a[D] - 3) < 1e-9 && std::fabs(a[D + 1] - 3) < 1e-9);
  auto area = [&](const double* p) {
    double s = 0;
    for (int i = 0; i < GlyphMorph::kSamples; i++) {
      const int j = (i + 1) % GlyphMorph::kSamples;
      s += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
    }
    return s / 2;
  };
  MCHECK((area(a.data()) > 0) != (area(a.data() + D) > 0));

  const std::vector<double> b = GlyphMorph::normalize(square(0, 0, 10, false), {4});
  MCHECK(b.size() == static_cast<size_t>(D));

  const std::vector<double> half = GlyphMorph::interpolate(a, b, 0.5);
  MCHECK(half.size() == static_cast<size_t>(2 * D));
  // The outer square stays put; the hole has halved about its centre (5, 5).
  MCHECK(std::fabs(half[0] - 0) < 1e-9);
  double minX = 1e9, maxX = -1e9;
  for (int i = 0; i < GlyphMorph::kSamples; i++) {
    minX = std::min(minX, half[D + 2 * i]);
    maxX = std::max(maxX, half[D + 2 * i]);
  }
  MCHECK(std::fabs(minX - 4) < 1e-9 && std::fabs(maxX - 6) < 1e-9);
  const std::vector<double> end = GlyphMorph::interpolate(a, b, 1);
  MCHECK(std::fabs(end[D] - 5) < 1e-9 && std::fabs(end[D + 1] - 5) < 1e-9);

  // Point to point: a square becoming a translated square moves every point by the offset.
  const std::vector<double> c = GlyphMorph::normalize(square(20, 0, 10, false), {4});
  const std::vector<double> mid = GlyphMorph::interpolate(b, c, 0.5);
  for (int i = 0; i < GlyphMorph::kSamples; i++) {
    MCHECK(std::fabs((mid[2 * i] - b[2 * i]) - 10) < 1e-6);
    MCHECK(std::fabs(mid[2 * i + 1] - b[2 * i + 1]) < 1e-6);
  }

  // Aligning once and interpolating without the search is the same outline.
  const std::vector<double> aligned = GlyphMorph::align(b, c);
  std::vector<double> fast(static_cast<size_t>(D));
  GlyphMorph::interpolate(b.data(), 1, aligned.data(), 1, 0.5, fast.data(), true);
  for (int i = 0; i < D; i++) {
    MCHECK(std::fabs(fast[i] - mid[i]) < 1e-9);
  }

  // Degenerate contours are dropped.
  const std::vector<double> flat = GlyphMorph::normalize({0, 0, 5, 0, 10, 0}, {3});
  MCHECK(flat.empty());
  return morphFailures;
}
