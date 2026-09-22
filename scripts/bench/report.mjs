#!/usr/bin/env node
// Renders the benchmark result files (scripts/bench/results/*.ndjson) as the
// Markdown tables in BENCHMARKS.md. Usage: node scripts/bench/report.mjs [files...]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const RESULTS_DIR = path.join(here, 'results')

// Mirrors example/src/bench/impls.tsx, in table order.
export const IMPLS = [
  ['text', 'Text (no animation)'],
  ['atext', 'AnimateableText (shared value)'],
  ['nitro-prop', '**Nitro `value` prop**'],
  ['nitro-jump', '**Nitro `jumpTo`**'],
  ['rnna', 'number-animation (native)'],
  ['arn', 'animated-rolling-numbers'],
  ['nf-view', 'NumberFlow View'],
  ['nf-skia', 'NumberFlow Skia'],
  ['nf-skia-sv', 'NumberFlow Skia sharedValue'],
  ['bloom', 'NumberBloom (Skia)'],
  ['ticker', 'react-native-ticker'],
  ['anim-numbers', 'AnimatedNumbers'],
]
// Mirrors example/src/bench/inputs.tsx, in table order.
export const INPUT_IMPLS = [
  ['rn-text', 'TextInput (text)'],
  ['nitro-text', '**NitroInput (text)**'],
  ['morph-text', '**MorphInput (text)**'],
  ['rn-number-js', 'TextInput + JS formatting'],
  ['currency-input', 'react-native-currency-input'],
  ['mask-input', 'react-native-mask-input (number mask)'],
  ['nitro-number', '**NitroInput (number)**'],
  ['morph-number', '**MorphInput (number)**'],
  ['advanced-mask', 'react-native-advanced-input-mask'],
  ['nitro-mask', '**NitroInput (mask)**'],
  ['expo', 'Expo UI TextField'],
]
const ORDER = new Map([...IMPLS, ...INPUT_IMPLS].map(([k], i) => [k, i]))
const LABEL = new Map([...IMPLS, ...INPUT_IMPLS])

export function loadRun(file) {
  const events = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
  const plan = events.find((e) => e.event === 'plan')
  return {
    file,
    device: plan?.device ?? null,
    label: plan?.label ?? path.basename(file),
    results: events.filter((e) => e.event === 'result'),
  }
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return null
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const f1 = (x) => (x == null ? '–' : x.toFixed(1))
const f0 = (x) => (x == null ? '–' : Math.round(x).toString())
const pct = (x) => (x == null ? '–' : `${Math.round(x)} %`)

const kindOf = (r) => r.kind ?? 'stream'
const rateText = (rate) => (rate === 'frame' ? 'new value every frame' : `${rate} values a second`)
const thermalBefore = (r) => (typeof r.thermal === 'string' ? r.thermal : r.thermal?.before)
const THROTTLED = new Set(['serious', 'severe', 'critical', 'emergency', 'shutdown'])
/** Tables in this order: the stream matrix (heavier first), then the list, mount, typing and focus. */
const KIND_ORDER = { stream: 0, list: 1, mount: 2, leak: 3, leaklist: 4, type: 5, focus: 6 }

export function groupKey(r) {
  switch (kindOf(r)) {
    case 'stream':
      return `stream|${r.count}|${r.rate}`
    case 'list':
      return `list|${r.rows}|${r.rate}`
    case 'mount':
      return `mount|${r.count}`
    case 'type':
      return `type|${r.rate}`
    case 'focus':
      return 'focus'
    case 'leak':
      return `leak|${r.count}|${r.cycles}`
    case 'leaklist':
      // A starved JS thread overshoots the planned seconds; the rows, not the overshoot, define the group.
      return `leaklist|${r.rows}`
    default:
      return kindOf(r)
  }
}

export function groupTitle(r) {
  switch (kindOf(r)) {
    case 'stream':
      return `${r.count} ${r.count === 1 ? 'copy' : 'copies'}, ${rateText(r.rate)}`
    case 'list':
      return `A list of ${r.rows} rows scrolling, ${rateText(r.rate)}`
    case 'mount':
      return `Mount and unmount ${r.count} copies`
    case 'type':
      return `Typing at ${r.rate} keys a second`
    case 'focus':
      return 'Focus latency'
    case 'leak':
      return `Memory over ${r.cycles} mount/unmount cycles of ${r.count} copies`
    case 'leaklist':
      return `Memory over about ${Math.round(r.seconds / 10) * 10} s of a list of ${r.rows} rows scrolling`
    default:
      return kindOf(r)
  }
}

/** The columns of a group of one kind. */
function columns(kind, android) {
  switch (kind) {
    case 'stream':
    case 'list': {
      const cols = ['Implementation', 'UI fps', 'dropped', 'p95 ms', 'JS fps', 'process CPU', 'main', 'JS thread']
      if (android) cols.push('RenderThread', 'HWUI janky (of frames drawn)')
      return cols
    }
    case 'mount':
      return ['Implementation', 'mount ms', 'min', 'max', 'unmount ms', 'main-thread ms', 'JS-thread ms']
    case 'type':
      return ['Implementation', 'keys/s', 'rewrites per key', 'keys rewritten', 'settled p95 ms', 'main ms/key', 'JS ms/key', 'change events/key', 'dropped']
    case 'focus':
      return ['Implementation', 'focus → onFocus ms', 'p95', 'first (keyboard)']
    case 'leak':
    case 'leaklist': {
      const cols = ['Implementation', 'footprint, start', 'footprint, end', 'peak', kind === 'leak' ? 'growth per cycle' : 'growth per second', 'malloc heap, start → end']
      if (android) cols.push('live Views, start → end')
      return cols
    }
    default:
      return ['Implementation']
  }
}

/** One row's cells: each the median over the repeats of that scenario. */
function cells(kind, ok, android) {
  const m = (f) => median(ok.map(f))
  switch (kind) {
    case 'stream':
    case 'list': {
      const out = [
        f1(m((r) => r.ui?.fps)),
        f0(m((r) => r.ui?.dropped)),
        f0(m((r) => r.ui?.p95)),
        f1(m((r) => r.js.fps)),
        pct(m((r) => r.cpu?.process)),
        pct(m((r) => r.cpu?.main)),
        pct(m((r) => r.cpu?.js)),
      ]
      if (android) {
        out.push(pct(m((r) => r.cpu?.render)))
        // HWUI only counts frames it drew; with a static screen that is a handful, so say how many.
        const hw = ok.filter((r) => r.hwui)
        out.push(hw.length ? `${pct(median(hw.map((r) => r.hwui.jankyPct)))} of ${f0(median(hw.map((r) => r.hwui.frames)))}` : '–')
      }
      return out
    }
    case 'mount': {
      // A pass whose last layout never came within five seconds is reported as such, not as 5000 ms.
      const ms = (x) => (x == null ? '–' : x >= 4990 ? 'timed out' : x.toFixed(1))
      // Resident memory before and after is in the result files but not here: for 24 views it is a few MB, under the garbage collector's swings.
      return [ms(m((r) => r.mountMs.p50)), ms(m((r) => r.mountMs.min)), ms(m((r) => r.mountMs.max)), f1(m((r) => r.unmountMs.p50)), f1(m((r) => r.mountMainMs)), f1(m((r) => r.mountJsMs))]
    }
    case 'type': {
      const p50 = m((r) => r.rewrites.p50)
      const max = m((r) => r.rewrites.max)
      return [
        f1(m((r) => r.achievedRate)),
        `${f0(p50)}${max > p50 ? ` (max ${f0(max)})` : ''}`,
        `${f0(m((r) => r.rewrites.keysWithRewrites))} of ${f0(m((r) => r.typed))}`,
        f0(m((r) => r.settledMs.p95)),
        f1(m((r) => r.mainMsPerKey)),
        f1(m((r) => r.jsMsPerKey)),
        f1(m((r) => r.changeEventsPerKey)),
        f0(m((r) => r.dropped)),
      ]
    }
    case 'focus':
      return [f1(m((r) => r.ms.p50)), f1(m((r) => r.ms.p95)), f1(m((r) => r.first))]
    case 'leak':
    case 'leaklist': {
      const mb = (x) => (x == null ? '–' : `${x.toFixed(1)} MB`)
      const kb = (x) => (x == null ? '–' : `${x >= 0 ? '+' : ''}${x.toFixed(1)} KB`)
      const out = [mb(m((r) => r.rssFirstMb)), mb(m((r) => r.rssLastMb)), mb(m((r) => r.rssMaxMb)), kb(m(kind === 'leak' ? (r) => r.growthKbPerCycle : (r) => r.growthKbPerSecond))]
      const heap = ok.filter((r) => r.nativeHeapFirstMb != null && r.nativeHeapLastMb != null)
      out.push(heap.length ? `${median(heap.map((r) => r.nativeHeapFirstMb)).toFixed(1)} → ${median(heap.map((r) => r.nativeHeapLastMb)).toFixed(1)} MB` : '–')
      if (android) {
        const mi = ok.filter((r) => r.meminfo)
        out.push(mi.length ? `${f0(median(mi.map((r) => r.meminfo.viewsStart)))} → ${f0(median(mi.map((r) => r.meminfo.viewsEnd)))}` : '–')
      }
      return out
    }
    default:
      return []
  }
}

/** One table per group (kind, copies, rate…); each cell the median over the repeats of that scenario. */
export function renderRun(run) {
  const android = run.device?.platform === 'android'
  let flagged = false
  const groups = new Map()
  for (const r of run.results) {
    const key = groupKey(r)
    if (!groups.has(key)) groups.set(key, { kind: kindOf(r), sample: r, byImpl: new Map() })
    const g = groups.get(key)
    if (!g.byImpl.has(r.impl)) g.byImpl.set(r.impl, [])
    g.byImpl.get(r.impl).push(r)
  }
  const orderedGroups = [...groups.values()].sort((a, b) => {
    const ka = KIND_ORDER[a.kind] ?? 9
    const kb = KIND_ORDER[b.kind] ?? 9
    if (ka !== kb) return ka - kb
    if (a.kind === 'stream') {
      const ra = a.sample.rate === 'frame' ? 0 : 1
      const rb = b.sample.rate === 'frame' ? 0 : 1
      return b.sample.count - a.sample.count || ra - rb
    }
    if (a.kind === 'type') return a.sample.rate - b.sample.rate
    return 0
  })
  let out = ''
  for (const g of orderedGroups) {
    const cols = [...columns(g.kind, android), 'runs']
    out += `### ${groupTitle(g.sample)}\n\n`
    out += `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n`
    const rows = [...g.byImpl.entries()].sort((a, b) => (ORDER.get(a[0]) ?? 99) - (ORDER.get(b[0]) ?? 99))
    for (const [impl, rs] of rows) {
      const ok = rs.filter((r) => !r.error)
      const label = LABEL.get(impl) ?? impl
      if (!ok.length) {
        out += `| ${label} | failed: ${rs[0].error} |${' |'.repeat(cols.length - 2)}\n`
        continue
      }
      const throttled = ok.filter((r) => THROTTLED.has(thermalBefore(r))).length
      if (throttled) flagged = true
      out += `| ${[label, ...cells(g.kind, ok, android), `${ok.length}${throttled ? ' ‡' : ''}`].join(' | ')} |\n`
    }
    out += '\n'
  }
  if (flagged) out += '‡ at least one of these runs started with the phone already throttled (thermal state serious or worse).\n\n'
  return out
}

/** iOS reports the model identifier and, since iOS 16, "iPhone" as the name; Android reports the model number. */
const MARKETING = {
  'iPhone12,3': 'iPhone 11 Pro',
  'iPhone14,3': 'iPhone 13 Pro Max',
  'iPhone17,2': 'iPhone 16 Pro Max',
  'SM-A225F': 'Samsung Galaxy A22',
}

export function deviceName(d) {
  if (!d) return 'unknown device'
  return MARKETING[d.model] ?? (d.platform === 'ios' ? d.model : d.name)
}

export function deviceTitle(run) {
  const d = run.device
  if (!d) return run.label
  const hz = run.results.find((r) => r.ui?.hz)?.ui.hz ?? d.refreshRate
  return `${deviceName(d)} (${d.model}, ${d.platform === 'ios' ? 'iOS' : 'Android'} ${d.os}, ${hz} Hz)`
}

/** Every file of one device merged into one run, so a matrix and an input plan measured separately share a section. */
export function renderAll(files) {
  const byDevice = new Map()
  for (const run of files.map(loadRun)) {
    const key = run.device ? `${run.device.platform}|${run.device.model}` : run.file
    if (!byDevice.has(key)) byDevice.set(key, { ...run, results: [] })
    byDevice.get(key).results.push(...run.results)
  }
  return [...byDevice.values()].map((run) => `## ${deviceTitle(run)}\n\n${renderRun(run)}`).join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs
        .readdirSync(RESULTS_DIR)
        .filter((f) => f.endsWith('.ndjson'))
        .sort()
        .map((f) => path.join(RESULTS_DIR, f))
  process.stdout.write(renderAll(files))
}
