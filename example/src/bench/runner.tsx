import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { matchFont } from '@shopify/react-native-skia'
import { useSharedValue } from 'react-native-reanimated'
import type { RollingNumberHandle } from 'react-native-nitro-rolling-number'
import { BENCH_FORMAT, BENCH_START, BenchItem, ImplBoundary, benchValue, type ImplKey } from './impls'
import {
  cpuBetween,
  sample,
  startFrames,
  stopFrames,
  thermalState,
  type CpuStats,
  type FrameStats,
  type Sample,
} from './probe'
import type { Count, Rate, Scenario } from './plan'

// React Native exposes performance.now() at runtime; the RN types omit the DOM lib.
declare const performance: { now(): number }

/** Pacing of the requestAnimationFrame loop that pushes the values: how responsive the JS thread stayed. */
export type JsStats = { fps: number; frames: number; p50: number; p95: number; p99: number; max: number; long: number }

export type BenchResult = {
  impl: ImplKey
  rate: Rate
  count: Count
  /** Measured seconds (after the warm-up). */
  seconds: number
  /** The native frame meter on the main thread; null without the probe. */
  ui: FrameStats | null
  js: JsStats
  /** Per-thread CPU over the measured window; null without the probe. */
  cpu: CpuStats | null
  rssMb: number | null
  thermal: { before: string; after: string }
  error?: string
}

export const BENCH_FONT_SIZE = 44

/**
 * One scenario: `count` copies of one implementation, fed the same value
 * stream. While `running`, a requestAnimationFrame loop pushes values for
 * `warmup` seconds unmeasured, then for `seconds` measured. The native probe
 * counts main-thread frames and samples per-thread CPU over the measured
 * window; the loop's own pacing is the JS-thread figure.
 */
export function BenchRun({
  scenario,
  seconds,
  warmup,
  running,
  onMeasureStart,
  onDone,
}: {
  scenario: Scenario
  seconds: number
  warmup: number
  running: boolean
  onMeasureStart?: () => void
  onDone: (result: BenchResult) => void
}) {
  const { impl, rate, count } = scenario
  const [value, setValue] = useState(BENCH_START)
  const nitroRefs = useRef<(RollingNumberHandle | null)[]>([])
  const fmt = useMemo(() => new Intl.NumberFormat('en-US', BENCH_FORMAT), [])
  const sv = useSharedValue(fmt.format(BENCH_START))
  const fontSize = count === 1 ? BENCH_FONT_SIZE : BENCH_FONT_SIZE / 2
  const font = useMemo(() => matchFont({ fontSize, fontWeight: 'bold' }), [fontSize])
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const onMeasureStartRef = useRef(onMeasureStart)
  onMeasureStartRef.current = onMeasureStart
  const errorRef = useRef<string | null>(null)

  useEffect(() => {
    if (!running) return
    const warmupMs = warmup * 1000
    const measureMs = seconds * 1000
    const interval = rate === 'frame' ? 0 : 1000 / rate
    const gaps: number[] = []
    let cancelled = false
    let frame = 0
    let start = 0
    let measureStart = 0
    let last = 0
    let lastPush = -Infinity
    let measuring = false
    let before: Sample | null = null
    let thermalBefore = ''

    const push = (v: number) => {
      if (impl === 'nitro-jump') nitroRefs.current.forEach((r) => r?.jumpTo(v))
      else if (impl === 'nf-skia-sv' || impl === 'atext') sv.value = fmt.format(v)
      else setValue(v)
    }

    const finish = (now: number, error?: string) => {
      const ui = measuring ? stopFrames() : null
      const after = measuring ? sample() : null
      const thermalAfter = thermalState()
      const measured = measuring ? (now - measureStart) / 1000 : 0
      const sorted = [...gaps].sort((a, b) => a - b)
      const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0)
      const frameMs = 1000 / (ui?.hz || 60)
      onDoneRef.current({
        impl,
        rate,
        count,
        seconds: measured,
        ui,
        js: {
          fps: measured > 0 ? gaps.length / measured : 0,
          frames: gaps.length ? gaps.length + 1 : 0,
          p50: q(0.5),
          p95: q(0.95),
          p99: q(0.99),
          max: sorted.length ? sorted[sorted.length - 1] : 0,
          long: gaps.filter((g) => g > 2.5 * frameMs).length,
        },
        cpu: before && after ? cpuBetween(before, after) : null,
        rssMb: after?.rssMb ?? null,
        thermal: { before: thermalBefore, after: thermalAfter },
        ...(error ? { error } : {}),
      })
    }

    const loop = () => {
      if (cancelled) return
      const now = performance.now()
      if (!start) start = now
      if (errorRef.current) {
        finish(now, errorRef.current)
        return
      }
      if (!measuring) {
        if (now - start >= warmupMs) {
          measuring = true
          measureStart = now
          last = now
          thermalBefore = thermalState()
          before = sample()
          startFrames()
          onMeasureStartRef.current?.()
        }
      } else {
        gaps.push(now - last)
        last = now
        if (now - measureStart >= measureMs) {
          finish(now)
          return
        }
      }
      // The loop always runs (it is the JS pacing probe); values are pushed at `rate`.
      if (interval === 0 || now - lastPush >= interval - 1) {
        lastPush = now
        push(benchValue((now - start) / 1000))
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      if (measuring) stopFrames()
    }
  }, [running, impl, rate, count, fmt, sv, warmup, seconds])

  return (
    <View style={count === 1 ? styles.single : styles.grid}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={count === 1 ? undefined : styles.cell}>
          <ImplBoundary
            onError={(e) => {
              errorRef.current = e.message || String(e)
            }}
          >
            <BenchItem
              impl={impl}
              value={value}
              fontSize={fontSize}
              fmt={fmt}
              sv={sv}
              font={font}
              nitroRef={(h) => {
                nitroRefs.current[i] = h
              }}
            />
          </ImplBoundary>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  single: { height: 72, justifyContent: 'center', alignItems: 'flex-start' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8 },
  cell: { width: '48%', height: 34, justifyContent: 'center' },
})
