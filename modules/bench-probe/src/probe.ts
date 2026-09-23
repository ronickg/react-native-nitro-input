import NativeBenchProbe from 'bench-probe'

export type ThreadSample = { id: number; name: string; main: boolean; cpuMs: number }
export type Sample = { wallMs: number; rssMb: number; nativeHeapMb?: number; javaHeapMb?: number; threads: ThreadSample[] }
export type FrameStats = {
  frames: number
  seconds: number
  fps: number
  /** The refresh rate the display was running at (the display link's own interval on iOS, the display mode on Android). */
  hz: number
  /** Frames the main thread missed: a gap of n intervals counts n - 1. */
  dropped: number
  /** Gaps longer than 2.5 intervals: visible hitches. */
  long: number
  p50: number
  p95: number
  p99: number
  max: number
}
export type DeviceInfo = {
  platform: string
  model: string
  name: string
  os: string
  refreshRate: number
  cpuCores: number
  lowPowerMode: boolean
  thermal: string
  debug: boolean
}

/** False in a build that predates the probe; the harness still runs, without CPU or a native frame meter. */
export const hasProbe = NativeBenchProbe != null

function parse<T>(json: string | undefined, fallback: T): T {
  try {
    return json ? (JSON.parse(json) as T) : fallback
  } catch {
    return fallback
  }
}

export function deviceInfo(): DeviceInfo | null {
  return hasProbe ? parse<DeviceInfo | null>(NativeBenchProbe!.getDeviceInfo(), null) : null
}

export function launchPlan(): string {
  return hasProbe ? NativeBenchProbe!.getLaunchPlan() : ''
}

export function thermalState(): string {
  return hasProbe ? NativeBenchProbe!.thermalState() : 'unknown'
}

export function sample(): Sample | null {
  return hasProbe ? parse<Sample | null>(NativeBenchProbe!.sample(), null) : null
}

/** Java GC + finalizers on Android, malloc pressure relief on iOS: call before a memory sample that should be a floor. */
export function forceGc() {
  NativeBenchProbe?.forceGc?.()
}

/**
 * Android: remember (weakly) every mounted view of this repo's packages; later, after a
 * forced collection, `trackedLiveCount` is how many are still alive. null where not measured (iOS).
 */
export function trackNativeViews(): number | null {
  const n = NativeBenchProbe?.trackNativeViews?.('com.margelo.nitro.')
  return n == null || n < 0 ? null : n
}
export function trackedLiveCount(): number | null {
  const n = NativeBenchProbe?.trackedLiveCount?.()
  return n == null || n < 0 ? null : n
}

export function startFrames() {
  NativeBenchProbe?.startFrames()
}

export function stopFrames(): FrameStats | null {
  return hasProbe ? parse<FrameStats | null>(NativeBenchProbe!.stopFrames(), null) : null
}

export type TypedKey = { key: string; rewrites: number; settledMs: number; cpuMs: number; text?: string }
export type TypeStats = { keys: TypedKey[]; typed: number; seconds: number; frames: number; dropped: number; error: string | null }

/** Types `text` into the focused field at `keysPerSecond`, the way real typing arrives; null without the probe. */
export async function typeText(text: string, keysPerSecond: number): Promise<TypeStats | null> {
  if (!hasProbe) return null
  return parse<TypeStats | null>(await NativeBenchProbe!.typeText(text, keysPerSecond), null)
}

/** One JSON line per event: stdout on iOS (devicectl streams it), logcat tag BENCH on Android, plus a file in the app container. */
export function report(event: Record<string, unknown>) {
  const line = JSON.stringify({ ...event, at: Date.now() })
  if (hasProbe) NativeBenchProbe!.report(line)
  else console.log('BENCH ' + line)
}

export type CpuStats = {
  /** Sum over every thread, in percent of one core (200 = two cores busy). */
  process: number
  main: number
  js: number
  render: number
  threads: { name: string; pct: number }[]
}

const JS_THREAD = /JavaScript|mqt_js|mqt_v_js/i
const RENDER_THREAD = /RenderThread/

/** Per-thread CPU between two samples, as percent of wall time. A thread born inside the window counts from zero. */
export function cpuBetween(a: Sample, b: Sample): CpuStats {
  const wall = b.wallMs - a.wallMs
  const before = new Map(a.threads.map((t) => [t.id, t]))
  let process = 0
  let main = 0
  let js = 0
  let render = 0
  const threads: { name: string; pct: number }[] = []
  for (const t of b.threads) {
    const prev = before.get(t.id)
    const cpu = t.cpuMs - (prev ? prev.cpuMs : 0)
    const pct = wall > 0 ? (cpu / wall) * 100 : 0
    process += pct
    if (t.main) main += pct
    else if (JS_THREAD.test(t.name)) js += pct
    else if (RENDER_THREAD.test(t.name)) render += pct
    threads.push({ name: t.main ? 'main' : t.name || `#${t.id}`, pct })
  }
  threads.sort((x, y) => y.pct - x.pct)
  return { process, main, js, render, threads: threads.slice(0, 8) }
}
