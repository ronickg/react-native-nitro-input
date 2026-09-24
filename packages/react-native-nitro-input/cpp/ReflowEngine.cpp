//
//  ReflowEngine.cpp
//  NitroInput
//

#include "ReflowEngine.hpp"

#include <algorithm>
#include <cmath>
#include <utility>

namespace margelo::nitro::nitroinput {

namespace {

constexpr double kPi = 3.14159265358979323846;
/// Text glyphs scale to/from this while fading (Torph's `scale` option).
constexpr double kFadeScale = 0.95;
/// Opacity ramps, as fractions of the duration (Torph's shares).
constexpr double kTextEnterFadeFrom = 0.25;
constexpr double kTextEnterFadeTo = 0.75;
constexpr double kTextExitFadeTo = 0.25;
constexpr double kSlideEnterFadeTo = 0.25;
/// Larger: a digit that has already left is a hole in the number.
constexpr double kSlideExitFadeTo = 0.45;
/// A glyph interrupted on its way in regains full opacity within this share.
constexpr double kPersistFadeTo = 0.25;
/// Where characters moving becomes one thing swapped for another (Torph's
/// `GROUP_MIN`). A run this long with no survivor inside it has nothing near
/// enough to animate from, and sliding each glyph only smears it.
constexpr int kGroupMin = 6;
/// Deeper than a character's 0.95, so the run reads as receding, not settling.
constexpr double kGroupScale = 0.8;
constexpr double kGroupExitFadeTo = 0.45;
constexpr double kGroupEnterFadeTo = 0.35;

double clamp01(double v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

/// y of the cubic Bézier (x1, y1, x2, y2) at x, like CSS `cubic-bezier`.
double cubicBezier(double x1, double y1, double x2, double y2, double x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const auto sampleX = [&](double t) { return ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t; };
  const auto sampleY = [&](double t) { return ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t; };
  const auto slopeX = [&](double t) { return 3 * (1 - 3 * x2 + 3 * x1) * t * t + 2 * (3 * x2 - 6 * x1) * t + 3 * x1; };
  double t = x;
  for (int i = 0; i < 8; ++i) {
    const double err = sampleX(t) - x;
    if (std::fabs(err) < 1e-7) return sampleY(t);
    const double slope = slopeX(t);
    if (std::fabs(slope) < 1e-6) break;
    t -= err / slope;
  }
  double lo = 0, hi = 1;
  t = x;
  while (hi - lo > 1e-7) {
    if (sampleX(t) < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

/// Step response of a damped spring, normalised so it has settled at t == 1
/// (the same curve as the rolling number's `spring` easing).
double spring(double t, double bounce) {
  const double zeta = std::min(1.0, std::max(0.05, 1.0 - clamp01(bounce)));
  const double omega = 3.0 * kPi;
  const double k = zeta * omega;
  if (zeta >= 0.999) {
    return 1 - (1 + k * t) * std::exp(-k * t);
  }
  const double wd = omega * std::sqrt(1 - zeta * zeta);
  return 1 - std::exp(-k * t) * (std::cos(wd * t) + (k / wd) * std::sin(wd * t));
}

/// Longest common subsequence as index pairs, walked forwards so ties go to
/// the earliest match (backwards, a repeated character flies across the text).
template <class Equal>
void lcsPairs(int m, int n, Equal equal, std::vector<std::pair<int, int>>& out) {
  if (m == 0 || n == 0) return;
  std::vector<int> dp(static_cast<size_t>((m + 1) * (n + 1)), 0);
  const auto at = [&](int i, int j) -> int& { return dp[static_cast<size_t>(i * (n + 1) + j)]; };
  for (int i = m - 1; i >= 0; --i) {
    for (int j = n - 1; j >= 0; --j) {
      at(i, j) = equal(i, j) ? at(i + 1, j + 1) + 1 : std::max(at(i + 1, j), at(i, j + 1));
    }
  }
  int i = 0, j = 0;
  while (i < m && j < n) {
    if (equal(i, j)) {
      out.emplace_back(i, j);
      ++i;
      ++j;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      ++i;
    } else {
      ++j;
    }
  }
}

double ramp(double p, double from, double to) {
  if (to <= from) return p >= to ? 1 : 0;
  return clamp01((p - from) / (to - from));
}

} // namespace

ReflowEngine::ReflowEngine() = default;
ReflowEngine::~ReflowEngine() = default;
ReflowEngine::ReflowEngine(const ReflowEngine&) = default;
ReflowEngine& ReflowEngine::operator=(const ReflowEngine&) = default;
ReflowEngine::ReflowEngine(ReflowEngine&&) noexcept = default;
ReflowEngine& ReflowEngine::operator=(ReflowEngine&&) noexcept = default;

// MARK: - Configuration

void ReflowEngine::setTiming(double durationSeconds, int easing, double bounce) {
  duration_ = std::max(0.0, durationSeconds);
  easing_ = easing;
  bounce_ = bounce;
}

void ReflowEngine::setEffect(int effect) {
  effect_ = effect;
}

void ReflowEngine::setReduceMotion(bool reduceMotion) {
  reduceMotion_ = reduceMotion;
}

double ReflowEngine::ease(double t) const {
  t = clamp01(t);
  switch (easing_) {
    case 1: return 1 - std::pow(1 - t, 3);
    case 2: return t < 0.5 ? 4 * t * t * t : 1 - std::pow(-2 * t + 2, 3) / 2;
    case 3: return t;
    case 4: return spring(t, bounce_);
    default: return cubicBezier(0.19, 1, 0.22, 1, t);
  }
}

bool ReflowEngine::slides(int kind) const {
  if (effect_ == 1) return true;
  if (effect_ == 2) return false;
  return kind != Text;
}

bool ReflowEngine::same(const Input& in, const Slot& slot) const {
  return in.character == slot.g.character && in.kind == slot.g.kind && in.role == slot.g.role &&
         in.placeholder == slot.g.placeholder;
}

int ReflowEngine::slotIndexOf(int64_t id) const {
  for (size_t i = 0; i < slots_.size(); ++i) {
    if (slots_[i].g.id == id) return static_cast<int>(i);
  }
  return -1;
}

// MARK: - Text

void ReflowEngine::beginText() {
  pending_.clear();
}

void ReflowEngine::addGlyph(uint32_t character, int role, int kind, double width, bool placeholder) {
  pending_.push_back(Input{character, role, kind, std::max(0.0, width), placeholder});
}

void ReflowEngine::snapTo(const std::vector<Input>& inputs) {
  slots_.clear();
  slots_.reserve(inputs.size());
  double x = 0;
  for (const auto& in : inputs) {
    Slot s;
    s.g = Glyph{nextId_++, in.character, in.role, in.kind, in.width, in.placeholder, x, 0, 1, 1, false};
    s.fromX = s.toX = x;
    s.slide = slides(in.kind) && !in.placeholder;
    slots_.push_back(s);
    x += in.width;
  }
  contentWidth_ = targetWidth_ = widthFrom_ = x;
  animating_ = false;
  publish();
}

/// Text mode hands every character in as `Text`. A body that is a number in
/// disguise (a phone number, a date, an amount typed into a plain field: digits
/// and punctuation, no letters) gets the number treatment instead, so its
/// digits slide and its separators reflow like a formatted amount's.
static void classifyNumericBody(std::vector<ReflowEngine::Input>& inputs) {
  bool digits = false;
  for (const auto& in : inputs) {
    if (in.role != ReflowEngine::Body) continue;
    if (in.kind != ReflowEngine::Text) return;   // already classified (number mode)
    const uint32_t c = in.character;
    if (c >= '0' && c <= '9') {
      digits = true;
    } else if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c > 0x7f) {
      return;                                    // real text
    }
  }
  if (!digits) return;
  for (auto& in : inputs) {
    if (in.role != ReflowEngine::Body) continue;
    const uint32_t c = in.character;
    in.kind = (c >= '0' && c <= '9') ? ReflowEngine::Digit : ReflowEngine::Separator;
  }
  // A lone '.' or ',' is the decimal point: the pivot the digits pair around,
  // part of the typed sequence like them, not a grouping separator that
  // reflows with the magnitude. As a separator it was re-paired from the
  // units end and, since the integer count then included the fraction
  // digits, every keystroke after it read as a reshape: the point left
  // downwards and rose again in the very same place. The last such character
  // is the candidate ("1,234.56" keeps its comma as grouping), and only when
  // it occurs once: "192.168.0.1" and "21.09.2026" are structure.
  int decimal = -1;
  for (size_t i = 0; i < inputs.size(); ++i) {
    if (inputs[i].role != ReflowEngine::Body) continue;
    if (inputs[i].character == '.' || inputs[i].character == ',') decimal = static_cast<int>(i);
  }
  if (decimal < 0) return;
  int occurrences = 0;
  for (const auto& in : inputs) {
    if (in.role == ReflowEngine::Body && in.character == inputs[static_cast<size_t>(decimal)].character) ++occurrences;
  }
  if (occurrences == 1) inputs[static_cast<size_t>(decimal)].kind = ReflowEngine::Decimal;
}

void ReflowEngine::commitText(int caretIndex, double now) {
  now_ = now;
  std::vector<Input> inputs;
  inputs.swap(pending_);
  classifyNumericBody(inputs);

  // A placeholder is not a value: it is what the field shows instead of one.
  // Replacing it is a change of state rather than a reflow, so the zero standing
  // in for an empty field does not roll into the digit that lands on it.
  const bool fromPlaceholder =
      std::any_of(slots_.begin(), slots_.end(), [](const Slot& s) { return !s.g.exiting && s.g.placeholder; });
  if (!committed_ || duration_ <= 0 || reduceMotion_ || fromPlaceholder) {
    snapTo(inputs);
    committed_ = true;
    return;
  }

  // Live (non-exiting) old glyphs and new glyphs, by role.
  std::vector<int> oldByRole[3], newByRole[3];
  for (size_t i = 0; i < slots_.size(); ++i) {
    if (!slots_[i].g.exiting) oldByRole[std::clamp(slots_[i].g.role, 0, 2)].push_back(static_cast<int>(i));
  }
  for (size_t i = 0; i < inputs.size(); ++i) {
    newByRole[std::clamp(inputs[i].role, 0, 2)].push_back(static_cast<int>(i));
  }

  // matchOfNew[new index] = old slot index, or -1.
  std::vector<int> matchOfNew(inputs.size(), -1);
  matchBySequence(inputs, oldByRole[Prefix], newByRole[Prefix], matchOfNew);
  matchBody(inputs, oldByRole[Body], newByRole[Body], caretIndex, matchOfNew);
  matchBySequence(inputs, oldByRole[Suffix], newByRole[Suffix], matchOfNew);

  std::vector<bool> used(slots_.size(), false);
  for (int m : matchOfNew) {
    if (m >= 0) used[static_cast<size_t>(m)] = true;
  }

  // Targets of the new layout.
  std::vector<double> targetX(inputs.size(), 0);
  double x = 0;
  for (size_t i = 0; i < inputs.size(); ++i) {
    targetX[i] = x;
    x += inputs[i].width;
  }

  // Nearest persisting neighbour in the new order (backward first), for entering glyphs.
  const auto anchorForNew = [&](size_t index) -> int {
    for (size_t j = index; j-- > 0;) {
      if (matchOfNew[j] >= 0) return matchOfNew[j];
    }
    for (size_t j = index + 1; j < inputs.size(); ++j) {
      if (matchOfNew[j] >= 0) return matchOfNew[j];
    }
    return -1;
  };
  // Nearest persisting neighbour in the old order (forward first), for exiting glyphs.
  std::vector<int> oldLive;
  for (size_t i = 0; i < slots_.size(); ++i) {
    if (!slots_[i].g.exiting) oldLive.push_back(static_cast<int>(i));
  }
  const auto anchorForOld = [&](int slotIndex) -> int {
    size_t pos = 0;
    while (pos < oldLive.size() && oldLive[pos] != slotIndex) ++pos;
    for (size_t j = pos + 1; j < oldLive.size(); ++j) {
      if (used[static_cast<size_t>(oldLive[j])]) return oldLive[j];
    }
    for (size_t j = pos; j-- > 0;) {
      if (used[static_cast<size_t>(oldLive[j])]) return oldLive[j];
    }
    return -1;
  };

  // A run of adjacent glyphs that are wholly replaced — no survivor inside it —
  // recedes as one shape instead of each glyph sliding a line box on its own. A
  // survivor breaks the run: it is right there to animate against.
  const auto closeRun = [&](const auto& extent) {
    if (runBuf_.size() >= static_cast<size_t>(kGroupMin)) {
      double lo = 0, hi = 0;
      for (size_t k = 0; k < runBuf_.size(); ++k) {
        const auto [left, right] = extent(runBuf_[k]);
        if (k == 0) { lo = left; hi = right; }
        else { lo = std::min(lo, left); hi = std::max(hi, right); }
      }
      const double mid = (lo + hi) / 2;
      for (size_t i : runBuf_) { groupFlag_[i] = 1; groupCentre_[i] = mid; }
    }
    runBuf_.clear();
  };

  // Old glyphs still on stage, in order; a run is measured where they sit now.
  // One already leaving is not on stage at all, so it neither joins nor breaks.
  groupFlag_.assign(slots_.size(), 0);
  groupCentre_.assign(slots_.size(), 0.0);
  runBuf_.clear();
  const auto oldExtent = [&](size_t i) {
    return std::pair<double, double>{slots_[i].g.x, slots_[i].g.x + slots_[i].g.width};
  };
  for (size_t i = 0; i < slots_.size(); ++i) {
    if (slots_[i].g.exiting) continue;
    if (used[i]) { closeRun(oldExtent); continue; }
    runBuf_.push_back(i);
  }
  closeRun(oldExtent);

  std::vector<Slot> next;
  next.reserve(slots_.size() + inputs.size());

  // Old glyphs that leave, and those already leaving, are drawn underneath the text.
  for (size_t i = 0; i < slots_.size(); ++i) {
    Slot s = slots_[i];
    if (s.g.exiting) {
      // Its anchor may be leaving now too: freeze where it is.
      if (s.anchorId >= 0) {
        const int a = slotIndexOf(s.anchorId);
        if (a < 0 || !used[static_cast<size_t>(a)]) {
          s.anchorId = -1;
          s.fromX = s.g.x;
        }
      }
      next.push_back(s);
      continue;
    }
    if (used[i]) continue;
    s.g.exiting = true;
    s.entering = false;
    s.start = now;
    s.fromX = s.toX = s.g.x;
    s.fromY = s.g.y;
    // Everything leaves downwards (Torph): digits pass through the line box like
    // an odometer, separators drop back to where they came in from.
    s.toY = s.slide ? 1 : 0;
    s.fromOpacity = s.g.opacity;
    s.toOpacity = 0;
    s.fadeFrom = 0;
    s.fadeTo = s.slide ? kSlideExitFadeTo : kTextExitFadeTo;
    s.fromScale = s.g.scale;
    s.toScale = s.slide ? 1 : kFadeScale;
    if (groupFlag_[i]) {
      // The whole run recedes into itself: no slide, no anchor to ride.
      s.grouped = true;
      s.groupCentre = groupCentre_[i];
      s.toY = s.fromY;
      s.fromScale = s.g.scale;
      s.toScale = kGroupScale;
      s.fadeTo = kGroupExitFadeTo;
      s.anchorId = -1;
      next.push_back(s);
      continue;
    }
    const int a = anchorForOld(static_cast<int>(i));
    s.anchorId = a >= 0 ? slots_[static_cast<size_t>(a)].g.id : -1;
    s.anchorBaseX = a >= 0 ? slots_[static_cast<size_t>(a)].g.x : 0;
    next.push_back(s);
  }

  // Arriving glyphs, measured where the new layout puts them. The exit pass is
  // done with the buffers by now, so they are reused rather than grown again.
  groupFlag_.assign(inputs.size(), 0);
  groupCentre_.assign(inputs.size(), 0.0);
  runBuf_.clear();
  const auto newExtent = [&](size_t i) {
    return std::pair<double, double>{targetX[i], targetX[i] + inputs[i].width};
  };
  for (size_t i = 0; i < inputs.size(); ++i) {
    if (matchOfNew[i] >= 0) { closeRun(newExtent); continue; }
    runBuf_.push_back(i);
  }
  closeRun(newExtent);

  for (size_t i = 0; i < inputs.size(); ++i) {
    const Input& in = inputs[i];
    const int m = matchOfNew[i];
    if (m >= 0) {
      Slot s = slots_[static_cast<size_t>(m)];
      s.g.width = in.width;
      s.entering = false;
      s.slide = slides(in.kind) && !in.placeholder;
      s.start = now;
      s.fromX = s.g.x;
      s.toX = targetX[i];
      s.fromY = s.g.y;
      s.toY = 0;
      s.fromOpacity = s.g.opacity;
      s.toOpacity = 1;
      s.fadeFrom = 0;
      s.fadeTo = kPersistFadeTo;
      s.fromScale = s.g.scale;
      s.toScale = 1;
      s.anchorId = -1;
      next.push_back(s);
    } else {
      Slot s;
      const bool slide = slides(in.kind) && !in.placeholder;
      s.slide = slide;
      s.entering = true;
      s.start = now;
      s.fromX = s.toX = targetX[i];
      s.fromY = slide ? ((in.kind == Separator || in.kind == Decimal) ? 1 : -1) : 0;
      s.toY = 0;
      s.fromOpacity = 0;
      s.toOpacity = 1;
      s.fadeFrom = slide ? 0 : kTextEnterFadeFrom;
      s.fadeTo = slide ? kSlideEnterFadeTo : kTextEnterFadeTo;
      s.fromScale = slide ? 1 : kFadeScale;
      s.toScale = 1;
      if (groupFlag_[i]) {
        // The same gesture in reverse: the run comes forward out of its centre.
        // Nothing to ride — the run is the whole event.
        s.grouped = true;
        s.groupCentre = groupCentre_[i];
        s.fromY = s.toY = 0;
        s.fromScale = kGroupScale;
        s.fadeTo = kGroupEnterFadeTo;
      } else {
        const int a = anchorForNew(i);
        s.anchorId = a >= 0 ? slots_[static_cast<size_t>(a)].g.id : -1;
        // Rides along with the anchor's remaining travel: x = target + (anchor.x - anchor.target).
        s.anchorBaseX = 0;
        if (a >= 0) {
          for (size_t j = 0; j < inputs.size(); ++j) {
            if (matchOfNew[j] == a) {
              s.anchorBaseX = targetX[j];
              break;
            }
          }
        }
      }
      s.g = Glyph{nextId_++, in.character, in.role, in.kind, in.width, in.placeholder,
                  s.fromX, s.fromY, 0, s.fromScale, false};
      next.push_back(s);
    }
  }

  slots_.swap(next);
  widthFrom_ = contentWidth_;
  targetWidth_ = x;
  widthStart_ = now;
  animating_ = true;
  tick(now);
}

// MARK: - Matching

void ReflowEngine::matchBySequence(const std::vector<Input>& inputs, const std::vector<int>& oldIdx,
                                  const std::vector<int>& newIdx, std::vector<int>& matchOfNew) const {
  std::vector<std::pair<int, int>> pairs;
  lcsPairs(static_cast<int>(oldIdx.size()), static_cast<int>(newIdx.size()),
           [&](int i, int j) { return same(inputs[static_cast<size_t>(newIdx[static_cast<size_t>(j)])], slots_[static_cast<size_t>(oldIdx[static_cast<size_t>(i)])]); },
           pairs);
  for (const auto& [i, j] : pairs) {
    matchOfNew[static_cast<size_t>(newIdx[static_cast<size_t>(j)])] = oldIdx[static_cast<size_t>(i)];
  }
}

void ReflowEngine::matchBody(const std::vector<Input>& inputs, const std::vector<int>& oldBody,
                            const std::vector<int>& newBody, int caretIndex, std::vector<int>& matchOfNew) const {
  if (caretIndex >= 0) {
    matchByCaret(inputs, oldBody, newBody, caretIndex, matchOfNew);
    return;
  }
  bool hasDigits = false;
  for (int i : oldBody) hasDigits = hasDigits || slots_[static_cast<size_t>(i)].g.kind == Digit;
  for (int i : newBody) hasDigits = hasDigits || inputs[static_cast<size_t>(i)].kind == Digit;
  if (hasDigits) {
    matchByPlace(inputs, oldBody, newBody, matchOfNew);
  } else {
    matchBySequence(inputs, oldBody, newBody, matchOfNew);
  }
}

/// The caret in the new text says where the edit was; both sides of it map
/// across by position. Grouping separators are left out of that walk (they
/// reflow with the magnitude, not with the keystroke) and pair from the units
/// end instead, so the thousands comma stays the thousands comma.
void ReflowEngine::matchByCaret(const std::vector<Input>& inputs, const std::vector<int>& oldBody,
                               const std::vector<int>& newBody, int caretIndex, std::vector<int>& matchOfNew) const {
  std::vector<int> keptOld, keptNew, sepOld, sepNew; // positions within the body lists
  for (size_t p = 0; p < oldBody.size(); ++p) {
    (slots_[static_cast<size_t>(oldBody[p])].g.kind == Separator ? sepOld : keptOld).push_back(static_cast<int>(p));
  }
  for (size_t p = 0; p < newBody.size(); ++p) {
    (inputs[static_cast<size_t>(newBody[p])].kind == Separator ? sepNew : keptNew).push_back(static_cast<int>(p));
  }
  const auto pairPositions = [&](int newPos, int oldPos) {
    const int ni = newBody[static_cast<size_t>(newPos)];
    const int oi = oldBody[static_cast<size_t>(oldPos)];
    if (same(inputs[static_cast<size_t>(ni)], slots_[static_cast<size_t>(oi)])) matchOfNew[static_cast<size_t>(ni)] = oi;
  };
  const auto pairKept = [&](int i, int o) {
    if (i < 0 || o < 0 || i >= static_cast<int>(keptNew.size()) || o >= static_cast<int>(keptOld.size())) return;
    pairPositions(keptNew[static_cast<size_t>(i)], keptOld[static_cast<size_t>(o)]);
  };

  int keptCursor = 0;
  while (keptCursor < static_cast<int>(keptNew.size()) && keptNew[static_cast<size_t>(keptCursor)] < caretIndex) ++keptCursor;
  const int lenDiff = static_cast<int>(keptNew.size()) - static_cast<int>(keptOld.size());

  if (lenDiff > 0) {
    const int editStart = keptCursor - lenDiff;
    for (int i = 0; i < editStart; ++i) pairKept(i, i);
    for (int i = keptCursor; i < static_cast<int>(keptNew.size()); ++i) pairKept(i, i - lenDiff);
  } else if (lenDiff < 0) {
    for (int i = 0; i < keptCursor; ++i) pairKept(i, i);
    for (int i = keptCursor; i < static_cast<int>(keptNew.size()); ++i) pairKept(i, i - lenDiff);
  } else {
    for (int i = 0; i < static_cast<int>(keptNew.size()); ++i) pairKept(i, i);
  }

  // Identical separators (grouping commas) pair from the units end so the
  // thousands comma stays the thousands comma; a mask's mixed punctuation
  // ("(555) 123-4567") pairs in order, as a subsequence.
  bool uniform = true;
  const auto sepChar = [&](const std::vector<int>& positions, const std::vector<int>& body, size_t i, bool old) {
    const int index = body[static_cast<size_t>(positions[i])];
    return old ? slots_[static_cast<size_t>(index)].g.character : inputs[static_cast<size_t>(index)].character;
  };
  for (size_t i = 1; i < sepOld.size() && uniform; ++i) uniform = sepChar(sepOld, oldBody, i, true) == sepChar(sepOld, oldBody, 0, true);
  for (size_t i = 0; i < sepNew.size() && uniform; ++i) uniform = sepOld.empty() || sepChar(sepNew, newBody, i, false) == sepChar(sepOld, oldBody, 0, true);
  // A grouping separator only holds its place while the integer columns hold
  // theirs. Type a digit into them and every comma belongs a group further
  // along; gliding it there would drag it sideways across the very digits that
  // just carried, the two passing through each other. So it leaves downwards
  // and a new one rises instead — the same reshape rule the place walk uses.
  // A mask's mixed punctuation is structure, not grouping, and is left alone.
  const auto integerDigits = [&](const std::vector<int>& body, bool old) {
    int count = 0;
    for (size_t p = 0; p < body.size(); ++p) {
      const size_t index = static_cast<size_t>(body[p]);
      const int kind = old ? slots_[index].g.kind : inputs[index].kind;
      if (kind == Decimal) break;
      if (kind == Digit) ++count;
    }
    return count;
  };
  bool carried = false;
  for (size_t p = 0; p < newBody.size() && !carried; ++p) {
    const size_t index = static_cast<size_t>(newBody[p]);
    if (inputs[index].kind == Decimal) break;
    if (inputs[index].kind == Digit && matchOfNew[index] >= 0) carried = true;
  }
  const bool reshaped = carried && integerDigits(oldBody, true) != integerDigits(newBody, false);
  if (uniform) {
    if (!reshaped) {
      for (size_t k = 1; k <= sepOld.size() && k <= sepNew.size(); ++k) {
        pairPositions(sepNew[sepNew.size() - k], sepOld[sepOld.size() - k]);
      }
    }
  } else {
    std::vector<std::pair<int, int>> pairs;
    lcsPairs(static_cast<int>(sepOld.size()), static_cast<int>(sepNew.size()),
             [&](int i, int j) {
               return same(inputs[static_cast<size_t>(newBody[static_cast<size_t>(sepNew[static_cast<size_t>(j)])])],
                           slots_[static_cast<size_t>(oldBody[static_cast<size_t>(sepOld[static_cast<size_t>(i)])])]);
             },
             pairs);
    for (const auto& [i, j] : pairs) pairPositions(sepNew[static_cast<size_t>(j)], sepOld[static_cast<size_t>(i)]);
  }
}

/// Pairs digits by their distance from the decimal separator: a digit's
/// identity is its column. When the integer part gained or lost columns the
/// digits pair by subsequence from the units end instead, and the separators,
/// which would have to cross them, leave.
void ReflowEngine::matchByPlace(const std::vector<Input>& inputs, const std::vector<int>& oldBody,
                               const std::vector<int>& newBody, std::vector<int>& matchOfNew) const {
  const int n = static_cast<int>(oldBody.size());
  const int m = static_cast<int>(newBody.size());
  const auto oldSlot = [&](int p) -> const Slot& { return slots_[static_cast<size_t>(oldBody[static_cast<size_t>(p)])]; };
  const auto newIn = [&](int p) -> const Input& { return inputs[static_cast<size_t>(newBody[static_cast<size_t>(p)])]; };
  const auto pair = [&](int newPos, int oldPos) {
    if (same(newIn(newPos), oldSlot(oldPos))) matchOfNew[static_cast<size_t>(newBody[static_cast<size_t>(newPos)])] = oldBody[static_cast<size_t>(oldPos)];
  };

  int start = 0;
  while (start < n && start < m && oldSlot(start).g.kind != Digit && same(newIn(start), oldSlot(start))) {
    pair(start, start);
    ++start;
  }
  int oldEnd = n, newEnd = m;
  while (oldEnd > start && newEnd > start && oldSlot(oldEnd - 1).g.kind != Digit && same(newIn(newEnd - 1), oldSlot(oldEnd - 1))) {
    pair(newEnd - 1, oldEnd - 1);
    --oldEnd;
    --newEnd;
  }

  int oldPivot = oldEnd, newPivot = newEnd;
  for (int i = oldEnd - 1; i >= start; --i) {
    if (oldSlot(i).g.kind == Decimal) { oldPivot = i; break; }
  }
  for (int i = newEnd - 1; i >= start; --i) {
    if (newIn(i).kind == Decimal) { newPivot = i; break; }
  }

  std::vector<int> oldInt, newInt;
  for (int i = start; i < oldPivot; ++i) if (oldSlot(i).g.kind == Digit) oldInt.push_back(i);
  for (int i = start; i < newPivot; ++i) if (newIn(i).kind == Digit) newInt.push_back(i);

  // Past this the digits overlap into a smear and nothing should carry across.
  constexpr int kMagnitudeJump = 3;
  if (!oldInt.empty() && !newInt.empty() &&
      std::abs(static_cast<int>(oldInt.size()) - static_cast<int>(newInt.size())) >= kMagnitudeJump) {
    return;
  }

  bool reshaped = false;
  if (oldInt.size() == newInt.size()) {
    for (size_t k = 0; k < oldInt.size(); ++k) pair(newInt[k], oldInt[k]);
  } else {
    // Reversed, so the subsequence walk resolves its ties from the units end.
    std::vector<std::pair<int, int>> pairs;
    lcsPairs(static_cast<int>(oldInt.size()), static_cast<int>(newInt.size()),
             [&](int i, int j) {
               return same(newIn(newInt[newInt.size() - 1 - static_cast<size_t>(j)]), oldSlot(oldInt[oldInt.size() - 1 - static_cast<size_t>(i)]));
             },
             pairs);
    for (const auto& [i, j] : pairs) {
      pair(newInt[newInt.size() - 1 - static_cast<size_t>(j)], oldInt[oldInt.size() - 1 - static_cast<size_t>(i)]);
    }
    reshaped = !pairs.empty();
  }

  if (!reshaped) {
    for (int k = 1; oldPivot - k >= start && newPivot - k >= start; ++k) {
      if (oldSlot(oldPivot - k).g.kind != Digit) pair(newPivot - k, oldPivot - k);
    }
  }

  if (oldPivot < oldEnd && newPivot < newEnd) {
    pair(newPivot, oldPivot);
    for (int k = 1; oldPivot + k < oldEnd && newPivot + k < newEnd; ++k) {
      if (oldSlot(oldPivot + k).g.kind != Digit) pair(newPivot + k, oldPivot + k);
    }
    std::vector<int> oldFrac, newFrac;
    for (int i = oldPivot + 1; i < oldEnd; ++i) if (oldSlot(i).g.kind == Digit) oldFrac.push_back(i);
    for (int i = newPivot + 1; i < newEnd; ++i) if (newIn(i).kind == Digit) newFrac.push_back(i);
    for (size_t k = 0; k < oldFrac.size() && k < newFrac.size(); ++k) pair(newFrac[k], oldFrac[k]);
  }
}

// MARK: - Frames

bool ReflowEngine::tick(double now) {
  now_ = now;
  if (!animating_) return false;
  bool moving = false;
  // A frame timed exactly `duration` after the start counts as finished (float slack).
  const auto progress = [&](double start) { return duration_ > 0 ? clamp01((now - start + 1e-9) / duration_) : 1.0; };

  const double wp = progress(widthStart_);
  contentWidth_ = widthFrom_ + (targetWidth_ - widthFrom_) * ease(wp);
  if (wp < 1) moving = true;

  // Anchors first (glyphs that stay), then the glyphs riding along with them.
  for (int pass = 0; pass < 2; ++pass) {
    for (auto& s : slots_) {
      const bool anchored = s.anchorId >= 0;
      if ((pass == 0) == anchored) continue;
      const double p = progress(s.start);
      const double e = ease(p);
      if (anchored) {
        const int a = slotIndexOf(s.anchorId);
        const double base = s.g.exiting ? s.fromX : s.toX;
        if (a >= 0) {
          s.g.x = base + (slots_[static_cast<size_t>(a)].g.x - s.anchorBaseX);
        } else {
          s.anchorId = -1;
          s.fromX = s.toX = base;
          s.g.x = base;
        }
      } else if (s.grouped) {
        // One shared scale, expressed per glyph: `scale` is about a glyph's own
        // centre, so put that centre where scaling the run about `groupCentre`
        // would have carried it.
        const double sc = s.fromScale + (s.toScale - s.fromScale) * e;
        const double rest = s.toX + s.g.width / 2;
        s.g.x = s.groupCentre + sc * (rest - s.groupCentre) - s.g.width / 2;
      } else {
        s.g.x = s.fromX + (s.toX - s.fromX) * e;
      }
      s.g.y = s.fromY + (s.toY - s.fromY) * e;
      s.g.scale = s.fromScale + (s.toScale - s.fromScale) * e;
      s.g.opacity = s.fromOpacity + (s.toOpacity - s.fromOpacity) * ramp(p, s.fadeFrom, s.fadeTo);
      if (p < 1) moving = true;
    }
  }

  slots_.erase(std::remove_if(slots_.begin(), slots_.end(),
                              [&](const Slot& s) { return s.g.exiting && progress(s.start) >= 1; }),
               slots_.end());

  animating_ = moving;
  publish();
  return moving;
}

bool ReflowEngine::needsFrames() const {
  return animating_;
}

// MARK: - Render state

int ReflowEngine::bodyCount() const {
  int count = 0;
  for (const auto& s : slots_) {
    if (!s.g.exiting && s.g.role == Body) ++count;
  }
  return count;
}

namespace {

/// The horizontal extent of one block of the run.
struct Block {
  double start = 0;
  double end = 0;
  bool any = false;
  void add(double x, double width) {
    if (!any) {
      start = x;
      end = x + width;
      any = true;
    } else {
      start = std::min(start, x);
      end = std::max(end, x + width);
    }
  }
};

/// Whitespace an affix uses to keep its distance from the digits.
bool isSpace(uint32_t c) {
  return c == 0x20 || c == 0xA0 || c == 0x2009 || c == 0x202F;
}

/// The run in six blocks: the prefix's ink and the space it ends with, a sign
/// laid out ahead of the prefix (`signPlacement: 'beforeAffix'` - a body
/// glyph, but outside the body's extent), the rest of the body, and the space
/// the suffix starts with and its ink. The spaces are blocks of their own so
/// that, mirrored, they stay against the digits rather than ending up on the
/// outside: " USD" after the number becomes "USD " before it.
struct Blocks {
  Block prefix, prefixGap, sign, rest, suffixGap, suffix;
  /// The extent of every prefix glyph, gap included.
  Block wholePrefix;
  /// Right edge of the prefix's last ink, left edge of the suffix's first.
  double prefixInkEnd = 0;
  double suffixInkStart = 0;
  bool aheadOfPrefix(const ReflowEngine::Glyph& g) const {
    return wholePrefix.any && g.x + g.width <= wholePrefix.start + 1e-6;
  }
  bool prefixGapGlyph(const ReflowEngine::Glyph& g) const {
    return g.role == ReflowEngine::Prefix && isSpace(g.character) && g.x >= prefixInkEnd - 1e-6;
  }
  bool suffixGapGlyph(const ReflowEngine::Glyph& g) const {
    return g.role == ReflowEngine::Suffix && isSpace(g.character) && g.x + g.width <= suffixInkStart + 1e-6;
  }
  const Block& of(const ReflowEngine::Glyph& g) const {
    if (g.role == ReflowEngine::Prefix) return prefixGapGlyph(g) ? prefixGap : prefix;
    if (g.role == ReflowEngine::Suffix) return suffixGapGlyph(g) ? suffixGap : suffix;
    return aheadOfPrefix(g) ? sign : rest;
  }
};

Blocks blocksOf(const std::vector<ReflowEngine::Glyph>& glyphs) {
  Blocks b;
  bool prefixInk = false;
  bool suffixInk = false;
  for (const auto& g : glyphs) {
    if (g.role == ReflowEngine::Prefix) {
      b.wholePrefix.add(g.x, g.width);
      if (!isSpace(g.character)) {
        b.prefixInkEnd = prefixInk ? std::max(b.prefixInkEnd, g.x + g.width) : g.x + g.width;
        prefixInk = true;
      }
    } else if (g.role == ReflowEngine::Suffix && !isSpace(g.character)) {
      b.suffixInkStart = suffixInk ? std::min(b.suffixInkStart, g.x) : g.x;
      suffixInk = true;
    }
  }
  // An affix that is all space has no ink to be inside of: it is one block.
  if (!prefixInk) b.prefixInkEnd = b.wholePrefix.any ? b.wholePrefix.end : 0;
  if (!suffixInk) b.suffixInkStart = -1;
  for (const auto& g : glyphs) {
    if (g.role == ReflowEngine::Prefix) {
      (b.prefixGapGlyph(g) ? b.prefixGap : b.prefix).add(g.x, g.width);
    } else if (g.role == ReflowEngine::Suffix) {
      (b.suffixGapGlyph(g) ? b.suffixGap : b.suffix).add(g.x, g.width);
    } else if (b.aheadOfPrefix(g)) {
      b.sign.add(g.x, g.width);
    } else {
      b.rest.add(g.x, g.width);
    }
  }
  return b;
}

/// Where `x`, inside `block`, lands once the block is at its mirror image.
double mirrored(double x, const Block& block, double total) {
  return total - block.end + (x - block.start);
}

} // namespace

// Under a right-to-left layout the prefix belongs at the start edge, which is
// the right, and the suffix at the end; the body stays a left-to-right run,
// because a number reads the same way in every script. So the run is mirrored
// block by block rather than glyph by glyph: each block moves to where its
// mirror image would be and keeps its own order inside. `slots_` stay
// left-to-right - the matching, the caret and the animation all reason there -
// and only the published frames move.
void ReflowEngine::publish() {
  glyphs_.clear();
  glyphs_.reserve(slots_.size());
  for (const auto& s : slots_) glyphs_.push_back(s.g);
  caretBlocks_ = CaretBlocks{};
  if (!rightToLeft_ || glyphs_.empty()) return;
  const Blocks b = blocksOf(glyphs_);
  const double total = contentWidth_;
  for (auto& g : glyphs_) g.x = mirrored(g.x, b.of(g), total);
  // The caret lives among the live glyphs alone - one on its way out is drawn
  // but is not part of the text - so its blocks are measured over those, from
  // the slots' left-to-right positions, and kept for `caretX`.
  liveBuf_.clear();
  for (const auto& s : slots_) {
    if (!s.g.exiting) liveBuf_.push_back(s.g);
  }
  const Blocks live = blocksOf(liveBuf_);
  caretBlocks_.sign = Extent{live.sign.start, live.sign.end, live.sign.any};
  caretBlocks_.rest = Extent{live.rest.start, live.rest.end, live.rest.any};
}

void ReflowEngine::setRightToLeft(bool rightToLeft) {
  if (rightToLeft_ == rightToLeft) return;
  rightToLeft_ = rightToLeft;
  publish();
}

double ReflowEngine::caretX(int index) const {
  int seen = 0;
  double afterPrefix = 0;
  double afterLast = -1;
  double x = -1;
  for (const auto& s : slots_) {
    if (s.g.exiting) continue;
    if (s.g.role == Prefix) {
      afterPrefix = s.g.x + s.g.width;
    } else if (s.g.role == Body) {
      if (seen == index && x < 0) x = s.g.x;
      afterLast = s.g.x + s.g.width;
      ++seen;
    }
  }
  if (x < 0) x = afterLast >= 0 ? afterLast : afterPrefix;
  if (!rightToLeft_) return x;
  // The caret lives in the body's block - the sign's for index 0 when the sign
  // is laid out ahead of the prefix - and moves with it. An empty body has no
  // block, and its caret is a point: mirror the point. The blocks were
  // measured when the frame was published (see `publish`).
  const Extent& block = (index == 0 && caretBlocks_.sign.any) ? caretBlocks_.sign : caretBlocks_.rest;
  if (!block.any) return contentWidth_ - x;
  return contentWidth_ - block.end + (x - block.start);
}

void ReflowEngine::reset() {
  duration_ = 0.4;
  easing_ = 0;
  bounce_ = 0.15;
  effect_ = 0;
  pending_.clear();
  slots_.clear();
  glyphs_.clear();
  caretBlocks_ = CaretBlocks{};
  committed_ = false;
  animating_ = false;
  contentWidth_ = targetWidth_ = widthFrom_ = 0;
}

} // namespace margelo::nitro::nitroinput
