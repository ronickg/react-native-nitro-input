import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { NitroNumber, type NitroNumberTransition } from 'react-native-nitro-input'
import { Btn, Row } from '../harness'

/**
 * Memory stress for NitroNumber, the screens the Android OOM (0.4.1, the warm
 * queue of glyph masks) was reproduced and fixed on. Watch the app's native
 * heap (`adb shell dumpsys meminfo com.nitroinput.example`) while one runs: it
 * should level off within a few seconds and stay there.
 *
 * - churn: 12 numbers on the numeric transition, every one a new value and a
 *   new colour every 350 ms (a new typography each time, so new glyph masks).
 * - rows: a 300-row list on the numeric transition in 25 sizes x 8 colours
 *   (200 typographies), scrolling itself up and down.
 * - rollrows: the same list on the roll transition (no glyph masks).
 * - fixedrows: the same list on the numeric transition in one typography.
 * - textrows: the same list with a plain `Text` in each row, the control: what
 *   the list itself costs, with no NitroNumber in it.
 */
export type NumberStressMode = 'churn' | 'rows' | 'rollrows' | 'fixedrows' | 'textrows'

const CHURN_COUNT = 12
const CHURN_MS = 350
const ROWS = 300
const ROW_HEIGHT = 56
const SIZES = Array.from({ length: 25 }, (_, i) => 14 + i)
const COLORS = ['#111827', '#B91C1C', '#047857', '#1D4ED8', '#7C3AED', '#C2410C', '#0E7490', '#BE185D']

function hsl(step: number, index: number) {
  return `hsl(${(step * 37 + index * 29) % 360}, 70%, 40%)`
}

function Churn({ running }: { running: boolean }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setStep((s) => s + 1), CHURN_MS)
    return () => clearInterval(id)
  }, [running])
  return (
    <View style={styles.churn}>
      {Array.from({ length: CHURN_COUNT }, (_, i) => (
        <NitroNumber
          key={i}
          testID={`stress-churn-${i}`}
          value={1000 + ((step * 7919 + i * 104729) % 9000)}
          transition="numeric"
          fractionDigits={i % 2 === 0 ? 2 : 0}
          fontSize={22}
          color={hsl(step, i)}
          style={styles.churnNumber}
        />
      ))}
      <Text testID="stress-step" style={styles.hint}>{`step ${step}`}</Text>
    </View>
  )
}

function Rows({ mode, running }: { mode: Exclude<NumberStressMode, 'churn'>; running: boolean }) {
  const list = useRef<FlatList<number>>(null)
  const [bump, setBump] = useState(0)
  const data = useMemo(() => Array.from({ length: ROWS }, (_, i) => i), [])
  const transition: NitroNumberTransition = mode === 'rollrows' ? 'roll' : 'numeric'

  // Scroll to the bottom and back, a screen or so a tick, and roll every row now and then.
  useEffect(() => {
    if (!running) return
    let offset = 0
    let down = true
    const max = ROWS * ROW_HEIGHT
    const id = setInterval(() => {
      offset += down ? 900 : -900
      if (offset >= max) down = false
      if (offset <= 0) down = true
      offset = Math.max(0, Math.min(max, offset))
      list.current?.scrollToOffset({ offset, animated: false })
    }, 250)
    const values = setInterval(() => setBump((b) => b + 1), 1000)
    return () => {
      clearInterval(id)
      clearInterval(values)
    }
  }, [running])

  return (
    <FlatList
      ref={list}
      testID="stress-list"
      data={data}
      keyExtractor={(i) => String(i)}
      getItemLayout={(_, index) => ({
        length: ROW_HEIGHT,
        offset: ROW_HEIGHT * index,
        index,
      })}
      windowSize={5}
      initialNumToRender={12}
      renderItem={({ item }) => {
        const fixed = mode === 'fixedrows'
        return (
          <View style={styles.row}>
            <Text style={styles.label}>{`#${item}`}</Text>
            {mode === 'textrows' ? (
              <Text
                style={[
                  styles.rowNumber,
                  {
                    fontSize: SIZES[item % SIZES.length],
                    color: COLORS[Math.floor(item / SIZES.length) % COLORS.length],
                  },
                ]}
              >
                {(10000 + item * 13 + bump).toFixed(2)}
              </Text>
            ) : (
              <NitroNumber
                value={10000 + item * 13 + bump}
                transition={transition}
                fontSize={fixed ? 20 : SIZES[item % SIZES.length]}
                color={fixed ? COLORS[0] : COLORS[Math.floor(item / SIZES.length) % COLORS.length]}
                fractionDigits={2}
                style={styles.rowNumber}
              />
            )}
          </View>
        )
      }}
    />
  )
}

export function NumberStressScreen({ mode: initialMode = 'churn', autorun = false }: { mode?: NumberStressMode; autorun?: boolean }) {
  const [mode, setMode] = useState<NumberStressMode>(initialMode)
  const [running, setRunning] = useState(autorun)
  const [mounted, setMounted] = useState(true)
  return (
    <View style={styles.screen}>
      <Row>
        <Btn testID="stress-churn" tone={mode === 'churn' ? 'primary' : 'plain'} title="churn" onPress={() => setMode('churn')} />
        <Btn testID="stress-rows" tone={mode === 'rows' ? 'primary' : 'plain'} title="rows" onPress={() => setMode('rows')} />
        <Btn testID="stress-rollrows" tone={mode === 'rollrows' ? 'primary' : 'plain'} title="rollrows" onPress={() => setMode('rollrows')} />
        <Btn testID="stress-fixedrows" tone={mode === 'fixedrows' ? 'primary' : 'plain'} title="fixedrows" onPress={() => setMode('fixedrows')} />
        <Btn testID="stress-textrows" tone={mode === 'textrows' ? 'primary' : 'plain'} title="textrows" onPress={() => setMode('textrows')} />
      </Row>
      <Row>
        <Btn testID="stress-run" tone="primary" title={running ? 'Pause' : 'Run'} onPress={() => setRunning((r) => !r)} />
        <Btn testID="stress-mount" title={mounted ? 'Unmount' : 'Mount'} onPress={() => setMounted((m) => !m)} />
      </Row>
      <Text testID="stress-mode" style={styles.hint}>{`${mode} · ${running ? 'running' : 'paused'} · ${mounted ? 'mounted' : 'unmounted'}`}</Text>
      {!mounted ? null : mode === 'churn' ? <Churn running={running} /> : <Rows key={mode} mode={mode} running={running} />}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F8FA', paddingTop: 8 },
  hint: {
    marginHorizontal: 16,
    marginVertical: 6,
    color: '#6B7280',
    fontSize: 13,
  },
  churn: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  churnNumber: { width: '50%', marginVertical: 8 },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  label: { width: 56, color: '#6B7280' },
  rowNumber: { flex: 1 },
})
