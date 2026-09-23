import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  NitroInputCanvas,
  type NitroInputCanvasHandle,
  type NitroInputCanvasProps,
} from './NitroInputCanvas';
import {useReflowModule} from '@site/src/engine/useReflowEngine';

// ---------------------------------------------------------------------------
// The outlined / filled frame, split the way the native views split it: this
// draws the frame and owns the label, and the field inside it only draws text.
// A single line is the reflow canvas; a wrapping one is a <textarea>, because
// `multiline` is plain on the real component too - the glyph engine lays one
// run out on one baseline and never sees a wrapped one.
//
// The gap under the floated label is a real hole in the stroked path, cut by
// the same C++ `OutlineGeometry` the two platforms replay (docs/wasm), so this
// is the geometry rather than a look-alike.
// ---------------------------------------------------------------------------

export type Variant = 'none' | 'outlined' | 'filled';
export type LabelBehavior = 'float' | 'always';

export interface NitroInputFramedProps extends NitroInputCanvasProps {
  variant?: Variant;
  label?: string;
  labelBehavior?: LabelBehavior;
  cornerRadius?: number;
  strokeWidth?: number;
  strokeColor?: string;
  focusedStrokeColor?: string;
  fillColor?: string;
  labelColor?: string;
  labelFocusedColor?: string;
  labelFontSize?: number;
  multiline?: boolean;
  numberOfLines?: number;
  lineHeight?: number;
  /** Off is a plain field: the browser draws the text, with no reflow. */
  reflow?: boolean;
}

/** The native views' timings: 200ms on a decelerate curve, notch staggered behind. */
const LABEL_MS = 200;
const NOTCH_DELAY_MS = 50;
const NOTCH_OPEN_MS = 100;
const NOTCH_CLOSE_MS = 50;
const FLOATED_RATIO = 0.75;
const GAP_PADDING = 4;

const decelerate = (t: number) => {
  // cubic-bezier(0, 0, 0.2, 1), solved the cheap way: it is close enough to its
  // own y at this size, and the curve is monotonic.
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3) * 0.78 - (1 - c) * 0.22 * Math.pow(1 - c, 1);
};

/**
 * `max(16, radius + 8)`, the horizontal inset the native views use: the label
 * has to clear the corner curve, so a rounder frame pushes it further in.
 */
const labelInsetFor = (radius: number) => Math.max(16, radius + 8);

/**
 * The room above and below the text. Flat, unlike the side inset - the text
 * sits in the middle of the box, so a rounder frame must not make it taller.
 */
const FRAME_PADDING = 16;

export interface NitroInputFramedHandle extends NitroInputCanvasHandle {}

export const NitroInputFramed = forwardRef<NitroInputFramedHandle, NitroInputFramedProps>(
  function NitroInputFramed(props, ref) {
    const {
      variant = 'none',
      label = '',
      labelBehavior = 'float',
      cornerRadius = 0,
      strokeWidth = 1,
      strokeColor = '#94a3b8',
      focusedStrokeColor,
      fillColor = '#e2e8f0',
      labelColor,
      labelFocusedColor,
      labelFontSize,
      multiline = false,
      numberOfLines = 0,
      lineHeight,
      reflow = true,
      fontSize = 17,
      fontWeight = 400,
      fontFamily,
      color = '#0f172a',
      placeholder = '',
      placeholderColor,
      textAlign = 'left',
      maxLength,
      onChangeText,
      onFocusChange,
      ...canvasProps
    } = props;

    const module = useReflowModule();
    const editable = (canvasProps as {editable?: boolean}).editable !== false;
    const draws = variant !== 'none';
    const hasLabel = draws && label.length > 0;

    const hostRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLCanvasElement>(null);
    const fieldRef = useRef<NitroInputCanvasHandle>(null);
    const areaRef = useRef<HTMLTextAreaElement>(null);
    const rafRef = useRef(0);

    const [focused, setFocused] = useState(false);
    const [filled, setFilled] = useState(false);
    const [area, setArea] = useState('');
    /// What a wrapping field measures to, for the `numberOfLines`-less case.
    const [grownLines, setGrownLines] = useState(1);

    // Progress is animated outside React: a state update per frame would be a
    // commit per frame, and nothing above this needs to know where the label is.
    const progress = useRef(0);
    const target = useRef(0);
    const startedAt = useRef(0);
    const startedFrom = useRef(0);

    // Whichever field is showing is the one whose text floats the label: a
    // wrapping field starts empty even when the single-line one held something.
    const hasText = multiline ? area.length > 0 : filled;
    const shouldFloat = hasLabel && (labelBehavior === 'always' || focused || hasText);

    const lineBox = lineHeight && lineHeight > 0 ? lineHeight : Math.ceil(fontSize * 1.18);
    const inset = draws ? labelInsetFor(cornerRadius) : 0;
    const pad = draws ? FRAME_PADDING : 0;
    const floatedSize = labelFontSize && labelFontSize > 0 ? labelFontSize : Math.max(9, fontSize * FLOATED_RATIO);
    // An outlined label straddles the top stroke, so half of it hangs into the
    // box; a filled one sits inside, on its own line above the text.
    const overhang = hasLabel && variant !== 'filled' ? floatedSize / 2 : 0;
    const topInset = hasLabel && variant === 'filled' ? floatedSize * 1.4 : 0;
    // `numberOfLines` pins the box; without one it grows with the text, which
    // is what the component does on both platforms.
    const lines = multiline ? (numberOfLines > 0 ? numberOfLines : grownLines) : 1;
    const contentHeight = lineBox * lines;
    const boxHeight = draws
      ? contentHeight + pad * 2 + topInset + (multiline ? overhang : 0)
      : contentHeight;
    // A single line is centred in the box; a wrapping one starts at the top.
    const padTop = draws ? (multiline ? pad + topInset + overhang : (boxHeight - contentHeight) / 2) : 0;
    // A floated outlined label is centred *on* the top stroke, so half of it is
    // above the box. The native views draw it - neither clips to its bounds -
    // so the canvas has to hang above its own box rather than cut it off.
    const overflowTop = hasLabel && variant !== 'filled' ? Math.ceil(floatedSize / 2) + 2 : 0;

    const drawFrame = useCallback(() => {
      const canvas = frameRef.current;
      const host = hostRef.current;
      if (!canvas || !host || !draws) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = host.clientWidth;
      const h = boxHeight;
      const tall = h + overflowTop;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(tall * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(tall * dpr);
      }
      canvas.style.width = `${w}px`;
      canvas.style.height = `${tall}px`;
      canvas.style.top = `${-overflowTop}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, tall);
      if (w <= 0) return;
      // Everything below is in the box's own coordinates.
      ctx.translate(0, overflowTop);

      const p = progress.current;
      const stroke = focused ? focusedStrokeColor ?? strokeColor : strokeColor;
      const width = focused ? strokeWidth * 2 : strokeWidth;
      const family =
        fontFamily ?? "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

      // The label, measured at the size it is right now, is what the gap is cut for.
      const size = fontSize + (floatedSize - fontSize) * p;
      ctx.font = `${fontWeight} ${size}px ${family}`;
      const labelWidth = hasLabel ? ctx.measureText(label).width : 0;

      // `OutlineGeometry` insets by half the stroke itself - it hands back
      // 0.5 for a 1pt stroke - so the box it is given is the full one, and
      // there is no half-stroke translate to apply on top.
      const inner = {
        width: Math.max(0, w),
        height: Math.max(0, h),
        radius: cornerRadius,
        strokeWidth: width,
        // A filled field squares its bottom so the indicator rule meets the
        // fill edge to edge rather than overhanging the curve.
        bottomRadius: variant === 'filled' ? 0 : -1,
      };

      ctx.save();

      const path = new Path2D();
      // The module loads asynchronously; before it arrives the frame is an
      // unbroken rounded rectangle, which is also what an unlabelled one is.
      const segments = module && draws && variant === 'outlined' ? module.outlinePath(
        inner.width,
        inner.height,
        inner.radius,
        inner.strokeWidth,
        inner.bottomRadius,
        inset - GAP_PADDING,
        labelWidth,
        GAP_PADDING,
        hasLabel ? p : 0,
      ) : null;

      if (segments) {
        for (let i = 0; i < segments.size(); i++) {
          const s = segments.get(i)!;
          if (s.verb === 0) path.moveTo(s.x, s.y);
          else if (s.verb === 1) path.lineTo(s.x, s.y);
          else {
            const from = (s.startAngle * Math.PI) / 180;
            const to = ((s.startAngle + s.sweepAngle) * Math.PI) / 180;
            path.arc(s.x, s.y, s.radius, from, to, s.sweepAngle < 0);
          }
        }
        segments.delete();
      } else {
        const half = width / 2;
        path.roundRect(half, half, Math.max(0, w - width), Math.max(0, h - width), cornerRadius);
      }

      if (variant === 'filled') {
        const fillPath = new Path2D();
        fillPath.roundRect(0, 0, w, h, [cornerRadius, cornerRadius, 0, 0]);
        ctx.fillStyle = fillColor;
        ctx.fill(fillPath);
        // Its one rule along the bottom, rather than a stroke all the way round.
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(0, h - width / 2);
        ctx.lineTo(w, h - width / 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.stroke(path);
      }
      ctx.restore();

      if (hasLabel) {
        // Resting: on the text's own line, at the text's size. Floated: onto the
        // top stroke (outlined) or the line above the text (filled).
        // Resting: on the text's own line. A single line is centred in the box;
        // a wrapping one starts at the top, and the label belongs where the
        // first character will appear rather than halfway down an empty field.
        const restY = variant === 'filled' || multiline ? padTop + lineBox / 2 : h / 2;
        // Floated onto the stroke means centred on it, which is what the gap
        // is cut around.
        const floatY = variant === 'filled' ? pad + floatedSize / 2 : width / 2;
        const y = restY + (floatY - restY) * p;
        ctx.save();
        ctx.font = `${fontWeight} ${size}px ${family}`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = focused ? labelFocusedColor ?? focusedStrokeColor ?? labelColor ?? stroke : labelColor ?? stroke;
        ctx.fillText(label, inset, y);
        ctx.restore();
      }
    }, [
      boxHeight,
      cornerRadius,
      draws,
      fillColor,
      floatedSize,
      focused,
      focusedStrokeColor,
      fontFamily,
      fontSize,
      fontWeight,
      hasLabel,
      inset,
      label,
      labelColor,
      labelFocusedColor,
      lineBox,
      module,
      multiline,
      overflowTop,
      padTop,
      strokeColor,
      strokeWidth,
      variant,
    ]);

    /** Runs the label and the notch to `to`, on the native views' timings. */
    const animateTo = useCallback(
      (to: number, animated: boolean) => {
        if (!animated) {
          progress.current = to;
          target.current = to;
          drawFrame();
          return;
        }
        if (target.current === to) return;
        target.current = to;
        startedFrom.current = progress.current;
        startedAt.current = performance.now();
        cancelAnimationFrame(rafRef.current);
        const opening = to > startedFrom.current;
        const total = opening ? NOTCH_DELAY_MS + NOTCH_OPEN_MS : NOTCH_CLOSE_MS;
        const duration = Math.max(LABEL_MS, total);
        const step = () => {
          const t = (performance.now() - startedAt.current) / duration;
          const eased = decelerate(Math.min(1, t));
          progress.current = startedFrom.current + (target.current - startedFrom.current) * eased;
          drawFrame();
          if (t < 1) rafRef.current = requestAnimationFrame(step);
          else progress.current = target.current;
        };
        rafRef.current = requestAnimationFrame(step);
      },
      [drawFrame],
    );

    useEffect(() => {
      animateTo(shouldFloat ? 1 : 0, progress.current !== (shouldFloat ? 1 : 0));
    }, [animateTo, shouldFloat]);

    useEffect(() => {
      drawFrame();
    }, [drawFrame]);

    useEffect(() => {
      const host = hostRef.current;
      if (!host || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => drawFrame());
      observer.observe(host);
      return () => observer.disconnect();
    }, [drawFrame]);

    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

    // How many lines the text actually takes. Measured with the height released,
    // because the box it normally fills is the answer we are looking for.
    useLayoutEffect(() => {
      const el = areaRef.current;
      if (!el || !multiline || numberOfLines > 0) return;
      const previous = el.style.height;
      el.style.height = 'auto';
      const next = Math.max(1, Math.round(el.scrollHeight / lineBox));
      el.style.height = previous;
      setGrownLines((current) => (current === next ? current : next));
    }, [area, lineBox, multiline, numberOfLines]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => (multiline ? areaRef.current?.focus() : fieldRef.current?.focus()),
        blur: () => (multiline ? areaRef.current?.blur() : fieldRef.current?.blur()),
        clear: () => (multiline ? setArea('') : fieldRef.current?.clear()),
        setText: (text: string) => (multiline ? setArea(text) : fieldRef.current?.setText(text)),
        setValue: (value: number) => fieldRef.current?.setValue(value),
        getText: () => (multiline ? area : fieldRef.current?.getText() ?? ''),
        getValue: () => fieldRef.current?.getValue() ?? NaN,
      }),
      [area, multiline],
    );

    const family =
      fontFamily ?? "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    // The label sits where the placeholder would, so only one of them shows.
    const visiblePlaceholder = hasLabel && !shouldFloat ? '' : placeholder;

    return (
      <div
        ref={hostRef}
        // The editor only covers the text; the rest of the box is frame. A field
        // is focused by tapping anywhere inside its bounds, which is what the
        // native views do - there the hidden field *is* the bounds - so the
        // padding has to hand the focus on rather than swallow it.
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
          // Without this the press lands on nothing, which blurs the editor.
          event.preventDefault();
          if (multiline) areaRef.current?.focus();
          else fieldRef.current?.focus();
        }}
        style={{
          position: 'relative',
          width: '100%',
          height: boxHeight,
          boxSizing: 'border-box',
          cursor: editable ? 'text' : 'default',
        }}>
        {draws ? (
          <canvas
            ref={frameRef}
            style={{position: 'absolute', left: 0, display: 'block', pointerEvents: 'none'}}
          />
        ) : null}
        <div
          style={{
            position: 'absolute',
            left: inset,
            right: inset,
            top: padTop,
            height: contentHeight,
          }}>
          {multiline ? (
            <textarea
              ref={areaRef}
              value={area}
              placeholder={visiblePlaceholder}
              maxLength={maxLength}
              onChange={(e) => {
                setArea(e.target.value);
                onChangeText?.(e.target.value);
              }}
              onFocus={() => {
                setFocused(true);
                onFocusChange?.(true);
              }}
              onBlur={() => {
                setFocused(false);
                onFocusChange?.(false);
              }}
              style={{
                width: '100%',
                height: '100%',
                margin: 0,
                padding: 0,
                border: 0,
                outline: 'none',
                resize: 'none',
                background: 'transparent',
                color,
                textAlign,
                font: `${fontWeight} ${fontSize}px/${lineBox}px ${family}`,
                boxSizing: 'border-box',
              }}
            />
          ) : (
            <NitroInputCanvas
              {...canvasProps}
              ref={fieldRef}
              fontSize={fontSize}
              fontWeight={fontWeight}
              fontFamily={fontFamily}
              color={color}
              placeholder={visiblePlaceholder}
              placeholderColor={placeholderColor}
              textAlign={textAlign}
              maxLength={maxLength}
              duration={reflow ? canvasProps.duration : 0}
              onChangeText={(text) => {
                setFilled(text.length > 0);
                onChangeText?.(text);
              }}
              onFocusChange={(next) => {
                setFocused(next);
                onFocusChange?.(next);
              }}
            />
          )}
        </div>
      </div>
    );
  },
);

export default NitroInputFramed;
