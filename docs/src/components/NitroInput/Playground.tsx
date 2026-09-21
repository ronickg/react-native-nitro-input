import React, {useEffect, useMemo, useRef, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import CodeBlock from '@theme/CodeBlock';
import {NitroInputFramed, type NitroInputFramedHandle} from './NitroInputFramed';
import styles from './Playground.module.css';

// ---------------------------------------------------------------------------
// A live `NitroInput` with every prop worth turning wired to a knob, and the
// JSX that would produce what you are looking at.
//
// One schema drives all three: the controls, the props handed to the preview,
// and the generated snippet. They cannot drift - a prop added here shows up in
// all of them, and the snippet only ever lists what you actually changed.
// ---------------------------------------------------------------------------

type Kind = 'seg' | 'select' | 'range' | 'text' | 'color' | 'bool';

interface Knob {
  /** The prop's real name, as written in JSX. */
  key: string;
  kind: Kind;
  /** The component's own default. Props still equal to it stay out of the snippet. */
  def: string | number | boolean;
  options?: readonly (string | number)[];
  /** `range`: bounds and step. */
  min?: number;
  max?: number;
  step?: number;
  /** Quoted in the snippet - strings are, numbers and booleans are not. */
  quote?: boolean;
  /** Hidden unless this returns true, so the panel only shows what applies. */
  when?: (s: State) => boolean;
  hint?: string;
}

interface Group {
  title: string;
  knobs: Knob[];
}

type State = Record<string, string | number | boolean>;

/** `auto` follows the site's theme; the rest are explicit choices. */
const AUTO = 'auto';
const INK = [AUTO, '#0f172a', '#2563eb', '#16a34a', '#b45309', '#dc2626', '#7c3aed'] as const;
const STROKE = ['#94a3b8', '#0f172a', '#2563eb', '#16a34a', '#dc2626', '#7c3aed'] as const;
const FILL = [AUTO, '#e2e8f0', '#f1f5f9', '#ede9fe', '#dcfce7', '#fee2e2', '#fef3c7'] as const;

/**
 * The colours the page itself is using. Read from the CSS variables rather
 * than hard-coded, and re-read when the theme toggle flips `data-theme`, so a
 * field with no colour of its own is legible in either theme.
 */
export function useThemeColors() {
  const [colors, setColors] = useState({ink: '#0f172a', fill: '#e2e8f0', muted: '#94a3b8'});
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
      setColors({
        ink: pick('--ifm-font-color-base', '#0f172a'),
        fill: pick('--nitro-bg-sunken', '#e2e8f0'),
        muted: pick('--nitro-ink-muted', '#94a3b8'),
      });
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'class']});
    return () => observer.disconnect();
  }, []);
  return colors;
}

const framed = (s: State) => s.variant !== 'none';
const labelled = (s: State) => framed(s) && String(s.label).length > 0;
const wraps = (s: State) => s.multiline === true;
const amount = (s: State) => s.mode === 'number' && !wraps(s);
// The glyph engine lays one run out on one baseline, so a wrapping field is
// plain text: amounts, masks and affixes all belong to the single-line path.
const single = (s: State) => !wraps(s);

const GROUPS: Group[] = [
  {
    title: 'Frame',
    knobs: [
      {key: 'variant', kind: 'seg', def: 'none', options: ['none', 'outlined', 'filled'], quote: true},
      {key: 'label', kind: 'text', def: '', quote: true, when: framed, hint: 'Floating label'},
      {
        key: 'labelBehavior',
        kind: 'seg',
        def: 'float',
        options: ['float', 'always'],
        quote: true,
        when: labelled,
      },
      {key: 'cornerRadius', kind: 'range', def: 0, min: 0, max: 28, step: 1, when: framed},
      {key: 'strokeWidth', kind: 'range', def: 1, min: 1, max: 4, step: 0.5, when: framed},
      {key: 'strokeColor', kind: 'color', def: '#94a3b8', options: STROKE, quote: true, when: framed},
      {
        key: 'focusedStrokeColor',
        kind: 'color',
        def: '#2563eb',
        options: STROKE,
        quote: true,
        when: framed,
      },
      {key: 'fillColor', kind: 'color', def: AUTO, options: FILL, quote: true, when: (s) => s.variant === 'filled'},
      {key: 'labelColor', kind: 'color', def: '#94a3b8', options: STROKE, quote: true, when: labelled},
      {key: 'labelFontSize', kind: 'range', def: 0, min: 0, max: 20, step: 1, when: labelled},
    ],
  },
  {
    title: 'Typography',
    knobs: [
      {key: 'fontSize', kind: 'range', def: 17, min: 11, max: 64, step: 1},
      {
        key: 'fontWeight',
        kind: 'select',
        def: 400,
        options: [300, 400, 500, 600, 700, 800, 900],
      },
      {key: 'color', kind: 'color', def: AUTO, options: INK, quote: true},
      {key: 'textAlign', kind: 'seg', def: 'left', options: ['left', 'center', 'right'], quote: true},
      {
        key: 'lineHeight',
        kind: 'range',
        def: 0,
        min: 0,
        max: 48,
        step: 1,
        when: wraps,
        hint: '0 uses the font’s own line box',
      },
    ],
  },
  {
    title: 'Content',
    knobs: [
      {key: 'mode', kind: 'seg', def: 'text', options: ['text', 'number'], quote: true, when: single},
      {key: 'placeholder', kind: 'text', def: '', quote: true},
      {key: 'multiline', kind: 'bool', def: false},
      {key: 'numberOfLines', kind: 'range', def: 0, min: 0, max: 8, step: 1, when: wraps},
      {key: 'maxLength', kind: 'range', def: 0, min: 0, max: 40, step: 1, when: single},
    ],
  },
  {
    title: 'Amount format',
    knobs: [
      {key: 'fractionDigits', kind: 'range', def: 2, min: 0, max: 4, step: 1, when: amount},
      {key: 'groupingSeparator', kind: 'seg', def: ',', options: [',', '.', ' '], quote: true, when: amount},
      {key: 'decimalSeparator', kind: 'seg', def: '.', options: ['.', ','], quote: true, when: amount},
      {key: 'prefix', kind: 'text', def: '', quote: true, when: single},
      {key: 'suffix', kind: 'text', def: '', quote: true, when: single},
      {
        key: 'affixAlign',
        kind: 'select',
        def: 'baseline',
        options: ['baseline', 'center', 'top', 'bottom'],
        quote: true,
        when: (s) => single(s) && (String(s.prefix).length > 0 || String(s.suffix).length > 0),
      },
      {
        key: 'prefixFontSize',
        kind: 'range',
        def: 0,
        min: 0,
        max: 48,
        step: 1,
        when: (s) => single(s) && String(s.prefix).length > 0,
      },
    ],
  },
  {
    title: 'Morph',
    knobs: [
      {
        key: 'morph',
        kind: 'bool',
        def: false,
        when: single,
        hint: 'Off is a plain field, as NitroInput is by default: the system draws the text',
      },
      {
        key: 'duration',
        kind: 'range',
        def: 400,
        min: 80,
        max: 1200,
        step: 20,
        when: (s) => single(s) && s.morph === true,
      },
      {
        key: 'easing',
        kind: 'select',
        def: 'expo',
        options: ['expo', 'easeOut', 'easeInOut', 'linear', 'spring'],
        quote: true,
        when: (s) => single(s) && s.morph === true,
      },
      {
        key: 'bounce',
        kind: 'range',
        def: 0,
        min: 0,
        max: 0.6,
        step: 0.05,
        when: (s) => single(s) && s.morph === true && s.easing === 'spring',
      },
      {
        key: 'effect',
        kind: 'seg',
        def: 'auto',
        options: ['auto', 'slide', 'fade'],
        quote: true,
        when: (s) => single(s) && s.morph === true,
      },
    ],
  },
];

const ALL: Knob[] = GROUPS.flatMap((g) => g.knobs);
const DEFAULTS: State = Object.fromEntries(ALL.map((k) => [k.key, k.def]));

/** Props the preview should not be told about, because they do not apply. */
function activeState(s: State): State {
  const out: State = {};
  for (const knob of ALL) {
    if (knob.when && !knob.when(s)) continue;
    out[knob.key] = s[knob.key];
  }
  return out;
}

/** The JSX for what is on screen: only the props that differ from the default. */
function snippetFor(s: State): string {
  const active = activeState(s);
  const lines: string[] = [];
  for (const knob of ALL) {
    if (!(knob.key in active)) continue;
    const value = active[knob.key];
    if (value === knob.def) continue;
    // A `0` on these means "unset" rather than zero, so it is the default.
    if (value === 0 && knob.def === 0) continue;
    if (typeof value === 'boolean') {
      lines.push(value ? `  ${knob.key}` : `  ${knob.key}={false}`);
    } else if (knob.quote) {
      lines.push(`  ${knob.key}="${String(value)}"`);
    } else {
      lines.push(`  ${knob.key}={${String(value)}}`);
    }
  }
  lines.push('  onChangeText={setText}');
  if (!lines.length) return '<NitroInput />';
  return `<NitroInput\n${lines.join('\n')}\n/>`;
}

function Row({knob, children}: {knob: Knob; children: React.ReactNode}) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel} title={knob.hint}>
        {knob.key}
      </span>
      <span className={styles.rowValue}>{children}</span>
    </div>
  );
}

function Control({
  knob,
  value,
  onChange,
  resolve,
}: {
  knob: Knob;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
  /** What a theme-following colour is right now, for painting its swatch. */
  resolve: (option: string) => string;
}) {
  switch (knob.kind) {
    case 'seg':
      return (
        <div className={styles.seg}>
          {knob.options!.map((o) => (
            <button
              key={String(o)}
              type="button"
              className={styles.segBtn}
              data-on={value === o}
              onClick={() => onChange(o)}>
              {o === ' ' ? '␣' : String(o)}
            </button>
          ))}
        </div>
      );
    case 'select':
      return (
        <select
          value={String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            const match = knob.options!.find((o) => String(o) === raw)!;
            onChange(match);
          }}>
          {knob.options!.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      );
    case 'range':
      return (
        <>
          <input
            type="range"
            min={knob.min}
            max={knob.max}
            step={knob.step}
            value={Number(value)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className={styles.num}>{Number(value) === 0 && knob.def === 0 ? '—' : value}</span>
        </>
      );
    case 'text':
      return (
        <input
          type="text"
          value={String(value)}
          placeholder="—"
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'color':
      return (
        <span className={styles.swatches}>
          {knob.options!.map((o) => (
            <button
              key={String(o)}
              type="button"
              aria-label={o === AUTO ? 'follow the theme' : String(o)}
              title={o === AUTO ? 'Follows the site theme' : String(o)}
              className={styles.swatch}
              data-on={value === o}
              data-auto={o === AUTO}
              style={{background: resolve(String(o))}}
              onClick={() => onChange(o)}
            />
          ))}
        </span>
      );
    case 'bool':
      return (
        <div className={styles.seg}>
          {[false, true].map((o) => (
            <button
              key={String(o)}
              type="button"
              className={styles.segBtn}
              data-on={value === o}
              onClick={() => onChange(o)}>
              {o ? 'on' : 'off'}
            </button>
          ))}
        </div>
      );
  }
}

function PlaygroundInner() {
  const ref = useRef<NitroInputFramedHandle>(null);
  const [state, setState] = useState<State>({
    ...DEFAULTS,
    variant: 'outlined',
    label: 'Email address',
    cornerRadius: 10,
    placeholder: 'you@example.com',
  });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [text, setText] = useState('');
  const [value, setValue] = useState(NaN);

  const theme = useThemeColors();
  // `auto` means "whatever the page is using"; everything else is literal.
  const resolveColor = (option: string) =>
    option !== AUTO ? option : theme.ink;
  const resolveFill = (option: string) => (option !== AUTO ? option : theme.fill);
  const active = useMemo(() => activeState(state), [state]);
  const snippet = useMemo(() => snippetFor(state), [state]);
  const set = (key: string) => (v: string | number | boolean) =>
    setState((prev) => ({...prev, [key]: v}));

  // `0` is this playground's "unset" for the props whose real default is unset.
  const orUndef = (v: unknown) => (v === 0 ? undefined : (v as number));

  return (
    <div className="rn-demo">
      <div className={styles.layout}>
        <div className={styles.preview}>
          <div className={styles.canvasWrap}>
            <NitroInputFramed
              ref={ref}
              mode={active.mode as 'text' | 'number'}
              variant={active.variant as never}
              label={active.label as string}
              labelBehavior={active.labelBehavior as never}
              cornerRadius={active.cornerRadius as number}
              strokeWidth={active.strokeWidth as number}
              strokeColor={active.strokeColor as string}
              focusedStrokeColor={active.focusedStrokeColor as string}
              fillColor={resolveFill(active.fillColor as string)}
              labelColor={active.labelColor as string}
              labelFontSize={orUndef(active.labelFontSize)}
              fontSize={active.fontSize as number}
              fontWeight={active.fontWeight as number}
              color={resolveColor(active.color as string)}
              textAlign={active.textAlign as never}
              lineHeight={orUndef(active.lineHeight)}
              multiline={active.multiline as boolean}
              numberOfLines={orUndef(active.numberOfLines)}
              placeholder={active.placeholder as string}
              maxLength={orUndef(active.maxLength)}
              fractionDigits={active.fractionDigits as number}
              groupingSeparator={active.groupingSeparator as string}
              decimalSeparator={active.decimalSeparator as string}
              prefix={active.prefix as string}
              suffix={active.suffix as string}
              affixAlign={active.affixAlign as never}
              prefixFontSize={orUndef(active.prefixFontSize)}
              morph={active.morph !== false}
              duration={active.duration as number}
              easing={active.easing as never}
              bounce={active.bounce as number}
              effect={active.effect as never}
              onChangeText={setText}
              onChangeValue={setValue}
            />
          </div>
          <p className={styles.readout}>
            onChangeText <code>{JSON.stringify(text)}</code>
            {active.mode === 'number' ? (
              <>
                {' · '}onChangeValue <code>{Number.isNaN(value) ? 'NaN' : String(value)}</code>
              </>
            ) : null}
          </p>
          <div className="rn-demo-controls">
            <button className="rn-btn" type="button" onClick={() => ref.current?.focus()}>
              Focus
            </button>
            <button className="rn-btn" type="button" onClick={() => ref.current?.blur()}>
              Blur
            </button>
            <button className="rn-btn" type="button" onClick={() => ref.current?.clear()}>
              Clear
            </button>
            <button
              className="rn-btn"
              type="button"
              onClick={() =>
                setState({
                  ...DEFAULTS,
                  variant: 'outlined',
                  label: 'Email address',
                  cornerRadius: 10,
                  placeholder: 'you@example.com',
                })
              }>
              Reset
            </button>
          </div>
        </div>

        <div className={styles.panel}>
          {GROUPS.map((group) => {
            const visible = group.knobs.filter((k) => !k.when || k.when(state));
            if (!visible.length) return null;
            const collapsed = open[group.title] === false;
            return (
              <div key={group.title} className={styles.group}>
                <button
                  type="button"
                  className={styles.groupHead}
                  onClick={() => setOpen((p) => ({...p, [group.title]: collapsed}))}>
                  {group.title}
                  <span aria-hidden>{collapsed ? '+' : '–'}</span>
                </button>
                {collapsed ? null : (
                  <div className={styles.groupBody}>
                    {visible.map((knob) => (
                      <Row key={knob.key} knob={knob}>
                        <Control
                          knob={knob}
                          value={state[knob.key]}
                          onChange={set(knob.key)}
                          resolve={resolveColor}
                        />
                      </Row>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.code}>
        <div className={styles.codeHead}>
          <span className={styles.codeTitle}>What you are looking at</span>
        </div>
        <CodeBlock language="tsx" className={styles.codeBlock}>
          {snippet}
        </CodeBlock>
      </div>
    </div>
  );
}

/** The playground. Canvas and WebAssembly, so it only renders in the browser. */
export function Playground() {
  return (
    <BrowserOnly fallback={<div className="rn-demo" style={{minHeight: 420}} />}>
      {() => <PlaygroundInner />}
    </BrowserOnly>
  );
}

export default Playground;
