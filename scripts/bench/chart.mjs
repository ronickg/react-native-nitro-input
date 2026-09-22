#!/usr/bin/env node
// The at-a-glance benchmark as a standalone SVG for the README, in a light and a
// dark version: one row per implementation, one column per phone, the column's
// full width the phone's refresh rate, this library's rows in the accent. The
// bars grow in with SMIL, which GitHub's image proxy leaves alone.
//
//   node scripts/bench/chart.mjs            # writes docs/static/img/bench/glance-{light,dark}.svg
//   node scripts/bench/chart.mjs --group list|200|10 --metric ui.fps --out path.svg --theme dark
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RESULTS_DIR, summarizeAll } from './report.mjs'

const THEMES = {
  light: { ink: '#0f172a', muted: '#5b6472', ours: '#2563eb', other: '#8a8f99', line: 'rgba(15,23,42,0.18)', code: 'rgba(15,23,42,0.06)' },
  dark: { ink: '#e6edf3', muted: '#9aa4b2', ours: '#60a5fa', other: '#6b7280', line: 'rgba(230,237,243,0.22)', code: 'rgba(230,237,243,0.08)' },
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(1))
const title = (name) => name.replace(/^Samsung /, '')

/** A label longer than the column breaks once at a space; markdown bold and backticks are dropped. */
function lines(label, max = 22) {
  const plain = label.replace(/[*`]/g, '')
  if (plain.length <= max) return [plain]
  const at = plain.lastIndexOf(' ', max)
  return at > 6 ? [plain.slice(0, at), plain.slice(at + 1)] : [plain]
}

export function renderChart(summary, { group = 'stream|24|frame', metric = 'ui.fps', theme = 'light', hzDomain = true, animate = true } = {}) {
  const t = THEMES[theme]
  const devices = [...summary.devices]
    .sort((a, b) => (a.platform !== b.platform ? (a.platform === 'ios' ? -1 : 1) : (b.hz ?? 0) - (a.hz ?? 0)))
    .flatMap((d) => {
      const g = d.groups.find((x) => x.key === group)
      return g ? [{ device: d, group: g }] : []
    })
  const impls = []
  for (const p of devices) for (const r of p.group.rows) if (!impls.some((x) => x.impl === r.impl)) impls.push(r)
  const LABEL_W = 176
  const COL_W = 178
  const VALUE_W = 40
  const GAP = 14
  const LEFT = 8
  const TOP = 34
  const BAR_H = 14
  const width = LEFT + LABEL_W + devices.length * (COL_W + GAP) - GAP + 8
  const rows = impls.map((r) => ({ row: r, lines: lines(r.label) }))
  const heights = rows.map((r) => (r.lines.length > 1 ? 30 : 22))
  const height = TOP + heights.reduce((a, b) => a + b, 0) + 8

  const all = devices.flatMap((p) => p.group.rows.map((r) => r[metric]).filter((v) => typeof v === 'number'))
  const sharedMax = Math.max(0, ...all)
  const domain = (p) => (hzDomain ? Math.max(p.device.hz ?? 60, ...p.group.rows.map((r) => (typeof r[metric] === 'number' ? r[metric] : 0))) : sharedMax)

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="12">\n`
  out += `<style>text{fill:${t.ink}} .m{fill:${t.muted}} .h{font-size:10.5px;font-weight:650;letter-spacing:.06em;fill:${t.muted}} .hz{font-weight:500;letter-spacing:0} .o{font-weight:600} .v{font-variant-numeric:tabular-nums}</style>\n`
  devices.forEach((p, i) => {
    const x = LEFT + LABEL_W + i * (COL_W + GAP)
    const barW = COL_W - VALUE_W
    out += `<text class="h" x="${x}" y="${TOP - 14}">${esc(title(p.device.name).toUpperCase())}${hzDomain && p.device.hz ? `<tspan class="hz"> · ${p.device.hz} Hz</tspan>` : ''}</text>\n`
    out += `<line x1="${x}" y1="${TOP - 6}" x2="${x + COL_W}" y2="${TOP - 6}" stroke="${t.line}" stroke-width="1"/>\n`
    if (hzDomain) out += `<line x1="${x + barW}" y1="${TOP - 2}" x2="${x + barW}" y2="${height - 6}" stroke="${t.line}" stroke-width="1"/>\n`
  })
  let y = TOP
  rows.forEach(({ row, lines: ls }, i) => {
    const h = heights[i]
    const cy = y + h / 2
    const cls = row.ours ? 'o' : 'm'
    if (ls.length === 1) out += `<text class="${cls}" x="${LEFT}" y="${cy + 4}">${esc(ls[0])}</text>\n`
    else out += `<text class="${cls}" x="${LEFT}" y="${cy - 2}">${esc(ls[0])}<tspan x="${LEFT}" dy="12">${esc(ls[1])}</tspan></text>\n`
    devices.forEach((p, j) => {
      const x = LEFT + LABEL_W + j * (COL_W + GAP)
      const barW = COL_W - VALUE_W
      const r = p.group.rows.find((z) => z.impl === row.impl)
      const v = r && typeof r[metric] === 'number' ? r[metric] : null
      if (v == null) {
        out += `<text class="m" x="${x}" y="${cy + 4}" font-style="italic" font-size="11">${r?.error ? 'did not finish' : 'not run'}</text>\n`
        return
      }
      const w = Math.max(0, (v / domain(p)) * barW)
      const delay = (i * 0.04).toFixed(2)
      out += `<path fill="${row.ours ? t.ours : t.other}" d="${barPath(x, cy - BAR_H / 2, w, BAR_H)}">`
      if (animate && w > 0) out += `<animate attributeName="d" from="${barPath(x, cy - BAR_H / 2, 0, BAR_H)}" to="${barPath(x, cy - BAR_H / 2, w, BAR_H)}" dur="0.8s" begin="${delay}s" fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.2 1"/>`
      out += `</path>\n`
      out += `<text class="v" x="${x + barW + 6}" y="${cy + 4}">${fmt(v)}`
      if (animate) out += `<animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${delay}s" fill="freeze"/>`
      out += `</text>\n`
    })
    y += h
  })
  out += '</svg>\n'
  return out
}

/** A bar with a 4px rounded data end, square at the baseline, that stays valid at width 0. */
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2)
  const f = (n) => Math.round(n * 100) / 100
  return `M${f(x)} ${f(y)} H${f(x + w - r)} Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)} V${f(y + h - r)} Q${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} H${f(x)} Z`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const opt = (name, dflt) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : dflt
  }
  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.ndjson'))
    .sort()
    .map((f) => path.join(RESULTS_DIR, f))
  const summary = summarizeAll(files)
  const group = opt('group', 'stream|24|frame')
  const metric = opt('metric', 'ui.fps')
  const out = opt('out', null)
  const themes = opt('theme', null) ? [opt('theme')] : ['light', 'dark']
  for (const theme of themes) {
    const file = out ?? path.resolve(fileURLToPath(import.meta.url), '../../../docs/static/img/bench', `glance-${theme}.svg`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, renderChart(summary, { group, metric, theme, hzDomain: metric.endsWith('.fps') }))
    console.log(`wrote ${path.relative(process.cwd(), file)}`)
  }
}
