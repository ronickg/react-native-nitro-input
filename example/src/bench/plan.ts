import { IMPLS, type ImplKey } from './impls'

/** 'frame' pushes a new value on every JS frame; a number is pushes per second. */
export type Rate = 'frame' | number
export type Count = 1 | 8 | 24
export type Scenario = { impl: ImplKey; rate: Rate; count: Count }
export type Plan = {
  label: string
  /** Measured seconds per scenario. */
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
const COUNTS: Count[] = [1, 8, 24]

function num(v: unknown, fallback: number) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
}

function isScenario(s: unknown): s is Scenario {
  if (typeof s !== 'object' || s === null) return false
  const o = s as Record<string, unknown>
  return (
    typeof o.impl === 'string' &&
    IMPL_KEYS.has(o.impl) &&
    (o.rate === 'frame' || (typeof o.rate === 'number' && o.rate > 0)) &&
    COUNTS.includes(o.count as Count)
  )
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

export function singlePlan(scenario: Scenario): Plan {
  return { label: 'single', seconds: DEFAULT_SECONDS, warmup: DEFAULT_WARMUP, settle: DEFAULT_SETTLE, scenarios: [scenario] }
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
  return { label: 'full', seconds: DEFAULT_SECONDS, warmup: DEFAULT_WARMUP, settle: DEFAULT_SETTLE, scenarios }
}

export function rateLabel(rate: Rate) {
  return rate === 'frame' ? 'every frame' : `${rate}/s`
}

export function planSeconds(plan: Plan) {
  return plan.scenarios.length * (plan.settle + plan.warmup + plan.seconds)
}
