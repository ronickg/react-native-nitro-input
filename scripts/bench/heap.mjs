#!/usr/bin/env node
// A native heap profile of the example app on Android while it mounts copies
// of one implementation: which call sites the memory of a mounted view comes
// from, as KB per copy. Perfetto's heapprofd samples every malloc (and, with
// all_heaps, the ART heap) from process start, so the trace is started
// before the app, the app is launched with a one-scenario footprint plan,
// and the trace is pulled and attributed when it ends.
//
//   node scripts/bench/heap.mjs --android <adb serial> --impl morph-text [--count 50] [--python .venv/bin/python]
//
// Needs: the release example app installed (its manifest is
// <profileable android:shell="true"/>, which lets the shell attach to it),
// and a Python with the `perfetto` package for the attribution
// (python3 -m venv .venv && .venv/bin/pip install perfetto; the package
// downloads trace_processor_shell on first use). Traces land in
// scripts/bench/results/heap/ (ignored by git). See heapprofd.md.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IMPLS, INPUT_IMPLS, RESULTS_DIR } from './report.mjs'

const ANDROID_PKG = 'com.rollingnumberexample'
const here = path.dirname(fileURLToPath(import.meta.url))

const o = { serial: '', impl: 'nitro-prop', count: 0, python: '', seconds: 60 }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const next = () => argv[++i]
  if (a === '--android') o.serial = next()
  else if (a === '--impl') o.impl = next()
  else if (a === '--count') o.count = Number(next())
  else if (a === '--python') o.python = next()
  else if (a === '--seconds') o.seconds = Number(next())
  else throw new Error(`unknown argument ${a}`)
}
if (!o.serial) throw new Error('give --android <adb serial>')
const isInput = INPUT_IMPLS.some(([k]) => k === o.impl)
if (!isInput && !IMPLS.some(([k]) => k === o.impl)) throw new Error(`unknown implementation ${o.impl}`)
if (!o.count) o.count = isInput ? 50 : 100
const python = o.python || ['.venv/bin/python', 'venv/bin/python'].find((p) => fs.existsSync(p)) || 'python3'

const adb = (args, opts = {}) => execFileSync('adb', ['-s', o.serial, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts })
const out = path.join(RESULTS_DIR, 'heap')
fs.mkdirSync(out, { recursive: true })
const onDevice = `/data/misc/perfetto-traces/heap-${o.impl}.pftrace`
const local = path.join(out, `${o.impl}-x${o.count}.pftrace`)

// 1. The config, with the duration this run wants.
const config = fs.readFileSync(path.join(here, 'heapprofd.cfg'), 'utf8').replace(/duration_ms: \d+/, `duration_ms: ${o.seconds * 1000}`)

// 2. Start the trace, then the app with its plan; heapprofd attaches as the process starts.
adb(['shell', 'am', 'force-stop', ANDROID_PKG])
adb(['shell', 'rm', '-f', onDevice])
const perfetto = spawn('adb', ['-s', o.serial, 'shell', 'perfetto', '--txt', '-c', '-', '-o', onDevice], { stdio: ['pipe', 'inherit', 'inherit'] })
perfetto.stdin.end(config)
await new Promise((r) => setTimeout(r, 4000))
const plan = { label: `heap-${o.impl}`, seconds: 5, warmup: 1, settle: 1, scenarios: [{ kind: 'footprint', impl: o.impl, count: o.count }] }
const encoded = Buffer.from(JSON.stringify(plan)).toString('base64')
adb(['shell', 'am', 'start', '-n', `${ANDROID_PKG}/.MainActivity`, '--es', 'BENCH_PLAN', encoded])
console.log(`recording ${o.impl} × ${o.count} for ${o.seconds} s`)
await new Promise((resolve, reject) => {
  perfetto.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`perfetto exited with ${code}`))))
})

// 3. Pull the trace and the in-app figure for the same mount, then attribute.
adb(['pull', onDevice, local])
const result = adb(['logcat', '-d', '-s', 'BENCH:I'])
  .split('\n')
  .filter((l) => l.includes('"event":"result"') && l.includes(`"impl":"${o.impl}"`))
  .pop()
if (result) {
  const r = JSON.parse(result.slice(result.indexOf('{')))
  console.log(`in-app: ${r.perViewFootprintKb?.toFixed(1)} KB footprint per copy (malloc ${r.perViewNativeKb?.toFixed(1)}${r.perViewJavaKb != null ? `, java ${r.perViewJavaKb.toFixed(1)}` : ''})`)
}
console.log(`trace: ${local}`)
execFileSync(python, [path.join(here, 'heap-attribute.py'), local, '--count', String(o.count)], { stdio: 'inherit' })
