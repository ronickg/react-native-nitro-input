#!/usr/bin/env node
// Regenerates everything derived from the result files in scripts/bench/results/:
//
//   - docs/src/data/benchmarks.json, which the docs' charts read (report.mjs --json)
//   - docs/static/img/bench/glance-{light,dark}.svg, the README's chart (chart.mjs)
//   - every table in BENCHMARKS.md that report.mjs prints, swapped in place under
//     its section and phone, plus the "At a glance" summary
//   - the two performance tables in README.md
//
// The prose around the tables quotes numbers and is written by hand: read it
// again after a new run. A table whose group is missing from the results is
// left as it was, with a warning.
//
//   node scripts/bench/assemble.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RESULTS_DIR, renderAll, summarizeAll } from './report.mjs'
import { renderChart } from './chart.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const files = fs
  .readdirSync(RESULTS_DIR)
  .filter((f) => f.endsWith('.ndjson'))
  .sort()
  .map((f) => path.join(RESULTS_DIR, f))
const summary = summarizeAll(files)

// The phones in the documents' order: iPhones first, the faster panel first.
const DEVICES = [...summary.devices].sort((a, b) => (a.platform !== b.platform ? (a.platform === 'ios' ? -1 : 1) : (b.hz ?? 0) - (a.hz ?? 0)))
const shortName = (d) => d.name.replace(/^Samsung /, '')

function write(file, text) {
  fs.writeFileSync(path.join(root, file), text)
  console.log(`wrote ${file}`)
}

// 1. The docs' data and the README's chart.
write('docs/src/data/benchmarks.json', JSON.stringify(summary, null, 1) + '\n')
for (const theme of ['light', 'dark']) {
  write(`docs/static/img/bench/glance-${theme}.svg`, renderChart(summary, { group: 'stream|24|frame', metric: 'ui.fps', theme, hzDomain: true }))
}

// 2. The report's tables, by phone and by group title.
const tables = new Map() // `${device name}|${group title}` -> table lines
const deviceTitles = new Map() // device name -> the report's heading
for (const section of renderAll(files).split(/^## /m).filter(Boolean)) {
  const title = section.slice(0, section.indexOf('\n')).trim()
  const device = DEVICES.find((d) => title.startsWith(d.name))
  if (!device) continue
  deviceTitles.set(device.name, title)
  for (const part of section.split(/^### /m).slice(1)) {
    const group = part.slice(0, part.indexOf('\n')).trim()
    const lines = part.split('\n')
    const start = lines.findIndex((l) => l.startsWith('|'))
    if (start < 0) continue
    let end = start
    while (end < lines.length && lines[end].startsWith('|')) end++
    tables.set(`${device.name}|${group}`, lines.slice(start, end))
  }
}

const row = (d, group, impl) => d.groups.find((g) => g.key === group)?.rows.find((r) => r.impl === impl)
const fps = (v) => (v >= 100 ? Math.round(v).toString() : v.toFixed(1))

// The "At a glance" summary: every implementation, 24 copies at a new value every frame.
function glanceTable() {
  const group = 'stream|24|frame'
  const impls = []
  for (const d of DEVICES) for (const r of d.groups.find((g) => g.key === group)?.rows ?? []) if (!impls.some((x) => x.impl === r.impl)) impls.push(r)
  impls.sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  const out = [`| Implementation | ${DEVICES.map((d) => `${shortName(d)}, ${d.hz} Hz`).join(' | ')} |`, `| --- |${DEVICES.map(() => ' --- |').join('')}`]
  for (const r of impls) {
    const cells = DEVICES.map((d) => {
      const x = row(d, group, r.impl)
      if (!x || x['ui.fps'] == null) return 'not run'
      return `${fps(x['ui.fps'])} fps, ${Math.round(x['ui.dropped'])} dropped, JS ${Math.round(x['js.fps'])}`
    })
    out.push(`| ${r.label} | ${cells.join(' | ')} |`)
  }
  return out
}

// The README's NitroNumber table: the other libraries by their npm names.
const README_NUMBER = [
  ['nitro-prop', '**NitroNumber** (`value` prop)'],
  ['nitro-jump', '**NitroNumber** (`jumpTo`)'],
  ['nitro-numeric', '**NitroNumber** (numeric transition)'],
  ['rnna', 'react-native-number-animation (native)'],
  ['arn', 'react-native-animated-rolling-numbers'],
  ['nf-view', 'NumberFlow (View)'],
  ['nf-skia', 'NumberFlow (Skia)'],
  ['bloom', 'react-native-number-bloom'],
  ['anim-numbers', 'react-native-animated-numbers'],
  ['ticker', 'react-native-ticker'],
]
const README_INPUT = [
  ['nitro-number', '**NitroInput** (`mode="number"`)'],
  ['morph-number', '**NitroInput reflow** (`mode="number"`)'],
  ['rn-number-js', 'TextInput + formatting in `onChangeText`'],
  ['currency-input', 'react-native-currency-input'],
  ['mask-input', 'react-native-mask-input'],
  ['rn-text', 'TextInput (plain, no formatting)'],
]
function readmeNumberTable() {
  const head = DEVICES.map((d) => `${shortName(d)} (${d.hz} Hz${d.platform === 'android' ? ', low-end' : ''})`)
  const out = [`| | ${head.join(' | ')} |`, `| --- |${DEVICES.map(() => ' --- |').join('')}`]
  for (const [impl, label] of README_NUMBER) {
    const cells = DEVICES.map((d) => {
      const x = row(d, 'stream|24|frame', impl)
      return x && x['ui.fps'] != null ? `${fps(x['ui.fps'])} fps (${Math.round(x['ui.dropped'])} dropped)` : 'not run'
    })
    out.push(`| ${label} | ${cells.join(' | ')} |`)
  }
  return out
}
function readmeInputTable() {
  const out = [`| | ${DEVICES.map(shortName).join(' | ')} |`, `| --- |${DEVICES.map(() => ' --- |').join('')}`]
  for (const [impl, label] of README_INPUT) {
    const cells = DEVICES.map((d) => {
      const x = row(d, 'type|8', impl)
      if (!x || x['rewrites.keysWithRewrites'] == null) return 'not run'
      return `${Math.round(x['rewrites.keysWithRewrites'])} of ${Math.round(x.typed ?? 12)} keys, ${Math.round(x['settledMs.p95'])} ms, JS ${Math.round(x.jsMsPerKey)} ms/key`
    })
    out.push(`| ${label} | ${cells.join(' | ')} |`)
  }
  return out
}

// 3. BENCHMARKS.md. A phone's own section holds the three value-stream tables
// in order; every other table sits under a phone's heading inside a section
// named for its group.
const STREAMS = ['24 copies, new value every frame', '24 copies, 10 values a second', '1 copy, new value every frame']
const SECTION_GROUP = {
  'The list': 'A list of 200 rows scrolling, 10 values a second',
  'Mount and unmount': 'Mount and unmount 24 copies',
  'Mount and unmount cycles': 'Memory over 40 mount/unmount cycles of 24 copies',
  'A list scrolling for 30 seconds': 'Memory over about 30 s of a list of 200 rows scrolling',
  'What one copy costs': 'Memory per copy, 100 mounted at once',
  'Typing at 8 keys a second': 'Typing at 8 keys a second',
  'Typing at 15 keys a second': 'Typing at 15 keys a second',
  'Focus latency': 'Focus latency',
  'Mounting 20 fields': 'Mount and unmount 20 copies',
  'Memory over 40 mount/unmount cycles of 20 fields': 'Memory over 40 mount/unmount cycles of 20 copies',
  'What one field costs': 'Memory per copy, 50 mounted at once',
}
const deviceOf = (heading) => DEVICES.find((d) => heading.startsWith(d.name))

function assembleBenchmarks(text) {
  const lines = text.split('\n')
  const out = []
  let h2 = null
  let h3 = null
  let phone = null // the phone whose tables follow
  let streamIndex = 0
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    const heading = /^(#{2,4}) (.*)$/.exec(line)
    if (heading && !line.startsWith('#####')) {
      const [, hashes, title] = heading
      const d = deviceOf(title)
      if (hashes === '##') {
        h2 = title
        h3 = null
        phone = d && !/^#### /.test(line) ? d : null
        streamIndex = 0
      } else if (hashes === '###') {
        h3 = title
        phone = null
      } else if (hashes === '####') {
        phone = d ?? null
      }
      out.push(d && deviceTitles.has(d.name) ? `${hashes} ${deviceTitles.get(d.name)}` : line)
      i++
      continue
    }
    if (!line.startsWith('|')) {
      out.push(line)
      i++
      continue
    }
    let end = i
    while (end < lines.length && lines[end].startsWith('|')) end++
    const block = lines.slice(i, end)
    let replacement = null
    let wanted = null
    if (h2 === 'At a glance') {
      replacement = glanceTable()
    } else if (phone && h3 == null && deviceOf(h2 ?? '')) {
      wanted = STREAMS[streamIndex++]
    } else if (phone) {
      wanted = SECTION_GROUP[h3 ?? h2]
    }
    if (wanted) {
      replacement = tables.get(`${phone.name}|${wanted}`) ?? null
      if (!replacement) console.warn(`BENCHMARKS.md: no "${wanted}" for ${phone.name}; the table is left as it was`)
    }
    out.push(...(replacement ?? block))
    i = end
  }
  return out.join('\n')
}

write('BENCHMARKS.md', assembleBenchmarks(fs.readFileSync(path.join(root, 'BENCHMARKS.md'), 'utf8')))

// 4. README.md: the tables whose first row is this library's.
function replaceTable(text, firstLabel, table) {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|') || (i > 0 && lines[i - 1].startsWith('|'))) continue
    let end = i
    while (end < lines.length && lines[end].startsWith('|')) end++
    if (lines[i + 2]?.startsWith(`| ${firstLabel}`)) {
      lines.splice(i, end - i, ...table)
      return lines.join('\n')
    }
  }
  console.warn(`README.md: no table starting with ${firstLabel}`)
  return text
}
let readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
readme = replaceTable(readme, '**NitroNumber**', readmeNumberTable())
readme = replaceTable(readme, '**NitroInput**', readmeInputTable())
write('README.md', readme)
