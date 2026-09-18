# Changelog

## 0.1.0 (unreleased)

- Initial release: native rolling number view (iOS + Android) built with Nitro Modules.
- `value`-driven digit roll with easing/spring, `stagger` and `direction`.
- Formatting: fraction digits, grouping and decimal separators, prefix/suffix with independent font sizes and `top` / `bottom` / `baseline` / `center` pinning, zero padding, negatives.
- `adjustsFontSizeToFit` / `minimumFontScale` with a continuous scale that keeps the box fixed.
- `loading` shine glint (`shimmerColor`, `shimmerDuration`).
- Imperative `animateTo` / `jumpTo` / `getValue` via ref.
- VoiceOver / TalkBack read the formatted amount; Reduce Motion / "remove animations" snap instead of rolling.
