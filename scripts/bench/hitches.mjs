#!/usr/bin/env node
// The render-server cross-check for iOS. The in-app frame meter only sees
// stalls inside the process; Core Animation can still drop frames while
// compositing. This records one scenario at a time under Instruments'
// "Animation Hitches" template (the app launched with a one-scenario plan) and
// reports the hitch time ratio: milliseconds a frame arrived late, per second.
//
//   node scripts/bench/hitches.mjs --ios <CoreDevice id> [--impls a,b,c] [--count 24] [--rate frame|10] [--seconds 5]
//
// Every recording happens first and the app's result file is pulled once at
// the end: a devicectl call between two recordings leaves the device
// unreachable for xctrace ("Timed out waiting for device to boot").
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IMPLS, RESULTS_DIR } from './report.mjs'

const IOS_BUNDLE = 'org.reactjs.native.example.RollingNumberExample'

const o = { ios: '', impls: ['nitro-prop', 'nitro-jump', 'rnna', 'arn', 'nf-view', 'anim-numbers'], count: 24, rate: 'frame', seconds: 5, warmup: 1.5, settle: 1 }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const next = () => argv[++i]
  if (a === '--ios') o.ios = next()
  else if (a === '--impls') o.impls = next().split(',')
  else if (a === '--count') o.count = Number(next())
  else if (a === '--rate') o.rate = next() === 'frame' ? 'frame' : Number(next())
  else if (a === '--seconds') o.seconds = Number(next())
  else throw new Error(`unknown argument ${a}`)
}
if (!o.ios) throw new Error('give --ios <CoreDevice id>')
for (const impl of o.impls) if (!IMPLS.some(([k]) => k === impl)) throw new Error(`unknown implementation ${impl}`)

const traces = path.join(RESULTS_DIR, 'hitches')
fs.mkdirSync(traces, { recursive: true })
const resultsFile = path.join(traces, 'bench-results.ndjson')

/** xctrace addresses a phone by its hardware UDID, devicectl by a CoreDevice identifier; accept either. */
function hardwareUdid(device) {
  const out = path.join(traces, 'device.json')
  execFileSync('xcrun', ['devicectl', 'device', 'info', 'details', '--device', device, '--json-output', out], { stdio: 'ignore' })
  const info = JSON.parse(fs.readFileSync(out, 'utf8'))
  return info?.result?.hardwareProperties?.udid ?? device
}
const xctraceDevice = hardwareUdid(o.ios)

const planLabel = (impl) => `hitches-${impl}`
const tracePath = (impl) => path.join(traces, `${impl}-x${o.count}-${o.rate}.trace`)

/** One recording: the app launched with a one-scenario plan, for just as long as that scenario takes. */
function record(impl, extraSeconds = 0) {
  const plan = { label: planLabel(impl), seconds: o.seconds, warmup: o.warmup, settle: o.settle, scenarios: [{ impl, rate: o.rate, count: o.count }] }
  const encoded = Buffer.from(JSON.stringify(plan)).toString('base64')
  const trace = tracePath(impl)
  // xctrace records for the whole time limit, so keep it to one scenario:
  // launch, settle, warm up, measure, plus a margin for the app to start.
  const limit = Math.ceil(o.settle + o.warmup + o.seconds + 8) + extraSeconds
  const args = ['xctrace', 'record', '--device', xctraceDevice, '--template', 'Animation Hitches', '--time-limit', `${limit}s`, '--output', trace, '--env', `BENCH_PLAN=${encoded}`, '--no-prompt', '--launch', '--', IOS_BUNDLE]
  console.log(`recording ${impl} for ${limit} s`)
  for (let attempt = 1; ; attempt++) {
    fs.rmSync(trace, { recursive: true, force: true })
    const r = spawnSync('xcrun', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
    if (r.status === 0) return trace
    if (attempt < 3 && /Timed out waiting for device|Unable to connect|not ready/i.test(r.stderr)) {
      console.log(`${impl}: ${r.stderr.trim().split('\n').pop()}; retrying in 15 s`)
      spawnSync('sleep', ['15'])
      continue
    }
    throw new Error(`xctrace failed for ${impl}: ${r.stderr}`)
  }
}

/** The app appends every event to a file in its container; xctrace carries no stdout back from a phone. */
function pullEvents() {
  execFileSync('xcrun', ['devicectl', 'device', 'copy', 'from', '--device', o.ios, '--domain-type', 'appDataContainer', '--domain-identifier', IOS_BUNDLE, '--source', 'Documents/bench-results.ndjson', '--destination', resultsFile], { stdio: 'ignore' })
  return fs.readFileSync(resultsFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

/** The events of the last run of this plan: after its "plan" line, before the next one. */
function eventsOf(all, impl) {
  let start = -1
  all.forEach((e, i) => {
    if (e.event === 'plan' && e.label === planLabel(impl)) start = i
  })
  if (start < 0) return []
  const rest = all.slice(start + 1)
  const next = rest.findIndex((e) => e.event === 'plan')
  return next < 0 ? rest : rest.slice(0, next)
}

/** xctrace's XML repeats values by reference: an element with id="n" is later cited as ref="n". */
function parseRows(xml) {
  const byId = new Map()
  const rows = []
  for (const rowMatch of xml.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
    const row = {}
    for (const m of rowMatch[1].matchAll(/<([\w-]+)((?:\s+[\w-]+="[^"]*")*)\s*(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
      const [, tag, attrs, inner = ''] = m
      const id = attrs.match(/\bid="(\d+)"/)?.[1]
      const ref = attrs.match(/\bref="(\d+)"/)?.[1]
      const fmt = attrs.match(/\bfmt="([^"]*)"/)?.[1]
      const value = ref ? byId.get(ref) : { text: inner.replace(/<[^>]+>/g, '').trim(), fmt }
      if (id) byId.set(id, value)
      row[tag] = value
    }
    rows.push(row)
  }
  return rows
}

function exportTable(trace, schema) {
  const xml = execFileSync('xcrun', ['xctrace', 'export', '--input', trace, '--xpath', `/trace-toc/run[@number="1"]/data/table[@schema="${schema}"]`], { encoding: 'utf8', maxBuffer: 256 << 20 })
  return parseRows(xml)
}

/** When the recording started, as epoch ms, so the app's own timestamps map onto the trace's clock. */
function traceStart(trace) {
  const toc = execFileSync('xcrun', ['xctrace', 'export', '--input', trace, '--toc'], { encoding: 'utf8' })
  const m = toc.match(/<start-date>([^<]+)<\/start-date>/)
  return m ? Date.parse(m[1]) : NaN
}

/** Each row of the "hitches" table is one hitch: when the frame was due (ns from the start of the recording) and how late it was (ns). */
function analyze(impl, events) {
  const trace = tracePath(impl)
  const result = events.find((e) => e.event === 'result')
  const measure = events.find((e) => e.event === 'measure')
  const started = traceStart(trace)
  const windowStart = measure && started ? (measure.at - started) * 1e6 : 0
  const windowEnd = result && started ? (result.at - started) * 1e6 : Infinity
  const table = exportTable(trace, 'hitches')
  const inWindow = table.filter((r) => {
    const t = Number(r['start-time']?.text ?? 0)
    return t >= windowStart && t <= windowEnd
  })
  const durations = inWindow.map((r) => Number(r.duration?.text ?? 0) / 1e6).filter((d) => d > 0)
  const hitches = { count: durations.length, totalMs: durations.reduce((a, b) => a + b, 0), maxMs: durations.length ? Math.max(...durations) : 0, all: table.length }
  const seconds = result?.seconds ?? o.seconds
  console.log(`${impl}: ${hitches.count} hitches (${hitches.all} in the whole recording), ${hitches.totalMs.toFixed(0)} ms in ${seconds.toFixed(1)} s; in-app ${result?.ui ? result.ui.fps.toFixed(1) + ' fps, ' + result.ui.dropped + ' dropped' : 'no result'}; thermal ${result?.thermal?.before ?? '–'}`)
  return { impl, result, hitches, seconds }
}

// Record everything first, pull once, then look at what the app had to say.
for (const impl of o.impls) record(impl)
let all = pullEvents()
const missing = o.impls.filter((impl) => !eventsOf(all, impl).some((e) => e.event === 'result'))
if (missing.length) {
  // The phone was probably cooling down; give those two more minutes.
  console.log(`no result for ${missing.join(', ')}; recording again with more time`)
  for (const impl of missing) record(impl, 120)
  all = pullEvents()
}
const rows = o.impls.map((impl) => analyze(impl, eventsOf(all, impl)))

const label = (k) => IMPLS.find(([key]) => key === k)?.[1] ?? k
console.log(`\n### Instruments Animation Hitches, ${o.count} copies, ${o.rate === 'frame' ? 'every frame' : o.rate + '/s'} (the measured ${o.seconds} s of the same run the in-app columns come from)\n`)
console.log('| Implementation | hitches | hitch time | hitch ratio (ms/s) | worst hitch | in-app UI fps | in-app dropped | thermal |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of rows) {
  const h = r.hitches
  const ratio = h.totalMs / r.seconds
  console.log(`| ${label(r.impl)} | ${h.count} | ${h.totalMs.toFixed(0)} ms | ${ratio.toFixed(1)} | ${h.maxMs.toFixed(0)} ms | ${r.result?.ui ? r.result.ui.fps.toFixed(1) : '–'} | ${r.result?.ui ? r.result.ui.dropped : '–'} | ${r.result?.thermal?.before ?? '–'} |`)
}
fs.writeFileSync(path.join(traces, `summary-x${o.count}-${o.rate}.json`), JSON.stringify(rows, null, 2))
