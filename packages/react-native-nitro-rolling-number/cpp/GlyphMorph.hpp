//
//  GlyphMorph.hpp
//  NitroRollingNumber
//
//  The shape half of the morph transition: one digit's outline turning into
//  another's. The platform hands over each digit's outline once (CoreText's
//  glyph path on iOS, `Paint.getTextPath` on Android) as flattened closed
//  contours; `normalize` makes every contour comparable (a fixed number of
//  points by arc length, one winding, a stable start), and `interpolate`
//  produces the outline part way between two normalized ones, which the
//  platform fills with the even-odd rule. Contours pair by size; a contour
//  with no partner (the second hole of an 8 turning into a 0) shrinks to, or
//  grows from, its own centre.
//
//  Plain arrays and counts so it imports into Swift, bridges over JNI and
//  compiles to WebAssembly. Coordinates are the caller's; y may point either way.
//

#pragma once

#include <vector>

namespace margelo::nitro::nitrorollingnumber {

class GlyphMorph final {
public:
  /// Points per normalized contour.
  static constexpr int kSamples = 64;
  /// Doubles per normalized contour (x, y pairs).
  static constexpr int kContourDoubles = kSamples * 2;

  /// `points`: every contour's vertices in turn, x y x y…; `sizes[i]`: how many
  /// vertices contour i has (a closed polyline, the closing edge implied).
  /// Writes `contourCount * kContourDoubles` doubles to `out`, largest contour
  /// first, and returns the contour count. Contours with fewer than 3
  /// vertices or no area are dropped.
  static int normalize(const double* points, const int* sizes, int contourCount, double* out);

  /// The outline between `a` (`contoursA` normalized contours) and `b` at
  /// `t` 0…1, written to `out` as `max(contoursA, contoursB)` contours of
  /// `kContourDoubles`; returns that count. Paired contours move point to
  /// point (each pair's start aligned by the closest rotation); an unpaired
  /// one scales about its centroid, to nothing (from `a`) or from nothing (in `b`).
  static int interpolate(const double* a, int contoursA, const double* b, int contoursB, double t, double* out);

  /// The largest number of doubles `interpolate` writes for these outlines.
  static int outputDoubles(int contoursA, int contoursB) {
    return (contoursA > contoursB ? contoursA : contoursB) * kContourDoubles;
  }

  // The std::vector forms, for the tests and the WebAssembly bindings.
  static std::vector<double> normalize(const std::vector<double>& points, const std::vector<int>& sizes);
  static std::vector<double> interpolate(const std::vector<double>& a, const std::vector<double>& b, double t);
};

} // namespace margelo::nitro::nitrorollingnumber
