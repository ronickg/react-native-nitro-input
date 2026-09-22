import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRoute } from '@react-navigation/native'
import { IMPLS, type ImplKey } from './impls'
import {
  fullPlan,
  inputPlan,
  kindOf,
  leakPlan,
  listPlan,
  mountPlan,
  planSeconds,
  rateLabel,
  scenarioLabel,
  singlePlan,
  type Count,
  type Plan,
  type Rate,
  type Scenario,
} from './plan'
import { deviceInfo, hasProbe, report, thermalState } from './probe'
import { BenchRun, type BenchResult } from './runner'
import {
  FocusRun,
  LeakListRun,
  LeakRun,
  ListRun,
  MountRun,
  TypeRun,
  implShort,
  type FocusResult,
  type LeakListResult,
  type LeakResult,
  type ListResult,
  type MountResult,
  type TypeResult,
} from './runs'

export type RollingBenchParams = { plan?: Plan } | undefined

export type AnyResult = BenchResult | ListResult | MountResult | TypeResult | FocusResult | LeakResult | LeakListResult

type Phase = 'idle' | 'settling' | 'running'

/**
 * How long to wait, at most, for the chip to cool before a scenario starts,
 * by thermal state. iOS throttles at "serious", Android at "severe";
 * "fair" / "light" is elevated but not throttled, so those start at once
 * (waiting for nominal after every heavy library turned a 10-minute matrix
 * into an hour). A throttled phone polls every two seconds until it is back
 * below that, or until the cap.
 */
const THROTTLED = new Set(['serious', 'severe', 'critical', 'emergency', 'shutdown'])
const COOL_CAP_MS: Record<string, number> = {
  moderate: 60_000,
  serious: 120_000,
  severe: 120_000,
  critical: 180_000,
  emergency: 180_000,
  shutdown: 180_000,
}

const f0 = (x: number | null | undefined) => (x == null ? '–' : x.toFixed(0))
const f1 = (x: number | null | undefined) => (x == null ? '–' : x.toFixed(1))

function fmtLine(r: AnyResult) {
  if (r.error) return `${implShort(r.impl)}: failed (${r.error})`
  switch (r.kind) {
    case 'stream':
    case 'list': {
      const head = r.kind === 'stream' ? `${implShort(r.impl)} ×${r.count} @${rateLabel(r.rate)}` : `${implShort(r.impl)} list of ${r.rows} @${rateLabel(r.rate)}`
      const ui = r.ui ? `UI ${r.ui.fps.toFixed(1)} fps of ${r.ui.hz}, ${r.ui.dropped} dropped, p95 ${f0(r.ui.p95)} ms` : 'UI: no probe'
      const js = `JS ${r.js.fps.toFixed(1)} fps`
      const cpu = r.cpu ? `CPU ${f0(r.cpu.process)} % (main ${f0(r.cpu.main)}, js ${f0(r.cpu.js)}${r.cpu.render > 0 ? `, render ${f0(r.cpu.render)}` : ''})` : ''
      return `${head}: ${ui} · ${js}${cpu ? ' · ' + cpu : ''}`
    }
    case 'mount':
      return `mount ${r.count} × ${implShort(r.impl)}: ${f1(r.mountMs.p50)} ms (min ${f1(r.mountMs.min)}, max ${f1(r.mountMs.max)}), unmount ${f1(r.unmountMs.p50)} ms · main ${f1(r.mountMainMs)} ms, js ${f1(r.mountJsMs)} ms · +${f1(r.rssDeltaMb)} MB`
    case 'type':
      return `type @${r.rate}/s into ${implShort(r.impl)}: ${r.typed} keys at ${f1(r.achievedRate)}/s · rewrites ${r.rewrites.p50} (max ${r.rewrites.max}, ${r.rewrites.keysWithRewrites} keys) · settled p95 ${f0(r.settledMs.p95)} ms · main ${f1(r.mainMsPerKey)} ms/key, js ${f1(r.jsMsPerKey)} ms/key · ${r.dropped} dropped · ${f1(r.changeEventsPerKey)} events/key`
    case 'focus':
      return `focus ${implShort(r.impl)}: ${f1(r.ms.p50)} ms (p95 ${f1(r.ms.p95)}, first ${f1(r.first)})`
    case 'leak':
      return `memory, ${r.cycles} × mount ${r.count} × ${implShort(r.impl)}: RSS ${f1(r.rssFirstMb)} → ${f1(r.rssLastMb)} MB (max ${f1(r.rssMaxMb)}), ${f1(r.growthKbPerCycle)} KB/cycle`
    case 'leaklist':
      return `memory, ${implShort(r.impl)} list for ${f0(r.seconds)} s: RSS ${f1(r.rssFirstMb)} → ${f1(r.rssLastMb)} MB (max ${f1(r.rssMaxMb)}), ${f1(r.growthKbPerSecond)} KB/s`
  }
}

function Chip({ title, selected, onPress, testID }: { title: string; selected?: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.chipPressed]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{title}</Text>
    </Pressable>
  )
}

/** The scenario that is running, by kind. */
function Stage({ scenario, plan, running, onMeasureStart, onDone }: { scenario: Scenario; plan: Plan; running: boolean; onMeasureStart: () => void; onDone: (r: AnyResult) => void }) {
  switch (kindOf(scenario)) {
    case 'stream':
      return <BenchRun scenario={scenario as Extract<Scenario, { kind?: 'stream' }>} seconds={plan.seconds} warmup={plan.warmup} running={running} onMeasureStart={onMeasureStart} onDone={onDone} />
    case 'list':
      return <ListRun scenario={scenario as Extract<Scenario, { kind: 'list' }>} seconds={plan.seconds} warmup={plan.warmup} running={running} onMeasureStart={onMeasureStart} onDone={onDone} />
    case 'mount':
      return <MountRun scenario={scenario as Extract<Scenario, { kind: 'mount' }>} running={running} onDone={onDone} />
    case 'type':
      return <TypeRun scenario={scenario as Extract<Scenario, { kind: 'type' }>} running={running} onDone={onDone} />
    case 'focus':
      return <FocusRun scenario={scenario as Extract<Scenario, { kind: 'focus' }>} running={running} onDone={onDone} />
    case 'leak':
      return <LeakRun scenario={scenario as Extract<Scenario, { kind: 'leak' }>} running={running} onDone={onDone} />
    case 'leaklist':
      return <LeakListRun scenario={scenario as Extract<Scenario, { kind: 'leaklist' }>} running={running} onDone={onDone} />
  }
}

/**
 * The benchmark screen: pick an implementation, a rate and a copy count and
 * run it, or run a whole plan (the value-stream matrix, the inputs, mount and
 * unmount, the scrolling list). Launched with a plan (see
 * scripts/bench/run.mjs) it runs the plan on its own and streams every result
 * through the probe.
 */
export function RollingBenchScreen() {
  const route = useRoute()
  const launched = (route.params as RollingBenchParams)?.plan ?? null
  const device = useMemo(() => deviceInfo(), [])

  const [impl, setImpl] = useState<ImplKey>('nitro-prop')
  const [rate, setRate] = useState<Rate>('frame')
  const [count, setCount] = useState<Count>(24)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [results, setResults] = useState<AnyResult[]>([])
  const [cooling, setCooling] = useState('')

  const startPlan = useCallback(
    (p: Plan) => {
      report({ event: 'plan', label: p.label, scenarios: p.scenarios.length, seconds: p.seconds, warmup: p.warmup, settle: p.settle, device })
      setResults([])
      setPlan(p)
      setIndex(0)
      setPhase('settling')
    },
    [device],
  )

  // Launched with a plan: give the screen a moment to land, then run it.
  useEffect(() => {
    if (!launched) return
    const t = setTimeout(() => startPlan(launched), 800)
    return () => clearTimeout(t)
  }, [launched, startPlan])

  // The next scenario is mounted and idle while it settles and, if the last
  // one heated the chip, while it cools; then it is measured.
  useEffect(() => {
    if (phase !== 'settling' || !plan) return
    const scenario = plan.scenarios[index]
    const settledAt = Date.now() + plan.settle * 1000
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const thermal = thermalState()
      const waited = Date.now() - settledAt
      if ((THROTTLED.has(thermal) || thermal === 'moderate') && waited < (COOL_CAP_MS[thermal] ?? 120_000)) {
        setCooling(`cooling (${thermal}) ${Math.round(waited / 1000)} s`)
        timer = setTimeout(tick, 2000)
        return
      }
      setCooling('')
      report({ event: 'start', index, ...scenario, thermal, cooled: Math.max(0, waited) })
      setPhase('running')
    }
    timer = setTimeout(tick, plan.settle * 1000)
    return () => clearTimeout(timer)
  }, [phase, plan, index])

  const onDone = useCallback(
    (r: AnyResult) => {
      if (!plan) return
      report({ event: 'result', index, ...r })
      setResults((prev) => [r, ...prev])
      if (index + 1 < plan.scenarios.length) {
        setIndex(index + 1)
        setPhase('settling')
      } else {
        report({ event: 'done', results: plan.scenarios.length })
        setPhase('idle')
        setPlan(null)
      }
    },
    [plan, index],
  )

  const busy = phase !== 'idle'
  const scenario = plan ? plan.scenarios[index] : null
  const status = scenario ? `${phase === 'settling' ? 'settling' : 'running'} ${index + 1}/${plan!.scenarios.length}: ${scenarioLabel(scenario)}${cooling ? ' · ' + cooling : ''}` : 'idle'
  const minutes = (p: Plan) => `${Math.max(1, Math.round(planSeconds(p) / 60))} min`

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="rolling-bench" keyboardShouldPersistTaps="always">
      <Text style={styles.hint}>
        {device
          ? `${device.name} · ${device.model} · ${device.platform} ${device.os} · ${device.refreshRate} Hz · ${device.cpuCores} cores · thermal ${device.thermal}` +
            (device.lowPowerMode ? ' · LOW POWER MODE' : '') +
            (device.debug ? ' · DEBUG BUILD' : '')
          : hasProbe
            ? 'device info unavailable'
            : 'no probe in this build: CPU, the native frame meter and the typing driver are off'}
      </Text>
      <Text style={styles.hint}>
        A value stream pushes a new value for {fullPlan().warmup} s unmeasured, then {fullPlan().seconds} s measured, into 1, 8 or 24 copies: every JS
        frame (about seven digits change per push) or ten a second like a live ticker. UI = main-thread frames from a native display link, JS =
        pacing of the loop that pushes, CPU = per-thread time from the process itself. The other plans mount and unmount, scroll a list, type
        into every input, and watch memory over mount/unmount cycles and a long scroll.
      </Text>

      <View style={styles.row}>
        {IMPLS.map((i) => (
          <Chip key={i.key} title={i.short} selected={i.key === impl} testID={`impl-${i.key}`} onPress={() => !busy && setImpl(i.key)} />
        ))}
      </View>
      <View style={styles.row}>
        <Chip title={busy ? 'Running…' : 'Run'} testID="bench-run" selected onPress={() => !busy && startPlan(singlePlan({ impl, rate, count }))} />
        <Chip title={`Rate: ${rateLabel(rate)}`} testID="bench-rate" onPress={() => !busy && setRate((r) => (r === 'frame' ? 10 : 'frame'))} />
        <Chip title={`Copies: ${count}`} testID="bench-count" onPress={() => !busy && setCount((c) => (c === 1 ? 8 : c === 8 ? 24 : 1))} />
        <Chip title="Clear" testID="bench-clear" onPress={() => setResults([])} />
      </View>
      <View style={styles.row}>
        <Chip title={`Full matrix (${minutes(fullPlan())})`} testID="bench-full" onPress={() => !busy && startPlan(fullPlan())} />
        <Chip title={`Inputs (${minutes(inputPlan())})`} testID="bench-inputs" onPress={() => !busy && startPlan(inputPlan())} />
        <Chip title={`Mount (${minutes(mountPlan())})`} testID="bench-mount" onPress={() => !busy && startPlan(mountPlan())} />
        <Chip title={`List (${minutes(listPlan())})`} testID="bench-list" onPress={() => !busy && startPlan(listPlan())} />
        <Chip title={`Memory (${minutes(leakPlan())})`} testID="bench-memory" onPress={() => !busy && startPlan(leakPlan())} />
      </View>
      <Text style={styles.status} testID="bench-status">
        {status}
      </Text>

      <View style={styles.stage}>
        {plan && scenario ? (
          <Stage key={`${index}-${scenario.impl}`} scenario={scenario} plan={plan} running={phase === 'running'} onMeasureStart={() => report({ event: 'measure', index })} onDone={onDone} />
        ) : null}
      </View>

      {results.map((r, i) => (
        <Text key={`${results.length - i}`} style={styles.result} testID={i === 0 ? 'bench-result' : undefined}>
          {fmtLine(r)}
        </Text>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 48 },
  hint: { fontSize: 12, color: '#555', marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#eef0f3' },
  chipSelected: { backgroundColor: '#1a56db' },
  chipPressed: { opacity: 0.7 },
  chipText: { fontSize: 13, color: '#222' },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  status: { fontSize: 12, color: '#333', marginBottom: 8 },
  stage: { minHeight: 200, marginBottom: 12 },
  result: { fontSize: 12, color: '#111', fontVariant: ['tabular-nums'], marginBottom: 4 },
})
