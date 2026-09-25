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
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { PlainText } from 'react-native-plain-text'
import { NitroText } from 'react-native-nitro-input'
import { forceGc, sample } from 'bench-probe'
import { Btn, Row, styles } from '../harness'

const COUNT = 1000
type Variant = 'text' | 'plain' | 'nitro'
const LABEL: Record<Variant, string> = { text: 'Text', plain: 'PlainText', nitro: 'NitroText' }
const ITEMS = Array.from({ length: COUNT }, (_, i) => `Label number ${i + 1}`)
const style = { fontSize: 16, color: '#111827' } as const

type Result = { interaction: number; commit: number; memoryKb: number | null }

declare const performance: { now(): number }
declare const PerformanceObserver: {
  new (callback: (list: { getEntries(): { startTime: number; duration: number }[] }) => void): {
    observe(options: { type: string; durationThreshold?: number }): void
    disconnect(): void
  }
}

export function TextMountScreen() {
  const [variant, setVariant] = useState<Variant | null>(null)
  const [results, setResults] = useState<Record<Variant, Result[]>>({ text: [], plain: [], nitro: [] })
  const events = useRef<{ start: number; duration: number }[]>([])
  const press = useRef<{ variant: Variant; start: number } | null>(null)
  const baseline = useRef<number | null>(null)
  const firstMount = useRef<Set<Variant>>(new Set())

  useEffect(() => {
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) events.current.push({ start: e.startTime, duration: e.duration })
    })
    observer.observe({ type: 'event', durationThreshold: 0 })
    return () => observer.disconnect()
  }, [])

  // After the commit that mounted the labels: the JS-thread slice, then the settled numbers.
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
            {line(v)}
          </Text>
        ))}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
        {variant === 'text' && ITEMS.map((t, i) => <Text key={i} style={style}>{t}</Text>)}
        {variant === 'plain' && ITEMS.map((t, i) => <PlainText key={i} style={style}>{t}</PlainText>)}
        {variant === 'nitro' && ITEMS.map((t, i) => <NitroText key={i} fontSize={16} color="#111827">{t}</NitroText>)}
      </ScrollView>
    </View>
  )
}
