# Changelog

## 0.1.0 (unreleased)

- Initial release: native rolling number view (iOS + Android) built with Nitro Modules.
- `value`-driven digit roll with easing/spring, `stagger` and `direction`.
- Formatting: fraction digits, grouping and decimal separators, prefix/suffix with independent font sizes and `top` / `bottom` / `baseline` / `center` pinning, zero padding, negatives.
- `adjustsFontSizeToFit` / `minimumFontScale` with a continuous scale that keeps the box fixed.
- `loading` shine glint (`shimmerColor`, `shimmerDuration`).
- Imperative `animateTo` / `jumpTo` / `getValue` via ref.
- VoiceOver / TalkBack read the formatted amount; Reduce Motion / "remove animations" snap instead of rolling.
- `allowFontScaling` / `maxFontSizeMultiplier` (off by default).
- View recycling (`RecyclableView`) for long lists.
- Rapid updates: a value that arrives mid-roll continues with the ease-out half of the curve instead of restarting from rest, so per-frame `value` updates keep rolling.
- Auto-size: when the settled width shrinks mid-roll the smaller size is reported after the roll finishes, so `adjustsFontSizeToFit` no longer squeezes the still-rolling digits and the amount no longer dips and grows back.
- Android: the per-frame engine bridge fills a reused array instead of allocating one.
- iOS renders with Core Animation layers (a wheel is a clipped strip of pre-rasterized digits that moves per frame) instead of redrawing a bitmap; the Core Graphics path is only used while the loading glint shows. `jumpTo` / `animateTo` coalesce to the newest value per main-thread turn on both platforms. See `BENCHMARKS.md`.
