import { Platform } from 'react-native'
import { IMPLS, type ImplKey } from './impls'
import { INPUT_IMPLS, type InputImplKey } from './inputs'

/** 'frame' pushes a new value on every JS frame; a number is pushes per second. */
export type Rate = 'frame' | number
export type Count = 1 | 8 | 24

/** A value stream into `count` copies of a rolling-number implementation. */
export type StreamScenario = { kind?: 'stream'; impl: ImplKey; rate: Rate; count: Count }
/** A list of `rows` numbers scrolling while a value stream runs. */
export type ListScenario = { kind: 'list'; impl: ImplKey; rows: number; rate: Rate }
/** `count` copies mounted cold and unmounted again, `passes` times. */
export type MountScenario = { kind: 'mount'; impl: ImplKey | InputImplKey; count: number; passes: number }
/** `keys` typed into a focused field at `rate` keys a second. */
export type TypeScenario = { kind: 'type'; impl: InputImplKey; keys: string; rate: number }
/** focus() to onFocus, `runs` times. */
export type FocusScenario = { kind: 'focus'; impl: InputImplKey; runs: number }
/** `count` copies mounted and unmounted `cycles` times, resident memory sampled along the way: a leak is a climb that outlives the garbage collector. */
export type LeakScenario = { kind: 'leak'; impl: ImplKey | InputImplKey; count: number; cycles: number }
/** A list of `rows` scrolled for `seconds` with values arriving at `rate`, resident memory sampled every second. */
export type LeakListScenario = { kind: 'leaklist'; impl: ImplKey; rows: number; rate: Rate; seconds: number }
/** `count` copies mounted at once, memory read after a forced collection before, with them, and after: the per-view footprint. */
export type FootprintScenario = { kind: 'footprint'; impl: ImplKey | InputImplKey; count: number }
export type Scenario = StreamScenario | ListScenario | MountScenario | TypeScenario | FocusScenario | LeakScenario | LeakListScenario | FootprintScenario
export type Kind = 'stream' | 'list' | 'mount' | 'type' | 'focus' | 'leak' | 'leaklist' | 'footprint'

export const kindOf = (s: Scenario): Kind => s.kind ?? 'stream'

export type Plan = {
  label: string
  /** Measured seconds per stream or list scenario. */
  seconds: number
  /** Seconds of pushes before measuring starts, so caches, fonts and JIT are warm. */
  warmup: number
  /** Seconds the next scenario sits mounted and idle before its run. */
  settle: number
  scenarios: Scenario[]
}

// Five measured seconds are 300 frames at 60 Hz and 600 at 120: enough for
// fps, dropped frames and a CPU percentage, and half the heat of ten.
export const DEFAULT_SECONDS = 5
export const DEFAULT_WARMUP = 1.5
export const DEFAULT_SETTLE = 1

const IMPL_KEYS = new Set<string>(IMPLS.map((i) => i.key))
const INPUT_KEYS = new Set<string>(INPUT_IMPLS.map((i) => i.key))
const COUNTS: Count[] = [1, 8, 24]

function num(v: unknown, fallback: number) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
}

const isRate = (r: unknown): r is Rate => r === 'frame' || (typeof r === 'number' && r > 0)
const isPositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

function isScenario(s: unknown): s is Scenario {
  if (typeof s !== 'object' || s === null) return false
  const o = s as Record<string, unknown>
  const impl = typeof o.impl === 'string' ? o.impl : ''
  switch (o.kind ?? 'stream') {
    case 'stream':
      return IMPL_KEYS.has(impl) && isRate(o.rate) && COUNTS.includes(o.count as Count)
    case 'list':
      return IMPL_KEYS.has(impl) && isRate(o.rate) && isPositive(o.rows)
    case 'mount':
      return (IMPL_KEYS.has(impl) || INPUT_KEYS.has(impl)) && isPositive(o.count) && isPositive(o.passes)
    case 'type':
      return INPUT_KEYS.has(impl) && typeof o.keys === 'string' && o.keys.length > 0 && isPositive(o.rate)
    case 'focus':
      return INPUT_KEYS.has(impl) && isPositive(o.runs)
    case 'leak':
      return (IMPL_KEYS.has(impl) || INPUT_KEYS.has(impl)) && isPositive(o.count) && isPositive(o.cycles)
    case 'leaklist':
      return IMPL_KEYS.has(impl) && isPositive(o.rows) && isRate(o.rate) && isPositive(o.seconds)
    case 'footprint':
      return (IMPL_KEYS.has(impl) || INPUT_KEYS.has(impl)) && isPositive(o.count)
    default:
      return false
  }
}

/** The plan the app was launched with (see scripts/bench/run.mjs), or null. */
export function parsePlan(json: string): Plan | null {
  if (!json) return null
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    const scenarios = Array.isArray(raw.scenarios) ? raw.scenarios.filter(isScenario) : []
    if (scenarios.length === 0) return null
    return {
      label: typeof raw.label === 'string' ? raw.label : 'plan',
      seconds: num(raw.seconds, DEFAULT_SECONDS),
      warmup: num(raw.warmup, DEFAULT_WARMUP),
      settle: num(raw.settle, DEFAULT_SETTLE),
      scenarios,
    }
  } catch {
    return null
  }
}

const withDefaults = (label: string, scenarios: Scenario[]): Plan => ({
  label,
  seconds: DEFAULT_SECONDS,
  warmup: DEFAULT_WARMUP,
  settle: DEFAULT_SETTLE,
  scenarios,
})

export function singlePlan(scenario: Scenario): Plan {
  return withDefaults('single', [scenario])
}

/**
 * The order the implementations run in within a round: a light one, a heavy
 * one, a light one… so the chip cools during the light scenarios instead of
 * the plan idling. Mirrored in scripts/bench/run.mjs.
 */
export const RUN_ORDER: ImplKey[] = [
  'text',
  'nf-view',
  'nitro-prop',
  'nf-skia',
  'nitro-jump',
  'bloom',
  'nitro-numeric',
  'atext',
  'ticker',
  'rnna',
  'nf-skia-sv',
  'anim-numbers',
  'arn',
]

/**
 * The matrix BENCHMARKS.md is built from: every implementation at 24 copies
 * every frame (three rounds, so the headline row is a median), one copy every
 * frame, and 24 copies at ten a second. The light rounds sit between the
 * heavy ones, and within a round light and heavy libraries alternate, so no
 * library runs on a hotter chip than its neighbours.
 */
export function fullPlan(impls: ImplKey[] = RUN_ORDER): Plan {
  const rounds: [Count, Rate][] = [
    [24, 'frame'],
    [1, 'frame'],
    [24, 'frame'],
    [24, 10],
    [24, 'frame'],
  ]
  const ordered = RUN_ORDER.filter((k) => impls.includes(k))
  const scenarios: Scenario[] = []
  for (const [count, rate] of rounds) for (const impl of ordered) scenarios.push({ impl, rate, count })
  return withDefaults('full', scenarios)
}

/** react-native-advanced-input-mask does not build against React Native 0.87's prebuilt core on iOS (see example/react-native.config.js). */
const INPUTS_HERE = INPUT_IMPLS.filter((i) => !(Platform.OS === 'ios' && i.key === 'advanced-mask'))

/** Every field typed into at a brisk and a fast pace, then its focus latency. */
export function inputPlan(): Plan {
  const scenarios: Scenario[] = []
  for (const rate of [8, 15]) for (const i of INPUTS_HERE) scenarios.push({ kind: 'type', impl: i.key, keys: i.keys, rate })
  for (const i of INPUTS_HERE) scenarios.push({ kind: 'focus', impl: i.key, runs: 8 })
  return withDefaults('inputs', scenarios)
}

/** 24 numbers and 20 fields mounted cold and unmounted, ten times each. */
export function mountPlan(): Plan {
  const scenarios: Scenario[] = []
  for (const impl of RUN_ORDER) scenarios.push({ kind: 'mount', impl, count: 24, passes: 10 })
  for (const i of INPUTS_HERE) scenarios.push({ kind: 'mount', impl: i.key, count: 20, passes: 10 })
  return withDefaults('mount', scenarios)
}

/** A market list: 200 rows scrolling while ten values a second arrive. */
export function listPlan(): Plan {
  return withDefaults(
    'list',
    RUN_ORDER.map((impl) => ({ kind: 'list', impl, rows: 200, rate: 10 })),
  )
}

/** Memory: 24 numbers and 20 fields mounted and unmounted 40 times each, then every number in a list scrolled for 30 s. */
export function leakPlan(): Plan {
  const scenarios: Scenario[] = []
  for (const impl of RUN_ORDER) scenarios.push({ kind: 'leak', impl, count: 24, cycles: 40 })
  for (const i of INPUTS_HERE) scenarios.push({ kind: 'leak', impl: i.key, count: 20, cycles: 40 })
  for (const impl of RUN_ORDER) scenarios.push({ kind: 'leaklist', impl, rows: 200, rate: 10, seconds: 30 })
  return withDefaults('leak', scenarios)
}

/** Per-view memory: 100 numbers, 50 fields, each impl once. */
export function footprintPlan(): Plan {
  const scenarios: Scenario[] = []
  for (const impl of RUN_ORDER) scenarios.push({ kind: 'footprint', impl, count: 100 })
  for (const i of INPUTS_HERE) scenarios.push({ kind: 'footprint', impl: i.key, count: 50 })
  return withDefaults('footprint', scenarios)
}

export function rateLabel(rate: Rate) {
  return rate === 'frame' ? 'every frame' : `${rate}/s`
}

/** Rough wall time of a scenario, for the plan's time estimate. */
export function scenarioSeconds(plan: Plan, s: Scenario) {
  switch (kindOf(s)) {
    case 'stream':
    case 'list':
      return plan.settle + plan.warmup + plan.seconds
    case 'mount':
      return plan.settle + (s as MountScenario).passes * 2.5
    case 'type':
      return plan.settle + 1.5 + (s as TypeScenario).keys.length / (s as TypeScenario).rate + 1
    case 'focus':
      return plan.settle + (s as FocusScenario).runs * 0.6
    case 'leak':
      return plan.settle + (s as LeakScenario).cycles * 2
    case 'leaklist':
      return plan.settle + 2 + (s as LeakListScenario).seconds
    case 'footprint':
      return plan.settle + 20
  }
}

export function planSeconds(plan: Plan) {
  return plan.scenarios.reduce((sum, s) => sum + scenarioSeconds(plan, s), 0)
}

export function scenarioLabel(s: Scenario): string {
  const impl = IMPLS.find((i) => i.key === s.impl)?.short ?? INPUT_IMPLS.find((i) => i.key === s.impl)?.short ?? s.impl
  switch (kindOf(s)) {
    case 'stream': {
      const st = s as StreamScenario
      return `${impl} ×${st.count} @${rateLabel(st.rate)}`
    }
    case 'list': {
      const l = s as ListScenario
      return `${impl} list of ${l.rows} @${rateLabel(l.rate)}`
    }
    case 'mount': {
      const m = s as MountScenario
      return `mount ${m.count} × ${impl}`
    }
    case 'type': {
      const t = s as TypeScenario
      return `type ${t.keys.length} keys @${t.rate}/s into ${impl}`
    }
    case 'focus':
      return `focus ${impl}`
    case 'leak': {
      const l = s as LeakScenario
      return `memory: ${l.cycles} × mount ${l.count} × ${impl}`
    }
    case 'leaklist': {
      const l = s as LeakListScenario
      return `memory: ${impl} list of ${l.rows} for ${l.seconds} s`
    }
    case 'footprint': {
      const f = s as FootprintScenario
      return `footprint: ${f.count} × ${impl} mounted`
    }
  }
}
