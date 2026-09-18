import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {useMorphModule, type AmountFormatter, type MorphEngine} from '@site/src/engine/useMorphEngine';

// ---------------------------------------------------------------------------
// A web port of the native input views: a real <input> owns the keyboard,
// editing and selection (its text is transparent), and a <canvas> on top draws
// the glyphs where the WebAssembly build of the C++ MorphEngine puts them, plus
// our own caret. In number mode every edit goes through the C++ AmountFormatter
// before the <input> shows it, exactly like the Swift and Kotlin views.
// ---------------------------------------------------------------------------

export type Mode = 'text' | 'number';
export type Easing = 'expo' | 'easeOut' | 'easeInOut' | 'linear' | 'spring';
export type Effect = 'auto' | 'slide' | 'fade';
export type AffixAlign = 'baseline' | 'center' | 'top' | 'bottom';
export type TextAlign = 'left' | 'center' | 'right';

export interface MorphInputCanvasProps {
  mode?: Mode;
  fractionDigits?: number;
  maxIntegerDigits?: number;
  groupingSeparator?: string;
  decimalSeparator?: string;
  prefix?: string;
  suffix?: string;
  prefixFontSize?: number;
  suffixFontSize?: number;
  affixAlign?: AffixAlign;
  prefixAlign?: AffixAlign;
  suffixAlign?: AffixAlign;
  placeholder?: string;
  placeholderColor?: string;
  duration?: number;
  easing?: Easing;
  bounce?: number;
  effect?: Effect;
  fontSize?: number;
  fontWeight?: number | string;
  fontFamily?: string;
  color?: string;
  textAlign?: TextAlign;
  caretColor?: string;
  defaultValue?: string;
  autoFocus?: boolean;
  maxLength?: number;
  onChangeText?: (text: string) => void;
  onChangeValue?: (value: number) => void;
  onFocusChange?: (focused: boolean) => void;
  style?: React.CSSProperties;
  className?: string;
}

export interface MorphInputCanvasHandle {
  focus(): void;
  blur(): void;
  clear(): void;
  setText(text: string): void;
  setValue(value: number): void;
  getText(): string;
  getValue(): number;
}

const EASINGS: Record<Easing, number> = {expo: 0, easeOut: 1, easeInOut: 2, linear: 3, spring: 4};
const EFFECTS: Record<Effect, number> = {auto: 0, slide: 1, fade: 2};
const DEFAULT_FONT = "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

type Role = 'prefix' | 'body' | 'suffix';
const ROLES: Role[] = ['prefix', 'body', 'suffix'];

interface Metrics {
  ascent: number;
  descent: number;
  lineHeight: number;
  capHeight: number;
}

/** Fonts and per-glyph measurements, like the native `FontSet`. */
class FontSet {
  readonly fonts: Record<Role, string>;
  readonly lineHeight: number;
  private readonly metrics: Record<Role, Metrics>;
  private readonly cache = new Map<string, number>();

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
    this.fonts = {prefix: font(prefixSize), body: font(size), suffix: font(suffixSize)};
    this.metrics = {
      prefix: this.measure(this.fonts.prefix),
      body: this.measure(this.fonts.body),
      suffix: this.measure(this.fonts.suffix),
    };
    this.lineHeight = Math.ceil(this.metrics.body.lineHeight);
  }

  private measure(font: string): Metrics {
    this.ctx.font = font;
    const m = this.ctx.measureText('0');
    const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent * 1.25;
    const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent + ascent * 0.2;
    return {ascent, descent, lineHeight: ascent + descent, capHeight: m.actualBoundingBoxAscent};
  }

  width(text: string, role: Role): number {
    const key = role + '|' + text;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    this.ctx.font = this.fonts[role];
    const w = this.ctx.measureText(text).width;
    this.cache.set(key, w);
    return w;
  }

  private inkDescent(text: string, role: Role): number {
    const key = 'ink|' + role + '|' + text;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    this.ctx.font = this.fonts[role];
    const descent = Math.max(0, this.ctx.measureText(text).actualBoundingBoxDescent);
    this.cache.set(key, descent);
    return descent;
  }

  /** Baseline y for `role` drawing `text`, given the top of the body line box. */
  baseline(role: Role, text: string, lineTop: number): number {
    const d = this.metrics.body;
    const bodyBaseline = lineTop + d.ascent;
    if (role === 'body') return bodyBaseline;
    const m = this.metrics[role];
    switch (role === 'prefix' ? this.prefixAlign : this.suffixAlign) {
      case 'baseline':
        return bodyBaseline;
      case 'center':
        return lineTop + (this.lineHeight - m.lineHeight) / 2 + m.ascent;
      case 'top':
        return lineTop + (d.ascent - d.capHeight) + m.capHeight;
      case 'bottom':
        return bodyBaseline + this.inkDescent('0123456789', 'body') - this.inkDescent(text, role);
    }
  }
}

function toWeight(w: number | string | undefined): number | string {
  if (w === undefined) return 400;
  if (typeof w === 'number') return w;
  const named: Record<string, number> = {normal: 400, bold: 700, semibold: 600, medium: 500, light: 300, heavy: 800, black: 900};
  return named[w] ?? w;
}

/** UTF-16 offset of code point index `cp` in `text`. */
function utf16Of(text: string, cp: number): number {
  let i = 0;
  let count = 0;
  for (const ch of text) {
    if (count === cp) return i;
    i += ch.length;
    count++;
  }
  return text.length;
}

/** Code point index of UTF-16 offset `index` in `text`. */
function cpOf(text: string, index: number): number {
  return Array.from(text.slice(0, index)).length;
}

export const MorphInputCanvas = forwardRef<MorphInputCanvasHandle, MorphInputCanvasProps>(
  function MorphInputCanvas(props, ref) {
    const {
      mode = 'text',
      fractionDigits = 2,
      maxIntegerDigits = 15,
      groupingSeparator = ',',
      decimalSeparator = '.',
      prefix = '',
      suffix = '',
      prefixFontSize,
      suffixFontSize,
      affixAlign = 'baseline',
      prefixAlign,
      suffixAlign,
      placeholder = '',
      placeholderColor,
      duration = 400,
      easing = 'expo',
      bounce = 0.15,
      effect = 'auto',
      fontSize = 32,
      fontWeight,
      fontFamily,
      color,
      textAlign = 'left',
      caretColor,
      defaultValue = '',
      autoFocus = false,
      maxLength,
      onChangeText,
      onChangeValue,
      onFocusChange,
      style,
      className,
    } = props;

    const module = useMorphModule();
    const rootRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const engineRef = useRef<MorphEngine | null>(null);
    const formatterRef = useRef<AmountFormatter | null>(null);
    const fontsRef = useRef<FontSet | null>(null);
    const frameRef = useRef(0);
    const state = useRef({text: '', caret: 0, selStart: 0, selEnd: 0, focused: false, blinkOn: true, blinkAt: 0, width: 0});
    const latest = useRef({onChangeText, onChangeValue, onFocusChange});
    latest.current = {onChangeText, onChangeValue, onFocusChange};
    const [ready, setReady] = useState(false);

    const now = () => performance.now() / 1000;
    const resolvedColor = color ?? (getComputedStyle(document.documentElement).getPropertyValue('--rn-demo-ink').trim() || '#111');
    const resolvedPlaceholder = placeholderColor ?? 'rgba(128, 134, 148, 0.6)';
    const resolvedCaret = caretColor ?? (getComputedStyle(document.documentElement).getPropertyValue('--ifm-color-primary').trim() || '#2563eb');
    const family = fontFamily ?? DEFAULT_FONT;
    const weight = toWeight(fontWeight);

    // Engine + formatter live as long as the component.
    useEffect(() => {
      if (!module) return;
      const engine = new module.MorphEngine();
      const formatter = new module.AmountFormatter();
      engineRef.current = engine;
      formatterRef.current = formatter;
      setReady(true);
      return () => {
        cancelAnimationFrame(frameRef.current);
        engine.delete();
        formatter.delete();
        engineRef.current = null;
        formatterRef.current = null;
      };
    }, [module]);

    const render = useCallback(() => {
      const canvas = canvasRef.current;
      const engine = engineRef.current;
      const fonts = fontsRef.current;
      if (!canvas || !engine || !fonts) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = state.current.width;
      const cssHeight = fonts.lineHeight;
      if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        canvas.style.height = `${cssHeight}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const contentWidth = engine.contentWidth();
      const x0 = textAlign === 'left' ? 0 : textAlign === 'center' ? (cssWidth - contentWidth) / 2 : cssWidth - contentWidth;
      const lineTop = 0;
      const lineHeight = fonts.lineHeight;
      ctx.textBaseline = 'alphabetic';

      const count = engine.glyphCount();
      for (let i = 0; i < count; i++) {
        const g = engine.glyphAt(i);
        const role = ROLES[g.role] ?? 'body';
        const ch = String.fromCodePoint(g.character);
        const slides = effect === 'slide' || (effect === 'auto' && g.kind !== 0);
        ctx.save();
        if (slides) {
          ctx.beginPath();
          ctx.rect(-1e5, lineTop, 2e5, lineHeight);
          ctx.clip();
        }
        ctx.font = fonts.fonts[role];
        ctx.fillStyle = g.placeholder ? resolvedPlaceholder : resolvedColor;
        ctx.globalAlpha = Math.max(0, Math.min(1, g.opacity));
        const x = x0 + g.x;
        const baseline = fonts.baseline(role, ch, lineTop) + g.y * lineHeight;
        if (g.scale !== 1) {
          const cx = x + g.width / 2;
          const cy = lineTop + lineHeight / 2;
          ctx.translate(cx, cy);
          ctx.scale(g.scale, g.scale);
          ctx.translate(-cx, -cy);
        }
        ctx.fillText(ch, x, baseline);
        ctx.restore();
      }

      const input = inputRef.current;
      const collapsed = !input || input.selectionStart === input.selectionEnd;
      if (state.current.focused && state.current.blinkOn && collapsed) {
        const caret = Math.max(0, Math.min(engine.bodyCount(), state.current.caret));
        const cx = x0 + engine.caretX(caret);
        ctx.fillStyle = resolvedCaret;
        ctx.globalAlpha = 1;
        const inset = lineHeight * 0.08;
        ctx.beginPath();
        ctx.roundRect(cx - 1, lineTop + inset, 2, lineHeight - inset * 2, 1);
        ctx.fill();
      }
    }, [effect, resolvedCaret, resolvedColor, resolvedPlaceholder, textAlign]);

    const loop = useCallback(() => {
      cancelAnimationFrame(frameRef.current);
      const step = () => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.tick(now());
        render();
        if (engine.needsFrames()) frameRef.current = requestAnimationFrame(step);
      };
      frameRef.current = requestAnimationFrame(step);
    }, [render]);

    /** Feeds the current text to the engine. `caret` = body index of the edit, -1 for a programmatic set. */
    const feed = useCallback(
      (caret: number) => {
        const engine = engineRef.current;
        const formatter = formatterRef.current;
        const fonts = fontsRef.current;
        if (!engine || !formatter || !fonts) return;
        const text = state.current.text;
        const showPlaceholder = text.length === 0 && placeholder.length > 0;
        const body = showPlaceholder ? placeholder : text;
        engine.beginText();
        for (const ch of prefix) engine.addGlyph(ch.codePointAt(0)!, 0, 0, fonts.width(ch, 'prefix'), false);
        for (const ch of body) {
          const cp = ch.codePointAt(0)!;
          const kind = mode === 'number' ? formatter.kindOf(cp) : 0;
          engine.addGlyph(cp, 1, kind, fonts.width(ch, 'body'), showPlaceholder);
        }
        for (const ch of suffix) engine.addGlyph(ch.codePointAt(0)!, 2, 0, fonts.width(ch, 'suffix'), false);
        engine.commitText(caret, now());
        loop();
      },
      [loop, mode, placeholder, prefix, suffix],
    );

    const restartBlink = () => {
      state.current.blinkOn = true;
      state.current.blinkAt = performance.now();
    };

    const syncCaret = useCallback(() => {
      const input = inputRef.current;
      if (!input) return;
      state.current.caret = cpOf(input.value, input.selectionStart ?? input.value.length);
      // Remembered so the next edit knows the range it replaced even without `beforeinput`
      // (selectionchange is dispatched after the input event, so this is still pre-edit).
      state.current.selStart = state.current.caret;
      state.current.selEnd = cpOf(input.value, input.selectionEnd ?? input.value.length);
      restartBlink();
      render();
    }, [render]);

    /** A programmatic replacement of the whole text (place matching). */
    const replaceText = useCallback(
      (next: string, notify: boolean) => {
        const formatter = formatterRef.current;
        const input = inputRef.current;
        if (!formatter || !input) return;
        let text = next;
        if (mode === 'number') {
          text = String(formatter.normalize(next).text);
        } else if (maxLength !== undefined) {
          text = Array.from(next).slice(0, maxLength).join('');
        }
        state.current.text = text;
        input.value = text;
        const end = text.length;
        if (document.activeElement === input) input.setSelectionRange(end, end);
        state.current.caret = cpOf(text, end);
        state.current.selStart = state.current.selEnd = state.current.caret;
        feed(-1);
        if (notify) {
          latest.current.onChangeText?.(text);
          if (mode === 'number') latest.current.onChangeValue?.(formatter.value(text));
        }
      },
      [feed, maxLength, mode],
    );

    // (Re)build fonts, push config, and (re)feed whenever a formatting/typography prop changes.
    useLayoutEffect(() => {
      if (!ready) return;
      const canvas = canvasRef.current;
      const engine = engineRef.current;
      const formatter = formatterRef.current;
      if (!canvas || !engine || !formatter) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      fontsRef.current = new FontSet(
        ctx,
        fontSize,
        prefixFontSize ?? fontSize,
        suffixFontSize ?? fontSize,
        weight,
        family,
        prefixAlign ?? affixAlign,
        suffixAlign ?? affixAlign,
      );
      engine.setTiming(duration / 1000, EASINGS[easing], bounce);
      engine.setEffect(EFFECTS[effect]);
      engine.setReduceMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      formatter.setFormat(fractionDigits, maxIntegerDigits, groupingSeparator, decimalSeparator);
      const input = inputRef.current;
      if (input) {
        input.style.font = fontsRef.current.fonts.body;
        input.style.paddingLeft = `${Array.from(prefix).reduce((w, ch) => w + fontsRef.current!.width(ch, 'prefix'), 0)}px`;
        input.style.paddingRight = `${Array.from(suffix).reduce((w, ch) => w + fontsRef.current!.width(ch, 'suffix'), 0)}px`;
        input.style.height = `${fontsRef.current.lineHeight}px`;
      }
      if (!engine.hasText()) {
        replaceText(defaultValue, false);
      } else {
        feed(-1);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      ready,
      fontSize,
      prefixFontSize,
      suffixFontSize,
      weight,
      family,
      affixAlign,
      prefixAlign,
      suffixAlign,
      duration,
      easing,
      bounce,
      effect,
      fractionDigits,
      maxIntegerDigits,
      groupingSeparator,
      decimalSeparator,
      prefix,
      suffix,
      placeholder,
      mode,
    ]);

    // Track the width of the root so the canvas can fill it.
    useEffect(() => {
      const root = rootRef.current;
      if (!root) return;
      const update = () => {
        state.current.width = root.getBoundingClientRect().width;
        render();
      };
      update();
      const observer = new ResizeObserver(update);
      observer.observe(root);
      return () => observer.disconnect();
    }, [render]);

    // Caret blink while focused.
    useEffect(() => {
      const id = window.setInterval(() => {
        if (!state.current.focused) return;
        if (performance.now() - state.current.blinkAt < 500) return;
        state.current.blinkOn = !state.current.blinkOn;
        state.current.blinkAt = performance.now();
        render();
      }, 100);
      return () => window.clearInterval(id);
    }, [render]);

    // Selection changes (arrow keys, clicks, drags) move our caret.
    useEffect(() => {
      const handler = () => {
        if (document.activeElement === inputRef.current) syncCaret();
      };
      document.addEventListener('selectionchange', handler);
      return () => document.removeEventListener('selectionchange', handler);
    }, [syncCaret]);

    useEffect(() => {
      if (autoFocus && ready) inputRef.current?.focus();
    }, [autoFocus, ready]);

    // The selection and kind of the edit about to happen, so the edit's range is
    // exact even when the typed character repeats its neighbour ("1" in front of "112").
    // Listened to natively: React's synthetic onBeforeInput is keypress-based and
    // never fires for deletions or execCommand edits.
    const pendingEdit = useRef<{start: number; end: number; type: string} | null>(null);
    useEffect(() => {
      const input = inputRef.current;
      if (!input) return;
      const handler = (event: Event) => {
        pendingEdit.current = {
          start: cpOf(input.value, input.selectionStart ?? input.value.length),
          end: cpOf(input.value, input.selectionEnd ?? input.value.length),
          type: (event as InputEvent).inputType ?? '',
        };
      };
      input.addEventListener('beforeinput', handler);
      return () => input.removeEventListener('beforeinput', handler);
    }, [ready]);

    const onInput = (event: React.FormEvent<HTMLInputElement>) => {
      const input = inputRef.current;
      const formatter = formatterRef.current;
      if (!input || !formatter) return;
      const prev = state.current.text;
      const next = input.value;
      if (mode === 'number') {
        const a = Array.from(prev);
        const b = Array.from(next);
        const inputType = (event.nativeEvent as InputEvent).inputType ?? '';
        const pending = pendingEdit.current ?? {
          start: state.current.selStart,
          end: state.current.selEnd,
          type: inputType,
        };
        pendingEdit.current = null;
        let start: number;
        let end: number;
        if (pending.start <= pending.end && pending.end <= a.length) {
          const removed = Math.max(0, a.length + (pending.end - pending.start) - b.length);
          if (pending.type.startsWith('deleteContentForward') && pending.start === pending.end) {
            start = pending.start;
            end = start + removed;
          } else if (pending.type.startsWith('delete') && pending.start === pending.end) {
            end = pending.start;
            start = end - removed;
          } else {
            start = pending.start;
            end = pending.end;
          }
        } else {
          // No beforeinput (older browsers): recover the range from the two strings.
          let p = 0;
          while (p < a.length && p < b.length && a[p] === b[p]) p++;
          let s = 0;
          while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
          start = p;
          end = a.length - s;
        }
        const replacement = b.slice(start, b.length - (a.length - end)).join('');
        // Forward-deleting a grouping separator takes the digit after it (the
        // formatter's own rule covers backspace, which takes the digit before).
        if (replacement === '' && end - start === 1 && pending.type.startsWith('deleteContentForward') &&
            formatter.kindOf(a[start]!.codePointAt(0)!) === 2 && end < a.length) {
          end += 1;
        }
        const edit = formatter.applyEdit(prev, start, end, replacement);
        const text = edit.accepted ? String(edit.text) : prev;
        const caret = edit.accepted ? edit.caret : start;
        state.current.text = text;
        input.value = text;
        const at = utf16Of(text, caret);
        input.setSelectionRange(at, at);
        state.current.caret = caret;
        state.current.selStart = state.current.selEnd = caret;
        restartBlink();
        feed(caret);
        if (edit.accepted) {
          latest.current.onChangeText?.(text);
          latest.current.onChangeValue?.(formatter.value(text));
        }
      } else {
        let text = next;
        if (maxLength !== undefined && Array.from(text).length > maxLength) {
          text = Array.from(text).slice(0, maxLength).join('');
          input.value = text;
        }
        state.current.text = text;
        const caret = cpOf(text, input.selectionStart ?? text.length);
        state.current.caret = caret;
        state.current.selStart = state.current.selEnd = caret;
        restartBlink();
        feed(caret);
        latest.current.onChangeText?.(text);
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
        blur: () => inputRef.current?.blur(),
        clear: () => replaceText('', true),
        setText: (text) => replaceText(text, true),
        setValue: (value) => replaceText(String(formatterRef.current?.format(value) ?? ''), true),
        getText: () => state.current.text,
        getValue: () => formatterRef.current?.value(state.current.text) ?? NaN,
      }),
      [replaceText],
    );

    const inputMode = mode === 'number' ? (fractionDigits > 0 ? 'decimal' : 'numeric') : 'text';

    return (
      <div ref={rootRef} className={className} style={{position: 'relative', width: '100%', ...style}}>
        <canvas ref={canvasRef} style={{display: 'block', width: '100%', pointerEvents: 'none'}} />
        <input
          ref={inputRef}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          defaultValue=""
          aria-label={placeholder || undefined}
          onInput={onInput}
          onFocus={() => {
            state.current.focused = true;
            restartBlink();
            syncCaret();
            latest.current.onFocusChange?.(true);
          }}
          onBlur={() => {
            state.current.focused = false;
            render();
            latest.current.onFocusChange?.(false);
          }}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            margin: 0,
            border: 0,
            outline: 'none',
            background: 'transparent',
            color: 'transparent',
            WebkitTextFillColor: 'transparent',
            caretColor: 'transparent',
            textAlign,
            boxSizing: 'border-box',
            letterSpacing: 0,
            fontKerning: 'none',
          }}
        />
      </div>
    );
  },
);
