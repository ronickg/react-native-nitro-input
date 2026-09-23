#include "GlyphMorph.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>

namespace margelo::nitro::nitrorollingnumber {

namespace {

constexpr int kS = GlyphMorph::kSamples;
constexpr int kD = GlyphMorph::kContourDoubles;

struct Contour {
  double pts[kD];
  double area;
};

double signedArea(const double* p, int n) {
  double a = 0;
  for (int i = 0; i < n; i++) {
    const int j = (i + 1) % n;
    a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
  }
  return a / 2;
}

/// `n` vertices of a closed polyline resampled to kSamples points by arc length.
bool resample(const double* p, int n, double* out) {
  double total = 0;
  for (int i = 0; i < n; i++) {
    const int j = (i + 1) % n;
    total += std::hypot(p[2 * j] - p[2 * i], p[2 * j + 1] - p[2 * i + 1]);
  }
  if (total <= 0) {
    return false;
  }
  const double step = total / kS;
  int seg = 0;
  double segStart = 0;
  double segLen = std::hypot(p[2 * ((seg + 1) % n)] - p[2 * seg], p[2 * ((seg + 1) % n) + 1] - p[2 * seg + 1]);
  for (int k = 0; k < kS; k++) {
    const double target = k * step;
    while (target > segStart + segLen && seg < n - 1) {
      segStart += segLen;
      seg++;
      segLen = std::hypot(p[2 * ((seg + 1) % n)] - p[2 * seg], p[2 * ((seg + 1) % n) + 1] - p[2 * seg + 1]);
    }
    const double u = segLen > 0 ? std::min(1.0, std::max(0.0, (target - segStart) / segLen)) : 0;
    const int j = (seg + 1) % n;
    out[2 * k] = p[2 * seg] + (p[2 * j] - p[2 * seg]) * u;
    out[2 * k + 1] = p[2 * seg + 1] + (p[2 * j + 1] - p[2 * seg + 1]) * u;
  }
  return true;
}

void centroid(const double* p, double& cx, double& cy) {
  cx = 0;
  cy = 0;
  for (int i = 0; i < kS; i++) {
    cx += p[2 * i];
    cy += p[2 * i + 1];
  }
  cx /= kS;
  cy /= kS;
}

} // namespace

int GlyphMorph::normalize(const double* points, const int* sizes, int contourCount, double* out) {
  std::vector<Contour> contours;
  contours.reserve(static_cast<size_t>(std::max(0, contourCount)));
  size_t offset = 0;
  for (int c = 0; c < contourCount; c++) {
    const int n = sizes[c];
    const double* p = points + offset;
    offset += static_cast<size_t>(2 * std::max(0, n));
    if (n < 3) {
      continue;
    }
    const double area = signedArea(p, n);
    if (std::fabs(area) < 1e-9) {
      continue;
    }
    Contour contour;
    if (!resample(p, n, contour.pts)) {
      continue;
    }
    // One winding for every contour: the fill rule is even-odd, so a hole
    // only needs to be a contour, not a reversed one.
    if (area < 0) {
      for (int i = 0; i < kS / 2; i++) {
        std::swap(contour.pts[2 * i], contour.pts[2 * (kS - 1 - i)]);
        std::swap(contour.pts[2 * i + 1], contour.pts[2 * (kS - 1 - i) + 1]);
      }
    }
    // Start at the topmost point (then the leftmost) so two glyphs' contours begin alike.
    int start = 0;
    for (int i = 1; i < kS; i++) {
      const double y = contour.pts[2 * i + 1];
      const double x = contour.pts[2 * i];
      const double sy = contour.pts[2 * start + 1];
      const double sx = contour.pts[2 * start];
      if (y < sy - 1e-9 || (std::fabs(y - sy) <= 1e-9 && x < sx)) {
        start = i;
      }
    }
    if (start != 0) {
      double rotated[kD];
      for (int i = 0; i < kS; i++) {
        const int j = (start + i) % kS;
        rotated[2 * i] = contour.pts[2 * j];
        rotated[2 * i + 1] = contour.pts[2 * j + 1];
      }
      std::copy(rotated, rotated + kD, contour.pts);
    }
    contour.area = std::fabs(area);
    contours.push_back(contour);
  }
  std::stable_sort(contours.begin(), contours.end(), [](const Contour& l, const Contour& r) { return l.area > r.area; });
  for (size_t c = 0; c < contours.size(); c++) {
    std::copy(contours[c].pts, contours[c].pts + kD, out + c * kD);
  }
  return static_cast<int>(contours.size());
}

int GlyphMorph::interpolate(const double* a, int contoursA, const double* b, int contoursB, double t, double* out) {
  t = std::min(1.0, std::max(0.0, t));
  const int count = std::max(contoursA, contoursB);
  for (int c = 0; c < count; c++) {
    double* o = out + c * kD;
    if (c < contoursA && c < contoursB) {
      const double* pa = a + c * kD;
      const double* pb = b + c * kD;
      // The rotation of b's points that keeps every point closest to its partner.
      int best = 0;
      double bestCost = 1e300;
      for (int shift = 0; shift < kS; shift++) {
        double cost = 0;
        for (int i = 0; i < kS; i++) {
          const int j = (i + shift) % kS;
          const double dx = pa[2 * i] - pb[2 * j];
          const double dy = pa[2 * i + 1] - pb[2 * j + 1];
          cost += dx * dx + dy * dy;
          if (cost >= bestCost) {
            break;
          }
        }
        if (cost < bestCost) {
          bestCost = cost;
          best = shift;
        }
      }
      for (int i = 0; i < kS; i++) {
        const int j = (i + best) % kS;
        o[2 * i] = pa[2 * i] + (pb[2 * j] - pa[2 * i]) * t;
        o[2 * i + 1] = pa[2 * i + 1] + (pb[2 * j + 1] - pa[2 * i + 1]) * t;
      }
    } else {
      // Unpaired: a's extra contour closes onto its centre, b's opens from it.
      const bool leaving = c < contoursA;
      const double* p = leaving ? a + c * kD : b + c * kD;
      const double scale = leaving ? 1 - t : t;
      double cx, cy;
      centroid(p, cx, cy);
      for (int i = 0; i < kS; i++) {
        o[2 * i] = cx + (p[2 * i] - cx) * scale;
        o[2 * i + 1] = cy + (p[2 * i + 1] - cy) * scale;
      }
    }
  }
  return count;
}

std::vector<double> GlyphMorph::normalize(const std::vector<double>& points, const std::vector<int>& sizes) {
  std::vector<double> out(sizes.size() * static_cast<size_t>(kD));
  const int count = normalize(points.data(), sizes.data(), static_cast<int>(sizes.size()), out.data());
  out.resize(static_cast<size_t>(count) * kD);
  return out;
}

std::vector<double> GlyphMorph::interpolate(const std::vector<double>& a, const std::vector<double>& b, double t) {
  const int ca = static_cast<int>(a.size() / kD);
  const int cb = static_cast<int>(b.size() / kD);
  std::vector<double> out(static_cast<size_t>(outputDoubles(ca, cb)));
  interpolate(a.data(), ca, b.data(), cb, t, out.data());
  return out;
}

} // namespace margelo::nitro::nitrorollingnumber
