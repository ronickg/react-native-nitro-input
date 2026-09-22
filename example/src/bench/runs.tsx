import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import type { RollingNumberHandle } from 'react-native-nitro-rolling-number'
import { BENCH_START, BenchItem, IMPLS, ImplBoundary, type ImplKey } from './impls'
import { INPUT_IMPLS, InputItem, type InputHandle, type InputImplKey } from './inputs'
import { cpuBetween, forceGc, sample, thermalState, typeText, type Sample, type TypeStats } from './probe'
import type { FocusScenario, FootprintScenario, LeakListScenario, LeakScenario, ListScenario, MountScenario, Rate, TypeScenario } from './plan'
import { benchValue } from './impls'
import { quantile, useBenchValue, useMeasuredStream, type StreamStats } from './runner'

declare const performance: { now(): number }

const isRolling = (impl: string): impl is ImplKey => IMPLS.some((i) => i.key === impl)
export const implShort = (impl: string) => IMPLS.find((i) => i.key === impl)?.short ?? INPUT_IMPLS.find((i) => i.key === impl)?.short ?? impl

const median = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5)
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Main- and JS-thread CPU milliseconds between two samples. */
function cpuMs(a: Sample | null, b: Sample | null) {
  if (!a || !b) return { main: null, js: null }
  const wall = b.wallMs - a.wallMs
  const c = cpuBetween(a, b)
  return { main: (c.main / 100) * wall, js: (c.js / 100) * wall }
}

// ---------------------------------------------------------------------------
// A scrolling list
// ---------------------------------------------------------------------------

export type ListResult = StreamStats & { kind: 'list'; impl: ImplKey; rate: Rate; rows: number }

const ROW_HEIGHT = 44
const LIST_HEIGHT = 420
const LIST_FONT = 22
/** The list scrolls a full screen's worth back and forth every second and a half. */
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
/** Two full scroll periods: the list has mounted every row it will and warmed its caches. */
const LIST_WARMUP_SECONDS = 6
const SCROLL_PERIOD = 3

/**
 * A market list: `rows` numbers in a FlatList, the same value stream into
 * every row, the list scrolled back and forth under the finger's stand-in.
 */
export function ListRun({
  scenario,
  seconds,
  warmup,
  running,
  onMeasureStart,
  onDone,
}: {
  scenario: ListScenario
  seconds: number
  warmup: number
  running: boolean
  onMeasureStart?: () => void
  onDone: (result: ListResult) => void
}) {
  const { impl, rate, rows } = scenario
  const { value, setValue, fmt, sv, font } = useBenchValue(LIST_FONT)
  const nitroRefs = useRef(new Map<number, RollingNumberHandle | null>())
  const listRef = useRef<FlatList<number>>(null)
  const errorRef = useRef<string | null>(null)
  const range = Math.max(0, rows * ROW_HEIGHT - LIST_HEIGHT)

  useMeasuredStream({
    running,
    rate,
    warmup,
    seconds,
    errorRef,
    onMeasureStart,
    onFrame: (elapsed) => {
      const offset = (range * (1 - Math.cos((2 * Math.PI * elapsed) / SCROLL_PERIOD))) / 2
      listRef.current?.scrollToOffset({ offset, animated: false })
    },
    push: (v) => {
      if (impl === 'nitro-jump') nitroRefs.current.forEach((r) => r?.jumpTo(v))
      else if (impl === 'nf-skia-sv' || impl === 'atext') sv.value = fmt.format(v)
      else setValue(v)
    },
    onDone: (stats) => onDone({ kind: 'list', impl, rate, rows, ...stats }),
  })

  const data = React.useMemo(() => Array.from({ length: rows }, (_, i) => i), [rows])
  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      data={data}
      keyExtractor={(i) => String(i)}
      getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
      scrollEnabled={false}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{`Row ${item + 1}`}</Text>
          <ImplBoundary
            onError={(e) => {
              errorRef.current = e.message || String(e)
            }}
          >
            <BenchItem
              impl={impl}
              value={value + item}
              fontSize={LIST_FONT}
              fmt={fmt}
              sv={sv}
              font={font}
              nitroRef={(h) => {
                nitroRefs.current.set(item, h)
              }}
            />
          </ImplBoundary>
        </View>
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Mount and unmount
// ---------------------------------------------------------------------------

export type MountResult = {
  kind: 'mount'
  impl: ImplKey | InputImplKey
  count: number
  passes: number
  /** Wall time from the state update that mounts `count` copies to the last one's layout. */
  mountMs: { p50: number; min: number; max: number }
  /** Wall time from the state update that unmounts them to the second frame after. */
  unmountMs: { p50: number; max: number }
  /** Main- and JS-thread CPU per pass, ms. */
  mountMainMs: number | null
  mountJsMs: number | null
  unmountMainMs: number | null
  /** Resident memory with the copies mounted minus without, MB (last pass). */
  rssDeltaMb: number | null
  thermal: string
  error?: string
}

/**
 * `count` copies mounted cold and unmounted again, `passes` times: the wall
 * time to the last layout and to the frame after the unmount, plus the CPU
 * each cost, medians over the passes.
 */
export function MountRun({ scenario, running, onDone }: { scenario: MountScenario; running: boolean; onDone: (r: MountResult) => void }) {
  const { impl, count, passes } = scenario
  const [mounted, setMounted] = useState(false)
  const { fmt, sv, font } = useBenchValue(LIST_FONT)
  // Which copies have laid out at least once: a copy whose intrinsic size comes
  // back from native lays out twice, so counting calls would end the pass early.
  const laidOut = useRef(new Set<number>())
  const resolveLayout = useRef<(() => void) | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const errorRef = useRef<string | null>(null)

  const onItemLayout = useCallback(
    (index: number) => {
      laidOut.current.add(index)
      if (laidOut.current.size >= count) resolveLayout.current?.()
    },
    [count],
  )

  useEffect(() => {
    if (!running) return
    let cancelled = false
    ;(async () => {
      const mountMs: number[] = []
      const unmountMs: number[] = []
      const mountMain: number[] = []
      const mountJs: number[] = []
      const unmountMain: number[] = []
      let rssDelta: number | null = null
      const thermal = thermalState()
      for (let pass = 0; pass < passes && !cancelled; pass++) {
        await nextFrame()
        const before = sample()
        laidOut.current.clear()
        const t0 = performance.now()
        const laid = new Promise<void>((resolve) => {
          resolveLayout.current = resolve
          setTimeout(resolve, 5000)
        })
        setMounted(true)
        await laid
        resolveLayout.current = null
        const t1 = performance.now()
        await nextFrame()
        const afterMount = sample()
        if (errorRef.current) break
        mountMs.push(t1 - t0)
        const m = cpuMs(before, afterMount)
        if (m.main != null) mountMain.push(m.main)
        if (m.js != null) mountJs.push(m.js)
        if (before && afterMount) rssDelta = afterMount.rssMb - before.rssMb
        await wait(120)
        const beforeUnmount = sample()
        const t2 = performance.now()
        setMounted(false)
        await nextFrame()
        await nextFrame()
        const t3 = performance.now()
        const afterUnmount = sample()
        unmountMs.push(t3 - t2)
        const u = cpuMs(beforeUnmount, afterUnmount)
        if (u.main != null) unmountMain.push(u.main)
        await wait(120)
      }
      if (cancelled) return
      const sortedMount = [...mountMs].sort((a, b) => a - b)
      const sortedUnmount = [...unmountMs].sort((a, b) => a - b)
      onDoneRef.current({
        kind: 'mount',
        impl,
        count,
        passes: mountMs.length,
        mountMs: { p50: median(mountMs), min: sortedMount[0] ?? 0, max: sortedMount[sortedMount.length - 1] ?? 0 },
        unmountMs: { p50: median(unmountMs), max: sortedUnmount[sortedUnmount.length - 1] ?? 0 },
        mountMainMs: mountMain.length ? median(mountMain) : null,
        mountJsMs: mountJs.length ? median(mountJs) : null,
        unmountMainMs: unmountMain.length ? median(unmountMain) : null,
        rssDeltaMb: rssDelta,
        thermal,
        ...(errorRef.current ? { error: errorRef.current } : {}),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [running, impl, count, passes])

  return (
    <View style={styles.mountBox}>
      {mounted
        ? Array.from({ length: count }, (_, i) => (
            <View key={i} onLayout={() => onItemLayout(i)} style={styles.mountItem}>
              <ImplBoundary
                onError={(e) => {
                  errorRef.current = e.message || String(e)
                  resolveLayout.current?.()
                }}
              >
                {isRolling(impl) ? (
                  <BenchItem impl={impl} value={BENCH_START + i} fontSize={LIST_FONT} fmt={fmt} sv={sv} font={font} nitroRef={() => {}} />
                ) : (
                  <InputItem impl={impl} />
                )}
              </ImplBoundary>
            </View>
          ))
        : null}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

export type TypeResult = {
  kind: 'type'
  impl: InputImplKey
  rate: number
  keys: number
  typed: number
  seconds: number
  /** Keys a second the driver managed (it waits for a key to settle before the next). */
  achievedRate: number
  /** Frames after a key's own frame that changed the field's text again: the flicker of a JS round trip. */
  rewrites: { p50: number; max: number; keysWithRewrites: number }
  /** Milliseconds from the key to the last time its text changed. */
  settledMs: { p50: number; p95: number; max: number }
  /** Main- and JS-thread CPU per key, ms, over the whole typing window (Android accounts thread time in 10 ms ticks, so per-key deltas are too coarse). */
  mainMsPerKey: number | null
  jsMsPerKey: number | null
  /** Change callbacks JS received per key. */
  changeEventsPerKey: number
  frames: number
  dropped: number
  thermal: string
  error?: string
}

/** A field focused and typed into by the native driver, at `rate` keys a second. */
export function TypeRun({ scenario, running, onDone }: { scenario: TypeScenario; running: boolean; onDone: (r: TypeResult) => void }) {
  const { impl, keys, rate } = scenario
  const ref = useRef<InputHandle>(null)
  const focused = useRef<(() => void) | null>(null)
  const changes = useRef(0)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const errorRef = useRef<string | null>(null)

  useEffect(() => {
    if (!running) return
    let cancelled = false
    ;(async () => {
      const thermal = thermalState()
      await nextFrame()
      const gotFocus = new Promise<void>((resolve) => {
        focused.current = resolve
        setTimeout(resolve, 1500)
      })
      ref.current?.focus()
      await gotFocus
      focused.current = null
      // The keyboard's own arrival is not the field's cost.
      await wait(600)
      if (cancelled) return
      changes.current = 0
      const before = sample()
      const stats: TypeStats | null = await typeText(keys, rate)
      const after = sample()
      if (cancelled) return
      ref.current?.blur()
      const perKey = stats?.keys ?? []
      const rewrites = perKey.map((k) => k.rewrites)
      const settled = perKey.map((k) => k.settledMs).sort((a, b) => a - b)
      const cpu = cpuMs(before, after)
      const typed = stats?.typed ?? 0
      onDoneRef.current({
        kind: 'type',
        impl,
        rate,
        keys: keys.length,
        typed,
        seconds: stats?.seconds ?? 0,
        achievedRate: stats && stats.seconds > 0 ? typed / stats.seconds : 0,
        rewrites: { p50: median(rewrites), max: Math.max(0, ...rewrites), keysWithRewrites: rewrites.filter((r) => r > 0).length },
        settledMs: { p50: quantile(settled, 0.5), p95: quantile(settled, 0.95), max: settled[settled.length - 1] ?? 0 },
        mainMsPerKey: cpu.main != null && typed > 0 ? cpu.main / typed : null,
        jsMsPerKey: cpu.js != null && typed > 0 ? cpu.js / typed : null,
        changeEventsPerKey: typed > 0 ? changes.current / typed : 0,
        frames: stats?.frames ?? 0,
        dropped: stats?.dropped ?? 0,
        thermal,
        ...(stats?.error || errorRef.current || !stats ? { error: stats?.error ?? errorRef.current ?? 'no probe' } : {}),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [running, impl, keys, rate])

  return (
    <View style={styles.typeBox}>
      <ImplBoundary
        onError={(e) => {
          errorRef.current = e.message || String(e)
        }}
      >
        <InputItem
          ref={ref}
          impl={impl}
          onChangeText={() => {
            changes.current += 1
          }}
          onFocus={() => focused.current?.()}
        />
      </ImplBoundary>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Focus latency
// ---------------------------------------------------------------------------

export type FocusResult = {
  kind: 'focus'
  impl: InputImplKey
  runs: number
  /** focus() to onFocus, ms; the first run pays for the keyboard appearing. */
  first: number
  ms: { p50: number; p95: number; max: number }
  error?: string
}

export function FocusRun({ scenario, running, onDone }: { scenario: FocusScenario; running: boolean; onDone: (r: FocusResult) => void }) {
  const { impl, runs } = scenario
  const ref = useRef<InputHandle>(null)
  const resolveFocus = useRef<((ms: number) => void) | null>(null)
  const t0 = useRef(0)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    if (!running) return
    let cancelled = false
    ;(async () => {
      const samples: number[] = []
      await nextFrame()
      for (let i = 0; i < runs && !cancelled; i++) {
        const ms = await new Promise<number>((resolve) => {
          resolveFocus.current = resolve
          t0.current = performance.now()
          ref.current?.focus()
          setTimeout(() => resolve(NaN), 2000)
        })
        resolveFocus.current = null
        if (!Number.isNaN(ms)) samples.push(ms)
        ref.current?.blur()
        await wait(350)
      }
      if (cancelled) return
      const sorted = [...samples].sort((a, b) => a - b)
      onDoneRef.current({
        kind: 'focus',
        impl,
        runs: samples.length,
        first: samples[0] ?? 0,
        ms: { p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), max: sorted[sorted.length - 1] ?? 0 },
        ...(samples.length === 0 ? { error: 'onFocus never fired' } : {}),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [running, impl, runs])

  return (
    <View style={styles.typeBox}>
      <InputItem ref={ref} impl={impl} onFocus={() => resolveFocus.current?.(performance.now() - t0.current)} />
    </View>
  )
}

const styles = StyleSheet.create({
  list: { height: LIST_HEIGHT },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  rowLabel: { fontSize: 14, color: '#666' },
  mountBox: { minHeight: 200 },
  mountItem: { marginBottom: 4 },
  typeBox: { paddingVertical: 8 },
})


// ---------------------------------------------------------------------------
// Memory: mount/unmount cycles, and a long scrolling list
// ---------------------------------------------------------------------------

export type MemorySample = { at: number; rssMb: number; nativeHeapMb?: number }

/** Least-squares slope of resident memory over `x` (cycles or seconds), in KB per unit. */
function slopeKb(samples: { x: number; rssMb: number }[]) {
  if (samples.length < 3) return null
  const n = samples.length
  const mx = samples.reduce((a, s) => a + s.x, 0) / n
  const my = samples.reduce((a, s) => a + s.rssMb, 0) / n
  let num = 0
  let den = 0
  for (const s of samples) {
    num += (s.x - mx) * (s.rssMb - my)
    den += (s.x - mx) ** 2
  }
  return den > 0 ? (num / den) * 1024 : null
}

const quarterMin = (samples: { x: number; rssMb: number }[], which: 'first' | 'last') => {
  if (!samples.length) return null
  const xs = samples.map((s) => s.x)
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  const span = hi - lo
  const part = samples.filter((s) => (which === 'first' ? s.x <= lo + span / 4 : s.x >= hi - span / 4))
  return part.length ? Math.min(...part.map((s) => s.rssMb)) : null
}

export type LeakResult = {
  kind: 'leak'
  impl: ImplKey | InputImplKey
  count: number
  cycles: number
  seconds: number
  samples: MemorySample[]
  /** The lowest resident size in the first and the last quarter of the cycles: a leak lifts the floor. */
  rssFirstMb: number | null
  rssLastMb: number | null
  rssMaxMb: number | null
  /** Least-squares slope of resident memory over the cycles, KB per cycle. */
  growthKbPerCycle: number | null
  /** malloc / native-heap bytes in use after a forced collection, first and last (see the probe's `forceGc`). */
  nativeHeapFirstMb: number | null
  nativeHeapLastMb: number | null
  thermal: string
  error?: string
}

/**
 * `count` copies mounted and unmounted `cycles` times, resident memory
 * sampled every few cycles. The garbage collector makes the number swing;
 * a leak is a floor that keeps rising.
 */
export function LeakRun({ scenario, running, onDone }: { scenario: LeakScenario; running: boolean; onDone: (r: LeakResult) => void }) {
  const { impl, count, cycles } = scenario
  const [mounted, setMounted] = useState(false)
  const { fmt, sv, font } = useBenchValue(LIST_FONT)
  const laidOut = useRef(new Set<number>())
  const resolveLayout = useRef<(() => void) | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const errorRef = useRef<string | null>(null)

  const onItemLayout = useCallback(
    (index: number) => {
      laidOut.current.add(index)
      if (laidOut.current.size >= count) resolveLayout.current?.()
    },
    [count],
  )

  useEffect(() => {
    if (!running) return
    let cancelled = false
    ;(async () => {
      const thermal = thermalState()
      const samples: { x: number; rssMb: number; nativeHeapMb?: number }[] = []
      const t0 = performance.now()
      const take = (cycle: number) => {
        const s = sample()
        if (s) samples.push({ x: cycle, rssMb: s.rssMb, nativeHeapMb: s.nativeHeapMb })
      }
      // The host samples the process (dumpsys on Android) at the start event,
      // which was just reported: collect first, then give it a moment, so both
      // sides see the same floor with nothing of ours mounted.
      forceGc()
      await pause(1200)
      take(0)
      for (let cycle = 1; cycle <= cycles && !cancelled; cycle++) {
        laidOut.current.clear()
        const laid = new Promise<void>((resolve) => {
          resolveLayout.current = resolve
          setTimeout(resolve, 3000)
        })
        setMounted(true)
        await laid
        resolveLayout.current = null
        await nextFrame()
        setMounted(false)
        await nextFrame()
        await nextFrame()
        if (errorRef.current) break
        if (cycle % 4 === 0) take(cycle)
      }
      if (cancelled) return
      // The end floor: everything unmounted, collected, and finalized, so a
      // view that is merely waiting for the collector does not count as leaked.
      forceGc()
      take(cycles)
      const plain = samples.map((s) => ({ at: s.x, rssMb: s.rssMb, nativeHeapMb: s.nativeHeapMb }))
      const heap = samples.filter((s) => s.nativeHeapMb != null)
      onDoneRef.current({
        kind: 'leak',
        impl,
        count,
        cycles,
        seconds: (performance.now() - t0) / 1000,
        samples: plain,
        rssFirstMb: samples.length ? samples[0].rssMb : null,
        rssLastMb: samples.length ? samples[samples.length - 1].rssMb : null,
        rssMaxMb: samples.length ? Math.max(...samples.map((s) => s.rssMb)) : null,
        growthKbPerCycle: slopeKb(samples),
        nativeHeapFirstMb: heap.length ? heap[0].nativeHeapMb! : null,
        nativeHeapLastMb: heap.length ? heap[heap.length - 1].nativeHeapMb! : null,
        thermal,
        ...(errorRef.current ? { error: errorRef.current } : {}),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [running, impl, count, cycles])

  return (
    <View style={styles.mountBox}>
      {mounted
        ? Array.from({ length: count }, (_, i) => (
            <View key={i} onLayout={() => onItemLayout(i)} style={styles.mountItem}>
              <ImplBoundary
                onError={(e) => {
                  errorRef.current = e.message || String(e)
                  resolveLayout.current?.()
                }}
              >
                {isRolling(impl) ? (
                  <BenchItem impl={impl} value={BENCH_START + i} fontSize={LIST_FONT} fmt={fmt} sv={sv} font={font} nitroRef={() => {}} />
                ) : (
                  <InputItem impl={impl} />
                )}
              </ImplBoundary>
            </View>
          ))
        : null}
    </View>
  )
}

export type LeakListResult = {
  kind: 'leaklist'
  impl: ImplKey
  rows: number
  rate: Rate
  seconds: number
  samples: MemorySample[]
  rssFirstMb: number | null
  rssLastMb: number | null
  rssMaxMb: number | null
  /** Least-squares slope of resident memory over the run after the warm-up, KB per second. */
  growthKbPerSecond: number | null
  /** Seconds skipped at the start: a 200-row list mounting and its caches warming are not a leak. */
  warmupSeconds: number
  nativeHeapFirstMb: number | null
  nativeHeapLastMb: number | null
  thermal: string
  error?: string
}

/**
 * The list scenario kept going for `seconds`, with resident memory sampled
 * every second: rows mount and unmount as they scroll, and Fabric recycles
 * their views, so anything a row keeps alive shows here.
 */
export function LeakListRun({ scenario, running, onDone }: { scenario: LeakListScenario; running: boolean; onDone: (r: LeakListResult) => void }) {
  const { impl, rows, rate, seconds } = scenario
  const { value, setValue, fmt, sv, font } = useBenchValue(LIST_FONT)
  const nitroRefs = useRef(new Map<number, RollingNumberHandle | null>())
  const listRef = useRef<FlatList<number>>(null)
  const errorRef = useRef<string | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const range = Math.max(0, rows * ROW_HEIGHT - LIST_HEIGHT)

  useEffect(() => {
    if (!running) return
    const thermal = thermalState()
    const interval = rate === 'frame' ? 0 : 1000 / rate
    const samples: { x: number; rssMb: number; nativeHeapMb?: number }[] = []
    let cancelled = false
    let frame = 0
    let start = 0
    let lastPush = -Infinity
    let lastSample = -Infinity
    const finish = (now: number) => {
      // The end floor: the list still mounted but collected and finalized, so
      // what is left is what rows that scrolled out kept alive.
      forceGc()
      const last = sample()
      const elapsed = (now - start) / 1000
      if (last) samples.push({ x: elapsed, rssMb: last.rssMb, nativeHeapMb: last.nativeHeapMb })
      const measured = samples.filter((s) => s.x >= LIST_WARMUP_SECONDS)
      const heap = measured.filter((s) => s.nativeHeapMb != null)
      onDoneRef.current({
        kind: 'leaklist',
        impl,
        rows,
        rate,
        seconds: elapsed,
        samples: samples.map((s) => ({ at: s.x, rssMb: s.rssMb, nativeHeapMb: s.nativeHeapMb })),
        rssFirstMb: quarterMin(measured, 'first'),
        rssLastMb: measured.length ? measured[measured.length - 1].rssMb : null,
        rssMaxMb: samples.length ? Math.max(...samples.map((s) => s.rssMb)) : null,
        growthKbPerSecond: slopeKb(measured),
        warmupSeconds: LIST_WARMUP_SECONDS,
        nativeHeapFirstMb: heap.length ? heap[0].nativeHeapMb! : null,
        nativeHeapLastMb: heap.length ? heap[heap.length - 1].nativeHeapMb! : null,
        thermal,
        ...(errorRef.current ? { error: errorRef.current } : {}),
      })
    }
    const loop = () => {
      if (cancelled) return
      const now = performance.now()
      if (!start) start = now
      const elapsed = (now - start) / 1000
      if (errorRef.current || elapsed >= seconds) {
        finish(now)
        return
      }
      if (now - lastSample >= 1000) {
        lastSample = now
        const s = sample()
        if (s) samples.push({ x: elapsed, rssMb: s.rssMb, nativeHeapMb: s.nativeHeapMb })
      }
      const offset = (range * (1 - Math.cos((2 * Math.PI * elapsed) / SCROLL_PERIOD))) / 2
      listRef.current?.scrollToOffset({ offset, animated: false })
      if (interval === 0 || now - lastPush >= interval - 1) {
        lastPush = now
        const v = benchValue(elapsed)
        if (impl === 'nitro-jump') nitroRefs.current.forEach((r) => r?.jumpTo(v))
        else if (impl === 'nf-skia-sv' || impl === 'atext') sv.value = fmt.format(v)
        else setValue(v)
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [running, impl, rows, rate, seconds, fmt, sv, range, setValue])

  const data = React.useMemo(() => Array.from({ length: rows }, (_, i) => i), [rows])
  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      data={data}
      keyExtractor={(i) => String(i)}
      getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
      scrollEnabled={false}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{`Row ${item + 1}`}</Text>
          <ImplBoundary
            onError={(e) => {
              errorRef.current = e.message || String(e)
            }}
          >
            <BenchItem
              impl={impl}
              value={value + item}
              fontSize={LIST_FONT}
              fmt={fmt}
              sv={sv}
              font={font}
              nitroRef={(h) => {
                nitroRefs.current.set(item, h)
              }}
            />
          </ImplBoundary>
        </View>
      )}
    />
  )
}

export type FootprintResult = {
  kind: 'footprint'
  impl: ImplKey | InputImplKey
  count: number
  /** Memory with `count` copies mounted minus memory before, per copy, after a forced collection each time. */
  perViewFootprintKb: number | null
  perViewNativeKb: number | null
  perViewJavaKb: number | null
  /** The same delta after unmounting: what the copies left behind, per copy. */
  leftFootprintKb: number | null
  leftNativeKb: number | null
  seconds: number
  thermal: string
  error?: string
}

/**
 * What one mounted copy costs: `count` of them mounted at once, memory read
 * after a forced collection before, with them on screen, and after they are
 * gone. The number behind a Nitro hybrid's `memorySize`.
 */
export function FootprintRun({ scenario, running, onDone }: { scenario: FootprintScenario; running: boolean; onDone: (r: FootprintResult) => void }) {
  const { impl, count } = scenario
  const [mounted, setMounted] = useState(false)
  const { fmt, sv, font } = useBenchValue(LIST_FONT)
  const laidOut = useRef(new Set<number>())
  const resolveLayout = useRef<(() => void) | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const errorRef = useRef<string | null>(null)

  const onItemLayout = useCallback(
    (index: number) => {
      laidOut.current.add(index)
      if (laidOut.current.size >= count) resolveLayout.current?.()
    },
    [count],
  )

  useEffect(() => {
    if (!running) return
    let cancelled = false
    ;(async () => {
      const thermal = thermalState()
      const t0 = performance.now()
      // A floor is a reading that stopped moving: the previous scenario's
      // views and garbage go on being freed for a while, and a delta taken
      // across that is off by tens of KB a copy. Collect, wait, read, and
      // accept only two consecutive readings within two percent of each other.
      const floor = async () => {
        let last: Sample | null = null
        for (let attempt = 0; attempt < 8; attempt++) {
          forceGc()
          await pause(600)
          const s = sample()
          if (s && last && Math.abs(s.rssMb - last.rssMb) <= 0.02 * last.rssMb && Math.abs((s.nativeHeapMb ?? 0) - (last.nativeHeapMb ?? 0)) <= 0.02 * (last.nativeHeapMb ?? 1)) return s
          last = s
        }
        return last
      }
      const before = await floor()
      laidOut.current.clear()
      const laid = new Promise<void>((resolve) => {
        resolveLayout.current = resolve
        setTimeout(resolve, 6000)
      })
      setMounted(true)
      await laid
      resolveLayout.current = null
      await nextFrame()
      await pause(800)
      const withCopies = await floor()
      setMounted(false)
      await nextFrame()
      await nextFrame()
      await pause(500)
      const after = await floor()
      if (cancelled) return
      const per = (a: number | undefined, b: number | undefined) => (a == null || b == null ? null : ((a - b) * 1024) / count)
      onDoneRef.current({
        kind: 'footprint',
        impl,
        count,
        perViewFootprintKb: per(withCopies?.rssMb, before?.rssMb),
        perViewNativeKb: per(withCopies?.nativeHeapMb, before?.nativeHeapMb),
        perViewJavaKb: per(withCopies?.javaHeapMb, before?.javaHeapMb),
        leftFootprintKb: per(after?.rssMb, before?.rssMb),
        leftNativeKb: per(after?.nativeHeapMb, before?.nativeHeapMb),
        seconds: (performance.now() - t0) / 1000,
        thermal,
        ...(errorRef.current ? { error: errorRef.current } : {}),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [running, impl, count])

  return (
    <View style={styles.mountBox}>
      {mounted
        ? Array.from({ length: count }, (_, i) => (
            <View key={i} onLayout={() => onItemLayout(i)} style={styles.mountItem}>
              <ImplBoundary
                onError={(e) => {
                  errorRef.current = e.message || String(e)
                  resolveLayout.current?.()
                }}
              >
                {isRolling(impl) ? (
                  <BenchItem impl={impl} value={BENCH_START + i} fontSize={LIST_FONT} fmt={fmt} sv={sv} font={font} nitroRef={() => {}} />
                ) : (
                  <InputItem impl={impl} />
                )}
              </ImplBoundary>
            </View>
          ))
        : null}
    </View>
  )
}
