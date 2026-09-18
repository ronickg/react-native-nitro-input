import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import {
  RollingNumber,
  type RollingNumberHandle,
} from 'react-native-nitro-rolling-number'
import { NumberFlow } from 'number-flow-react-native'
import { SkiaNumberFlow } from 'number-flow-react-native/skia'
import { Canvas, matchFont } from '@shopify/react-native-skia'
import AnimatedNumbers from 'react-native-animated-numbers'
import { useFrameCallback, useSharedValue } from 'react-native-reanimated'

// React Native exposes performance.now() at runtime; the RN types omit the DOM lib.
declare const performance: { now(): number }

function Button({
  title,
  onPress,
  selected,
  testID,
}: {
  title: string
  onPress: () => void
  selected?: boolean
  testID?: string
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && styles.buttonSelected,
        pressed && styles.buttonPressed,
      ]}
      testID={testID ?? `button-${title}`}
    >
      <Text style={[styles.buttonText, selected && styles.buttonTextSelected]}>{title}</Text>
    </Pressable>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionHint}>{hint}</Text>
      {children}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Benchmark: the same value stream, every JS frame, into each implementation.
// ---------------------------------------------------------------------------

const BENCH_SECONDS = 12
const BENCH_FONT_SIZE = 44
const BENCH_START = 4321.09
const BENCH_FORMAT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
}

type BenchImpl =
  | 'text'
  | 'nitro-prop'
  | 'nitro-jump'
  | 'nf-view'
  | 'nf-skia'
  | 'nf-skia-sv'
  | 'anim-numbers'

const BENCH_IMPLS: { key: BenchImpl; label: string }[] = [
  { key: 'text', label: 'Text (no anim)' },
  { key: 'nitro-prop', label: 'Nitro prop' },
  { key: 'nitro-jump', label: 'Nitro jumpTo' },
  { key: 'nf-view', label: 'NumberFlow View' },
  { key: 'nf-skia', label: 'NumberFlow Skia' },
  { key: 'nf-skia-sv', label: 'NumberFlow Skia SV' },
  { key: 'anim-numbers', label: 'AnimatedNumbers' },
]

/** ~7 changing digits every frame: cents tick each frame, thousands drift. */
function benchValue(seconds: number) {
  return 5000 + Math.sin(seconds * 0.7) * 4999 + seconds * 137.9
}

/** Updates pushed per second: every JS frame, or a live-ticker-like 10/s. */
type BenchRate = 60 | 10

/** UI-thread frame pacing, sampled by a Reanimated frame callback (a worklet on the UI thread). */
type UiStats = { fps: number; max: number; dropped: number }

type BenchStats = {
  impl: BenchImpl
  rate: BenchRate
  count: BenchCount
  frames: number
  seconds: number
  fps: number
  p50: number
  p95: number
  max: number
  long: number
  ui: UiStats
}

function summarize(impl: BenchImpl, rate: BenchRate, count: BenchCount, gaps: number[], seconds: number, ui: UiStats): BenchStats {
  const sorted = [...gaps].sort((a, b) => a - b)
  const q = (p: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0
  return {
    impl,
    rate,
    count,
    frames: gaps.length + 1,
    seconds,
    fps: seconds > 0 ? gaps.length / seconds : 0,
    p50: q(0.5),
    p95: q(0.95),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    long: gaps.filter((g) => g > 34).length,
    ui,
  }
}

function formatStats(s: BenchStats) {
  const label = BENCH_IMPLS.find((i) => i.key === s.impl)?.label ?? s.impl
  return (
    `${label} ×${s.count} @${s.rate}/s: UI ${s.ui.fps.toFixed(1)} fps, max ${s.ui.max.toFixed(0)} ms, ${s.ui.dropped} dropped` +
    ` | JS ${s.fps.toFixed(1)} fps, p95 ${s.p95.toFixed(1)} ms, max ${s.max.toFixed(0)} ms`
  )
}

/** How many copies of the implementation render at once, all fed by the same value stream. */
type BenchCount = 1 | 8 | 24

function BenchItem({
  impl,
  value,
  fontSize,
  shimmer,
  fmt,
  sv,
  font,
  nitroRef,
}: {
  impl: BenchImpl
  value: number
  fontSize: number
  shimmer: boolean
  fmt: Intl.NumberFormat
  sv: ReturnType<typeof useSharedValue<string>>
  font: ReturnType<typeof matchFont>
  nitroRef: (h: RollingNumberHandle | null) => void
}) {
  const textStyle = { fontSize, fontWeight: '700' as const, color: '#111' }
  const canvasStyle = { width: '100%' as const, height: fontSize * 1.45 }
  switch (impl) {
    case 'text':
      return (
        <Text style={[textStyle, styles.tabular]} testID="bench-text">
          {fmt.format(value)}
        </Text>
      )
    case 'nitro-prop':
      return (
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          fontSize={fontSize}
          fontWeight="700"
          color="#111"
          duration={500}
          loading={shimmer}
          testID="bench-nitro"
        />
      )
    case 'nitro-jump':
      return (
        <RollingNumber
          ref={nitroRef}
          value={BENCH_START}
          fractionDigits={2}
          groupingSeparator=","
          fontSize={fontSize}
          fontWeight="700"
          color="#111"
          loading={shimmer}
          testID="bench-nitro"
        />
      )
    case 'nf-view':
      return <NumberFlow value={value} format={BENCH_FORMAT} style={textStyle} />
    case 'nf-skia':
      return (
        <Canvas style={canvasStyle}>
          <SkiaNumberFlow value={value} format={BENCH_FORMAT} font={font} color="#111" y={fontSize} tabularNums />
        </Canvas>
      )
    case 'nf-skia-sv':
      return (
        <Canvas style={canvasStyle}>
          <SkiaNumberFlow sharedValue={sv} font={font} color="#111" y={fontSize} tabularNums />
        </Canvas>
      )
    case 'anim-numbers':
      // AnimatedNumbers is integer-only: feed cents so it rolls the same 7 digits.
      return (
        <AnimatedNumbers
          animateToNumber={Math.round(value * 100)}
          includeComma
          animationDuration={500}
          fontStyle={textStyle}
        />
      )
  }
}

function BenchDisplay({
  impl,
  rate,
  count,
  running,
  shimmer,
  onDone,
}: {
  impl: BenchImpl
  rate: BenchRate
  count: BenchCount
  running: boolean
  shimmer: boolean
  onDone: (stats: BenchStats) => void
}) {
  const [value, setValue] = useState(BENCH_START)
  const nitroRefs = useRef<(RollingNumberHandle | null)[]>([])
  const fmt = useMemo(() => new Intl.NumberFormat('en-US', BENCH_FORMAT), [])
  const sv = useSharedValue(fmt.format(BENCH_START))
  const fontSize = count === 1 ? BENCH_FONT_SIZE : BENCH_FONT_SIZE / 2
  const font = useMemo(() => matchFont({ fontSize, fontWeight: 'bold' }), [fontSize])
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  // UI-thread frame meter: runs as a worklet on the UI thread, so a busy main
  // thread (layout, drawing, mounting) shows up as long gaps here even when the
  // JS thread is idle. Counters are scalar shared values so JS can read them back.
  const uiFrames = useSharedValue(0)
  const uiMax = useSharedValue(0)
  const uiDropped = useSharedValue(0)
  // Memoized: useFrameCallback re-registers whenever the callback identity
  // changes, and prop-driven variants re-render this component every frame.
  const uiTick = useCallback(
    (info: { timeSincePreviousFrame: number | null }) => {
      'worklet'
      const gap = info.timeSincePreviousFrame
      if (gap === null) return
      uiFrames.value += 1
      if (gap > uiMax.value) uiMax.value = gap
      if (gap > 25) uiDropped.value += Math.round(gap / 16.667) - 1
    },
    [uiFrames, uiMax, uiDropped],
  )
  const uiMeter = useFrameCallback(uiTick, false)

  useEffect(() => {
    if (!running) return
    const gaps: number[] = []
    const interval = 1000 / rate
    let start = 0
    let last = 0
    let lastPush = -Infinity
    let frame = 0
    uiFrames.value = 0
    uiMax.value = 0
    uiDropped.value = 0
    uiMeter.setActive(true)
    const loop = () => {
      const t = performance.now()
      if (!start) start = t
      else gaps.push(t - last)
      last = t
      const s = (t - start) / 1000
      if (s >= BENCH_SECONDS) {
        uiMeter.setActive(false)
        // Let the last UI-thread frame land before reading the counters.
        setTimeout(() => {
          const ui: UiStats = {
            fps: s > 0 ? uiFrames.value / s : 0,
            max: uiMax.value,
            dropped: uiDropped.value,
          }
          onDoneRef.current(summarize(impl, rate, count, gaps, s, ui))
        }, 50)
        return
      }
      // The rAF loop always runs (it is the JS pacing probe); values are pushed at `rate`.
      if (t - lastPush >= interval - 1) {
        lastPush = t
        const v = benchValue(s)
        if (impl === 'nitro-jump') nitroRefs.current.forEach((r) => r?.jumpTo(v))
        else if (impl === 'nf-skia-sv') sv.value = fmt.format(v)
        else setValue(v)
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      uiMeter.setActive(false)
    }
  }, [running, impl, rate, count, fmt, sv, uiMeter, uiFrames, uiMax, uiDropped])

  return (
    <View style={count === 1 ? styles.benchSingle : styles.benchGrid}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={count === 1 ? undefined : styles.benchCell}>
          <BenchItem
            impl={impl}
            value={value}
            fontSize={fontSize}
            shimmer={shimmer}
            fmt={fmt}
            sv={sv}
            font={font}
            nitroRef={(h) => {
              nitroRefs.current[i] = h
            }}
          />
        </View>
      ))}
    </View>
  )
}

function Benchmark() {
  const [impl, setImpl] = useState<BenchImpl>('nitro-prop')
  const [rate, setRate] = useState<BenchRate>(60)
  const [count, setCount] = useState<BenchCount>(1)
  const [running, setRunning] = useState(false)
  const [shimmer, setShimmer] = useState(false)
  const [results, setResults] = useState<BenchStats[]>([])
  const onDone = useCallback((s: BenchStats) => {
    setRunning(false)
    setResults((r) => [s, ...r].slice(0, 8))
  }, [])
  const current = BENCH_IMPLS.find((i) => i.key === impl)?.label ?? impl
  return (
    <Section
      title="Benchmark"
      hint={`Pushes new values for ${BENCH_SECONDS}s, either every JS frame (about 7 digits change each frame) or 10 times a second like a live ticker, into 1, 8 or 24 copies. Results: UI-thread frame pacing (a Reanimated frame callback; dropped = frames the UI thread missed) and JS-thread pacing. CPU per thread is measured outside the app.`}
    >
      <View style={styles.row}>
        {BENCH_IMPLS.map((i) => (
          <Button
            key={i.key}
            title={i.label}
            selected={i.key === impl}
            testID={`impl-${i.key}`}
            onPress={() => !running && setImpl(i.key)}
          />
        ))}
      </View>
      <View style={styles.row}>
        <Button title={running ? 'Running…' : 'Run'} testID="bench-run" onPress={() => !running && setRunning(true)} />
        <Button
          title={`Rate: ${rate}/s`}
          testID="bench-rate"
          onPress={() => !running && setRate((r) => (r === 60 ? 10 : 60))}
        />
        <Button
          title={`Copies: ${count}`}
          testID="bench-count"
          onPress={() => !running && setCount((c) => (c === 1 ? 8 : c === 8 ? 24 : 1))}
        />
        <Button
          title={shimmer ? 'Shimmer: on' : 'Shimmer: off'}
          testID="bench-shimmer"
          onPress={() => setShimmer((s) => !s)}
        />
        <Button title="Clear" testID="bench-clear" onPress={() => setResults([])} />
      </View>
      <Text style={styles.sectionHint} testID="bench-status">
        {running ? `running ${current}` : 'idle'}
      </Text>
      <BenchDisplay
        key={`${impl}-${count}`}
        impl={impl}
        rate={rate}
        count={count}
        running={running}
        shimmer={shimmer}
        onDone={onDone}
      />
      {results.map((r, i) => (
        <Text key={i} style={styles.benchResult} testID={i === 0 ? 'bench-result' : undefined}>
          {formatStats(r)}
        </Text>
      ))}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Feature demos
// ---------------------------------------------------------------------------

function ReactDrivenDemo() {
  const [value, setValue] = useState(1234.5)
  const [mounted, setMounted] = useState(true)
  return (
    <Section title="React prop" hint="Change `value`, the digits roll natively. Fits the card: full size until it would overflow, then it shrinks.">
      <View style={styles.display}>
        {mounted ? (
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          prefix="$"
          fontSize={52}
          fontWeight="700"
          color="#0A84FF"
          easing="spring"
          bounce={0.2}
          duration={700}
          stagger={40}
          adjustsFontSizeToFit
          minimumFontScale={0.35}
          style={styles.fitCard}
          testID="react-driven"
        />
        ) : (
          <Text style={styles.sectionHint}>unmounted</Text>
        )}
      </View>
      <View style={styles.row}>
        <Button title="+1" onPress={() => setValue((v) => v + 1)} />
        <Button title="+123.45" onPress={() => setValue((v) => v + 123.45)} />
        <Button title="×10" onPress={() => setValue((v) => v * 10)} />
        <Button title="−1" onPress={() => setValue((v) => v - 1)} />
        <Button title="÷10" onPress={() => setValue((v) => v / 10)} />
        <Button title="Random" onPress={() => setValue(Math.round(Math.random() * 1_000_000_00) / 100)} />
        <Button title="Negate" onPress={() => setValue((v) => -v)} />
        <Button title="Reset" onPress={() => setValue(1234.5)} />
        <Button title={mounted ? 'Unmount' : 'Remount'} onPress={() => setMounted((m) => !m)} />
      </View>
    </Section>
  )
}

function CurrencyDemo() {
  const [value, setValue] = useState(4280.5)
  const [loading, setLoading] = useState(false)
  return (
    <Section title="Currency layouts" hint="Smaller prefix/suffix, shrink-to-fit inside a fixed width, loading shimmer.">
      <View style={styles.display}>
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          prefix="$"
          prefixFontSize={22}
          affixAlign="top"
          fontSize={44}
          fontFamily="OpenRunde-Semibold"
          loading={loading}
          testID="currency-prefix"
        />
      </View>
      <View style={styles.display}>
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          suffix=" USD"
          suffixFontSize={16}
          suffixAlign="bottom"
          fontSize={44}
          fontWeight="600"
          color="#5E5CE6"
          testID="currency-suffix"
        />
      </View>
      <Text style={styles.sectionHint}>Fixed 180×64pt box with adjustsFontSizeToFit (box never resizes):</Text>
      <View style={styles.fitBox}>
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          prefix="$"
          fontSize={44}
          fontWeight="700"
          adjustsFontSizeToFit
          minimumFontScale={0.3}
          textAlign="center"
          style={styles.fitNumber}
          testID="currency-fit"
        />
      </View>
      <View style={styles.row}>
        <Button title="×100" onPress={() => setValue((v) => v * 100)} />
        <Button title="÷100" onPress={() => setValue((v) => v / 100)} />
        <Button title="+0.99" onPress={() => setValue((v) => v + 0.99)} />
        <Button title="Reset" onPress={() => setValue(4280.5)} />
        <Button title={loading ? 'Loaded' : 'Loading…'} onPress={() => setLoading((l) => !l)} />
      </View>
    </Section>
  )
}

function CenteredDemo() {
  const [value, setValue] = useState(875.4)
  return (
    <Section title="Centered in a fixed box" hint={'OpenRunde-Bold (bundled font), textAlign="center", top-pinned prefix and bottom-pinned suffix; watch them slide as digits appear.'}>
      <View style={styles.centerBox}>
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          prefix="$"
          prefixFontSize={20}
          prefixAlign="top"
          suffix=" USD"
          suffixFontSize={14}
          suffixAlign="bottom"
          fontSize={40}
          fontFamily="OpenRunde-Bold"
          textAlign="center"
          stagger={30}
          style={styles.centerNumber}
          testID="centered"
        />
      </View>
      <View style={styles.row}>
        <Button title="×10" onPress={() => setValue((v) => v * 10)} />
        <Button title="÷10" onPress={() => setValue((v) => v / 10)} />
        <Button title="+1" onPress={() => setValue((v) => v + 1)} />
        <Button title="Random" onPress={() => setValue(Math.round(Math.random() * 10_000_000) / 100)} />
        <Button title="Reset" onPress={() => setValue(875.4)} />
      </View>
    </Section>
  )
}

function ImperativeDemo() {
  const ref = useRef<RollingNumberHandle>(null)
  return (
    <Section title="Imperative handle" hint="`animateTo` rolls, `jumpTo` positions the wheels continuously.">
      <View style={styles.display}>
        <RollingNumber
          ref={ref}
          value={42}
          fractionDigits={1}
          minimumIntegerDigits={4}
          fontSize={44}
          fontFamily="Menlo"
          color="#30D158"
          duration={400}
          easing="easeOut"
          testID="imperative"
        />
      </View>
      <View style={styles.row}>
        <Button title="animateTo(7)" onPress={() => ref.current?.animateTo(7)} />
        <Button title="animateTo(9999)" onPress={() => ref.current?.animateTo(9999)} />
        <Button title="jumpTo(1234.5)" onPress={() => ref.current?.jumpTo(1234.5)} />
        <Button title="jumpTo(999.75)" onPress={() => ref.current?.jumpTo(999.75)} />
        <Button title="jumpTo(−3.5)" onPress={() => ref.current?.jumpTo(-3.5)} />
      </View>
      <Text style={styles.sectionHint}>Scroll the strip to scrub with jumpTo:</Text>
      <ScrollView
        horizontal
        onScroll={(e) => ref.current?.jumpTo(e.nativeEvent.contentOffset.x / 4)}
        scrollEventThrottle={16}
        style={styles.scrubber}
        contentContainerStyle={styles.scrubberContent}
        showsHorizontalScrollIndicator={false}
        testID="scrubber"
      >
        {Array.from({ length: 40 }, (_, i) => (
          <View key={i} style={styles.tick}>
            <Text style={styles.tickLabel}>{i * 100}</Text>
          </View>
        ))}
      </ScrollView>
    </Section>
  )
}

/** The win tiers of the demo rollup: the count lands on each, punches, holds, then runs on. */
const REVEAL_MILESTONES = [1000, 10000, 25000]

function RevealDemo() {
  const [amount, setAmount] = useState(50000)
  const [spin, setSpin] = useState(false)
  const [landed, setLanded] = useState(false)
  const [style, setStyle] = useState<'count' | 'spin'>('count')
  const [tiers, setTiers] = useState(true)
  const ref = useRef<RollingNumberHandle>(null)
  const status = landed ? 'Credit unlocked' : spin ? (style === 'spin' ? 'Spinning…' : 'Counting…') : 'Ready when you are'
  const rearm = () => setLanded(false)
  return (
    <Section
      title="Jackpot reveal"
      hint="`reveal={false}` holds the opening frame; flip it and the figure plays the casino win-meter rollup (count) or the jackpot reels (spin), then lands with a pop. With tiers, the count runs tier by tier: it lands on each milestone, punches, holds, then accelerates again. Tap the number to skip."
    >
      <View style={styles.row}>
        <Button title="Count" selected={style === 'count'} testID="reveal-style-count" onPress={() => { setSpin(false); rearm(); setStyle('count') }} />
        <Button title="Spin" selected={style === 'spin'} testID="reveal-style-spin" onPress={() => { setSpin(false); rearm(); setStyle('spin') }} />
        <Button title={tiers ? 'Tiers: 1k / 10k / 25k' : 'Tiers: off'} testID="reveal-tiers" onPress={() => { setSpin(false); rearm(); setTiers((t) => !t) }} />
      </View>
      <Pressable style={styles.revealCard} onPress={() => spin && !landed && ref.current?.jumpTo(amount)}>
        <Text style={styles.revealTitle}>Congrats!</Text>
        <RollingNumber
          ref={ref}
          value={amount}
          reveal={spin}
          revealStyle={style}
          revealMilestones={tiers ? REVEAL_MILESTONES : undefined}
          revealMilestoneHold={400}
          revealDuration={tiers && style === 'count' ? 4800 : 2200}
          onRevealEnd={() => setLanded(true)}
          prefix="$"
          fractionDigits={2}
          groupingSeparator=","
          fontSize={52}
          fontWeight="800"
          color="#fff"
          textAlign="center"
          style={styles.revealNumber}
          testID="reveal"
        />
        <Text style={styles.revealSubtitle} testID="reveal-status">{status}</Text>
      </Pressable>
      <View style={styles.row}>
        <Button
          title={spin ? 'Reset' : 'Reveal'}
          testID="reveal-toggle"
          onPress={() => {
            rearm()
            setSpin((s) => !s)
          }}
        />
        <Button
          title="Random amount"
          onPress={() => {
            rearm()
            setSpin(false)
            setAmount(Math.round(Math.random() * 9_999_999) / 100)
          }}
        />
        <Button
          title="revealTo(1,234.56)"
          onPress={() => {
            rearm()
            ref.current?.revealTo(1234.56)
          }}
        />
      </View>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Showcase: button-free, auto-playing screens for the docs recordings. Tap the
// invisible top-right corner to leave.
// ---------------------------------------------------------------------------

type Showcase = 'balance' | 'reveal' | null

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places

function AssetRow({ name, ticker, tint, amount, price }: { name: string; ticker: string; tint: string; amount: number; price: number }) {
  return (
    <View style={showcase.card}>
      <View style={[showcase.coin, { backgroundColor: tint }]}>
        <Text style={showcase.coinText}>{ticker[0]}</Text>
      </View>
      <View>
        <Text style={showcase.cardName}>{name}</Text>
        <Text style={showcase.cardSub}>{ticker}</Text>
      </View>
      <View style={showcase.cardRight}>
        <RollingNumber
          value={amount}
          fractionDigits={4}
          suffix={' ' + ticker}
          suffixFontSize={12}
          suffixAlign="bottom"
          fontSize={20}
          fontWeight="700"
          color="#fff"
          textAlign="right"
          duration={600}
          easing="easeOut"
          style={showcase.cardAmount}
        />
        <RollingNumber
          value={price}
          prefix="$"
          fractionDigits={2}
          groupingSeparator=","
          fontSize={13}
          fontWeight="500"
          color="rgba(255,255,255,0.55)"
          textAlign="right"
          duration={600}
          easing="easeOut"
          style={showcase.cardAmount}
        />
      </View>
    </View>
  )
}

function BalanceShowcase({ onExit }: { onExit: () => void }) {
  const [balance, setBalance] = useState(128_430.55)
  const [today, setToday] = useState(1_284.12)
  const [btc, setBtc] = useState(0.4821)
  const [eth, setEth] = useState(3.2041)
  const [btcPrice, setBtcPrice] = useState(64_210.9)
  const [ethPrice, setEthPrice] = useState(3_412.75)
  useEffect(() => {
    const balanceTimer = setInterval(() => {
      const delta = (Math.random() - 0.42) * 1900
      setBalance((b) => Math.max(0, round(b + delta, 2)))
      setToday((t) => round(t + delta, 2))
    }, 1300)
    const priceTimer = setInterval(() => {
      setBtcPrice((p) => round(p + (Math.random() - 0.5) * 700, 2))
      setEthPrice((p) => round(p + (Math.random() - 0.5) * 40, 2))
    }, 900)
    const holdingsTimer = setInterval(() => {
      setBtc((v) => round(v + (Math.random() - 0.45) * 0.05, 4))
      setEth((v) => round(v + (Math.random() - 0.45) * 0.3, 4))
    }, 2600)
    return () => {
      clearInterval(balanceTimer)
      clearInterval(priceTimer)
      clearInterval(holdingsTimer)
    }
  }, [])
  const up = today >= 0
  return (
    <View style={showcase.root}>
      <StatusBar hidden />
      <View style={showcase.glowA} />
      <View style={showcase.glowB} />
      <Pressable style={showcase.exit} onPress={onExit} testID="showcase-exit" />
      <Text style={showcase.eyebrow}>Total balance</Text>
      <RollingNumber
        value={balance}
        prefix="$"
        prefixFontSize={30}
        affixAlign="top"
        fractionDigits={2}
        groupingSeparator=","
        fontSize={58}
        fontWeight="800"
        color="#fff"
        easing="spring"
        bounce={0.12}
        stagger={25}
        duration={700}
        textAlign="center"
        style={showcase.hero}
      />
      <View style={showcase.pill}>
        <RollingNumber
          value={Math.abs(today)}
          prefix={up ? '+$' : '−$'}
          fractionDigits={2}
          groupingSeparator=","
          fontSize={16}
          fontWeight="700"
          color={up ? '#34D399' : '#F87171'}
          duration={600}
          easing="easeOut"
        />
        <Text style={showcase.pillText}>today</Text>
      </View>
      <View style={showcase.cards}>
        <AssetRow name="Bitcoin" ticker="BTC" tint="#F7931A" amount={btc} price={btcPrice} />
        <AssetRow name="Ethereum" ticker="ETH" tint="#627EEA" amount={eth} price={ethPrice} />
      </View>
    </View>
  )
}

function RevealShowcase({ onExit }: { onExit: () => void }) {
  const [style, setStyle] = useState<'count' | 'spin'>('count')
  const [amount, setAmount] = useState(50_000)
  const [reveal, setReveal] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms))
  }
  useEffect(() => {
    later(900, () => setReveal(true))
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])
  // Count with tiers → hold → reels → hold → again.
  const onRevealEnd = () => {
    later(1800, () => {
      setReveal(false)
      later(700, () => {
        setStyle((s) => (s === 'count' ? 'spin' : 'count'))
        setAmount((a) => (a === 50_000 ? 25_750 : 50_000))
        later(400, () => setReveal(true))
      })
    })
  }
  return (
    <View style={[showcase.root, showcase.rootBrand]}>
      <StatusBar hidden />
      <View style={[showcase.glowA, showcase.glowBrand]} />
      <Pressable style={showcase.exit} onPress={onExit} testID="showcase-exit" />
      <View style={showcase.badge}>
        <Text style={showcase.badgeText}>🎉</Text>
      </View>
      <Text style={showcase.revealTitle}>Congratulations!</Text>
      <Text style={showcase.revealSub}>You've unlocked</Text>
      <RollingNumber
        value={amount}
        reveal={reveal}
        revealStyle={style}
        revealMilestones={[1000, 10000, 25000]}
        revealMilestoneHold={400}
        revealDuration={style === 'count' ? 4800 : 2400}
        onRevealEnd={onRevealEnd}
        prefix="$"
        fractionDigits={2}
        groupingSeparator=","
        fontSize={62}
        fontWeight="800"
        color="#fff"
        textAlign="center"
        style={showcase.hero}
      />
      <Text style={showcase.revealSub}>in credit</Text>
      <View style={showcase.cta}>
        <Text style={showcase.ctaText}>Claim credit</Text>
      </View>
    </View>
  )
}

const showcase = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F19', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, overflow: 'hidden' },
  rootBrand: { backgroundColor: '#1D4ED8' },
  glowA: { position: 'absolute', width: 460, height: 460, borderRadius: 230, backgroundColor: '#2563EB', opacity: 0.3, top: -160, left: -140 },
  glowB: { position: 'absolute', width: 380, height: 380, borderRadius: 190, backgroundColor: '#0EA5E9', opacity: 0.18, bottom: -140, right: -120 },
  glowBrand: { backgroundColor: '#60A5FA', opacity: 0.35 },
  exit: { position: 'absolute', top: 0, right: 0, width: 72, height: 72 },
  eyebrow: { color: 'rgba(255,255,255,0.65)', fontSize: 13, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: '600', marginBottom: 10 },
  hero: { width: '100%' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 14 },
  pillText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  cards: { width: '100%', marginTop: 40, gap: 12 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 18, padding: 16, gap: 14 },
  coin: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  coinText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  cardName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cardSub: { color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 2 },
  cardRight: { marginLeft: 'auto', alignItems: 'flex-end', gap: 2 },
  cardAmount: { width: 150 },
  badge: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  badgeText: { fontSize: 36 },
  revealTitle: { color: '#fff', fontSize: 28, fontWeight: '800' },
  revealSub: { color: 'rgba(255,255,255,0.8)', fontSize: 16, marginVertical: 10 },
  cta: { position: 'absolute', bottom: 132, left: 24, right: 24, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#1D4ED8', fontWeight: '700', fontSize: 16 },
})

function App() {
  const dark = useColorScheme() === 'dark'
  const [showing, setShowing] = useState<Showcase>(null)
  if (showing === 'balance') return <BalanceShowcase onExit={() => setShowing(null)} />
  if (showing === 'reveal') return <RevealShowcase onExit={() => setShowing(null)} />
  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, dark && styles.rootDark]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.title, dark && styles.titleDark]}>Nitro Rolling Number</Text>
          <View style={styles.row}>
            <Button title="Showcase: Balance" testID="showcase-balance" onPress={() => setShowing('balance')} />
            <Button title="Showcase: Reveal" testID="showcase-reveal" onPress={() => setShowing('reveal')} />
          </View>
          <RevealDemo />
          <ReactDrivenDemo />
          <CurrencyDemo />
          <CenteredDemo />
          <ImperativeDemo />
          <Benchmark />
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  rootDark: { backgroundColor: '#000' },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#111' },
  titleDark: { color: '#fff' },
  section: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  sectionHint: { fontSize: 13, color: '#666' },
  display: {
    minHeight: 72,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  benchSingle: {
    height: 72,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  benchGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8 },
  benchCell: { width: '48%', height: 34, justifyContent: 'center' },
  benchResult: { fontSize: 12, color: '#111', fontVariant: ['tabular-nums'] },
  tabular: { fontVariant: ['tabular-nums'] },
  fitBox: {
    width: 180,
    height: 64,
    borderWidth: 1,
    borderColor: '#C7C7CC',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fitNumber: { width: 164 },
  fitCard: { maxWidth: '100%' },
  centerBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C7C7CC',
    borderRadius: 10,
    paddingVertical: 10,
  },
  centerNumber: { width: '100%' },
  revealCard: {
    backgroundColor: '#1D4ED8',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 6,
  },
  revealTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  revealNumber: { width: '100%' },
  revealSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    backgroundColor: '#E5E5EA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  buttonSelected: { backgroundColor: '#0A84FF' },
  buttonPressed: { opacity: 0.6 },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#111' },
  buttonTextSelected: { color: '#fff' },
  scrubber: { height: 44, backgroundColor: '#F2F2F7', borderRadius: 10 },
  scrubberContent: { alignItems: 'center' },
  tick: { width: 400, height: 44, justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: '#C7C7CC', paddingLeft: 6 },
  tickLabel: { fontSize: 12, color: '#8E8E93' },
})

export default App
