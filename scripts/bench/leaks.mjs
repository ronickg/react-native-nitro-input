#!/usr/bin/env node
// The leak cross-check for iOS: one implementation's mount/unmount cycles
// recorded under Instruments' "Leaks" template, which finds allocations
// nothing references any more. The in-app memory plan sees resident memory
// grow; this says whether the growth is garbage the runtime will reclaim or
// objects that are gone for good.
//
//   node scripts/bench/leaks.mjs --ios <CoreDevice id> [--impls nitro-prop,nitro-jump,nitro-text,morph-text] [--count 24] [--cycles 30]
//
// Every recording happens first and the app's result file is pulled once at
// the end: a devicectl call between two recordings leaves the device
// unreachable for xctrace ("Timed out waiting for device to boot").
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IMPLS, INPUT_IMPLS, RESULTS_DIR } from './report.mjs'

const IOS_BUNDLE = 'org.reactjs.native.example.RollingNumberExample'

const o = { ios: '', impls: ['nitro-prop', 'nitro-jump', 'nitro-text', 'morph-text'], count: 24, cycles: 30 }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const next = () => argv[++i]
  if (a === '--ios') o.ios = next()
  else if (a === '--impls') o.impls = next().split(',')
  else if (a === '--count') o.count = Number(next())
  else if (a === '--cycles') o.cycles = Number(next())
  else throw new Error(`unknown argument ${a}`)
}
if (!o.ios) throw new Error('give --ios <CoreDevice id>')
const known = [...IMPLS, ...INPUT_IMPLS].map(([k]) => k)
for (const impl of o.impls) if (!known.includes(impl)) throw new Error(`unknown implementation ${impl}`)

const traces = path.join(RESULTS_DIR, 'leaks')
fs.mkdirSync(traces, { recursive: true })
const resultsFile = path.join(traces, 'bench-results.ndjson')

function hardwareUdid(device) {
  const out = path.join(traces, 'device.json')
  execFileSync('xcrun', ['devicectl', 'device', 'info', 'details', '--device', device, '--json-output', out], { stdio: 'ignore' })
  const info = JSON.parse(fs.readFileSync(out, 'utf8'))
  return info?.result?.hardwareProperties?.udid ?? device
}
const xctraceDevice = hardwareUdid(o.ios)

const planLabel = (impl) => `leaks-${impl}`
const tracePath = (impl) => path.join(traces, `${impl}-x${o.count}-${o.cycles}.trace`)
const isInput = (impl) => INPUT_IMPLS.some(([k]) => k === impl)

/** One recording: the app launched with a one-scenario memory plan, for about as long as the cycles take. */
function record(impl, extraSeconds = 0) {
  const count = isInput(impl) ? Math.min(o.count, 20) : o.count
  const plan = { label: planLabel(impl), seconds: 5, warmup: 1, settle: 1, scenarios: [{ kind: 'leak', impl, count, cycles: o.cycles }] }
  const encoded = Buffer.from(JSON.stringify(plan)).toString('base64')
  const trace = tracePath(impl)
  // The Leaks instrument scans every ten seconds; give it a scan after the
  // cycles end, and allow for the launch, which takes a while.
  const limit = Math.ceil(4 + o.cycles * 1.2) + 20 + extraSeconds
  console.log(`recording ${impl} for ${limit} s`)
  for (let attempt = 1; ; attempt++) {
    fs.rmSync(trace, { recursive: true, force: true })
    // The Leaks and Allocations instruments need the process launched by
    // Instruments (malloc logging is set up at launch); attaching records
    // nothing but process and thread tables. On a phone devicectl has talked
    // to, `xctrace --launch` sometimes waits for the device "to boot" for
    // good, so the launch is bounded and retried.
    const args = ['xctrace', 'record', '--device', xctraceDevice, '--template', 'Leaks', '--time-limit', `${limit}s`, '--output', trace, '--env', `BENCH_PLAN=${encoded}`, '--no-prompt', '--launch', '--', IOS_BUNDLE]
    const r = spawnSync('xcrun', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: (limit + 150) * 1000 })
    if (r.status === 0) return trace
    if (attempt < 3 && (r.signal || /Timed out waiting for device|Unable to connect|not ready|Unable to attach/i.test(r.stderr ?? ''))) {
      console.log(`${impl}: ${r.signal ? 'xctrace hung' : r.stderr.trim().split('\n').pop()}; retrying in 15 s`)
      spawnSync('sleep', ['15'])
      continue
    }
    throw new Error(`xctrace failed for ${impl}: ${r.stderr}`)
  }
}

function pullEvents() {
  execFileSync('xcrun', ['devicectl', 'device', 'copy', 'from', '--device', o.ios, '--domain-type', 'appDataContainer', '--domain-identifier', IOS_BUNDLE, '--source', 'Documents/bench-results.ndjson', '--destination', resultsFile], { stdio: 'ignore' })
  return fs.readFileSync(resultsFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

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

function schemas(trace) {
  const toc = execFileSync('xcrun', ['xctrace', 'export', '--input', trace, '--toc'], { encoding: 'utf8' })
  return [...new Set([...toc.matchAll(/schema="([^"]+)"/g)].map((m) => m[1]))]
}

function exportTable(trace, schema) {
  const xml = execFileSync('xcrun', ['xctrace', 'export', '--input', trace, '--xpath', `/trace-toc/run[@number="1"]/data/table[@schema="${schema}"]`], { encoding: 'utf8', maxBuffer: 256 << 20 })
  return parseRows(xml)
}

/** The leaks table: one row per leaked allocation, with its size and the responsible library. */
function analyze(impl, events) {
  const trace = tracePath(impl)
  const result = events.find((e) => e.event === 'result')
  const names = schemas(trace)
  const schema = names.find((n) => n === 'leaks') ?? names.find((n) => /leak/i.test(n))
  if (!schema) throw new Error(`${impl}: no leaks table in the trace (found ${names.join(', ')})`)
  const table = exportTable(trace, schema)
  const bytesOf = (r) => Number(r.size?.text ?? r['leaked-size']?.text ?? r.bytes?.text ?? 0)
  const libraryOf = (r) => r['responsible-library']?.text ?? r.library?.text ?? r['responsible-frame']?.fmt ?? '?'
  const bytes = table.reduce((a, r) => a + bytesOf(r), 0)
  const byLibrary = new Map()
  for (const r of table) byLibrary.set(libraryOf(r), (byLibrary.get(libraryOf(r)) ?? 0) + 1)
  const top = [...byLibrary.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  console.log(`${impl}: ${table.length} leaked allocations, ${(bytes / 1024).toFixed(1)} KB (${schema}); by library: ${top.map(([l, n]) => `${l} ${n}`).join(', ') || '–'}; in-app RSS ${result ? `${result.rssFirstMb?.toFixed(1)} → ${result.rssLastMb?.toFixed(1)} MB, ${result.growthKbPerCycle?.toFixed(1)} KB/cycle` : 'no result'}`)
  return { impl, result, leaks: { count: table.length, bytes, byLibrary: Object.fromEntries(byLibrary) } }
}

for (const impl of o.impls) record(impl)
let all = pullEvents()
const missing = o.impls.filter((impl) => !eventsOf(all, impl).some((e) => e.event === 'result'))
if (missing.length) {
  console.log(`no result for ${missing.join(', ')}; recording again with more time`)
  for (const impl of missing) record(impl, 60)
  all = pullEvents()
}
const rows = o.impls.map((impl) => analyze(impl, eventsOf(all, impl)))

const label = (k) => [...IMPLS, ...INPUT_IMPLS].find(([key]) => key === k)?.[1] ?? k
console.log(`\n### Instruments Leaks, ${o.cycles} mount/unmount cycles\n`)
console.log('| Implementation | leaked allocations | leaked bytes | in-app RSS floor, early → late | in-app growth per cycle |')
console.log('| --- | --- | --- | --- | --- |')
for (const r of rows) {
  const res = r.result
  console.log(`| ${label(r.impl)} | ${r.leaks.count} | ${(r.leaks.bytes / 1024).toFixed(1)} KB | ${res ? `${res.rssFirstMb?.toFixed(1)} → ${res.rssLastMb?.toFixed(1)} MB` : '–'} | ${res?.growthKbPerCycle != null ? res.growthKbPerCycle.toFixed(1) + ' KB' : '–'} |`)
}
fs.writeFileSync(path.join(traces, `summary-x${o.count}-${o.cycles}.json`), JSON.stringify(rows, null, 2))
