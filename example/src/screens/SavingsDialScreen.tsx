import React, { useRef, useState } from 'react'
import { PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { NitroNumber } from 'react-native-nitro-input'

/**
 * Uno's savings calculator dial, the middle of it: what a year earns on the
 * amount the knob stands on. The figure is set up as Uno's `AmountText` sets
 * up NitroNumber (centred in the full width, fitted to it, a 900 ms spring
 * roll, Open Runde's proportional digits), and the numbers follow Uno's maths:
 * dollars from the knob on a quadratic track, rounded to typeable steps, 15%
 * a year, nothing under a 10-dollar minimum. Dragging below the minimum rolls
 * the year to zero, which is where Uno showed a short bounce.
 *
 * The sweep buttons replay a drag (one step per frame) so it can be recorded
 * without a finger.
 */

const STEPS = 1000
const MIN_USD = 1
const MAX_USD = 5000
const MINIMUM_USD = 10
const RATE = 0.15

const positionToUsd = (position: number) => {
  const clamped = Math.min(Math.max(position, 0), 1)
  return MIN_USD + (MAX_USD - MIN_USD) * clamped * clamped
}
const displayStep = (major: number) => (major < 100 ? 1 : major < 1000 ? 10 : major < 10000 ? 100 : 1000)
const roundForDisplay = (major: number) => {
  const step = displayStep(major)
  return Math.max(step, Math.round(major / step) * step)
}

type Mode = 'usd' | 'peso'

function figureFor(position: number) {
  const saved = roundForDisplay(positionToUsd(position / STEPS))
  const earning = saved >= MINIMUM_USD
  const yearly = earning ? roundForDisplay(saved * RATE) : 0
  return { saved, earning, yearly }
}

export function SavingsDialScreen() {
  const { width: screenWidth } = useWindowDimensions()
  const [position, setPosition] = useState(Math.round(0.08 * STEPS))
  const [mode, setMode] = useState<Mode>('usd')
  const [rowHeight, setRowHeight] = useState(0)
  const sweep = useRef<ReturnType<typeof setInterval> | null>(null)
  const trackWidth = useRef(1)

  const { saved, earning, yearly } = figureFor(position)
  const money = (n: number) => (mode === 'usd' ? `$${n.toLocaleString('en-US')}` : `${n.toLocaleString('en-US')} USD`)

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: e => setPosition(Math.round((e.nativeEvent.locationX / trackWidth.current) * STEPS)),
      onPanResponderMove: e =>
        setPosition(Math.min(STEPS, Math.max(0, Math.round((e.nativeEvent.locationX / trackWidth.current) * STEPS)))),
    })
  ).current

  // A finger dragging the knob: one step every frame from one position to another.
  const replay = (from: number, to: number, perFrame: number) => {
    if (sweep.current) clearInterval(sweep.current)
    let p = from
    setPosition(p)
    sweep.current = setInterval(() => {
      p = from < to ? Math.min(to, p + perFrame) : Math.max(to, p - perFrame)
      setPosition(p)
      if (p === to && sweep.current) {
        clearInterval(sweep.current)
        sweep.current = null
      }
    }, 16)
  }

  // Uno's card: 16 page padding, 16 card padding, the dial's hero full width.
  const heroWidth = Math.min(screenWidth - 64, 300)

  return (
    <View style={s.page}>
      <View style={s.card}>
        <Text style={s.label}>{earning ? "In a year you'd earn about" : "In a year you'd earn"}</Text>
        {/* The row never gets shorter than the tallest figure it has drawn. */}
        <View
          style={[s.row, { minHeight: rowHeight }]}
          onLayout={e => {
            const h = e.nativeEvent.layout.height
            setRowHeight(tallest => Math.max(tallest, h))
          }}
        >
          <NitroNumber
            testID="dial-figure"
            adjustsFontSizeToFit
            affixAlign="baseline"
            color="#111827"
            direction="shortest"
            duration={900}
            easing="spring"
            fontSize={40}
            fontWeight="700"
            fractionDigits={0}
            letterSpacing={-1.8}
            minimumFontScale={0}
            prefix={mode === 'usd' ? '$' : ''}
            prefixFontSize={24}
            prefixOffset={-2}
            prefixSpacing={2}
            style={{ width: heroWidth }}
            suffix={mode === 'peso' ? 'USD' : ''}
            suffixFontSize={24}
            suffixOffset={-2}
            suffixSpacing={2}
            tabularNums={false}
            textAlign="center"
            value={yearly}
          />
        </View>
        <Text style={s.line}>{earning ? `if you save ${money(saved)}` : `Starts at ${money(MINIMUM_USD)}`}</Text>
      </View>

      <View
        style={s.track}
        onLayout={e => (trackWidth.current = e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={[s.fill, { width: `${(position / STEPS) * 100}%` }]} />
      </View>
      <Text style={s.readout} testID="dial-readout">
        {`position ${position} · saved ${money(saved)} · year ${money(yearly)}`}
      </Text>

      <View style={s.buttons}>
        <Btn testID="dial-sweep-down" title="Drag to zero" onPress={() => replay(Math.round(0.08 * STEPS), 0, 2)} />
        <Btn testID="dial-sweep-up" title="Drag from zero" onPress={() => replay(0, Math.round(0.08 * STEPS), 2)} />
        <Btn testID="dial-jump-zero" title="Jump to zero" onPress={() => replay(position, 0, STEPS)} />
        <Btn
          testID="dial-mode"
          title={mode === 'usd' ? 'Peso user (N USD)' : 'Dollar user ($N)'}
          onPress={() => setMode(m => (m === 'usd' ? 'peso' : 'usd'))}
        />
      </View>
    </View>
  )
}

function Btn({ title, onPress, testID }: { title: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={s.btn}>
      <Text style={s.btnText}>{title}</Text>
    </Pressable>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 16, backgroundColor: '#F3F4F6' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 16, alignItems: 'center', gap: 4 },
  label: { fontSize: 14, color: '#4B5563', fontWeight: '500', textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', width: '100%' },
  line: { fontSize: 14, color: '#4B5563', textAlign: 'center' },
  track: { height: 44, borderRadius: 22, backgroundColor: '#E5E7EB', overflow: 'hidden', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#93C5FD' },
  readout: { fontSize: 13, color: '#374151', fontVariant: ['tabular-nums'] },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#E0E7FF' },
  btnText: { fontSize: 15, color: '#1E3A8A', fontWeight: '600' },
})
