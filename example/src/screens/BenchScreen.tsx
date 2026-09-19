import React, { useCallback, useRef, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { RollingNumber } from 'react-native-nitro-rolling-number'
import { ExpoField, type ExpoFieldRef } from '../expoField'
import { MorphInput, NitroInput, type MorphInputHandle } from 'react-native-nitro-input'
import { Btn, Card, Row, styles } from '../harness'

// React Native exposes performance.now() at runtime; the RN types omit the DOM lib.
declare const performance: { now(): number }

type Kind = 'plain' | 'morph' | 'rn' | 'view' | 'roll' | 'expo'
const BATCH = 20
// n=5 was not enough: the per-pass spread is wider than the difference
// between components, so medians moved by 2x between runs.
const MOUNT_PASSES = 15
const FOCUS_RUNS = 12

function stats(samples: number[]) {
  if (samples.length === 0) return '—'
  const sorted = [...samples].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
  return `n=${sorted.length}  median ${median.toFixed(1)}ms  mean ${mean.toFixed(1)}ms  min ${sorted[0].toFixed(1)}  max ${sorted[sorted.length - 1].toFixed(1)}`
}

/**
 * Mount cost and focus latency for the two components, measured the same way:
 * mount is the wall time from the state update that renders `BATCH` fields to
 * the last one's `onLayout`; focus is the time from calling `focus()` to the
 * `onFocus` callback.
 */
export function BenchScreen() {
  const [mounted, setMounted] = useState<Kind | null>(null)
  const [mountResult, setMountResult] = useState<Record<Kind, string>>({ plain: '—', morph: '—', rn: '—', view: '—', roll: '—', expo: '—' })
  const [focusResult, setFocusResult] = useState<Record<Kind, string>>({ plain: '—', morph: '—', rn: '—', view: '—', roll: '—', expo: '—' })
  const [busy, setBusy] = useState('')

  const t0 = useRef(0)
  const laidOut = useRef(0)
  const mountSamples = useRef<number[]>([])
  const pass = useRef(0)
  const kindRef = useRef<Kind>('morph')

  // Focus-latency probes: one field of each kind, kept mounted.
  const expoProbe = useRef<ExpoFieldRef>(null)
  const plainProbe = useRef<MorphInputHandle>(null)
  const morphProbe = useRef<MorphInputHandle>(null)
  const rnProbe = useRef<React.ComponentRef<typeof TextInput>>(null)
  const focusT0 = useRef(0)
  const focusResolve = useRef<((ms: number) => void) | null>(null)

  const onItemLayout = useCallback(() => {
    laidOut.current += 1
    if (laidOut.current < BATCH) return
    const elapsed = performance.now() - t0.current
    mountSamples.current.push(elapsed)
    pass.current += 1
    const kind = kindRef.current
    if (pass.current < MOUNT_PASSES) {
      // Unmount, then mount again, so each pass measures a cold batch.
      setMounted(null)
      requestAnimationFrame(() => {
        laidOut.current = 0
        t0.current = performance.now()
        setMounted(kind)
      })
    } else {
      setMountResult(prev => ({ ...prev, [kind]: stats(mountSamples.current) }))
      setBusy('')
      setMounted(null)
    }
  }, [])

  const runMount = useCallback((kind: Kind) => {
    setBusy(`mounting ${BATCH} × ${kind} …`)
    kindRef.current = kind
    mountSamples.current = []
    pass.current = 0
    setMounted(null)
    requestAnimationFrame(() => {
      laidOut.current = 0
      t0.current = performance.now()
      setMounted(kind)
    })
  }, [])

  const runFocus = useCallback(async (kind: Kind) => {
    setBusy(`focusing ${kind} ×${FOCUS_RUNS} …`)
    const samples: number[] = []
    for (let i = 0; i < FOCUS_RUNS; i++) {
      const ms = await new Promise<number>(resolve => {
        focusResolve.current = resolve
        focusT0.current = performance.now()
        if (kind === 'expo') void expoProbe.current?.focus()
        else if (kind === 'plain') plainProbe.current?.focus()
        else if (kind === 'morph') morphProbe.current?.focus()
        else rnProbe.current?.focus()
        setTimeout(() => {
          if (focusResolve.current) {
            focusResolve.current = null
            resolve(NaN)
          }
        }, 2000)
      })
      if (!Number.isNaN(ms)) samples.push(ms)
      if (kind === 'expo') void expoProbe.current?.blur()
      else if (kind === 'plain') plainProbe.current?.blur()
      else if (kind === 'morph') morphProbe.current?.blur()
      else rnProbe.current?.blur()
      await new Promise<void>(r => setTimeout(() => r(), 350))
    }
    setFocusResult(prev => ({ ...prev, [kind]: stats(samples) }))
    setBusy('')
  }, [])

  // Is onFocus delivered inside the focus() call, or after it returns? That is
  // the difference between "we skip a scheduling hop" and "we measure a
  // different event", so it is checked rather than assumed.
  const [order, setOrder] = useState<Record<Kind, string>>({ plain: '—', morph: '—', rn: '—', view: '—', roll: '—', expo: '—' })
  const orderTrace = useRef<string[] | null>(null)

  const runOrder = useCallback((kind: Kind) => {
    const trace: string[] = []
    orderTrace.current = trace
    trace.push('call focus()')
    if (kind === 'plain') plainProbe.current?.focus()
    else if (kind === 'morph') morphProbe.current?.focus()
    else rnProbe.current?.focus()
    trace.push('focus() returned')
    setTimeout(() => {
      orderTrace.current = null
      setOrder(prev => ({ ...prev, [kind]: trace.join('  →  ') }))
      if (kind === 'plain') plainProbe.current?.blur()
      else if (kind === 'morph') morphProbe.current?.blur()
      else rnProbe.current?.blur()
    }, 400)
  }, [])

  const settleFocus = useCallback(() => {
    orderTrace.current?.push('onFocus')
    const resolve = focusResolve.current
    if (resolve == null) return
    focusResolve.current = null
    resolve(performance.now() - focusT0.current)
  }, [])

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card title="Mount cost" hint={`Wall time from the state update that renders ${BATCH} fields to the last onLayout, ${MOUNT_PASSES} cold passes.`}>
        <Row>
          <Btn testID="bench-mount-plain" tone="primary" title={`mount ${BATCH} plain`} onPress={() => runMount('plain')} />
          <Btn testID="bench-mount-morph" tone="primary" title={`mount ${BATCH} morph`} onPress={() => runMount('morph')} />
          <Btn testID="bench-mount-rn" tone="primary" title={`mount ${BATCH} rn`} onPress={() => runMount('rn')} />
        </Row>
        <Row>
          <Btn testID="bench-mount-view" title={`mount ${BATCH} View`} onPress={() => runMount('view')} />
          <Btn testID="bench-mount-roll" title={`mount ${BATCH} RollingNumber`} onPress={() => runMount('roll')} />
          <Btn testID="bench-mount-expo" title={`mount ${BATCH} Expo UI`} onPress={() => runMount('expo')} />
        </Row>
        <Text testID="bench-mount-plain-result" style={styles.cardHint}>{`plain: ${mountResult.plain}`}</Text>
        <Text testID="bench-mount-morph-result" style={styles.cardHint}>{`morph: ${mountResult.morph}`}</Text>
        <Text testID="bench-mount-rn-result" style={styles.cardHint}>{`rn:    ${mountResult.rn}`}</Text>
        <Text testID="bench-mount-view-result" style={styles.cardHint}>{`View:  ${mountResult.view}`}</Text>
        <Text testID="bench-mount-roll-result" style={styles.cardHint}>{`Roll:  ${mountResult.roll}`}</Text>
        <Text testID="bench-mount-expo-result" style={styles.cardHint}>{`expo:  ${mountResult.expo}`}</Text>
      </Card>

      <Card title="Focus latency" hint={`focus() → onFocus, ×${FOCUS_RUNS}. The first run pays for the keyboard appearing.`}>
        <Row>
          <Btn testID="bench-focus-plain" tone="primary" title="focus plain" onPress={() => runFocus('plain')} />
          <Btn testID="bench-focus-morph" tone="primary" title="focus morph" onPress={() => runFocus('morph')} />
          <Btn testID="bench-focus-rn" tone="primary" title="focus rn" onPress={() => runFocus('rn')} />
          <Btn testID="bench-focus-expo" tone="primary" title="focus expo" onPress={() => runFocus('expo')} />
        </Row>
        <Text testID="bench-focus-plain-result" style={styles.cardHint}>{`plain: ${focusResult.plain}`}</Text>
        <Text testID="bench-focus-morph-result" style={styles.cardHint}>{`morph: ${focusResult.morph}`}</Text>
        <Text testID="bench-focus-rn-result" style={styles.cardHint}>{`rn:    ${focusResult.rn}`}</Text>
        <Text testID="bench-focus-expo-result" style={styles.cardHint}>{`expo:  ${focusResult.expo}`}</Text>
        <Text testID="bench-busy" style={styles.cardHint}>{busy || 'idle'}</Text>
      </Card>

      <Card title="Callback ordering" hint="Where onFocus lands relative to the focus() call returning.">
        <Row>
          <Btn testID="bench-order-morph" title="order: morph" onPress={() => runOrder('morph')} />
          <Btn testID="bench-order-rn" title="order: rn" onPress={() => runOrder('rn')} />
        </Row>
        <Text testID="bench-order-morph-result" style={styles.cardHint}>{`morph: ${order.morph}`}</Text>
        <Text testID="bench-order-rn-result" style={styles.cardHint}>{`rn:    ${order.rn}`}</Text>
      </Card>

      <Card title="Focus probes" hint="One of each, kept mounted.">
        <NitroInput
          testID="bench-probe-plain"
          ref={plainProbe}
          style={styles.field}
          fontSize={20}
          placeholder="plain probe"
          onFocus={settleFocus}
        />
        <MorphInput
          testID="bench-probe-morph"
          ref={morphProbe}
          style={styles.field}
          fontSize={20}
          placeholder="morph probe"
          onFocus={settleFocus}
        />
        <ExpoField
          fieldRef={expoProbe}
          style={styles.field}
          placeholder="expo probe"
          onFocusChange={focused => {
            if (focused) settleFocus()
          }}
        />
        <TextInput
          testID="bench-probe-rn"
          ref={rnProbe}
          style={[styles.field, styles.rnField]}
          placeholder="rn probe"
          onFocus={settleFocus}
        />
      </Card>

      <Card title={`Batch (${mounted ?? 'empty'})`}>
        <View testID="bench-batch">
          {mounted === 'plain'
            ? Array.from({ length: BATCH }, (_, i) => (
                <NitroInput key={i} style={styles.field} fontSize={18} placeholder={`p${i}`} onLayout={onItemLayout} />
              ))
            : mounted === 'morph'
            ? Array.from({ length: BATCH }, (_, i) => (
                <MorphInput key={i} style={styles.field} fontSize={18} placeholder={`m${i}`} onLayout={onItemLayout} />
              ))
            : mounted === 'rn'
              ? Array.from({ length: BATCH }, (_, i) => (
                  <TextInput key={i} style={[styles.field, styles.rnField]} placeholder={`r${i}`} onLayout={onItemLayout} />
                ))
            : mounted === 'view'
              ? Array.from({ length: BATCH }, (_, i) => (
                  <View key={i} style={styles.field} onLayout={onItemLayout} />
                ))
            : mounted === 'roll'
              ? Array.from({ length: BATCH }, (_, i) => (
                  <RollingNumber key={i} value={i} fontSize={18} style={styles.field} onLayout={onItemLayout} />
                ))
            : mounted === 'expo'
              ? // `Host` has no onLayout, so each item carries a wrapper View.
                // That is one extra RN View per item (~0.2 ms each, see the
                // View row) baked into this number.
                Array.from({ length: BATCH }, (_, i) => (
                  <View key={i} onLayout={onItemLayout}>
                    <ExpoField style={styles.field} placeholder={`e${i}`} />
                  </View>
                ))
              : null}
        </View>
      </Card>
    </ScrollView>
  )
}
