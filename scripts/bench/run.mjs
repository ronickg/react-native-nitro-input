#!/usr/bin/env node
// Runs the rolling-number benchmark on real devices and collects the results.
//
//   node scripts/bench/run.mjs --ios <udid> --android <serial> [--plan full|headline|quick|file.json]
//        [--impls a,b,c] [--repeat 3] [--seconds 10] [--warmup 2] [--settle 1.5]
//        [--build] [--no-install] [--team <apple team id>] [--label name]
//
// Each device gets a release build (with --build), the app is installed, then
// launched with the plan (an environment variable on iOS, an intent extra on
// Android). The app runs the plan on its own and prints one JSON line per
// event; devicectl's --console and logcat carry them back here. Every event
// lands in scripts/bench/results/<label>-<platform>-<model>.ndjson and the
// tables print at the end (see report.mjs). Devices run concurrently.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IMPLS, INPUT_IMPLS, RESULTS_DIR, renderAll } from './report.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = path.resolve(here, '../../bench')
const IOS_BUNDLE = 'org.reactjs.native.example.RollingNumberExample'
const IOS_APP = path.join(app, 'ios/build-device/Build/Products/Release-iphoneos/RollingNumberExample.app')
const ANDROID_PKG = 'com.rollingnumberexample'
const ANDROID_APK = path.join(app, 'android/app/build/outputs/apk/release/app-release.apk')
const ANDROID_HOME = process.env.ANDROID_HOME ?? path.join(process.env.HOME ?? '', 'Library/Android/sdk')
const ADB = path.join(ANDROID_HOME, 'platform-tools/adb')

function parseArgs(argv) {
  const o = { ios: [], android: [], plan: 'full', impls: null, repeat: 3, seconds: 5, warmup: 1.5, settle: 1, build: false, install: true, team: process.env.BENCH_IOS_TEAM ?? '5PSQ3NC8JP', label: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--ios') o.ios.push(next())
    else if (a === '--android') o.android.push(next())
    else if (a === '--plan') o.plan = next()
    else if (a === '--impls') o.impls = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--repeat') o.repeat = Number(next())
    else if (a === '--seconds') o.seconds = Number(next())
    else if (a === '--warmup') o.warmup = Number(next())
    else if (a === '--settle') o.settle = Number(next())
    else if (a === '--build') o.build = true
    else if (a === '--no-install') o.install = false
    else if (a === '--team') o.team = next()
    else if (a === '--label') o.label = next()
    else throw new Error(`unknown argument ${a}`)
  }
  if (!o.ios.length && !o.android.length) throw new Error('give at least one --ios <udid> or --android <serial>')
  return o
}

// A light library, a heavy one, a light one… so the chip cools during the
// light scenarios instead of the plan idling. Mirrors bench/src/bench/plan.ts.
const RUN_ORDER = ['text', 'nf-view', 'nitro-prop', 'nf-skia', 'nitro-jump', 'bloom', 'nitro-numeric', 'atext', 'ticker', 'rnna', 'nf-skia-sv', 'anim-numbers', 'arn']

// What the typing driver types: digits into a number or text field, a phone number into a masked one.
const INPUT_KEYS = { 'advanced-mask': '1234567890', 'nitro-mask': '1234567890' }
const inputKeys = (impl) => INPUT_KEYS[impl] ?? '123456789012'

/**
 * The plans. `full` is the value-stream matrix (the light rounds sit between
 * the heavy ones); `inputs` types into every field at two paces and measures
 * focus; `mount` mounts and unmounts 24 numbers and 20 fields ten times;
 * `list` scrolls 200 rows under ten values a second; `all` is all of them.
 * Mirrors bench/src/bench/plan.ts.
 */
function buildPlan(o) {
  const scenarios = []
  const known = [...IMPLS, ...INPUT_IMPLS].map(([k]) => k)
  const unknown = (o.impls ?? []).filter((k) => !known.includes(k))
  if (unknown.length) throw new Error(`unknown implementations: ${unknown.join(', ')}`)
  const rolling = RUN_ORDER.filter((k) => !o.impls || o.impls.includes(k))
  const inputs = INPUT_IMPLS.map(([k]) => k).filter((k) => !o.impls || o.impls.includes(k))
  const parts = o.plan === 'all' ? ['full', 'inputs', 'mount', 'list', 'leak'] : [o.plan]
  for (const part of parts) {
    if (part === 'full' || part === 'headline' || part === 'quick') {
      let rounds
      if (part === 'full') {
        const heavy = Array.from({ length: Math.max(1, o.repeat) }, () => [24, 'frame'])
        const light = [[1, 'frame'], [24, 10]]
        rounds = []
        heavy.forEach((h, i) => {
          rounds.push(h)
          if (light[i]) rounds.push(light[i])
        })
      } else if (part === 'headline') rounds = Array.from({ length: o.repeat }, () => [24, 'frame'])
      else rounds = [[24, 'frame']]
      for (const [count, rate] of rounds) for (const impl of rolling) scenarios.push({ impl, rate, count })
    } else if (part === 'inputs') {
      for (const rate of [8, 15]) for (const impl of inputs) scenarios.push({ kind: 'type', impl, keys: inputKeys(impl), rate })
      for (const impl of inputs) scenarios.push({ kind: 'focus', impl, runs: 8 })
    } else if (part === 'mount') {
      for (const impl of rolling) scenarios.push({ kind: 'mount', impl, count: 24, passes: 10 })
      for (const impl of inputs) scenarios.push({ kind: 'mount', impl, count: 20, passes: 10 })
    } else if (part === 'list') {
      for (const impl of rolling) scenarios.push({ kind: 'list', impl, rows: 200, rate: 10 })
    } else if (part === 'leak') {
      for (const impl of rolling) scenarios.push({ kind: 'leak', impl, count: 24, cycles: 40 })
      for (const impl of inputs) scenarios.push({ kind: 'leak', impl, count: 20, cycles: 40 })
      for (const impl of rolling) scenarios.push({ kind: 'leaklist', impl, rows: 200, rate: 10, seconds: 30 })
    } else if (part === 'footprint') {
      // Per-view memory: what one mounted copy costs, after forced collections.
      // Repeated and interleaved (--repeat), so a row is a median of runs that
      // followed different neighbours.
      for (let round = 0; round < Math.max(1, o.repeat); round++) {
        for (const impl of rolling) scenarios.push({ kind: 'footprint', impl, count: 100 })
        for (const impl of inputs) scenarios.push({ kind: 'footprint', impl, count: 50 })
      }
    } else {
      return JSON.parse(fs.readFileSync(part, 'utf8'))
    }
  }
  return { label: o.label || o.plan, seconds: o.seconds, warmup: o.warmup, settle: o.settle, scenarios }
}

const scenarioSeconds = (plan, s) => {
  switch (s.kind ?? 'stream') {
    case 'mount':
      // A pass is a mount (up to two seconds for a heavy library's 24 copies, five if it times out), an unmount and two short waits.
      return plan.settle + s.passes * 2.5
    case 'type':
      return plan.settle + 2.5 + s.keys.length / s.rate
    case 'focus':
      return plan.settle + s.runs * 0.6
    case 'leak':
      return plan.settle + s.cycles * 2
    case 'leaklist':
      return plan.settle + 2 + s.seconds
    case 'footprint':
      return plan.settle + 20
    default:
      return plan.settle + plan.warmup + plan.seconds + 1
  }
}
const planSeconds = (plan) => plan.scenarios.reduce((sum, s) => sum + scenarioSeconds(plan, s), 0)

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`)
  const { capture, ...rest } = opts
  const out = execFileSync(cmd, args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', maxBuffer: 64 << 20, ...rest })
  return out ? out.toString() : ''
}
const adb = (serial, args, opts) => run(ADB, ['-s', serial, ...args], opts)

/** Reads `BENCH {json}` lines from a stream; resolves with every event once the app reports done. */
function collect(tag, stream, onEvent, timeoutMs) {
  return new Promise((resolve, reject) => {
    const events = []
    let buf = ''
    const timer = setTimeout(() => reject(new Error(`${tag}: no "done" event after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        // iOS stdout lines are "BENCH {...}"; logcat -v raw prints the bare JSON.
        const at = line.indexOf('BENCH {')
        const json = at >= 0 ? line.slice(at + 6) : line.startsWith('{"event"') ? line : null
        if (json == null) continue
        let event
        try {
          event = JSON.parse(json)
        } catch {
          continue
        }
        events.push(event)
        onEvent?.(event)
        if (event.event === 'result') {
          console.log(`[${tag}] ${event.index + 1}: ${describe(event)}${event.error ? ' · FAILED ' + event.error : ''}`)
        } else if (event.event === 'plan') {
          console.log(`[${tag}] ${event.device?.name} ${event.device?.model} ${event.device?.os}, ${event.device?.refreshRate} Hz, thermal ${event.device?.thermal}${event.device?.lowPowerMode ? ', LOW POWER MODE' : ''}${event.device?.debug ? ', DEBUG BUILD' : ''}: ${event.scenarios} scenarios`)
        } else if (event.event === 'done') {
          clearTimeout(timer)
          resolve(events)
        }
      }
    })
    stream.on('error', reject)
  })
}

/** One line per result, by kind. */
function describe(r) {
  switch (r.kind ?? 'stream') {
    case 'mount':
      return `mount ${r.count} × ${r.impl} → ${r.mountMs.p50.toFixed(1)} ms, unmount ${r.unmountMs.p50.toFixed(1)} ms, main ${r.mountMainMs?.toFixed(1) ?? '–'} ms`
    case 'type':
      return `type @${r.rate}/s into ${r.impl} → ${r.typed} keys, rewrites ${r.rewrites.p50} (max ${r.rewrites.max}), settled p95 ${r.settledMs.p95.toFixed(0)} ms, main ${r.mainMsPerKey?.toFixed(1) ?? '–'} ms/key, ${r.dropped} dropped`
    case 'focus':
      return `focus ${r.impl} → ${r.ms.p50.toFixed(1)} ms (first ${r.first.toFixed(1)})`
    case 'leak':
      return `memory ${r.cycles} × mount ${r.count} × ${r.impl} → RSS ${r.rssFirstMb?.toFixed(1)} → ${r.rssLastMb?.toFixed(1)} MB, ${r.growthKbPerCycle?.toFixed(1)} KB/cycle${r.meminfo ? `, views ${r.meminfo.viewsStart} → ${r.meminfo.viewsEnd}` : ''}`
    case 'leaklist':
      return `memory ${r.impl} list ${Math.round(r.seconds)} s → RSS ${r.rssFirstMb?.toFixed(1)} → ${r.rssLastMb?.toFixed(1)} MB, ${r.growthKbPerSecond?.toFixed(1)} KB/s${r.meminfo ? `, views ${r.meminfo.viewsStart} → ${r.meminfo.viewsEnd}` : ''}`
    case 'footprint':
      return `footprint ${r.count} × ${r.impl} → ${r.perViewFootprintKb?.toFixed(1)} KB per copy (malloc ${r.perViewNativeKb?.toFixed(1)}${r.perViewJavaKb != null ? `, java ${r.perViewJavaKb.toFixed(1)}` : ''}), left ${r.leftFootprintKb?.toFixed(1)} KB`
    default: {
      const ui = r.ui ? `UI ${r.ui.fps.toFixed(1)}/${r.ui.hz} fps, ${r.ui.dropped} dropped` : 'UI –'
      const what = r.kind === 'list' ? `${r.impl} list of ${r.rows} @${r.rate}` : `${r.impl} ×${r.count} @${r.rate}`
      return `${what} → ${ui} · JS ${r.js.fps.toFixed(1)} fps · CPU ${r.cpu ? Math.round(r.cpu.process) + ' %' : '–'}`
    }
  }
}

function save(label, events) {
  const device = events.find((e) => e.event === 'plan')?.device
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  const name = `${label}-${device?.platform ?? 'unknown'}-${(device?.model ?? 'device').replace(/[^\w.]+/g, '_')}-${stamp}.ndjson`
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const file = path.join(RESULTS_DIR, name)
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return file
}

async function runIos(udid, plan, o) {
  const tag = `ios ${udid.slice(0, 8)}`
  if (o.build) {
    run('xcodebuild', ['-workspace', 'ios/RollingNumberExample.xcworkspace', '-scheme', 'RollingNumberExample', '-configuration', 'Release', '-destination', `id=${udid}`, '-derivedDataPath', 'ios/build-device', '-allowProvisioningUpdates', `DEVELOPMENT_TEAM=${o.team}`, 'CODE_SIGN_STYLE=Automatic', '-quiet', 'build'], { cwd: app })
  }
  if (o.install) run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', udid, IOS_APP])
  const encoded = Buffer.from(JSON.stringify(plan)).toString('base64')
  const args = ['devicectl', 'device', 'process', 'launch', '--console', '--terminate-existing', '--environment-variables', JSON.stringify({ BENCH_PLAN: encoded }), '--device', udid, IOS_BUNDLE]
  console.log(`[${tag}] launching with ${plan.scenarios.length} scenarios (~${Math.round(planSeconds(plan) / 60)} min)`)
  const child = spawn('xcrun', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.setEncoding('utf8')
  // The app's stderr carries system logging (and NSLog copies of the BENCH lines); keep only the rest.
  child.stderr.on('data', (d) => {
    const lines = d.split('\n').filter((l) => l.trim() && !l.includes('BENCH {'))
    if (lines.length) process.stderr.write(lines.map((l) => `[${tag}] ${l}`).join('\n') + '\n')
  })
  try {
    return await collect(tag, child.stdout, null, planSeconds(plan) * 1000 * 1.5 + 90_000)
  } finally {
    child.kill('SIGINT') // devicectl forwards it: the app quits
  }
}

/** Live View objects and the native heap, from dumpsys meminfo: detached views that never die are the classic leak. */
function parseMeminfo(text) {
  const views = text.match(/Views:\s*(\d+)/)
  const heap = text.match(/Native Heap:\s*(\d+)/) ?? text.match(/Native Heap\s+(\d+)/)
  return { views: views ? Number(views[1]) : null, nativeHeapKb: heap ? Number(heap[1]) : null }
}

function parseGfxinfo(text) {
  const num = (re) => {
    const m = text.match(re)
    return m ? Number(m[1]) : null
  }
  const total = num(/Total frames rendered:\s*(\d+)/)
  const janky = num(/Janky frames:\s*(\d+)/)
  if (total == null || janky == null) return null
  return { frames: total, janky, jankyPct: total ? (janky / total) * 100 : 0, p50: num(/50th percentile:\s*(\d+)ms/), p90: num(/90th percentile:\s*(\d+)ms/), p95: num(/95th percentile:\s*(\d+)ms/), p99: num(/99th percentile:\s*(\d+)ms/) }
}

async function runAndroid(serial, plan, o) {
  const tag = `android ${serial}`
  if (o.build) run(path.join(app, 'android/gradlew'), ['assembleRelease', '-q'], { cwd: path.join(app, 'android'), env: { ...process.env, ANDROID_HOME } })
  if (o.install) adb(serial, ['install', '-r', '-d', ANDROID_APK])
  adb(serial, ['shell', 'am', 'force-stop', ANDROID_PKG])
  adb(serial, ['logcat', '-c'])
  const logcat = spawn(ADB, ['-s', serial, 'logcat', '-v', 'raw', '-s', 'BENCH:I'], { stdio: ['ignore', 'pipe', 'inherit'] })
  const encoded = Buffer.from(JSON.stringify(plan)).toString('base64')
  console.log(`[${tag}] launching with ${plan.scenarios.length} scenarios (~${Math.round(planSeconds(plan) / 60)} min)`)
  adb(serial, ['shell', 'am', 'start', '-n', `${ANDROID_PKG}/.MainActivity`, '--es', 'BENCH_PLAN', encoded], { capture: true })
  // HWUI's own frame accounting, reset when the measured window opens and read
  // with the result; and around a memory scenario, the live View count and the
  // native heap from dumpsys meminfo.
  const meminfoAtStart = new Map()
  const onEvent = (event) => {
    try {
      if (event.event === 'measure') adb(serial, ['shell', 'dumpsys', 'gfxinfo', ANDROID_PKG, 'reset'], { capture: true, stdio: ['ignore', 'pipe', 'ignore'] })
      else if (event.event === 'start' && (event.kind === 'leak' || event.kind === 'leaklist')) {
        meminfoAtStart.set(event.index, parseMeminfo(adb(serial, ['shell', 'dumpsys', 'meminfo', ANDROID_PKG], { capture: true, stdio: ['ignore', 'pipe', 'ignore'] })))
      } else if (event.event === 'result') {
        if (event.kind === 'leak' || event.kind === 'leaklist') {
          const before = meminfoAtStart.get(event.index)
          const after = parseMeminfo(adb(serial, ['shell', 'dumpsys', 'meminfo', ANDROID_PKG], { capture: true, stdio: ['ignore', 'pipe', 'ignore'] }))
          if (before) event.meminfo = { viewsStart: before.views, viewsEnd: after.views, nativeHeapStartKb: before.nativeHeapKb, nativeHeapEndKb: after.nativeHeapKb }
        } else {
          event.hwui = parseGfxinfo(adb(serial, ['shell', 'dumpsys', 'gfxinfo', ANDROID_PKG], { capture: true, stdio: ['ignore', 'pipe', 'ignore'] }))
        }
      }
    } catch (e) {
      console.warn(`[${tag}] dumpsys: ${e.message}`)
    }
  }
  try {
    return await collect(tag, logcat.stdout, onEvent, planSeconds(plan) * 1000 * 1.5 + 90_000)
  } finally {
    logcat.kill()
    try {
      adb(serial, ['shell', 'am', 'force-stop', ANDROID_PKG], { capture: true })
    } catch {}
  }
}

const o = parseArgs(process.argv.slice(2))
const plan = buildPlan(o)
// react-native-advanced-input-mask does not build against React Native 0.87's prebuilt core on iOS (see bench/react-native.config.js).
const iosPlan = { ...plan, scenarios: plan.scenarios.filter((s) => s.impl !== 'advanced-mask') }
console.log(`plan "${plan.label}": ${plan.scenarios.length} scenarios × (${plan.settle} + ${plan.warmup} + ${plan.seconds} s) ≈ ${Math.round(planSeconds(plan) / 60)} min per device`)
const jobs = [...o.ios.map((udid) => runIos(udid, iosPlan, o)), ...o.android.map((serial) => runAndroid(serial, plan, o))]
const settled = await Promise.allSettled(jobs)
const files = []
settled.forEach((s, i) => {
  const target = i < o.ios.length ? `ios ${o.ios[i]}` : `android ${o.android[i - o.ios.length]}`
  if (s.status === 'fulfilled') files.push(save(plan.label, s.value))
  else console.error(`${target} failed: ${s.reason?.message ?? s.reason}`)
})
if (files.length) {
  console.log(`\nsaved:\n${files.map((f) => '  ' + path.relative(process.cwd(), f)).join('\n')}\n`)
  process.stdout.write(renderAll(files))
}
process.exit(files.length === jobs.length ? 0 : 1)
