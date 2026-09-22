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
const ORDER = new Map(IMPLS.map(([k], i) => [k, i]))
const LABEL = new Map(IMPLS)

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

export function groupKey(r) {
  return `${r.count}|${r.rate}`
}
export function groupTitle(count, rate) {
  const rateText = rate === 'frame' ? 'new value every frame' : `${rate} values a second`
  return `${count} ${count === 1 ? 'copy' : 'copies'}, ${rateText}`
}

/** One table per (copies, rate) group; each cell the median over the repeats of that scenario. */
const THROTTLED = new Set(['serious', 'severe', 'critical', 'emergency', 'shutdown'])

export function renderRun(run) {
  const android = run.device?.platform === 'android'
  let flagged = false
  const groups = new Map()
  for (const r of run.results) {
    const key = groupKey(r)
    if (!groups.has(key)) groups.set(key, { count: r.count, rate: r.rate, byImpl: new Map() })
    const g = groups.get(key)
    if (!g.byImpl.has(r.impl)) g.byImpl.set(r.impl, [])
    g.byImpl.get(r.impl).push(r)
  }
  const orderedGroups = [...groups.values()].sort((a, b) => {
    const ra = a.rate === 'frame' ? 0 : 1
    const rb = b.rate === 'frame' ? 0 : 1
    return b.count - a.count || ra - rb
  })
  let out = ''
  for (const g of orderedGroups) {
    const cols = ['Implementation', 'UI fps', 'dropped', 'p95 ms', 'JS fps', 'process CPU', 'main', 'JS thread']
    if (android) cols.push('RenderThread', 'HWUI janky (of frames drawn)')
    cols.push('runs')
    out += `### ${groupTitle(g.count, g.rate)}\n\n`
    out += `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n`
    const rows = [...g.byImpl.entries()].sort((a, b) => (ORDER.get(a[0]) ?? 99) - (ORDER.get(b[0]) ?? 99))
    for (const [impl, rs] of rows) {
      const ok = rs.filter((r) => !r.error)
      const label = LABEL.get(impl) ?? impl
      if (!ok.length) {
        out += `| ${label} | failed: ${rs[0].error} |${' |'.repeat(cols.length - 2)}\n`
        continue
      }
      const cells = [
        label,
        f1(median(ok.map((r) => r.ui?.fps))),
        f0(median(ok.map((r) => r.ui?.dropped))),
        f0(median(ok.map((r) => r.ui?.p95))),
        f1(median(ok.map((r) => r.js.fps))),
        pct(median(ok.map((r) => r.cpu?.process))),
        pct(median(ok.map((r) => r.cpu?.main))),
        pct(median(ok.map((r) => r.cpu?.js))),
      ]
      if (android) {
        cells.push(pct(median(ok.map((r) => r.cpu?.render))))
        // HWUI only counts frames it drew; with a static screen that is a handful, so say how many.
        const hw = ok.filter((r) => r.hwui)
        cells.push(hw.length ? `${pct(median(hw.map((r) => r.hwui.jankyPct)))} of ${f0(median(hw.map((r) => r.hwui.frames)))}` : '–')
      }
      const throttled = ok.filter((r) => THROTTLED.has(r.thermal?.before)).length
      if (throttled) flagged = true
      cells.push(`${ok.length}${throttled ? ' ‡' : ''}`)
      out += `| ${cells.join(' | ')} |\n`
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

export function renderAll(files) {
  return files
    .map(loadRun)
    .map((run) => `## ${deviceTitle(run)}\n\n${renderRun(run)}`)
    .join('\n')
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
