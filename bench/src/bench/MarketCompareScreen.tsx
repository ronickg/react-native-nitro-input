import React, { useEffect, useRef, useState } from 'react'
import { StatusBar, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { RootStackParamList } from '../navigation'
import Animated, { useAnimatedProps, useFrameCallback, useSharedValue } from 'react-native-reanimated'
import { NitroNumber } from 'react-native-nitro-input'
import { AnimatedNumber } from 'react-native-number-animation'
import { cpuBetween, report, sample, startFrames, stopFrames } from 'bench-probe'

// ---------------------------------------------------------------------------
// The example's market dashboard, drawn by one library at a time so two
// recordings can be put side by side. Every library gets the same feed the
// same way: one React state object, changed every 50 ms, about 280 value
// changes a second across ~50 figures. The header measures the UI thread and
// the JS thread while it runs.
// ---------------------------------------------------------------------------

export type CompareLib = 'nitro-roll' | 'nitro-numeric' | 'rnna'
export type MarketCompareParams = { lib: CompareLib }

const LABELS: Record<CompareLib, string> = {
  'nitro-roll': 'NitroNumber · roll',
  'nitro-numeric': 'NitroNumber · numeric',
  rnna: 'react-native-number-animation',
}

const FONT = { medium: 'OpenRunde-Medium', semibold: 'OpenRunde-Semibold', bold: 'OpenRunde-Bold' }
const UP = '#34D399'
const DOWN = '#FB7185'
const INK = '#F1F5F9'
const MUTED = 'rgba(226,232,240,0.55)'
const DURATION = 500

const TILES = [
  { sym: 'BTC', price: 64_210.9, digits: 2, qty: 0.8 },
  { sym: 'ETH', price: 3_412.75, digits: 2, qty: 6 },
  { sym: 'SOL', price: 148.32, digits: 2, qty: 60 },
  { sym: 'AAPL', price: 227.48, digits: 2, qty: 40 },
  { sym: 'NVDA', price: 131.26, digits: 2, qty: 90 },
  { sym: 'TSLA', price: 248.5, digits: 2, qty: 25 },
  { sym: 'MSFT', price: 418.12, digits: 2, qty: 20 },
  { sym: 'AMZN', price: 186.4, digits: 2, qty: 35 },
  { sym: 'META', price: 512.07, digits: 2, qty: 12 },
  { sym: 'DOGE', price: 0.1284, digits: 4, qty: 20_000 },
  { sym: 'XRP', price: 0.5712, digits: 4, qty: 5_000 },
  { sym: 'GOLD', price: 2_391.6, digits: 1, qty: 3 },
]
const BOOK_ROWS = 6
const TICK_MS = 50
/** Figures on screen: portfolio, change, percent, two per tile, four per book level, spread. */
const FIGURES = 3 + TILES.length * 2 + BOOK_ROWS * 4 + 1

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places
function makeRandom(seed: number) {
  let x = seed
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return x / 4294967296
  }
}

type FigureProps = {
  lib: CompareLib
  value: number
  digits: number
  prefix?: string
  suffix?: string
  size: number
  color: string
  family: string
  grouping?: boolean
}

/** One number, drawn by the library under test. */
const Figure = React.memo(function Figure({ lib, value, digits, prefix = '', suffix = '', size, color, family, grouping = true }: FigureProps) {
  if (lib === 'rnna') {
    return (
      <AnimatedNumber
        value={value}
        locales="en-US"
        format={{ minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: grouping }}
        prefix={prefix}
        suffix={suffix}
        style={{ fontSize: size, color, fontFamily: family }}
        animation={{ digit: { duration: DURATION } }}
      />
    )
  }
  return (
    <NitroNumber
      value={value}
      fractionDigits={digits}
      groupingSeparator={grouping ? ',' : ''}
      prefix={prefix}
      suffix={suffix}
      transition={lib === 'nitro-numeric' ? 'numeric' : 'roll'}
      duration={DURATION}
      fontFamily={family}
      fontSize={size}
      color={color}
    />
  )
})

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

/** UI thread frames per second, measured and drawn on the UI thread. */
function UiFps() {
  const fps = useSharedValue(0)
  const win = useSharedValue({ start: 0, frames: 0 })
  useFrameCallback((frame) => {
    'worklet'
    const w = win.value
    if (w.start === 0) {
      win.value = { start: frame.timestamp, frames: 0 }
      return
    }
    const elapsed = frame.timestamp - w.start
    if (elapsed >= 500) {
      fps.value = Math.round(((w.frames + 1) * 1000) / elapsed)
      win.value = { start: frame.timestamp, frames: 0 }
    } else {
      win.value = { start: w.start, frames: w.frames + 1 }
    }
  })
  const props = useAnimatedProps(() => {
    const text = `UI ${fps.value}`
    return { text, defaultValue: text } as never
  })
  return <AnimatedTextInput editable={false} underlineColorAndroid="transparent" style={s.meter} animatedProps={props} defaultValue="UI —" />
}

/** JS thread frames per second, from requestAnimationFrame. */
function JsFps() {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    let raf = 0
    let start = 0
    let frames = 0
    const tick = (t: number) => {
      if (start === 0) start = t
      frames++
      if (t - start >= 500) {
        setFps(Math.round((frames * 1000) / (t - start)))
        start = t
        frames = 0
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <Text style={s.meter}>JS {fps}</Text>
}

type Market = {
  prices: number[]
  bids: { price: number; size: number }[]
  asks: { price: number; size: number }[]
}

function initial(): Market {
  const r = makeRandom(7)
  const mid = TILES[0].price
  return {
    prices: TILES.map((t) => t.price),
    bids: Array.from({ length: BOOK_ROWS }, (_, i) => ({ price: round(mid - 0.5 - i * 2.5, 1), size: round(0.2 + r() * 3, 3) })),
    asks: Array.from({ length: BOOK_ROWS }, (_, i) => ({ price: round(mid + 0.5 + i * 2.5, 1), size: round(0.2 + r() * 3, 3) })),
  }
}

export function MarketCompareScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'MarketCompare'>) {
  const lib = route.params?.lib ?? 'nitro-roll'
  const insets = useSafeAreaInsets()
  const [m, setM] = useState<Market>(initial)
  const [rate, setRate] = useState(0)
  const open = useRef(TILES.map((t) => t.price)).current

  useEffect(() => {
    navigation.setOptions({ headerShown: false })
  }, [navigation])

  // One measured window per visit, for scripted runs: after a warm-up, the
  // main thread's CPU and frame pacing over 10 s of the feed, as a BENCH line.
  useEffect(() => {
    let cancelled = false
    const warmup = setTimeout(() => {
      const before = sample()
      startFrames()
      setTimeout(() => {
        if (cancelled) return
        const frames = stopFrames()
        const after = sample()
        const cpu = before && after ? cpuBetween(before, after) : null
        report({
          event: 'market',
          lib,
          mainPct: cpu?.main ?? null,
          jsPct: cpu?.js ?? null,
          renderPct: cpu?.render ?? null,
          fps: frames?.fps ?? null,
          dropped: frames?.dropped ?? null,
          p95: frames?.p95 ?? null,
          max: frames?.max ?? null,
        })
        report({ event: 'done' })
      }, 10_000)
    }, 3_000)
    return () => {
      cancelled = true
      clearTimeout(warmup)
    }
  }, [lib])

  useEffect(() => {
    const r = makeRandom(42)
    let tick = 0
    let changes = 0
    let second = Date.now()
    const loop = setInterval(() => {
      tick++
      setM((prev) => {
        const prices = prev.prices.slice()
        const bids = prev.bids.map((b) => ({ ...b }))
        const asks = prev.asks.map((a) => ({ ...a }))
        for (let k = 0; k < 4; k++) {
          const i = Math.floor(r() * TILES.length)
          const away = (prices[i] - open[i]) / open[i]
          prices[i] = round(Math.max(10 ** -TILES[i].digits, prices[i] * (1 + (r() - 0.5) * 0.0024 - away * 0.03)), TILES[i].digits)
          changes += 2
        }
        for (let k = 0; k < 5; k++) {
          const i = Math.floor(r() * BOOK_ROWS)
          const book = r() < 0.5 ? bids : asks
          book[i].size = round(Math.min(24, Math.max(0.001, book[i].size * (0.6 + r() * 0.8) + (r() < 0.1 ? r() * 2 : 0))), 3)
          changes++
        }
        if (tick % 6 === 0) {
          const mid = prices[0]
          for (let i = 0; i < BOOK_ROWS; i++) {
            bids[i].price = round(mid - 0.5 - i * 2.5, 1)
            asks[i].price = round(mid + 0.5 + i * 2.5, 1)
          }
          changes += BOOK_ROWS * 2
        }
        if (tick % 10 === 0) changes += 3
        return { prices, bids, asks }
      })
      const now = Date.now()
      if (now - second >= 1000) {
        setRate(Math.round((changes * 1000) / (now - second)))
        changes = 0
        second = now
      }
    }, TICK_MS)
    return () => clearInterval(loop)
  }, [open])

  const openValue = TILES.reduce((sum, t) => sum + t.price * t.qty, 0)
  const value = round(TILES.reduce((sum, t, i) => sum + m.prices[i] * t.qty, 0), 2)
  const change = round(value - openValue, 2)
  const up = change >= 0
  const tone = up ? UP : DOWN

  return (
    <View style={s.root}>
      <StatusBar hidden />
      <View style={[s.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 10 }]}>
        <View style={s.header}>
          <Text style={s.title}>Markets</Text>
          <View style={s.meters}>
            <UiFps />
            <JsFps />
          </View>
        </View>
        <View style={s.libRow}>
          <Text style={s.lib}>{LABELS[lib]}</Text>
          <Text style={s.stats}>
            {FIGURES} numbers · {rate} changes/s
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.label}>Portfolio value</Text>
          <Figure lib={lib} value={value} digits={2} prefix="$" size={38} color={INK} family={FONT.bold} />
          <View style={s.pnlRow}>
            <Text style={[s.arrow, { color: tone }]}>{up ? '▲' : '▼'}</Text>
            <Figure lib={lib} value={Math.abs(change)} digits={2} prefix="$" size={14} color={tone} family={FONT.semibold} />
            <Figure lib={lib} value={Math.abs(round((change / openValue) * 100, 2))} digits={2} prefix=" (" suffix="%)" size={14} color={tone} family={FONT.semibold} />
          </View>
        </View>

        <View style={s.grid}>
          {TILES.map((t, i) => {
            const pct = round(((m.prices[i] - open[i]) / open[i]) * 100, 2)
            return (
              <View key={t.sym} style={[s.tile, { backgroundColor: pct > 0.4 ? '#0E5A3F' : pct < -0.4 ? '#6B1D2B' : '#1A2230' }]}>
                <Text style={s.sym}>{t.sym}</Text>
                <Figure lib={lib} value={m.prices[i]} digits={t.digits} prefix="$" size={15} color={INK} family={FONT.semibold} />
                <Figure lib={lib} value={pct} digits={2} suffix="%" size={12} color="rgba(241,245,249,0.75)" family={FONT.medium} />
              </View>
            )
          })}
        </View>

        <View style={s.card}>
          <Text style={s.label}>Order book · BTC/USD</Text>
          <View style={s.book}>
            <View style={s.side}>
              {m.bids.map((b, i) => (
                <View key={i} style={s.level}>
                  <Figure lib={lib} value={b.size} digits={3} size={13} color={MUTED} family={FONT.medium} grouping={false} />
                  <Figure lib={lib} value={b.price} digits={1} size={13} color={UP} family={FONT.semibold} />
                </View>
              ))}
            </View>
            <View style={s.side}>
              {m.asks.map((a, i) => (
                <View key={i} style={s.level}>
                  <Figure lib={lib} value={a.price} digits={1} size={13} color={DOWN} family={FONT.semibold} />
                  <Figure lib={lib} value={a.size} digits={3} size={13} color={MUTED} family={FONT.medium} grouping={false} />
                </View>
              ))}
            </View>
          </View>
          <View style={s.spread}>
            <Text style={s.label}>spread </Text>
            <Figure lib={lib} value={round(m.asks[0].price - m.bids[0].price, 1)} digits={1} size={12} color={INK} family={FONT.semibold} />
          </View>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#06080D' },
  page: { flex: 1, paddingHorizontal: 14, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: INK, fontFamily: FONT.bold, fontSize: 26 },
  meters: { flexDirection: 'row', gap: 8 },
  meter: { color: INK, fontFamily: FONT.semibold, fontSize: 12, padding: 0, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', minWidth: 62, textAlign: 'center', overflow: 'hidden' },
  libRow: { gap: 2, marginTop: -4 },
  lib: { color: '#93C5FD', fontFamily: FONT.bold, fontSize: 15 },
  stats: { color: MUTED, fontFamily: FONT.medium, fontSize: 13 },
  card: { borderRadius: 18, padding: 14, backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' },
  label: { color: MUTED, fontFamily: FONT.medium, fontSize: 13 },
  pnlRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  arrow: { fontSize: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { flexBasis: '30%', flexGrow: 1, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6 },
  sym: { color: 'rgba(241,245,249,0.9)', fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.5 },
  book: { flexDirection: 'row', gap: 8, marginTop: 6 },
  side: { flex: 1, gap: 2 },
  level: { height: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 6 },
})
