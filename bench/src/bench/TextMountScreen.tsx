/**
 * Mounting 1000 labels: React Native's Text, react-native-plain-text's
 * PlainText and NitroText, measured the way react-native-plain-text measures
 * itself (docs/contributing/measuring.md there):
 *
 * - interaction: the longest PerformanceObserver `event` entry of the press
 *   that mounted them (native touch → JS → render → commit → layout →
 *   mount), which React Native holds open until the new views are mounted;
 * - commit: a User Timing measure from the press to the post-commit effect,
 *   the JS-thread slice;
 * - memory per label: the physical footprint after a forced collection,
 *   before and after the first mount of the process, over the count (later
 *   mounts reuse Fabric's pooled views and cost nothing).
 *
 * Driven by real taps (a synthetic call has no `event` entry): Clear, then a
 * variant, and read the result line.
 *
 * Launched with `{"textMount":{"rounds":6}}` it runs by itself instead, with
 * no touch and no UI-test runner attached (whose accessibility snapshots of a
 * thousand labels load the main thread): each round mounts the three
 * variants in turn and reports, per mount, the JS slice, the main thread's
 * CPU over the next second (mount, layout of the views, drawing) and its
 * longest frame, as BENCH lines.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ScrollView, Text, View } from 'react-native'
import { PlainText } from 'react-native-plain-text'
import { NitroText } from 'react-native-nitro-input'
import { cpuBetween, forceGc, report, sample, startFrames, stopFrames, type Sample } from 'bench-probe'
import type { RootStackParamList } from '../navigation'
import { Btn, Row, styles } from '../harness'

const COUNT = 1000
type Variant = 'text' | 'plain' | 'nitro'
const LABEL: Record<Variant, string> = { text: 'Text', plain: 'PlainText', nitro: 'NitroText' }
const ITEMS = Array.from({ length: COUNT }, (_, i) => `Label number ${i + 1}`)
// Every label changed at once: NitroText morphs them (the digits roll), the others re-render.
const UPDATED = Array.from({ length: COUNT }, (_, i) => `Label number ${i + 1001}`)
const style = { fontSize: 16, color: '#111827' } as const

type Result = { interaction: number; commit: number; memoryKb: number | null }

declare const performance: { now(): number }
declare const PerformanceObserver: {
  new (callback: (list: { getEntries(): { startTime: number; duration: number }[] }) => void): {
    observe(options: { type: string; durationThreshold?: number }): void
    disconnect(): void
  }
}

type Auto = { interaction: number; commit: number; mainMs: number; mainSysMs: number; faults: number; jsMs: number; maxFrame: number }
const mainSys = (s: Sample) => s.threads.find((t) => t.main)?.sysMs ?? 0
const wait = (ms: number) => new Promise<void>((r) => setTimeout(() => r(), ms))

export function TextMountScreen({ route }: NativeStackScreenProps<RootStackParamList, 'TextMount'>) {
  const rounds = route.params?.rounds
  const [variant, setVariant] = useState<Variant | null>(null)
  const [updated, setUpdated] = useState(false)
  const [results, setResults] = useState<Record<Variant, Result[]>>({ text: [], plain: [], nitro: [] })
  const events = useRef<{ start: number; duration: number }[]>([])
  const press = useRef<{ variant: Variant; start: number } | null>(null)
  const baseline = useRef<number | null>(null)
  const firstMount = useRef<Set<Variant>>(new Set())
  const [auto, setAuto] = useState<Record<Variant, Auto[]>>({ text: [], plain: [], nitro: [] })
  const committed = useRef<(() => void) | null>(null)

  // Launched with a plan: mount each variant in turn, `rounds` times, untouched.
  useEffect(() => {
    if (!rounds) return
    let cancelled = false
    const run = async () => {
      await wait(1500)
      for (let round = 0; round < rounds && !cancelled; round++) {
        // Rotated per round: each variant follows each other one's clearing.
        const order = (['nitro', 'text', 'plain'] as Variant[]).map((_, i, all) => all[(i + round) % all.length]!)
        for (const v of order) {
          // Cleared together with the update flag: the labels leave showing
          // the updated text (no morph back), so the next mount reuses views
          // whose last text differs from the one they are given.
          setVariant(null)
          setUpdated(false)
          await wait(1500)
          forceGc()
          await wait(200)
          const before = sample()
          startFrames()
          const start = performance.now()
          const layout = new Promise<void>((resolve) => (committed.current = () => resolve()))
          setVariant(v)
          await layout
          const commit = performance.now() - start
          await wait(1000)
          const frames = stopFrames()
          const after = sample()
          const cpu = before && after ? cpuBetween(before, after) : null
          const wall = before && after ? after.wallMs - before.wallMs : 0
          const r: Auto = {
            interaction: commit + (frames?.max ?? 0),
            commit,
            mainMs: cpu ? (cpu.main * wall) / 100 : 0,
            mainSysMs: before && after ? mainSys(after) - mainSys(before) : 0,
            faults: (after?.faults ?? 0) - (before?.faults ?? 0),
            jsMs: cpu ? (cpu.js * wall) / 100 : 0,
            maxFrame: frames?.max ?? 0,
          }
          report({ event: 'text-mount', variant: v, round, ...r })
          setAuto((a) => ({ ...a, [v]: [...a[v], r] }))

          // Then every label changes: for NitroText, a morph of each.
          await wait(500)
          const u0 = sample()
          startFrames()
          const uStart = performance.now()
          const uLayout = new Promise<void>((resolve) => (committed.current = () => resolve()))
          setUpdated(true)
          await uLayout
          const uCommit = performance.now() - uStart
          await wait(1200)
          const uFrames = stopFrames()
          const u1 = sample()
          const uCpu = u0 && u1 ? cpuBetween(u0, u1) : null
          const uWall = u0 && u1 ? u1.wallMs - u0.wallMs : 0
          report({
            event: 'text-update',
            variant: v,
            round,
            commit: uCommit,
            mainMs: uCpu ? (uCpu.main * uWall) / 100 : 0,
            jsMs: uCpu ? (uCpu.js * uWall) / 100 : 0,
            renderMs: uCpu ? (uCpu.render * uWall) / 100 : 0,
            maxFrame: uFrames?.max ?? 0,
            dropped: uFrames?.dropped ?? 0,
          })

        }
      }
      setVariant(null)
      report({ event: 'done' })
    }
    run()
    return () => {
      cancelled = true
    }
  }, [rounds])

  useEffect(() => {
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) events.current.push({ start: e.startTime, duration: e.duration })
    })
    observer.observe({ type: 'event', durationThreshold: 0 })
    return () => observer.disconnect()
  }, [])

  // After the commit that mounted the labels: the JS-thread slice, then the settled numbers.
  useLayoutEffect(() => {
    if (variant && committed.current) {
      committed.current()
      committed.current = null
    }
  }, [variant, updated])

  useLayoutEffect(() => {
    const current = press.current
    if (!current || variant !== current.variant) return
    const commit = performance.now() - current.start
    const first = !firstMount.current.has(current.variant)
    firstMount.current.add(current.variant)
    setTimeout(() => {
      const near = events.current.filter((e) => Math.abs(e.start - current.start) < 1000)
      const interaction = near.reduce((max, e) => Math.max(max, e.duration), 0)
      let memoryKb: number | null = null
      if (first && baseline.current !== null) {
        forceGc()
        const after = sample()?.rssMb
        if (after !== undefined) memoryKb = ((after - baseline.current) * 1024) / COUNT
      }
      events.current = []
      press.current = null
      setResults((r) => ({ ...r, [current.variant]: [...r[current.variant], { interaction, commit, memoryKb }] }))
    }, 1500)
  }, [variant])

  const mount = (next: Variant) => {
    events.current = []
    press.current = { variant: next, start: performance.now() }
    setVariant(next)
  }

  const clear = () => {
    setVariant(null)
    setTimeout(() => {
      forceGc()
      baseline.current = sample()?.rssMb ?? null
    }, 300)
  }

  const line = (v: Variant) => {
    const runs = results[v]
    if (runs.length === 0) return `${LABEL[v]}: –`
    const mean = (f: (r: Result) => number) => runs.reduce((s, r) => s + f(r), 0) / runs.length
    const memory = runs.find((r) => r.memoryKb !== null)?.memoryKb
    return `${LABEL[v]}: n=${runs.length} interaction ${mean((r) => r.interaction).toFixed(1)} ms · commit ${mean((r) => r.commit).toFixed(1)} ms · ` +
      `first ${runs[0]!.interaction.toFixed(1)} ms${memory != null ? ` · ${memory.toFixed(2)} KB/label` : ''} [${runs.map((r) => r.interaction.toFixed(0)).join(',')}]`
  }

  const autoLine = (v: Variant) => {
    // The first round creates the views; the rest reuse Fabric's pooled ones.
    const warm = auto[v].slice(1)
    if (warm.length === 0) return `${LABEL[v]}: ${auto[v].length ? 'cold only' : '–'}`
    const median = (f: (r: Auto) => number) => {
      const xs = warm.map(f).sort((a, b) => a - b)
      return xs[Math.floor(xs.length / 2)]!
    }
    const first = auto[v][0]!
    return `${LABEL[v]}: warm n=${warm.length} commit ${median((r) => r.commit).toFixed(1)} · main CPU ${median((r) => r.mainMs).toFixed(1)} · ` +
      `longest frame ${median((r) => r.maxFrame).toFixed(1)} · JS CPU ${median((r) => r.jsMs).toFixed(1)} ms | cold commit ${first.commit.toFixed(0)} main ${first.mainMs.toFixed(0)}`
  }

  return (
    <View style={styles.screen}>
      <View style={{ padding: 12, gap: 8 }}>
        <Row>
          <Btn testID="text-clear" title="Clear" onPress={clear} />
          <Btn testID="text-text" title="Text" onPress={() => mount('text')} />
          <Btn testID="text-plain" title="PlainText" onPress={() => mount('plain')} />
          <Btn testID="text-nitro" title="NitroText" onPress={() => mount('nitro')} />
        </Row>
        {(['text', 'plain', 'nitro'] as Variant[]).map((v) => (
          <Text key={v} testID={`text-result-${v}`} style={styles.cardHint}>
            {rounds ? autoLine(v) : line(v)}
          </Text>
        ))}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
        {variant === 'text' && (updated ? UPDATED : ITEMS).map((t, i) => <Text key={i} style={style}>{t}</Text>)}
        {variant === 'plain' && (updated ? UPDATED : ITEMS).map((t, i) => <PlainText key={i} style={style}>{t}</PlainText>)}
        {variant === 'nitro' && (updated ? UPDATED : ITEMS).map((t, i) => <NitroText key={i} fontSize={16} color="#111827">{t}</NitroText>)}
      </ScrollView>
    </View>
  )
}
