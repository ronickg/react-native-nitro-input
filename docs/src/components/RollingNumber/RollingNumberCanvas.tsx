import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {useEngineModule, type RollingEngine} from '@site/src/engine/useRollingEngine';

// ---------------------------------------------------------------------------
// A web port of the native views' render loop, on a <canvas>: the same layout
// (sign, prefix, wheels high → low with separators, suffix), the same wheel
// drawing (two glyphs clipped to a slot, offset by the wheel's fractional
// position), the same shrink-to-fit scale, the same loading glint composited
// source-atop, and the same landing pop. Everything that *moves* comes from
// the WebAssembly build of the C++ engine, so what you see here is what the
// iOS and Android views draw.
// ---------------------------------------------------------------------------

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'spring';
export type Direction = 'auto' | 'up' | 'down';
export type AffixAlign = 'baseline' | 'center' | 'top' | 'bottom';
export type TextAlign = 'left' | 'center' | 'right';
export type RevealStyle = 'count' | 'spin';

export interface RollingNumberCanvasProps {
  value: number;
  fractionDigits?: number;
  minimumIntegerDigits?: number;
  groupingSeparator?: string;
  decimalSeparator?: string;
  prefix?: string;
  suffix?: string;
  duration?: number;
  easing?: Easing;
  /**
   * The odometer roll, or one of the glyph-swap transitions. The morph is
   * native-only (a canvas has no glyph outlines): this canvas shows the
   * numeric transition for it.
   */
  transition?: 'roll' | 'numeric' | 'flip' | 'scramble' | 'morph';
  /** The change flash: the colour a changed digit lights up in when the value grew / shrank. */
  flashUpColor?: string;
  flashDownColor?: string;
  /** Milliseconds a change flash takes to fade. Default 600. */
  flashDuration?: number;
  /** A punch of the whole figure on every change, peak overshoot 0–1. Default 0. */
  popOnChange?: number;
  bounce?: number;
  stagger?: number;
  direction?: Direction;
  reveal?: boolean;
  revealStyle?: RevealStyle;
  revealDuration?: number;
  revealBounce?: number;
  revealGrow?: number;
  revealStagger?: number;
  revealMilestones?: number[];
  revealMilestoneHold?: number;
  onRevealEnd?: () => void;
  onRevealMilestone?: (index: number, value: number) => void;
  loading?: boolean;
  shimmerColor?: string;
  shimmerDuration?: number;
  fontSize?: number;
  prefixFontSize?: number;
  suffixFontSize?: number;
  affixAlign?: AffixAlign;
  prefixAlign?: AffixAlign;
  suffixAlign?: AffixAlign;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
  fontWeight?: number | string;
  fontFamily?: string;
  color?: string;
  textAlign?: TextAlign;
  /** Fixed width in CSS px; omitted = auto-size to the settled figure. */
  width?: number;
  style?: React.CSSProperties;
  className?: string;
  /** Skip the reveal on click (the "tap to slam" pattern). */
  skipOnClick?: boolean;
}

export interface RollingNumberCanvasHandle {
  jumpTo(value: number): void;
  animateTo(value: number): void;
  revealTo(value: number): void;
  getValue(): number;
}

const EASINGS: Record<Easing, number> = {linear: 0, easeIn: 1, easeOut: 2, easeInOut: 3, spring: 4};
const DIRECTIONS: Record<Direction, number> = {auto: 0, up: 1, down: 2};
const DEFAULT_FONT = "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SHIMMER_SEED = 0.25;
const SHIMMER_SLANT = 0.6;
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

const colorCache = new Map<string, [number, number, number, number]>();
/** A CSS colour as r g b a, through a canvas so any syntax the browser knows works. */
function parseColor(color: string): [number, number, number, number] {
  const cached = colorCache.get(color);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  const out: [number, number, number, number] = [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  colorCache.set(color, out);
  return out;
}
function mixColor(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  const m = (i: 0 | 1 | 2) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgba(${m(0)}, ${m(1)}, ${m(2)}, ${a[3] + (b[3] - a[3]) * t})`;
}

type Role = 'digit' | 'prefix' | 'suffix';

interface Wheel {
  position: number;
  width: number;
  linear: boolean;
  blankZero: boolean;
  fromGlyph: number;
  toGlyph: number;
  blend: number;
  fromAbove: boolean;
  flash: number;
  flashUp: boolean;
}

const TRANSITIONS: Record<string, number> = {roll: 0, numeric: 1, flip: 2, scramble: 3, morph: 4};

// The numeric transition's geometry, in line heights; mirrors
// `RollingEngine::kNumeric*`, where the effect is described.
const NUMERIC_OFFSET = 0.4;
const NUMERIC_SCALE = 0.6;
const NUMERIC_BLUR = 0.16;

interface Element {
  wheel: number; // -1 for glyphs
  text: string;
  role: Role;
  width: number;
  fullWidth: number;
  factor: number;
}

interface Metrics {
  ascent: number;
  descent: number;
  lineHeight: number;
  capHeight: number;
}

/** Fonts and per-glyph measurements, like the native `FontSet`. */
class FontSet {
  readonly digit: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly lineHeight: number;
  readonly digitWidth: number;
  private readonly metrics: Record<Role, Metrics>;
  private readonly widths = new Map<string, number>();

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    size: number,
    prefixSize: number,
    suffixSize: number,
    weight: number | string,
    family: string,
    private readonly prefixAlign: AffixAlign,
    private readonly suffixAlign: AffixAlign,
  ) {
    const font = (s: number) => `${weight} ${s}px ${family}`;
    this.digit = font(size);
    this.prefix = font(prefixSize);
    this.suffix = font(suffixSize);
    this.metrics = {
      digit: this.measure(this.digit),
      prefix: this.measure(this.prefix),
      suffix: this.measure(this.suffix),
    };
    this.lineHeight = Math.ceil(this.metrics.digit.lineHeight);
    this.digitWidth = Math.max(...DIGITS.map((d) => this.width(d, 'digit')));
  }

  private measure(font: string): Metrics {
    this.ctx.font = font;
    const m = this.ctx.measureText('0');
    const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent * 1.25;
    const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent + ascent * 0.2;
    return {ascent, descent, lineHeight: ascent + descent, capHeight: m.actualBoundingBoxAscent};
  }

  font(role: Role): string {
    return role === 'digit' ? this.digit : role === 'prefix' ? this.prefix : this.suffix;
  }

  width(text: string, role: Role): number {
    const key = role + '|' + text;
    const cached = this.widths.get(key);
    if (cached !== undefined) return cached;
    this.ctx.font = this.font(role);
    const w = this.ctx.measureText(text).width;
    this.widths.set(key, w);
    return w;
  }

  /** How far `text`'s ink hangs below the baseline (0 for digits and capitals). */
  inkDescent(text: string, role: Role): number {
    const key = 'ink|' + role + '|' + text;
    const cached = this.widths.get(key);
    if (cached !== undefined) return cached;
    this.ctx.font = this.font(role);
    const descent = Math.max(0, this.ctx.measureText(text).actualBoundingBoxDescent);
    this.widths.set(key, descent);
    return descent;
  }

  /** Baseline y for `role` drawing `text`, given the top of the digit line box. */
  baseline(role: Role, text: string, lineTop: number): number {
    const d = this.metrics.digit;
    const digitBaseline = lineTop + d.ascent;
    if (role === 'digit') return digitBaseline;
    const m = this.metrics[role];
    switch (role === 'prefix' ? this.prefixAlign : this.suffixAlign) {
      case 'baseline':
        return digitBaseline;
      case 'center':
        return lineTop + (this.lineHeight - m.lineHeight) / 2 + m.ascent;
      case 'top':
        return lineTop + (d.ascent - d.capHeight) + m.capHeight;
      case 'bottom':
        // The bottom of the ink, not of the line boxes: "USD" sits on the digits' baseline.
        return digitBaseline + this.inkDescent('0123456789', 'digit') - this.inkDescent(text, role);
    }
  }
}

function toWeight(w: number | string | undefined): number | string {
  if (w === undefined) return 400;
  if (typeof w === 'number') return w;
  const named: Record<string, number> = {normal: 400, bold: 700, semibold: 600, medium: 500, light: 300, heavy: 800, black: 900};
  return named[w] ?? w;
}

export const RollingNumberCanvas = forwardRef<RollingNumberCanvasHandle, RollingNumberCanvasProps>(
  function RollingNumberCanvas(props, ref) {
    const {
      value,
      fractionDigits = 0,
      minimumIntegerDigits = 1,
      groupingSeparator = '',
      decimalSeparator = '.',
      prefix = '',
      suffix = '',
      duration = 500,
      easing = 'easeInOut',
      transition = 'roll',
      flashUpColor,
      flashDownColor,
      flashDuration = 600,
      popOnChange = 0,
      bounce = 0.15,
      stagger = 0,
      direction = 'auto',
      reveal,
      revealStyle = 'count',
      revealDuration = 2200,
      revealBounce = 0.12,
      revealGrow = 0.2,
      revealStagger = 200,
      revealMilestones,
      revealMilestoneHold = 0,
      onRevealEnd,
      onRevealMilestone,
      loading = false,
      shimmerColor,
      shimmerDuration = 950,
      fontSize = 32,
      prefixFontSize,
      suffixFontSize,
      affixAlign = 'baseline',
      prefixAlign,
      suffixAlign,
      adjustsFontSizeToFit = false,
      minimumFontScale = 0.5,
      fontWeight,
      fontFamily,
      color,
      textAlign = 'left',
      width,
      style,
      className,
      skipOnClick = false,
    } = props;

    const module = useEngineModule();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<RollingEngine | null>(null);
    const fontsRef = useRef<FontSet | null>(null);
    const frameRef = useRef<number | null>(null);
    const appliedRevealRef = useRef<boolean | null | undefined>(undefined);
    const wasRevealingRef = useRef(false);
    const onRevealEndRef = useRef(onRevealEnd);
    onRevealEndRef.current = onRevealEnd;
    const onRevealMilestoneRef = useRef(onRevealMilestone);
    onRevealMilestoneRef.current = onRevealMilestone;
    const milestonesKey = revealMilestones?.join(',') ?? '';
    const [settledWidth, setSettledWidth] = useState<number>(0);
    const [ink, setInk] = useState<string>('#000');

    const resolvedWeight = toWeight(fontWeight);
    const family = fontFamily ?? DEFAULT_FONT;
    const pAlign = prefixAlign ?? affixAlign;
    const sAlign = suffixAlign ?? affixAlign;

    // The engine lives as long as the module does.
    useEffect(() => {
      if (!module) return;
      const engine = new module.RollingEngine();
      engineRef.current = engine;
      appliedRevealRef.current = undefined;
      return () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        engine.delete();
        engineRef.current = null;
      };
    }, [module]);

    // Fonts follow the typography props.
    const fonts = useMemo(() => {
      if (typeof document === 'undefined') return null;
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return null;
      return new FontSet(ctx, fontSize, prefixFontSize ?? fontSize, suffixFontSize ?? fontSize, resolvedWeight, family, pAlign, sAlign);
    }, [fontSize, prefixFontSize, suffixFontSize, resolvedWeight, family, pAlign, sAlign]);
    fontsRef.current = fonts;

    // Resolve the ink from the page theme when no color is given.
    useLayoutEffect(() => {
      if (color) {
        setInk(color);
        return;
      }
      const el = canvasRef.current;
      if (!el) return;
      setInk(getComputedStyle(el).color || '#000');
      const observer = new MutationObserver(() => setInk(getComputedStyle(el).color || '#000'));
      observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
      return () => observer.disconnect();
    }, [color]);

    // --- Layout helpers (ports of buildElements / settledWidth) -------------

    const buildElements = (f: FontSet, wheels: Wheel[], signFactor: number): Element[] => {
      const elements: Element[] = [];
      const fd = fractionDigits;
      const addGlyph = (text: string, role: Role, factor: number) => {
        if (!text || factor <= 0) return;
        const w = f.width(text, role);
        elements.push({wheel: -1, text, role, width: w * factor, fullWidth: w, factor});
      };
      addGlyph('-', 'digit', signFactor);
      addGlyph(prefix, 'prefix', 1);
      for (let power = wheels.length - 1; power >= 0; power--) {
        const wheel = wheels[power];
        if (wheel.width > 0) {
          elements.push({wheel: power, text: '', role: 'digit', width: f.digitWidth * wheel.width, fullWidth: f.digitWidth, factor: wheel.width});
        }
        if (power > fd && (power - fd) % 3 === 0) addGlyph(groupingSeparator, 'digit', wheel.width);
        if (fd > 0 && power === fd) addGlyph(decimalSeparator, 'digit', 1);
      }
      addGlyph(suffix, 'suffix', 1);
      return elements;
    };

    const measureSettled = (engine: RollingEngine, f: FontSet): number => {
      const count = engine.settledPowerCount();
      const wheels: Wheel[] = Array.from({length: count}, () => ({position: 0, width: 1, linear: false, blankZero: false, fromGlyph: -1, toGlyph: -1, blend: 1, fromAbove: true, flash: 0, flashUp: true}));
      return buildElements(f, wheels, engine.settledNegative() ? 1 : 0).reduce((sum, e) => sum + e.width, 0);
    };

    // --- Drawing (port of onDraw / draw(_:)) --------------------------------

    const draw = () => {
      const engine = engineRef.current;
      const f = fontsRef.current;
      const canvas = canvasRef.current;
      if (!engine || !f || !canvas || !engine.hasShownValue()) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = width ?? Math.ceil(measureSettled(engine, f));
      const cssHeight = f.lineHeight;

      const wheels: Wheel[] = [];
      const count = engine.wheelCount();
      for (let i = 0; i < count; i++) wheels.push(engine.wheelAt(i));
      const elements = buildElements(f, wheels, engine.signFactor());
      const total = elements.reduce((sum, e) => sum + e.width, 0);

      let fit = 1;
      if (adjustsFontSizeToFit && cssWidth > 0 && total > cssWidth) {
        fit = Math.max(Math.min(1, minimumFontScale), cssWidth / total);
      }
      let originX = textAlign === 'left' ? 0 : textAlign === 'center' ? (cssWidth - total * fit) / 2 : cssWidth - total * fit;
      let originY = (cssHeight - f.lineHeight * fit) / 2;
      const pop = engine.revealScale();
      if (pop !== 1) {
        originX += (total * fit * (1 - pop)) / 2;
        originY += (f.lineHeight * fit * (1 - pop)) / 2;
      }
      const scale = fit * pop;

      // Like the native views, never clip: the bitmap bleeds past the layout
      // box far enough for the pop and for content wider than a fixed width.
      const overflowLeft = Math.max(0, -originX);
      const overflowRight = Math.max(0, originX + total * scale - cssWidth);
      const bleedX = Math.ceil(Math.max(cssWidth * 0.08, overflowLeft, overflowRight) + 4);
      const bleedY = Math.ceil(f.lineHeight * 0.15);
      const pw = Math.round((cssWidth + 2 * bleedX) * dpr);
      const ph = Math.round((cssHeight + 2 * bleedY) * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      canvas.style.width = `${cssWidth + 2 * bleedX}px`;
      canvas.style.height = `${cssHeight + 2 * bleedY}px`;
      canvas.style.left = `${-bleedX}px`;
      canvas.style.top = `${-bleedY}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth + 2 * bleedX, cssHeight + 2 * bleedY);
      ctx.translate(bleedX + originX, bleedY + originY);
      ctx.scale(scale, scale);
      ctx.fillStyle = ink;
      ctx.textBaseline = 'alphabetic';

      const dim = Math.min(1, Math.max(0, engine.loadingProgress()));
      let x = 0;
      for (const e of elements) {
        if (e.wheel >= 0) drawWheel(ctx, f, wheels[e.wheel], x, e.width);
        else drawGlyph(ctx, f, e.text, e.role, x, e.width, e.fullWidth, e.factor);
        x += e.width;
      }
      if (dim > 0 && total > 0) {
        const phase = engine.shimmerPhase(performance.now() / 1000, shimmerDuration / 1000);
        const progress = SHIMMER_SEED + (1 - SHIMMER_SEED) * phase;
        const startX = total * (2 * progress - 1);
        const gradient = ctx.createLinearGradient(startX, 0, startX + total, SHIMMER_SLANT * total);
        const highlight = shimmerColor ?? (document.documentElement.dataset.theme === 'dark' ? '#2B2E37' : '#D6D9E1');
        gradient.addColorStop(0.1, ink);
        gradient.addColorStop(0.5, highlight);
        gradient.addColorStop(0.9, ink);
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = dim;
        ctx.fillStyle = gradient;
        ctx.fillRect(-bleedX, -bleedY, total + 2 * bleedX, f.lineHeight + 2 * bleedY);
        ctx.restore();
      }
    };

    const drawGlyph = (ctx: CanvasRenderingContext2D, f: FontSet, text: string, role: Role, x: number, w: number, fullWidth: number, alpha: number) => {
      if (w <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, w, f.lineHeight);
      ctx.clip();
      ctx.globalAlpha = alpha;
      ctx.font = f.font(role);
      ctx.fillText(text, x + w - fullWidth, f.baseline(role, text, 0));
      ctx.restore();
    };

    const glyphAt = (index: number, wheel: Wheel): string | null => {
      if (wheel.linear && index < 0) return null;
      if (wheel.blankZero && index === 0) return null;
      return DIGITS[((index % 10) + 10) % 10];
    };

    // The numeric transition: the leaving glyph and the arriving one, each
    // scaled about its centre, offset along the axis, faded and blurred as it
    // goes out of, or comes into, focus.
    const drawSwap = (ctx: CanvasRenderingContext2D, f: FontSet, wheel: Wheel, x: number, w: number) => {
      const lineHeight = f.lineHeight;
      const b = wheel.blend;
      const d = wheel.fromAbove ? 1 : -1;
      const offset = lineHeight * NUMERIC_OFFSET;
      const cx = x + w - f.digitWidth / 2;
      const cy = lineHeight / 2;
      const canBlur = 'filter' in ctx;
      const pair = [
        {glyph: wheel.fromGlyph, dy: d * offset * b, scale: 1 - (1 - NUMERIC_SCALE) * b, alpha: 1 - b, blur: Math.min(1, 2 * b)},
        {glyph: wheel.toGlyph, dy: -d * offset * (1 - b), scale: NUMERIC_SCALE + (1 - NUMERIC_SCALE) * b, alpha: b, blur: 1 - b},
      ];
      ctx.font = f.digit;
      for (const item of pair) {
        if (item.glyph < 0 || item.alpha <= 0.002) continue;
        const text = DIGITS[((item.glyph % 10) + 10) % 10]!;
        ctx.save();
        ctx.globalAlpha = wheel.width * item.alpha;
        if (canBlur && item.blur > 0.02) ctx.filter = `blur(${(lineHeight * NUMERIC_BLUR * item.blur).toFixed(2)}px)`;
        ctx.translate(cx, cy + item.dy);
        ctx.scale(item.scale, item.scale);
        ctx.fillText(text, -f.width(text, 'digit') / 2, f.baseline('digit', text, 0) - lineHeight / 2);
        ctx.restore();
      }
    };

    // The split-flap board, without a third dimension: the flap squashes about
    // the centre line instead of turning, which reads the same at this size.
    const drawFlip = (ctx: CanvasRenderingContext2D, f: FontSet, wheel: Wheel, x: number, w: number) => {
      const lineHeight = f.lineHeight;
      const baseline = f.baseline('digit', '0', 0);
      const cx = x + w - f.digitWidth / 2;
      const mid = lineHeight / 2;
      const current = wheel.fromGlyph >= 0 ? DIGITS[wheel.fromGlyph % 10]! : null;
      const next = wheel.toGlyph >= 0 ? DIGITS[wheel.toGlyph % 10]! : null;
      const b = wheel.blend;
      const half = (text: string | null, top: boolean, squash: number, shade: number) => {
        if (!text) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, top ? 0 : mid + 0.5, w, top ? mid - 0.5 : mid);
        ctx.clip();
        ctx.translate(cx, mid);
        ctx.scale(1, Math.max(0.001, squash));
        ctx.globalAlpha = wheel.width * (1 - shade);
        ctx.font = f.digit;
        ctx.fillText(text, -f.width(text, 'digit') / 2, baseline - mid);
        ctx.restore();
      };
      // The eased angle of the flap: 0 hanging, 1 landed; it passes the horizontal at 0.5.
      const angle = b < 0.5 ? 2 * b * b : 1 - 2 * (1 - b) * (1 - b);
      half(next, true, 1, 0);          // the next card's top, already in place under the flap
      half(current, false, 1, 0);      // the current card's bottom, until the flap lands
      if (angle < 0.5) {
        half(current, true, 1 - angle * 2, angle * 0.6);        // the flap's front, falling
      } else {
        half(next, false, (angle - 0.5) * 2, (1 - angle) * 0.6); // the flap's back, landing
      }
      // The board's hinge line.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, w, lineHeight);
      ctx.clip();
      ctx.globalAlpha = wheel.width * 0.9;
      ctx.clearRect(x, mid - 0.5, w, 1);
      ctx.restore();
    };

    const drawWheel = (ctx: CanvasRenderingContext2D, f: FontSet, wheel: Wheel, x: number, w: number) => {
      if (w <= 0) return;
      const lineHeight = f.lineHeight;
      const baseline = f.baseline('digit', '0', 0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, w, lineHeight);
      ctx.clip();
      // The change flash tints this wheel's glyphs towards the up or down colour.
      const tint = wheel.flash > 0.002 ? (wheel.flashUp ? flashUpColor : flashDownColor) : undefined;
      if (tint) {
        ctx.fillStyle = mixColor(ctx.fillStyle as string, tint, wheel.flash);
      }
      if (wheel.blend < 1) {
        if (transition === 'flip') drawFlip(ctx, f, wheel, x, w);
        else drawSwap(ctx, f, wheel, x, w);
        ctx.restore();
        return;
      }
      ctx.globalAlpha = wheel.width;
      ctx.font = f.digit;
      const base = Math.floor(wheel.position);
      const fraction = wheel.position - base;
      const columnLeft = x + w - f.digitWidth;
      const g0 = glyphAt(base, wheel);
      if (g0) ctx.fillText(g0, columnLeft + (f.digitWidth - f.width(g0, 'digit')) / 2, baseline - fraction * lineHeight);
      if (fraction > 0.0001) {
        const g1 = glyphAt(base + 1, wheel);
        if (g1) ctx.fillText(g1, columnLeft + (f.digitWidth - f.width(g1, 'digit')) / 2, baseline + (1 - fraction) * lineHeight);
      }
      ctx.restore();
    };

    // --- Frame loop -----------------------------------------------------------

    const reportSize = () => {
      const engine = engineRef.current;
      const f = fontsRef.current;
      if (!engine || !f) return;
      setSettledWidth(Math.ceil(measureSettled(engine, f)));
    };

    const scheduleFrames = () => {
      const engine = engineRef.current;
      if (!engine) return;
      if (frameRef.current !== null) return;
      const step = () => {
        frameRef.current = null;
        const e = engineRef.current;
        if (!e) return;
        const wasRevealing = e.isRevealing();
        const reachedBefore = e.revealMilestonesReached();
        e.tick(performance.now() / 1000);
        draw();
        if (wasRevealing) {
          reportMilestones(reachedBefore);
          if (!e.isRevealing()) onRevealEndRef.current?.();
        }
        if (e.needsFrames()) frameRef.current = requestAnimationFrame(step);
      };
      if (engine.needsFrames()) frameRef.current = requestAnimationFrame(step);
    };

    const now = () => performance.now() / 1000;
    const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    /** Fires onRevealMilestone for every milestone reached since `reachedBefore`. */
    const reportMilestones = (reachedBefore: number) => {
      const e = engineRef.current;
      const listener = onRevealMilestoneRef.current;
      if (!e || !listener) return;
      const reached = e.revealMilestonesReached();
      for (let i = reachedBefore; i < reached; i++) listener(i, e.revealMilestoneValue(i));
    };

    const commands = {
      jumpTo(v: number) {
        const e = engineRef.current;
        if (!e) return;
        e.setValue(v);
        reportSize();
        scheduleFrames();
        draw();
      },
      animateTo(v: number) {
        const e = engineRef.current;
        if (!e) return;
        e.setReduceMotion(reduceMotion());
        e.animateTo(v, now());
        reportSize();
        scheduleFrames();
        draw();
      },
      holdReveal(v: number) {
        const e = engineRef.current;
        if (!e) return;
        e.holdReveal(v);
        reportSize();
        scheduleFrames();
        draw();
      },
      revealTo(v: number) {
        const e = engineRef.current;
        if (!e) return;
        e.setReduceMotion(reduceMotion());
        e.reveal(v, now());
        reportSize();
        scheduleFrames();
        draw();
        reportMilestones(0);
        if (!e.isRevealing()) onRevealEndRef.current?.();
        if (reveal !== undefined) appliedRevealRef.current = true;
      },
    };

    useImperativeHandle(ref, () => ({
      jumpTo: commands.jumpTo,
      animateTo: commands.animateTo,
      revealTo: commands.revealTo,
      getValue: () => engineRef.current?.targetValue() ?? value,
    }));

    // Configuration → engine (format, timing) — like the hybrid view's flushConfig.
    useEffect(() => {
      const e = engineRef.current;
      if (!e || !module) return;
      e.setFormat(fractionDigits, minimumIntegerDigits);
      e.setTiming(duration / 1000, EASINGS[easing], bounce, stagger / 1000, DIRECTIONS[direction]);
      e.setTransition(TRANSITIONS[transition] ?? 0);
      e.setFlash(flashUpColor || flashDownColor ? flashDuration / 1000 : 0);
      e.setPopOnChange(popOnChange);
      e.setRevealTiming(revealDuration / 1000, revealBounce, revealStyle === 'spin' ? 1 : 0, revealStagger / 1000);
      e.setRevealGrow(revealGrow);
      e.setRevealMilestoneHold(revealMilestoneHold / 1000);
      e.clearRevealMilestones();
      for (const m of revealMilestones ?? []) e.addRevealMilestone(m);
      if (e.hasShownValue()) reportSize();
      draw();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [module, fractionDigits, minimumIntegerDigits, duration, easing, transition, flashUpColor, flashDownColor, flashDuration, popOnChange, bounce, stagger, direction, revealDuration, revealBounce, revealGrow, revealStyle, revealStagger, revealMilestoneHold, milestonesKey]);

    // Loading glint.
    useEffect(() => {
      const e = engineRef.current;
      if (!e || !module) return;
      e.setReduceMotion(reduceMotion());
      e.setLoading(loading, now());
      scheduleFrames();
      draw();
    }, [module, loading]);

    // Value / reveal prop machine — mirrors HybridRollingNumberView.commit().
    const lastValueRef = useRef<number | undefined>(undefined);
    useEffect(() => {
      const e = engineRef.current;
      if (!e || !module) return;
      const changed = lastValueRef.current !== value;
      lastValueRef.current = value;
      if (reveal === undefined) {
        appliedRevealRef.current = undefined;
        if (changed || !e.hasShownValue()) commands.animateTo(value);
        return;
      }
      const applied = appliedRevealRef.current;
      if (!reveal) {
        if (changed || applied !== false || !e.hasShownValue()) commands.holdReveal(value);
      } else if (applied !== true) {
        commands.revealTo(value);
      } else if (changed) {
        if (e.isRevealing()) commands.revealTo(value);
        else commands.animateTo(value);
      }
      appliedRevealRef.current = reveal;
    }, [module, value, reveal]);

    // Redraw when the fonts, the ink or the layout props change.
    useEffect(() => {
      const e = engineRef.current;
      if (!e || !module) return;
      if (e.hasShownValue()) reportSize();
      draw();
    }, [module, fonts, ink, groupingSeparator, decimalSeparator, prefix, suffix, textAlign, width, adjustsFontSizeToFit, minimumFontScale]);

    const boxWidth = width ?? settledWidth;
    const boxHeight = fonts?.lineHeight ?? fontSize * 1.25;

    return (
      <div
        className={className}
        style={{
          display: 'inline-block',
          width: boxWidth || undefined,
          height: boxHeight,
          position: 'relative',
          overflow: 'visible',
          lineHeight: 0,
          transition: width === undefined ? 'width 200ms ease' : undefined,
          cursor: skipOnClick ? 'pointer' : undefined,
          ...style,
        }}
        onClick={skipOnClick ? () => engineRef.current?.isRevealing() && commands.jumpTo(engineRef.current.targetValue()) : undefined}
        role="img"
        aria-label={`${prefix}${value.toLocaleString(undefined, {minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits})}${suffix}`}>
        <canvas ref={canvasRef} style={{display: 'block', position: 'absolute', color: color ?? 'inherit', pointerEvents: 'none'}} />
      </div>
    );
  },
);
