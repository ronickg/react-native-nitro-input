#!/usr/bin/env node
// Drives the example app's "Recycle check" screen through argent and verifies,
// after every scroll, value bump, remount and mode switch, that each visible
// row shows the value its label says. A recycled or re-mounted native view
// that kept the value of the row it used to be in fails here.
//
//   node scripts/ui/recycle-check.mjs --udid <device>   (simulator UDID, adb serial, or physical iPhone)
//
// Needs argent (npx @swmansion/argent) on PATH and the example app installed
// on the device. Every step is an `argent run <tool>` call, so the same script
// runs on iOS and Android; it reads the accessibility tree (`describe`) and
// pairs "expect N" labels with the number or field on the same row by their
// y position. Exit status 1 when any row was wrong.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const udid = flag('--udid')
if (!udid) throw new Error('give --udid <device id from `argent run list-devices`>')
const isIos = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(udid) || /^[0-9A-F]{8}-[0-9A-F]{16}$/i.test(udid)
const bundleId = isIos ? 'org.reactjs.native.example.RollingNumberExample' : 'com.rollingnumberexample'

function run(tool, args) {
  const out = execFileSync('argent', ['run', tool, '--json', '--args', JSON.stringify({ udid, ...args })], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    return JSON.parse(out)
  } catch {
    return { raw: out }
  }
}
const sleep = (ms) => execFileSync('sleep', [String(ms / 1000)])
/** Wait for the tree to stop changing (a fling decelerates for a while; a roll takes half a second), then a little more. */
function settle(ms = 300) {
  try {
    run('await-screen-idle', { timeoutMs: 8000, minStableMs: 600 })
  } catch {}
  sleep(ms)
}

/** One element per line: role, quoted label / value / id, flags, then the frame "(x, y, w, h)". */
function tree() {
  const r = run('describe', {})
  const text = typeof r.description === 'string' ? r.description : r.raw ?? JSON.stringify(r)
  const FRAME = /\(\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)\s*\)\s*$/
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(FRAME)
      if (!m) return null
      const body = line.slice(0, m.index)
      return { line, body, x: +m[1], y: +m[2], w: +m[3], h: +m[4], quoted: [...body.matchAll(/"([^"]*)"/g)].map((q) => q[1]), id: body.match(/\bid="([^"]*)"/)?.[1] }
    })
    .filter(Boolean)
}
/**
 * The accessibility tree says what a view *means* to show; whether it drew it
 * is a different question (a view can report its value and paint nothing).
 * A screenshot answers that: for each row, count dark pixels in the column
 * where the number or field sits. Needs python3 with Pillow; skipped without.
 */
const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recycle-check-'))
let shots = 0
let inkAvailable = null
function inkPerRow(rows, column) {
  if (inkAvailable === false || !rows.length) return null
  const file = path.join(shotDir, `shot-${++shots}.png`)
  try {
    execFileSync('argent', ['run', 'screenshot', '--json', '--out', file, '--args', JSON.stringify({ udid, scale: 1 })], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return null
  }
  const script = `
import json, sys
try:
    from PIL import Image
except Exception:
    print('no-pil'); sys.exit(0)
im = Image.open(sys.argv[1]).convert('L')
W, H = im.size
px = im.load()
rows = json.loads(sys.argv[2]); col = json.loads(sys.argv[3])
out = []
for y0, y1 in rows:
    x0, x1 = int(col[0] * W), int(col[1] * W)
    ya, yb = max(0, int(y0 * H)), min(H, int(y1 * H))
    dark = 0
    cols = set()
    for y in range(ya, yb):
        for x in range(x0, x1, 2):
            if px[x, y] < 110:
                dark += 1
                cols.add(x)
    out.append([dark, len(cols)])
print(json.dumps(out))
`
  const res = execFileSync('python3', ['-c', script, file, JSON.stringify(rows), JSON.stringify(column)], { encoding: 'utf8' }).trim()
  if (res === 'no-pil') {
    inkAvailable = false
    console.log('     (no Pillow for python3: skipping the painted-pixels check)')
    return null
  }
  inkAvailable = true
  return JSON.parse(res).map(([dark, cols]) => ({ dark, cols }))
}

const find = (els, pred) => els.find(pred)
const byId = (els, id) => find(els, (e) => e.id === id) ?? find(els, (e) => e.quoted.includes(id))
const centre = (e) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 })
const tap = (e) => run('gesture-tap', centre(e))

/** Straight swipe inside the list; a fling by default, momentum:false for a precise move. */
function swipe(list, dir, precise = false) {
  const x = list.x + list.w / 2
  const top = list.y + list.h * 0.15
  const bottom = list.y + list.h * 0.85
  const [fromY, toY] = dir === 'down' ? [bottom, top] : [top, bottom]
  run('gesture-swipe', { fromX: x, fromY, toX: x, toY, durationMs: precise ? 400 : 200, momentum: !precise })
}

/** The value every row must show: the screen starts at 10000 and each "Bump values" adds one. */
let base = 10000

/**
 * Pair every row with the value shown in it. A row is known by its testID
 * (`row-<index>`, static for the life of the row) where the tree exposes it,
 * which makes the expectation independent of anything painted; where it does
 * not (iOS lists only accessibility elements), the "expect N" label stands in.
 * The label is also compared on its own, so a stale label is reported as
 * such and not as a wrong number.
 */
function verify(step, els) {
  const labels = []
  const values = []
  const rows = []
  const frame = list()
  const bottom = Math.min(frame.y + frame.h, 0.92)
  // Rows touching the list's top edge are half under it or still settling; leave them out.
  const onScreen = (e) => e.y >= frame.y + 0.01 && e.y + 0.03 <= bottom
  for (const e of els) {
    const row = e.id?.match(/^row-(\d+)$/)
    if (row && onScreen(e)) rows.push({ y: e.y, h: e.h, expected: base + +row[1], index: +row[1] })
    const label = e.quoted.map((q) => q.match(/^expect (\d+)$/)).find(Boolean)
    if (label) {
      if (onScreen(e)) labels.push({ y: e.y, expected: +label[1] })
      continue
    }
    for (const q of e.quoted) {
      const m = q.match(/^-?\d{4,7}$/)
      if (m) values.push({ y: e.y, shown: +q, used: false })
    }
  }
  const staleLabels = rows.length
    ? labels.filter((l) => {
        const r = rows.find((r) => Math.abs(r.y - l.y) <= 0.02)
        return r && r.expected !== l.expected
      })
    : []
  if (rows.length) {
    // Expectations from the row ids; the labels are informational.
    labels.length = 0
    for (const r of rows) labels.push({ y: r.y, expected: r.expected })
  }
  const wrong = []
  const missing = []
  let ok = 0
  for (const l of labels.sort((a, b) => a.y - b.y)) {
    const v = values.find((v) => !v.used && Math.abs(v.y - l.y) <= 0.02)
    if (!v) {
      missing.push(l)
      continue
    }
    v.used = true
    if (v.shown === l.expected) ok += 1
    else wrong.push({ ...l, shown: v.shown })
  }
  // Painted? Only rows fully on screen, in the column the values occupy
  // (their reported frames), between the label's top and bottom.
  const valueFrames = els.filter((e) => e.quoted.some((q) => /^-?\d{4,7}$/.test(q)) && !e.quoted.some((q) => /^expect /.test(q)))
  const xs = valueFrames.length ? [Math.min(...valueFrames.map((e) => e.x)), Math.max(...valueFrames.map((e) => e.x + e.w))] : [0.6, 0.98]
  const fullRows = labels
  const ink = inkPerRow(fullRows.map((l) => [l.y - 0.004, l.y + 0.03]), xs)
  const blank = ink ? fullRows.filter((_, i) => ink[i].dark < 15) : []
  const status = wrong.length || missing.length || blank.length || !labels.length ? 'FAIL' : 'ok'
  console.log(`${status.padEnd(4)} ${step}: ${labels.length} rows visible, ${ok} correct${wrong.length ? `, ${wrong.length} WRONG` : ''}${missing.length ? `, ${missing.length} without a value` : ''}${ink ? `, painted ${fullRows.length - blank.length}/${fullRows.length}` : ''}`)
  for (const w of wrong) console.log(`       row expecting ${w.expected} shows ${w.shown} (y=${w.y.toFixed(3)})`)
  for (const m of missing) console.log(`       row expecting ${m.expected} shows nothing readable (y=${m.y.toFixed(3)})`)
  for (const b of blank) console.log(`       row expecting ${b.expected} reports its value but painted nothing (y=${b.y.toFixed(3)})`)
  if (staleLabels.length) console.log(`       note: ${staleLabels.length} "expect" labels read stale in the tree (the plain Text next to the value, not the value)`)
  return status === 'ok'
}

// 1. Open the app and the screen.
run('launch-app', { bundleId })
sleep(1500)
let els = tree()
for (let attempt = 0; attempt < 6 && !byId(els, 'home-recycle'); attempt++) {
  if (byId(els, 'recycle-list') || byId(els, 'recycle-bump')) break
  const back = byId(els, 'Navigate up') ?? find(els, (e) => /back/i.test(e.body) && /button/i.test(e.body))
  if (back && !byId(els, 'home-parity')) {
    tap(back)
  } else {
    run('gesture-swipe', { fromX: 0.5, fromY: 0.85, toX: 0.5, toY: 0.25, durationMs: 300, momentum: false })
  }
  sleep(600)
  els = tree()
}
if (byId(els, 'home-recycle')) {
  tap(byId(els, 'home-recycle'))
  sleep(1200)
  els = tree()
}
if (!byId(els, 'recycle-bump')) throw new Error('could not reach the Recycle check screen; tree:\n' + els.map((e) => e.line).join('\n'))

const results = []
const check = (step) => {
  settle()
  els = tree()
  const ys = els.filter((e) => e.quoted.some((q) => /^expect \d+$/.test(q))).map((e) => e.y).sort((a, b) => a - b)
  if (ys.some((y, i) => i > 0 && y - ys[i - 1] < 0.01)) {
    // Two rows on one line: the tree was read while the list moved. Once more.
    settle(600)
    els = tree()
  }
  results.push(verify(step, els))
}
/** The list's frame: its testID on Android; on iOS (which lists only accessibility elements) everything below the "base …" line. */
const list = () => {
  const els = tree()
  const byTest = byId(els, 'recycle-list')
  if (byTest) return byTest
  const hint = find(els, (e) => e.quoted.some((q) => q.startsWith('base ')))
  const top = hint ? hint.y + hint.h : 0.2
  return { x: 0.05, y: top, w: 0.9, h: 0.97 - top }
}
const bump = () => {
  tap(button('recycle-bump'))
  base += 1
}
const button = (id) => byId(tree(), id)

// 2. Numbers: scroll far down with flings, then precisely, then back up.
check('numbers, top of the list')
for (let i = 0; i < 3; i++) swipe(list(), 'down')
check('numbers, after 3 flings down')
for (let i = 0; i < 3; i++) swipe(list(), 'down')
check('numbers, after 6 flings down')
for (let i = 0; i < 2; i++) swipe(list(), 'down', true)
check('numbers, after 2 precise swipes')
for (let i = 0; i < 8; i++) swipe(list(), 'up')
check('numbers, back near the top')

// 3. Every row rolls by one; the settled values must follow, and no frame of
// the roll may leave a row blank (a wheel between two digits still shows ink).
{
  settle()
  const before = tree()
  const frame = list()
  const rowsBefore = before.filter((e) => e.id?.match(/^row-\d+$/) && e.y >= frame.y && e.y + 0.03 <= Math.min(frame.y + frame.h, 0.92))
  const valueFrames = before.filter((e) => e.quoted.some((q) => /^-?\d{4,7}$/.test(q)))
  const xs = valueFrames.length ? [Math.min(...valueFrames.map((e) => e.x)), Math.max(...valueFrames.map((e) => e.x + e.w))] : [0.6, 0.98]
  // At rest every value paints a certain number of pixel columns; a wheel
  // that goes blank while rolling takes a fifth of them away, a half-shown
  // digit far less. Compare each mid-roll frame's column count with rest.
  const bands = rowsBefore.map((r) => [r.y - 0.004, r.y + 0.03])
  const rest = inkPerRow(bands, xs)
  bump()
  let blankFrames = 0
  let frames = 0
  for (let k = 0; k < 4 && rest; k++) {
    const ink = inkPerRow(bands, xs)
    if (!ink) break
    frames += 1
    const blank = rowsBefore.filter((_, i) => ink[i].dark < 15 || ink[i].cols < rest[i].cols * 0.8)
    if (blank.length) {
      blankFrames += 1
      console.log(`       mid-roll frame ${k + 1}: ${blank.length} rows lost a digit's worth of paint (${blank.map((r, j) => `${r.expected - 1}: ${ink[rowsBefore.indexOf(r)].cols}/${rest[rowsBefore.indexOf(r)].cols} columns`).join(', ')})`)
    }
  }
  if (frames) {
    console.log(`${blankFrames ? 'FAIL' : 'ok  '} numbers, frames captured during the roll: ${frames} frames, ${blankFrames} with a blank row`)
    results.push(!blankFrames)
  }
}
check('numbers, after one bump (all rows rolled)')
for (let i = 0; i < 3; i++) {
  bump()
  sleep(120)
}
check('numbers, after three quick bumps')
for (let i = 0; i < 3; i++) swipe(list(), 'down')
check('numbers, scrolled after the bumps')

// 4. Unmount and mount the whole list.
tap(button('recycle-toggle'))
sleep(600)
tap(button('recycle-toggle'))
check('numbers, after unmount + mount')
for (let i = 0; i < 4; i++) swipe(list(), 'down')
check('numbers, scrolled after the remount')

// 5. The same list with text fields in the rows.
tap(button('recycle-kind'))
check('fields, after switching the rows to fields')
for (let i = 0; i < 4; i++) swipe(list(), 'down')
check('fields, after 4 flings down')
for (let i = 0; i < 6; i++) swipe(list(), 'up')
check('fields, back near the top')
bump()
check('fields, after a bump')
tap(button('recycle-toggle'))
sleep(600)
tap(button('recycle-toggle'))
check('fields, after unmount + mount')

// 6. Back to numbers once more, the rows now recycled from fields.
tap(button('recycle-kind'))
check('numbers again, after the fields')

const failed = results.filter((r) => !r).length
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nall ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
