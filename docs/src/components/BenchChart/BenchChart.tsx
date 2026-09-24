import React, {useEffect, useMemo, useRef, useState} from 'react';
import clsx from 'clsx';
import data from '@site/src/data/benchmarks.json';
import styles from './BenchChart.module.css';

/**
 * The benchmark tables as bars: one row per implementation, one column per
 * phone (a `group` across every phone) or per scenario (a `device` with its
 * `groups`), the metric picked from a row of buttons. This library's rows
 * are the accent, everything else is gray, so the chart answers one question
 * at a time. The data is `docs/src/data/benchmarks.json`, which
 * `scripts/bench/report.mjs --json` writes from the result files, the same
 * groups and medians the tables under each chart print.
 *
 * Frame-rate metrics use the phone's own refresh rate as the full width, so a
 * bar that reaches the end is a panel that never missed; every other metric
 * shares one scale across the three columns, so a bar reads the same in each.
 * Bars grow in when the chart scrolls into view and the figures roll up to
 * their value, unless the reader asked for reduced motion.
 */

type Row = {impl: string; label: string; order?: number; ours: boolean; runs: number; error: string | null} & Record<string, unknown>;
type Group = {key: string; kind: string; title: string; rows: Row[]};
type Device = {key: string; name: string; model: string | null; platform: string | null; hz: number | null; groups: Group[]};

/** A column: one phone for a group, or one scenario for a phone. */
type Column = {key: string; title: string; device: Device; group: Group};

type Spec = {
  /** The button's text. */
  short: string;
  /** The axis title under the buttons. */
  label: string;
  unit: string;
  better: 'higher' | 'lower';
  /** `hz`: the column's full width is the phone's refresh rate. */
  domain?: 'hz';
  digits?: number;
  /** A metric whose negative values are noise (a memory floor that fell): the bar starts at zero, the label keeps the sign. */
  floorAtZero?: boolean;
};

export const METRICS = {
  'ui.fps': {short: 'UI fps', label: 'Frames per second the main thread delivered', unit: 'fps', better: 'higher', domain: 'hz'},
  'ui.dropped': {short: 'Dropped', label: 'Frames the main thread missed in five seconds', unit: 'frames', better: 'lower', digits: 0},
  'js.fps': {short: 'JS fps', label: 'Frames per second the JS thread kept up', unit: 'fps', better: 'higher'},
  'cpu.main': {short: 'Main CPU', label: 'Main-thread CPU, percent of one core', unit: '%', better: 'lower', digits: 0},
  'cpu.js': {short: 'JS CPU', label: 'JS-thread CPU, percent of one core', unit: '%', better: 'lower', digits: 0},
  'mountMs.p50': {short: 'Mount', label: 'Mount, milliseconds to the last first layout, median of ten', unit: 'ms', better: 'lower'},
  'unmountMs.p50': {short: 'Unmount', label: 'Unmount, milliseconds to the second frame after, median of ten', unit: 'ms', better: 'lower'},
  'mountMainMs': {short: 'Main CPU / mount', label: 'Main-thread CPU per mount, milliseconds', unit: 'ms', better: 'lower', digits: 0},
  'mountJsMs': {short: 'JS CPU / mount', label: 'JS-thread CPU per mount, milliseconds', unit: 'ms', better: 'lower', digits: 0},
  'growthKbPerCycle': {short: 'Growth / cycle', label: 'Footprint growth per mount/unmount cycle, kilobytes (a floor after a forced collection)', unit: 'KB', better: 'lower', digits: 0, floorAtZero: true},
  'growthKbPerSecond': {short: 'Growth / s', label: 'Footprint growth per second of scrolling, megabytes', unit: 'MB', better: 'lower', digits: 1, floorAtZero: true},
  'rewrites.keysWithRewrites': {short: 'Rewritten keys', label: 'Keys of twelve whose text was rewritten a frame later', unit: 'of 12', better: 'lower', digits: 0},
  'settledMs.p95': {short: 'Settle p95', label: 'Milliseconds for a key to settle, 95th percentile', unit: 'ms', better: 'lower', digits: 0},
  'jsMsPerKey': {short: 'JS / key', label: 'JS-thread CPU per key, milliseconds', unit: 'ms', better: 'lower'},
  'mainMsPerKey': {short: 'Main / key', label: 'Main-thread CPU per key, milliseconds', unit: 'ms', better: 'lower'},
  'dropped': {short: 'Dropped', label: 'Frames the main thread missed while typing', unit: 'frames', better: 'lower', digits: 0},
  'ms.p50': {short: 'Focus', label: 'focus() to onFocus, milliseconds, median of eight', unit: 'ms', better: 'lower'},
  'first': {short: 'First focus', label: 'The first focus, which pays for the keyboard, milliseconds', unit: 'ms', better: 'lower'},
  'perViewFootprintKb': {short: 'Footprint', label: 'Footprint per mounted copy, kilobytes, the difference of two settled floors divided by the count', unit: 'KB', better: 'lower', digits: 0},
  'perViewNativeKb': {short: 'malloc', label: 'malloc bytes in use per mounted copy, kilobytes', unit: 'KB', better: 'lower', digits: 0},
  'perViewJavaKb': {short: 'Java heap', label: 'Java heap per mounted copy, kilobytes (Android)', unit: 'KB', better: 'lower', digits: 0},
  'leftFootprintKb': {short: 'Left behind', label: 'Footprint still there after the copies unmounted, kilobytes per copy', unit: 'KB', better: 'lower', digits: 0},
} satisfies Record<string, Spec>;

export type MetricKey = keyof typeof METRICS;

/** iPhones first, then the faster panel, so the order matches the tables. */
const DEVICES: Device[] = [...(data.devices as Device[])].sort((a, b) => {
  if (a.platform !== b.platform) return a.platform === 'ios' ? -1 : 1;
  return (b.hz ?? 0) - (a.hz ?? 0);
});

/**
 * NitroNumber's rows by transition: the roll (the `value` prop, and `jumpTo`,
 * which positions the wheels and has no numeric counterpart) or the numeric
 * transition, which draws more per frame. A chart that has both shows one set
 * at a time, picked with a switch, so each compares like with like.
 */
const TRANSITIONS = {
  roll: {short: 'Roll', impls: ['nitro-prop', 'nitro-jump']},
  numeric: {short: 'Numeric', impls: ['nitro-numeric']},
} as const;
type Transition = keyof typeof TRANSITIONS;

/**
 * A mount that hit the harness's five-second limit is recorded as the limit;
 * the tables print "timed out" for it (`report.mjs`), and so does a chart,
 * rather than a bar that reads as a measurement.
 */
function timedOut(metric: string, v: number) {
  return metric.startsWith('mountMs') && v >= 4990;
}

const REVEAL_MS = 800;
const STAGGER_MS = 40;

function deviceTitle(d: Device) {
  return d.name.replace(/^Samsung /, '');
}

/** The report's scenario title, shortened for a column head. */
function scenarioTitle(g: Group) {
  return g.title.replace('new value every frame', 'every frame').replace('values a second', 'a second').replace(/^Memory over about /, '').replace(/^Memory over /, '');
}

function format(v: number, spec: Spec) {
  const digits = spec.digits ?? (Math.abs(v) >= 100 ? 0 : 1);
  return v.toLocaleString('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits});
}

/** The report's markdown label, bold stripped, backticks as code. */
function Label({text}: {text: string}) {
  const plain = text.replace(/\*\*/g, '');
  const parts = plain.split('`');
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** A figure that rolls from where it was to where it should be, in step with its bar. */
function Figure({to, spec, run, delay, instant}: {to: number; spec: Spec; run: boolean; delay: number; instant: boolean}) {
  const [shown, setShown] = useState(instant ? to : 0);
  const from = useRef(0);
  useEffect(() => {
    if (!run) return;
    if (instant) {
      setShown(to);
      return;
    }
    const start = from.current;
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0 - delay) / REVEAL_MS);
      if (p >= 0) {
        const e = 1 - Math.pow(1 - p, 3);
        setShown(start + (to - start) * e);
      }
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = shown;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, run, instant]);
  return <>{format(run ? shown : 0, spec)}</>;
}

type Tip = {column: Column; row: Row; x: number; y: number};

export default function BenchChart({
  group,
  groups,
  device,
  metrics,
  caption,
}: {
  /** A group key as `report.mjs` builds it: `stream|24|frame`, `mount|24`, `type|8`, `focus`. One column per phone. */
  group?: string;
  /** With `device`: the groups that are the columns, for that phone alone. */
  groups?: string[];
  /** A phone (its model, `iPhone14,3`, or a part of its name); the columns are then its `groups`. */
  device?: string;
  /** The metrics to offer, the first selected. */
  metrics: MetricKey[];
  caption?: string;
}) {
  const [metric, setMetric] = useState<MetricKey>(metrics[0]);
  const [transition, setTransition] = useState<Transition>('roll');
  const spec: Spec = METRICS[metric];
  const reduced = usePrefersReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [settled, setSettled] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setArmed(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArmed(true);
          io.disconnect();
        }
      },
      {threshold: 0.15},
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setSettled(true), REVEAL_MS + STAGGER_MS * 14);
    return () => clearTimeout(t);
  }, [armed]);

  const panels = useMemo<Column[]>(() => {
    if (device) {
      const d = DEVICES.find((x) => x.key === device || x.model === device || x.name.includes(device));
      if (!d) return [];
      return (groups ?? (group ? [group] : [])).flatMap((k) => {
        const g = d.groups.find((x) => x.key === k);
        return g ? [{key: k, title: scenarioTitle(g), device: d, group: g}] : [];
      });
    }
    return DEVICES.flatMap((d) => {
      const g = d.groups.find((x) => x.key === group);
      return g ? [{key: d.key, title: deviceTitle(d), device: d, group: g}] : [];
    });
  }, [group, groups, device]);
  const byScenario = Boolean(device);

  // Every implementation any phone ran, in the tables' order.
  const ran = useMemo(() => {
    const seen = new Map<string, Row>();
    for (const p of panels) for (const r of p.group.rows) if (!seen.has(r.impl)) seen.set(r.impl, r);
    // By the tables' order, not by the first phone that ran it: a row one phone
    // lacks would otherwise land after everything the first phone had.
    return [...seen.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }, [panels]);
  // With both transitions measured, only the chosen one's rows.
  const both = (Object.keys(TRANSITIONS) as Transition[]).every((t) => ran.some((r) => (TRANSITIONS[t].impls as readonly string[]).includes(r.impl)));
  const impls = useMemo(() => {
    if (!both) return ran;
    const hidden = (Object.keys(TRANSITIONS) as Transition[]).filter((t) => t !== transition).flatMap((t) => TRANSITIONS[t].impls as readonly string[]);
    return ran.filter((r) => !hidden.includes(r.impl));
  }, [ran, both, transition]);

  const value = (p: {group: Group}, impl: string) => {
    const r = p.group.rows.find((x) => x.impl === impl);
    const v = r?.[metric];
    return typeof v === 'number' && !timedOut(metric, v) ? v : null;
  };

  // One scale for every column, except frame rates, where the column is its phone's panel.
  const all = panels.flatMap((p) => impls.map((r) => value(p, r.impl))).filter((v): v is number => v != null);
  const sharedMin = spec.floorAtZero ? 0 : Math.min(0, ...all);
  const sharedMax = Math.max(0, ...all);
  const domainFor = (p: Column): [number, number] => {
    if (spec.domain === 'hz') {
      const own = impls.map((r) => value(p, r.impl)).filter((v): v is number => v != null);
      return [0, Math.max(p.device.hz ?? 60, ...own)];
    }
    return [sharedMin, sharedMax];
  };

  const instant = reduced;

  if (!panels.length) return null;

  const showTip = (column: Column, row: Row, e: React.MouseEvent | React.FocusEvent) => {
    const host = root.current;
    if (!host) return;
    const cell = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const box = host.getBoundingClientRect();
    setTip({column, row, x: cell.left - box.left + cell.width / 2, y: cell.top - box.top});
  };
  const hz = panels[0]?.device.hz;

  return (
    <figure ref={root} className={clsx(styles.figure, armed && styles.armed, settled && styles.settled)}>
      <div className={styles.controls}>
        {metrics.length > 1 ? (
          <div className={styles.segments} role="tablist" aria-label="Metric">
            {metrics.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={m === metric}
                className={clsx(styles.segment, m === metric && styles.segmentOn)}
                onClick={() => setMetric(m)}>
                {METRICS[m].short}
              </button>
            ))}
          </div>
        ) : null}
        {both ? (
          <div className={styles.segments} role="tablist" aria-label="NitroNumber transition">
            {(Object.keys(TRANSITIONS) as Transition[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={t === transition}
                className={clsx(styles.segment, t === transition && styles.segmentOn)}
                onClick={() => setTransition(t)}>
                {TRANSITIONS[t].short}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.legend} aria-hidden="true">
          <span className={styles.swatchOurs} /> this library
          <span className={styles.swatchOther} /> other libraries
        </div>
      </div>
      <div className={styles.axisTitle}>
        {spec.label}. {spec.better === 'higher' ? 'Longer is better' : 'Shorter is better'}
        {spec.domain === 'hz' ? (byScenario && hz ? `; the column is the phone’s refresh rate, ${hz} Hz.` : '; the column is the phone’s refresh rate.') : '.'}
      </div>
      <div className={styles.scroll}>
        <div className={styles.grid} style={{gridTemplateColumns: `minmax(150px, 1fr) repeat(${panels.length}, minmax(140px, 1.3fr))`}}>
          <div className={styles.corner} />
          {panels.map((p) => (
            <div key={p.key} className={styles.head}>
              {p.title}
              {spec.domain === 'hz' && !byScenario && p.device.hz ? <span className={styles.hz}> · {p.device.hz} Hz</span> : null}
            </div>
          ))}
          {impls.map((row, i) => (
            <React.Fragment key={row.impl}>
              <div className={clsx(styles.label, row.ours && styles.labelOurs)}>
                <Label text={row.label} />
              </div>
              {panels.map((p) => {
                const r = p.group.rows.find((x) => x.impl === row.impl);
                const v = value(p, row.impl);
                const [lo, hi] = domainFor(p);
                const span = hi - lo || 1;
                const zero = ((0 - lo) / span) * 100;
                const delay = instant ? 0 : i * STAGGER_MS;
                if (v == null) {
                  const raw = r?.[metric];
                  return (
                    <div key={p.key} className={styles.cell}>
                      <span className={styles.missing}>{r?.error ? 'did not finish' : typeof raw === 'number' && timedOut(metric, raw) ? 'timed out' : r ? 'n/a' : 'not run'}</span>
                    </div>
                  );
                }
                const drawn = spec.floorAtZero ? Math.max(0, v) : v;
                const left = drawn >= 0 ? zero : ((drawn - lo) / span) * 100;
                const width = (Math.abs(drawn) / span) * 100;
                const text = `${p.title}, ${row.label.replace(/[*`]/g, '')}: ${format(v, spec)} ${spec.unit}`;
                return (
                  <div
                    key={p.key}
                    className={styles.cell}
                    role="img"
                    aria-label={text}
                    tabIndex={0}
                    onMouseEnter={(e) => showTip(p, r!, e)}
                    onFocus={(e) => showTip(p, r!, e)}
                    onMouseLeave={() => setTip(null)}
                    onBlur={() => setTip(null)}>
                    <div className={styles.track}>
                      {lo < 0 ? <span className={styles.zero} style={{left: `${zero}%`}} /> : null}
                      {spec.domain === 'hz' ? <span className={styles.rate} /> : null}
                      <span
                        className={clsx(styles.bar, row.ours ? styles.barOurs : styles.barOther, drawn < 0 && styles.barNeg)}
                        style={{
                          left: `${armed ? left : zero}%`,
                          width: `${armed ? width : 0}%`,
                          transitionDelay: settled ? '0ms' : `${delay}ms`,
                        }}
                      />
                    </div>
                    <span className={clsx(styles.value, spec.floorAtZero && v < 0 && styles.valueFell)} style={{transitionDelay: settled ? '0ms' : `${delay}ms`}}>
                      <Figure to={v} spec={spec} run={armed} delay={delay} instant={instant} />
                    </span>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      {tip ? (
        <div className={styles.tip} style={{left: tip.x, top: tip.y}} role="presentation">
          <div className={styles.tipTitle}>
            <Label text={tip.row.label} />
            <span className={styles.tipDevice}>{tip.column.title}</span>
          </div>
          <dl className={styles.tipList}>
            {metrics.map((m) => {
              const v = tip.row[m];
              if (typeof v !== 'number') return null;
              return (
                <React.Fragment key={m}>
                  <dt className={m === metric ? styles.tipOn : undefined}>{METRICS[m].short}</dt>
                  <dd className={m === metric ? styles.tipOn : undefined}>
                    {format(v, METRICS[m])} {METRICS[m].unit}
                  </dd>
                </React.Fragment>
              );
            })}
          </dl>
        </div>
      ) : null}
      {caption ? <figcaption className={styles.caption}>{caption}</figcaption> : null}
    </figure>
  );
}
