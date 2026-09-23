import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type FrameInfo,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { NitroInput, NitroNumber, type NitroInputHandle, type NitroNumberRef } from 'react-native-nitro-input'

// ---------------------------------------------------------------------------
// Showcases: button-free, auto-playing screens for the docs and README
// recordings (scripts/record-demos.md). Each loops, so a recording can start
// anywhere. Tap the invisible top-right corner to leave.
// ---------------------------------------------------------------------------

const FONT = {
  regular: 'OpenRunde-Regular',
  medium: 'OpenRunde-Medium',
  semibold: 'OpenRunde-Semibold',
  bold: 'OpenRunde-Bold',
}

const UP = '#34D399'
const DOWN = '#FB7185'

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places
const money = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Timers that are all cleared when the screen goes away. */
function useTimers() {
  const pending = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => pending.current.forEach(clearTimeout), [])
  return (ms: number, fn: () => void) => {
    pending.current.push(setTimeout(fn, ms))
  }
}

/** Keeps the JS thread busy, doing nothing else, for `ms`. */
function blockJsThread(ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    // spin
  }
}

/** The page behind a showcase: a base colour and soft light, drawn as radial gradients. */
function Backdrop({ base, lights }: { base: string; lights: string[] }) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: base, backgroundImage: lights.join(', ') }]}
    />
  )
}

function Exit({ onExit }: { onExit: () => void }) {
  return <Pressable style={s.exit} onPress={onExit} testID="showcase-exit" />
}

// ------------------------------------------------------------------ meters

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

/** Frames per second on the UI thread, measured and drawn there: it keeps counting while JS is blocked. */
function UiFps() {
  const fps = useSharedValue(0)
  const window = useSharedValue({ start: 0, frames: 0 })
  useFrameCallback((frame) => {
    'worklet'
    const w = window.value
    if (w.start === 0) {
      window.value = { start: frame.timestamp, frames: 0 }
      return
    }
    const frames = w.frames + 1
    const elapsed = frame.timestamp - w.start
    if (elapsed >= 500) {
      fps.value = Math.round((frames * 1000) / elapsed)
      window.value = { start: frame.timestamp, frames: 0 }
    } else {
      window.value = { start: w.start, frames }
    }
  })
  const props = useAnimatedProps(() => {
    const text = `${fps.value} fps`
    return { text, defaultValue: text } as never
  })
  return (
    <AnimatedTextInput
      editable={false}
      underlineColorAndroid="transparent"
      style={s.meterValue}
      animatedProps={props}
      defaultValue="— fps"
    />
  )
}



// ------------------------------------------------------------------ market
//
// Built so that a tick re-renders only what it changed: the watchlist owns
// its feed and its rows are memoised, the chart is memoised on its series,
// and the setState lane and the JS meter keep their own state. A showcase
// for speed should not spend the phone's time re-rendering itself.

const POINTS = 32
const CHART_HEIGHT = 140

/** A line chart from plain views: one rotated segment per step, a gradient column under each point. */
const LineChart = React.memo(function LineChart({ series, color }: { series: number[]; color: string }) {
  const [width, setWidth] = useState(0)
  const height = CHART_HEIGHT
  const lo = Math.min(...series)
  const hi = Math.max(...series)
  const span = Math.max(hi - lo, 1e-9)
  const pad = 14
  const pts = series.map((v, i) => ({
    x: (i / (series.length - 1)) * width,
    y: pad + (1 - (v - lo) / span) * (height - pad * 2),
  }))
  const step = width / (series.length - 1)
  const last = pts[pts.length - 1]
  return (
    <View style={[s.chart, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 &&
        pts.map((p, i) => (
          <View
            key={`a${i}`}
            style={[
              s.area,
              {
                left: p.x - step / 2 - 0.75,
                top: p.y,
                width: step + 1.5,
                height: height - p.y,
                backgroundImage: `linear-gradient(180deg, ${color}40, ${color}00)`,
              },
            ]}
          />
        ))}
      {width > 0 &&
        pts.slice(1).map((p, i) => {
          const a = pts[i]
          const dx = p.x - a.x
          const dy = p.y - a.y
          return (
            <View
              key={`l${i}`}
              style={[
                s.segment,
                {
                  left: a.x,
                  top: a.y - 1.25,
                  width: Math.hypot(dx, dy) + 0.8,
                  backgroundColor: color,
                  transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                },
              ]}
            />
          )
        })}
      {width > 0 && last && (
        <View style={[s.dot, { left: last.x - 5, top: last.y - 5, backgroundColor: color, boxShadow: `0 0 12px ${color}` }]} />
      )}
    </View>
  )
})

/** Frames per second on the JS thread, from requestAnimationFrame: it stops while JS is blocked. */
function JsFps({ blocked }: { blocked: boolean }) {
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
  return <Text style={[s.meterValue, blocked && s.meterValueBlocked]}>{blocked ? 'blocked' : `${fps} fps`}</Text>
}

const WATCH = [
  { sym: 'AAPL', name: 'Apple', from: '#E5E7EB', to: '#9CA3AF', price: 227.48 },
  { sym: 'NVDA', name: 'NVIDIA', from: '#84CC16', to: '#3F6212', price: 131.26 },
  { sym: 'TSLA', name: 'Tesla', from: '#F87171', to: '#B91C1C', price: 248.5 },
  { sym: 'ETH', name: 'Ethereum', from: '#A5B4FC', to: '#4F46E5', price: 3_412.75 },
  { sym: 'SOL', name: 'Solana', from: '#C084FC', to: '#14B8A6', price: 148.32 },
  { sym: 'MSFT', name: 'Microsoft', from: '#7DD3FC', to: '#0369A1', price: 418.12 },
]
const ROW_HEIGHT = 56

/** How long a stress test hands the feeds to the UI thread; it covers the 2 s the JS thread is blocked. */
const UI_FEED = 2300

/**
 * The state of a feed that runs on the UI thread: `left` ms still to run,
 * `wait` ms to the next tick, and its prices (the rows', or the asset's ticks).
 */
type UiFeed = { left: number; wait: number; prices: number[] }
const IDLE: UiFeed = { left: 0, wait: 0, prices: [] }

const WatchRow = React.memo(function WatchRow({
  item,
  index,
  price,
  up,
  attach,
}: {
  item: (typeof WATCH)[number]
  index: number
  price: number
  up: boolean
  attach: (index: number, ref: NitroNumberRef) => void
}) {
  return (
    <View style={s.watchRow}>
      <View style={[s.logo, { backgroundImage: `linear-gradient(135deg, ${item.from}, ${item.to})` }]}>
        <Text style={s.logoText}>{item.sym[0]}</Text>
      </View>
      <View style={s.watchText}>
        <Text style={s.watchSym}>{item.sym}</Text>
        <Text style={s.watchName}>{item.name}</Text>
      </View>
      <View style={[s.pill, { backgroundColor: up ? '#10B981' : '#F43F5E' }]}>
        <NitroNumber
          value={price}
          prefix="$"
          fractionDigits={2}
          groupingSeparator=","
          transition="numeric"
          fontFamily={FONT.bold}
          fontSize={15}
          color="#FFFFFF"
          textAlign="right"
          style={s.pillNumber}
          onNativeRef={(ref) => attach(index, ref)}
        />
      </View>
    </View>
  )
})

/**
 * The watchlist owns its feed: a price moves every 150 ms, and only that row
 * re-renders. While JS is blocked the feed runs on the UI thread instead,
 * calling `animateTo` on the rows' Nitro objects directly, and hands React
 * the prices when it ends.
 */
function Watchlist({ blocked }: { blocked: boolean }) {
  const [rows, setRows] = useState(() => WATCH.map((w) => ({ price: w.price, up: true })))
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const [fit, setFit] = useState(0)
  const refs = useRef<NitroNumberRef[]>([])
  const [attached, setAttached] = useState(0)
  const attach = useCallback((index: number, ref: NitroNumberRef) => {
    refs.current[index] = ref
    setAttached((n) => n + 1)
  }, [])

  const move = useCallback((i: number, price: number) => {
    setRows((previous) => {
      const next = [...previous]
      next[i] = { price, up: price >= previous[i].price }
      return next
    })
  }, [])
  // React catches up with the UI thread's feed in one render. Posting every
  // tick instead would replay them once JS is free, rolling each row back
  // through prices it has already shown.
  const settle = useCallback((prices: number[]) => {
    setRows((previous) => previous.map((r, i) => ({ price: prices[i] ?? r.price, up: (prices[i] ?? r.price) >= r.price })))
  }, [])

  useEffect(() => {
    if (blocked) return
    const feed = setInterval(() => {
      const i = Math.floor(Math.random() * Math.min(WATCH.length, Math.max(fit, 1)))
      move(i, round(rowsRef.current[i].price * (1 + (Math.random() - 0.47) * 0.004), 2))
    }, 150)
    return () => clearInterval(feed)
  }, [blocked, fit, move])

  const uiFeed = useSharedValue<UiFeed>(IDLE)
  const views = refs.current.slice(0, fit)
  useEffect(() => {
    if (blocked) uiFeed.value = { left: UI_FEED, wait: 0, prices: rowsRef.current.map((r) => r.price) }
  }, [blocked, uiFeed])

  const tick = useCallback(
    (frame: FrameInfo) => {
      'worklet'
      const feed = uiFeed.value
      if (feed.left <= 0) return
      const dt = frame.timeSincePreviousFrame ?? 0
      const left = feed.left - dt
      if (left <= 0) {
        uiFeed.value = IDLE
        scheduleOnRN(settle, feed.prices)
        return
      }
      if (feed.wait - dt > 0) {
        uiFeed.value = { left, wait: feed.wait - dt, prices: feed.prices }
        return
      }
      const count = Math.min(views.length, feed.prices.length)
      const i = Math.floor(Math.random() * count)
      const prices = feed.prices.slice()
      prices[i] = Math.round(prices[i] * (1 + (Math.random() - 0.47) * 0.004) * 100) / 100
      views[i]?.animateTo(prices[i])
      uiFeed.value = { left, wait: 150, prices }
    },
    // The worklet captures the Nitro objects attached so far.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attached, fit, settle, uiFeed]
  )
  useFrameCallback(tick)

  return (
    <View style={s.watchlist} onLayout={(e) => setFit(Math.floor(e.nativeEvent.layout.height / ROW_HEIGHT))}>
      {WATCH.slice(0, fit).map((w, i) => (
        <WatchRow key={w.sym} item={w} index={i} price={rows[i].price} up={rows[i].up} attach={attach} />
      ))}
    </View>
  )
}

type Phase = 'live' | 'blocking' | 'after'

const OPENING = 64_210.9

/**
 * An asset page: the price rolls as a live feed arrives, the chart extends,
 * the watchlist's prices swap their digits in place, and every ten seconds
 * the JS thread is blocked for two. Then the feed moves to the UI thread and
 * calls the NitroNumbers' `animateTo` directly: every price keeps updating,
 * the UI thread meter holds the display's rate, and the chart and the Text
 * driven by setState freeze until JS catches up.
 */
export function MarketShowcase({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets()
  const later = useTimers()
  const [price, setPrice] = useState(OPENING)
  const [series, setSeries] = useState<number[]>(() =>
    Array.from({ length: POINTS }, (_, i) => OPENING * (0.985 + 0.012 * Math.sin(i / 4) + 0.006 * Math.cos(i * 1.3) + i * 0.0003))
  )
  const [phase, setPhase] = useState<Phase>('live')
  const blocked = phase === 'blocking'
  const priceRef = useRef(price)
  priceRef.current = price

  const tickTo = useCallback((next: number) => {
    setPrice(next)
    setSeries((sr) => [...sr.slice(1), next])
  }, [])
  // React catches up with the UI thread's feed in one render: the price it
  // ended on, and every tick on the chart. Posting each tick instead would
  // replay them once JS is free, rolling the numbers back through old prices.
  const settle = useCallback((ticks: number[]) => {
    setPrice(ticks[ticks.length - 1])
    setSeries((sr) => [...sr, ...ticks.slice(1)].slice(-POINTS))
  }, [])

  // The asset moves every 650 ms, and the chart with it.
  useEffect(() => {
    if (blocked) return
    const asset = setInterval(() => {
      tickTo(round(priceRef.current * (1 + (Math.random() - 0.44) * 0.0025), 2))
    }, 650)
    return () => clearInterval(asset)
  }, [blocked, tickTo])

  // The same feed on the UI thread, for the stress test: it drives the
  // headline, the lane and the change figures through their Nitro objects.
  const nums = useRef<{ hero?: NitroNumberRef; lane?: NitroNumberRef; change?: NitroNumberRef; pct?: NitroNumberRef }>({})
  const [attached, setAttached] = useState(0)
  const attach = (key: keyof typeof nums.current) => (ref: NitroNumberRef) => {
    nums.current[key] = ref
    setAttached((n) => n + 1)
  }
  const uiFeed = useSharedValue<UiFeed>(IDLE)
  const { hero, lane, change: changeView, pct: pctView } = nums.current
  const tick = useCallback(
    (frame: FrameInfo) => {
      'worklet'
      const feed = uiFeed.value
      if (feed.left <= 0) return
      const dt = frame.timeSincePreviousFrame ?? 0
      const left = feed.left - dt
      if (left <= 0) {
        uiFeed.value = IDLE
        scheduleOnRN(settle, feed.prices)
        return
      }
      if (feed.wait - dt > 0) {
        uiFeed.value = { left, wait: feed.wait - dt, prices: feed.prices }
        return
      }
      const last = feed.prices[feed.prices.length - 1]
      const next = Math.round(last * (1 + (Math.random() - 0.44) * 0.0025) * 100) / 100
      // Rounded exactly as the render below rounds them, so that when React
      // catches up the props match what is already on screen.
      const change = Math.round((next - OPENING) * 100) / 100
      const pct = Math.round(((change / OPENING) * 100) * 100) / 100
      hero?.animateTo(next)
      lane?.animateTo(next)
      changeView?.animateTo(Math.abs(change))
      pctView?.animateTo(Math.abs(pct))
      uiFeed.value = { left, wait: 500, prices: [...feed.prices, next] }
    },
    // The worklet captures the Nitro objects attached so far.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attached, settle, uiFeed]
  )
  useFrameCallback(tick)

  // The stress test, every ten seconds.
  useEffect(() => {
    const cycle = () => {
      later(6000, () => {
        setPhase('blocking')
        uiFeed.value = { left: UI_FEED, wait: 0, prices: [priceRef.current] }
        // Let the phase reach the screen, then take the JS thread away.
        later(250, () => blockJsThread(2000))
        later(2400, () => setPhase('after'))
        later(5200, () => {
          setPhase('live')
          cycle()
        })
      })
    }
    cycle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const change = round(price - OPENING, 2)
  const pct = round((change / OPENING) * 100, 2)
  const up = change >= 0
  const tone = up ? UP : DOWN

  return (
    <View style={s.root}>
      <StatusBar hidden />
      <Backdrop
        base="#06080C"
        lights={[
          `radial-gradient(circle at 50% 30%, ${up ? 'rgba(16,185,129,0.16)' : 'rgba(244,63,94,0.16)'}, transparent 55%)`,
          'radial-gradient(circle at 100% 0%, rgba(59,130,246,0.16), transparent 45%)',
        ]}
      />
      <Exit onExit={onExit} />
      <View style={[s.page, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 8 }]}>
        <View style={s.assetHeader}>
          <View style={[s.logo, s.logoLarge, { backgroundImage: 'linear-gradient(135deg, #FDBA74, #F7931A)' }]}>
            <Text style={[s.logoText, s.logoTextLarge]}>₿</Text>
          </View>
          <View style={s.assetTitle}>
            <Text style={s.assetName}>Bitcoin</Text>
            <Text style={s.assetSub}>BTC · Crypto</Text>
          </View>
          <View style={s.meters}>
            <View style={s.meter}>
              <Text style={s.meterLabel}>UI</Text>
              <UiFps />
            </View>
            <View style={[s.meter, blocked && s.meterBlocked]}>
              <Text style={s.meterLabel}>JS</Text>
              <JsFps blocked={blocked} />
            </View>
          </View>
        </View>

        <NitroNumber
          value={price}
          prefix="$"
          prefixFontSize={28}
          affixAlign="top"
          fractionDigits={2}
          groupingSeparator=","
          fontFamily={FONT.bold}
          fontSize={50}
          color="#FFFFFF"
          easing="spring"
          bounce={0.1}
          stagger={22}
          duration={650}
          style={s.hero}
          onNativeRef={attach('hero')}
        />
        <View style={s.changeRow}>
          <Text style={[s.changeArrow, { color: tone }]}>{up ? '▲' : '▼'}</Text>
          <NitroNumber
            value={Math.abs(change)}
            prefix="$"
            fractionDigits={2}
            groupingSeparator=","
            transition="numeric"
            fontFamily={FONT.semibold}
            fontSize={15}
            color={tone}
            onNativeRef={attach('change')}
          />
          <NitroNumber
            value={Math.abs(pct)}
            prefix="("
            suffix="%)"
            fractionDigits={2}
            transition="numeric"
            fontFamily={FONT.semibold}
            fontSize={15}
            color={tone}
            onNativeRef={attach('pct')}
          />
          <Text style={s.changeToday}>Today</Text>
        </View>

        <LineChart series={series} color={tone} />
        <View style={s.ranges}>
          {['1H', '1D', '1W', '1M', '1Y', 'ALL'].map((r) => (
            <Text key={r} style={[s.range, r === '1D' && [s.rangeActive, { color: tone }]]}>
              {r}
            </Text>
          ))}
        </View>

        <View style={[s.versus, blocked && s.versusBlocked]}>
          <View style={s.lane}>
            <Text style={s.laneLabel}>NitroNumber · native</Text>
            <NitroNumber
              value={price}
              prefix="$"
              fractionDigits={2}
              groupingSeparator=","
              fontFamily={FONT.semibold}
              fontSize={17}
              color={UP}
              duration={650}
              easing="easeOut"
              onNativeRef={attach('lane')}
            />
          </View>
          <View style={s.laneDivider} />
          <View style={s.lane}>
            <Text style={s.laneLabel}>Text · setState</Text>
            <Text style={[s.laneJs, blocked && s.laneJsFrozen]}>${money(price)}</Text>
          </View>
        </View>
        <Text style={[s.caption, blocked && s.captionBlocked]}>
          {phase === 'blocking'
            ? 'JS blocked for 2 s. The feed moved to the UI thread: every NitroNumber keeps updating.'
            : phase === 'after'
              ? 'The chart and the Text waited for JS. The NitroNumbers never did.'
              : 'Every price on this screen updates natively.'}
        </Text>

        <Text style={s.sectionTitle}>Watchlist</Text>
        <Watchlist blocked={blocked} />
      </View>
    </View>
  )
}

// ------------------------------------------------------------------- reward

/** The win levels a slot machine escalates through, one per milestone. */
const TIERS = [
  { name: 'BIG WIN', color: '#5EEAD4', glow: 'rgba(45,212,191,0.9)' },
  { name: 'MEGA WIN', color: '#F0ABFC', glow: 'rgba(232,121,249,0.9)' },
  { name: 'EPIC WIN', color: '#FDE047', glow: 'rgba(250,204,21,0.95)' },
]
const CONFETTI = ['#FBBF24', '#F472B6', '#60A5FA', '#34D399', '#FDE68A', '#C084FC']
const RAYS = 14
const COINS = 18

/** One piece of confetti, launched on every change of `burst`. */
function Piece({ burst, index }: { burst: number; index: number }) {
  const t = useSharedValue(0)
  const angle = (index / 32) * Math.PI * 2 + (index % 3) * 0.2
  const speed = 170 + ((index * 37) % 110)
  useEffect(() => {
    if (burst === 0) return
    t.value = 0
    t.value = withTiming(1, { duration: 1700, easing: Easing.out(Easing.quad) })
  }, [burst, t])
  const style = useAnimatedStyle(() => {
    const x = Math.cos(angle) * speed * t.value
    const y = Math.sin(angle) * speed * t.value + 300 * t.value * t.value
    return {
      opacity: t.value === 0 ? 0 : 1 - t.value,
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${t.value * (index % 2 ? 620 : -620)}deg` }],
    }
  })
  return <Animated.View style={[s.piece, { backgroundColor: CONFETTI[index % CONFETTI.length] }, style]} />
}

/** A gold coin that keeps falling while `rain` is up, flipping as it goes. */
function Coin({ index, height, rain }: { index: number; height: number; rain: { value: number } }) {
  const fall = useSharedValue(0)
  const x = ((index * 61) % 100) / 100
  const size = 22 + ((index * 13) % 14)
  useEffect(() => {
    fall.value = withDelay(
      (index * 173) % 1400,
      withRepeat(withTiming(1, { duration: 1500 + ((index * 97) % 900), easing: Easing.in(Easing.quad) }), -1)
    )
  }, [fall, index])
  const style = useAnimatedStyle(() => ({
    opacity: rain.value,
    transform: [
      { translateY: -60 + fall.value * (height + 120) },
      { scaleX: Math.abs(Math.cos(fall.value * Math.PI * 3 + index)) * 0.8 + 0.2 },
    ],
  }))
  return (
    <Animated.View style={[s.coin, { left: `${x * 92}%`, width: size, height: size, borderRadius: size / 2 }, style]}>
      <Text style={[s.coinText, { fontSize: size * 0.5 }]}>$</Text>
    </Animated.View>
  )
}

/**
 * A casino win: a gift box shakes and bursts open, light rays turn behind the
 * figure, NitroNumber counts it up tier by tier (BIG WIN, MEGA WIN, EPIC WIN,
 * each one punching in with a shake and heavier coin rain), and the total
 * lands with a pop and a confetti burst. The next round plays the reels.
 */
export function RewardShowcase({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const later = useTimers()
  const [style, setStyle] = useState<'count' | 'spin'>('count')
  const [amount, setAmount] = useState(50_000)
  const [reveal, setReveal] = useState(false)
  const [tier, setTier] = useState(-1)
  const [burst, setBurst] = useState(0)

  const box = useSharedValue(1) // 1: the gift is there, 0: it has burst
  const wiggle = useSharedValue(0)
  const lid = useSharedValue(0)
  const rays = useSharedValue(0)
  const spin = useSharedValue(0)
  const rain = useSharedValue(0)
  const shake = useSharedValue(0)
  const banner = useSharedValue(0)

  useEffect(() => {
    spin.value = withRepeat(withTiming(360, { duration: 14000, easing: Easing.linear }), -1)
  }, [spin])

  const punch = () => {
    banner.value = 0.4
    banner.value = withSequence(withTiming(1.22, { duration: 160, easing: Easing.out(Easing.back(3)) }), withTiming(1, { duration: 260 }))
    shake.value = withSequence(
      withTiming(-10, { duration: 45 }),
      withTiming(9, { duration: 45 }),
      withTiming(-6, { duration: 45 }),
      withTiming(4, { duration: 45 }),
      withTiming(0, { duration: 45 })
    )
  }

  const playRound = (next: 'count' | 'spin') => {
    // The gift: it wiggles, then the lid flies off and the light comes out.
    setTier(-1)
    box.value = withTiming(1, { duration: 250 })
    lid.value = 0
    rays.value = withTiming(0, { duration: 200 })
    rain.value = withTiming(0, { duration: 300 })
    wiggle.value = withDelay(
      300,
      withSequence(
        ...[1, -1, 1, -1, 1, -1].map((d, i) => withTiming(d * (6 + i * 1.5), { duration: 90 })),
        withTiming(0, { duration: 90 })
      )
    )
    later(1100, () => {
      lid.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) })
      box.value = withDelay(220, withTiming(0, { duration: 320 }))
      rays.value = withTiming(1, { duration: 500 })
      rain.value = withTiming(0.35, { duration: 400 })
      setStyle(next)
      setAmount(next === 'count' ? 50_000 : 25_750)
      later(350, () => setReveal(true))
    })
  }

  useEffect(() => {
    later(500, () => playRound('count'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onRevealMilestone = (index: number) => {
    setTier(index)
    punch()
    rain.value = withTiming(0.45 + index * 0.25, { duration: 250 })
  }

  const onRevealEnd = () => {
    setBurst((b) => b + 1)
    punch()
    if (style === 'spin') setTier(2)
    rain.value = withTiming(1, { duration: 200 })
    later(2600, () => {
      setReveal(false)
      later(500, () => playRound(style === 'count' ? 'spin' : 'count'))
    })
  }

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }))
  const raysStyle = useAnimatedStyle(() => ({ opacity: rays.value * 0.9, transform: [{ rotate: `${spin.value}deg` }, { scale: 0.6 + rays.value * 0.5 }] }))
  const giftStyle = useAnimatedStyle(() => ({ opacity: box.value, transform: [{ rotate: `${wiggle.value}deg` }, { scale: 0.7 + box.value * 0.3 }] }))
  const lidStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -lid.value * 170 }, { translateX: lid.value * 60 }, { rotate: `${lid.value * 38}deg` }],
    opacity: 1 - lid.value * 0.9,
  }))
  const bannerStyle = useAnimatedStyle(() => ({ transform: [{ scale: banner.value }], opacity: banner.value > 0 ? 1 : 0 }))
  const numberStyle = useAnimatedStyle(() => ({ opacity: 1 - box.value }))

  const t = tier >= 0 ? TIERS[tier] : null
  return (
    <View style={s.root}>
      <StatusBar hidden />
      <Backdrop
        base="#0B0618"
        lights={[
          'radial-gradient(circle at 50% 45%, rgba(250,204,21,0.26), transparent 45%)',
          'radial-gradient(circle at 0% 100%, rgba(168,85,247,0.40), transparent 55%)',
          'radial-gradient(circle at 100% 0%, rgba(236,72,153,0.30), transparent 50%)',
        ]}
      />
      <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: COINS }, (_, i) => (
          <Coin key={i} index={i} height={height} rain={rain} />
        ))}
      </View>
      <Exit onExit={onExit} />
      <Animated.View style={[s.center, { paddingTop: insets.top }, shakeStyle]}>
        <Text style={s.kicker}>Jackpot</Text>
        <View style={s.bannerSlot}>
          {t && (
            <Animated.Text style={[s.banner, { color: t.color, textShadowColor: t.glow }, bannerStyle]}>
              {t.name}
            </Animated.Text>
          )}
        </View>
        <View style={s.stage}>
          <Animated.View style={[s.rays, raysStyle]} pointerEvents="none">
            {Array.from({ length: RAYS }, (_, i) => (
              <View key={i} style={[s.ray, { transform: [{ rotate: `${(i * 360) / RAYS}deg` }, { translateY: -130 }] }]} />
            ))}
          </Animated.View>
          <View style={s.halo} />
          <Animated.View style={[s.gift, giftStyle]} pointerEvents="none">
            <Animated.View style={[s.giftLid, lidStyle]}>
              <View style={[s.bowLoop, s.bowLeft]} />
              <View style={[s.bowLoop, s.bowRight]} />
              <View style={s.lidRibbon} />
            </Animated.View>
            <View style={s.giftBody}>
              <View style={s.bodyRibbon} />
            </View>
          </Animated.View>
          <View style={s.burst} pointerEvents="none">
            {Array.from({ length: 32 }, (_, i) => (
              <Piece key={i} burst={burst} index={i} />
            ))}
          </View>
          <Animated.View style={[s.hero, numberStyle]}>
            <NitroNumber
              value={amount}
              reveal={reveal}
              revealStyle={style}
              revealMilestones={[1000, 10000, 25000]}
              revealMilestoneHold={420}
              revealDuration={style === 'count' ? 5200 : 2600}
              revealBounce={0.16}
              onRevealMilestone={onRevealMilestone}
              onRevealEnd={onRevealEnd}
              prefix="$"
              prefixFontSize={34}
              affixAlign="top"
              fractionDigits={2}
              groupingSeparator=","
              fontFamily={FONT.bold}
              fontSize={60}
              color="#FFF7DB"
              textAlign="center"
            />
          </Animated.View>
        </View>
        <Text style={s.rewardSub}>{style === 'count' ? 'Counted tier by tier, natively' : 'Reels locking from the left, natively'}</Text>
      </Animated.View>
      <View style={[s.footer, { paddingBottom: insets.bottom + 28 }]}>
        <View style={s.goldButton}>
          <Text style={s.goldButtonText}>Collect winnings</Text>
        </View>
      </View>
    </View>
  )
}

// ----------------------------------------------------------------- transfer

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']

/** Where the money goes: each currency formatted natively, separators and all. */
const PAYOUTS = [
  { code: 'EUR', flag: '🇪🇺', rate: 0.9218, prefix: '', suffix: ' €', grouping: '.', decimal: ',', digits: 2 },
  { code: 'GBP', flag: '🇬🇧', rate: 0.7712, prefix: '£', suffix: '', grouping: ',', decimal: '.', digits: 2 },
  { code: 'JPY', flag: '🇯🇵', rate: 149.31, prefix: '¥', suffix: '', grouping: ',', decimal: '.', digits: 0 },
  { code: 'CHF', flag: '🇨🇭', rate: 0.8634, prefix: 'CHF ', suffix: '', grouping: '’', decimal: '.', digits: 2 },
]
const FEE = 0.0041
/** The recipient card and the space around it. */
const RECIPIENT_HEIGHT = 96

/** A keypad key; every new `press` count lights it for a moment. */
function Key({ label, press }: { label: string; press: number }) {
  const glow = useSharedValue(0)
  useEffect(() => {
    if (press === 0) return
    glow.value = withSequence(withTiming(1, { duration: 50 }), withDelay(40, withTiming(0, { duration: 240 })))
  }, [press, glow])
  const style = useAnimatedStyle(() => ({
    backgroundColor: `rgba(255,255,255,${glow.value * 0.14})`,
    transform: [{ scale: 1 - glow.value * 0.06 }],
  }))
  return (
    <Animated.View style={[s.key, style]}>
      <Text style={s.keyText}>{label}</Text>
    </Animated.View>
  )
}

function Flag({ flag }: { flag: string }) {
  return (
    <View style={s.flag}>
      <Text style={s.flagText}>{flag}</Text>
    </View>
  )
}

/**
 * A transfer: the keypad types in quick bursts, about seven keys a second, and
 * every keystroke is formatted in C++ before the frame is drawn. What they
 * receive, the fee and the amount converted are NitroNumbers following it,
 * the rate ticks live, and the payout currency changes format as it goes.
 */
export function TransferShowcase({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets()
  const field = useRef<NitroInputHandle>(null)
  const [amount, setAmount] = useState(0)
  const [payout, setPayout] = useState(0)
  const [drift, setDrift] = useState(1)
  const [presses, setPresses] = useState<Record<string, number>>({})
  const [room, setRoom] = useState(0)
  const pending = useRef<ReturnType<typeof setTimeout>[]>([])

  // The rate is live: it moves a little every 1.4 s.
  useEffect(() => {
    const tick = setInterval(() => setDrift((d) => Math.min(1.004, Math.max(0.996, d + (Math.random() - 0.5) * 0.0012))), 1400)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    const at = (ms: number, fn: () => void) => {
      pending.current.push(setTimeout(fn, ms))
    }
    const press = (key: string) => setPresses((p) => ({ ...p, [key]: (p[key] ?? 0) + 1 }))
    const run = () => {
      let t = 400
      let text = ''
      const type = (key: string, step: number) => {
        at(t, () => {
          press(key)
          text = key === '⌫' ? text.slice(0, -1) : text + key
          field.current?.setText(text)
        })
        t += step
      }
      // A quick human burst: the commas reflow as the magnitude grows, and
      // everything below follows each keystroke. Uneven, like fingers; any
      // faster than the reflow and every new digit is still in the air.
      const burst = ['1', '2', '4', '8', '5', '.', '7', '5']
      const rhythm = [150, 130, 170, 140, 190, 130, 150, 150]
      burst.forEach((k, i) => type(k, rhythm[i]))
      t += 700
      // The payout currency changes: the same money, formatted for each.
      for (let i = 1; i < PAYOUTS.length; i++) {
        const next = i
        at(t, () => setPayout(next))
        t += 1100
      }
      at(t, () => setPayout(0))
      t += 800
      for (const k of ['⌫', '⌫', '⌫', '⌫', '⌫']) type(k, 125)
      t += 900
      // A value set from code: the columns reshape.
      at(t, () => field.current?.setValue(2500))
      t += 1600
      at(t, () => field.current?.clear())
      t += 1100
      at(t, run)
    }
    run()
    const timers = pending.current
    return () => timers.forEach(clearTimeout)
  }, [])

  const p = PAYOUTS[payout]
  const rate = round(p.rate * drift, p.digits === 0 ? 2 : 4)
  const fee = round(amount * FEE, 2)
  const converted = round(Math.max(0, amount - fee), 2)
  const receive = round(converted * rate, p.digits)

  return (
    <View style={s.root}>
      <StatusBar hidden />
      <Backdrop
        base="#0A0D12"
        lights={[
          'radial-gradient(circle at 85% 0%, rgba(45,212,191,0.22), transparent 45%)',
          'radial-gradient(circle at 0% 45%, rgba(59,130,246,0.14), transparent 45%)',
        ]}
      />
      <Exit onExit={onExit} />
      <View style={[s.tPage, { paddingTop: insets.top + 14 }]}>
        <View style={s.tHeader}>
          <Text style={s.tBack}>‹</Text>
          <Text style={s.tTitle}>Send money</Text>
          <View style={s.tBackSpacer} />
        </View>

        <View style={s.tCard}>
          <Text style={s.tCardLabel}>You send</Text>
          <View style={s.tCardRow}>
            <View style={s.tCurrency}>
              <Flag flag="🇺🇸" />
              <Text style={s.tCode}>USD</Text>
              <Text style={s.tChevron}>⌄</Text>
            </View>
            <NitroInput
              ref={field}
              transition="reflow"
              mode="number"
              placeholder="0"
              fontFamily={FONT.bold}
              fontSize={36}
              color="#FFFFFF"
              placeholderTextColor="rgba(255,255,255,0.3)"
              textAlign="right"
              editable={false}
              autoWidth={false}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              onChangeValue={(v) => setAmount(Number.isNaN(v) ? 0 : v)}
              style={s.tAmount}
            />
          </View>
          <Text style={s.tBalance}>Balance $24,810.20</Text>
        </View>

        <View style={s.tSwapRow}>
          <View style={s.tSwap}>
            <Text style={s.tSwapText}>⇅</Text>
          </View>
        </View>

        <View style={s.tCard}>
          <Text style={s.tCardLabel}>They receive</Text>
          <View style={s.tCardRow}>
            <View style={s.tCurrency}>
              <Flag flag={p.flag} />
              <Text style={s.tCode}>{p.code}</Text>
              <Text style={s.tChevron}>⌄</Text>
            </View>
            <NitroNumber
              value={receive}
              prefix={p.prefix}
              suffix={p.suffix}
              groupingSeparator={p.grouping}
              decimalSeparator={p.decimal}
              fractionDigits={p.digits}
              transition="numeric"
              fontFamily={FONT.bold}
              fontSize={36}
              color="#5EEAD4"
              textAlign="right"
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              style={s.tAmount}
            />
          </View>
          <View style={s.tRate}>
            <View style={s.tRateDot} />
            <Text style={s.tRateText}>1 USD = </Text>
            <NitroNumber
              value={rate}
              suffix={` ${p.code}`}
              fractionDigits={p.digits === 0 ? 2 : 4}
              transition="numeric"
              flashUpColor={UP}
              flashDownColor={DOWN}
              fontFamily={FONT.semibold}
              fontSize={13}
              color="rgba(255,255,255,0.8)"
            />
            <Text style={s.tRateText}> · live</Text>
          </View>
        </View>

        <View style={s.tBreakdown}>
          <View style={s.tLine}>
            <Text style={s.tLineLabel}>Fee</Text>
            <NitroNumber value={fee} prefix="$" fractionDigits={2} groupingSeparator="," transition="numeric" fontFamily={FONT.semibold} fontSize={14} color="rgba(255,255,255,0.85)" />
          </View>
          <View style={s.tLine}>
            <Text style={s.tLineLabel}>Amount we'll convert</Text>
            <NitroNumber value={converted} prefix="$" fractionDigits={2} groupingSeparator="," transition="numeric" fontFamily={FONT.semibold} fontSize={14} color="rgba(255,255,255,0.85)" />
          </View>
          <View style={s.tLine}>
            <Text style={s.tLineLabel}>Arrives</Text>
            <Text style={s.tLineValue}>In seconds</Text>
          </View>
        </View>

        {/* The recipient fills the space above the keypad, on a screen tall enough for it. */}
        <View style={s.tRecipientSlot} onLayout={(e) => setRoom(e.nativeEvent.layout.height)}>
          {room >= RECIPIENT_HEIGHT && (
            <View style={s.tRecipient}>
              <View style={s.tAvatar}>
                <Text style={s.tAvatarText}>AL</Text>
              </View>
              <View style={s.tRecipientText}>
                <Text style={s.tRecipientLabel}>Sending to</Text>
                <Text style={s.tRecipientName}>Amélie Laurent</Text>
              </View>
              <Text style={s.tRecipientAccount}>•••• 4821</Text>
            </View>
          )}
        </View>
      </View>

      <View style={[s.tBottom, { paddingBottom: insets.bottom + 14 }]}>
        <View style={s.keypad}>
          {KEYS.map((k) => (
            <Key key={k} label={k} press={presses[k] ?? 0} />
          ))}
        </View>
        <View style={s.tCta}>
          <Text style={s.tCtaText}>Continue</Text>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070D', overflow: 'hidden' },
  exit: { position: 'absolute', top: 0, right: 0, width: 72, height: 72, zIndex: 10 },
  page: { flex: 1, paddingHorizontal: 18 },

  assetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  assetTitle: { flex: 1 },
  assetName: { color: '#F8FAFC', fontFamily: FONT.semibold, fontSize: 17 },
  assetSub: { color: 'rgba(226,232,240,0.5)', fontFamily: FONT.medium, fontSize: 13, marginTop: 1 },
  logo: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  logoLarge: { width: 42, height: 42, borderRadius: 21 },
  logoText: { color: '#fff', fontFamily: FONT.bold, fontSize: 15 },
  logoTextLarge: { fontSize: 22 },
  meters: { gap: 6, alignItems: 'flex-end' },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 6, height: 26, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  meterBlocked: { backgroundColor: 'rgba(244,63,94,0.18)', borderColor: 'rgba(244,63,94,0.5)' },
  meterLabel: { color: 'rgba(226,232,240,0.5)', fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.8 },
  meterValue: { color: '#F8FAFC', fontFamily: FONT.semibold, fontSize: 12, padding: 0, minWidth: 50 },
  meterValueBlocked: { color: '#FDA4AF' },

  hero: { width: '100%' },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  changeArrow: { fontSize: 11 },
  changeToday: { color: 'rgba(226,232,240,0.5)', fontFamily: FONT.medium, fontSize: 15 },

  chart: { marginTop: 14, marginHorizontal: -18 },
  area: { position: 'absolute' },
  segment: { position: 'absolute', height: 2.5, borderRadius: 1.25, transformOrigin: 'left center' },
  dot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: '#06080C' },
  ranges: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  range: { color: 'rgba(226,232,240,0.45)', fontFamily: FONT.semibold, fontSize: 13, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, overflow: 'hidden' },
  rangeActive: { backgroundColor: 'rgba(255,255,255,0.09)' },

  versus: { flexDirection: 'row', marginTop: 16, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)', paddingVertical: 10 },
  versusBlocked: { borderColor: 'rgba(244,63,94,0.55)', backgroundColor: 'rgba(244,63,94,0.07)' },
  lane: { flex: 1, paddingHorizontal: 14, gap: 3 },
  laneDivider: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)' },
  laneLabel: { color: 'rgba(226,232,240,0.5)', fontFamily: FONT.medium, fontSize: 11 },
  laneJs: { color: '#F8FAFC', fontFamily: FONT.semibold, fontSize: 17, fontVariant: ['tabular-nums'] },
  laneJsFrozen: { color: '#FDA4AF' },
  caption: { color: 'rgba(226,232,240,0.45)', fontFamily: FONT.medium, fontSize: 12, marginTop: 8, textAlign: 'center' },
  captionBlocked: { color: '#FDA4AF' },

  sectionTitle: { color: '#F8FAFC', fontFamily: FONT.semibold, fontSize: 17, marginTop: 18, marginBottom: 4 },
  watchlist: { flex: 1, overflow: 'hidden' },
  watchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: ROW_HEIGHT },
  watchText: { flex: 1 },
  watchSym: { color: '#F8FAFC', fontFamily: FONT.semibold, fontSize: 15 },
  watchName: { color: 'rgba(226,232,240,0.5)', fontFamily: FONT.medium, fontSize: 12, marginTop: 1 },
  pill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, minWidth: 108 },
  pillNumber: { width: 88, alignSelf: 'flex-end' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  kicker: { color: '#FCD34D', fontFamily: FONT.bold, fontSize: 15, letterSpacing: 4, textTransform: 'uppercase' },
  bannerSlot: { height: 64, justifyContent: 'center', alignItems: 'center', marginTop: 6 },
  // Out of the slot's flow so it keeps its full height: the padding leaves
  // room for the glow, which Android clips to the text's box.
  banner: { position: 'absolute', flexShrink: 0, fontFamily: FONT.bold, fontSize: 44, letterSpacing: 1.5, paddingHorizontal: 36, paddingVertical: 18, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 },
  stage: { width: '100%', alignItems: 'center', justifyContent: 'center', height: 230 },
  rays: { position: 'absolute', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  ray: { position: 'absolute', width: 34, height: 260, borderRadius: 17, backgroundImage: 'linear-gradient(0deg, transparent, rgba(253,224,71,0.30) 55%, transparent)' },
  halo: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundImage: 'radial-gradient(circle, rgba(251,191,36,0.40), transparent 62%)' },
  gift: { position: 'absolute', alignItems: 'center' },
  giftLid: { width: 132, height: 30, borderRadius: 8, backgroundImage: 'linear-gradient(180deg, #F43F5E, #BE123C)', alignItems: 'center', zIndex: 2, boxShadow: '0 4px 10px rgba(0,0,0,0.35)' },
  lidRibbon: { position: 'absolute', top: 0, bottom: 0, width: 20, backgroundImage: 'linear-gradient(180deg, #FDE68A, #F59E0B)' },
  bowLoop: { position: 'absolute', top: -26, width: 38, height: 30, borderRadius: 16, borderWidth: 7, borderColor: '#FBBF24' },
  bowLeft: { right: 64, transform: [{ rotate: '-25deg' }] },
  bowRight: { left: 64, transform: [{ rotate: '25deg' }] },
  giftBody: { width: 118, height: 96, marginTop: -2, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundImage: 'linear-gradient(180deg, #E11D48, #881337)', alignItems: 'center' },
  bodyRibbon: { width: 20, height: '100%', backgroundImage: 'linear-gradient(180deg, #FCD34D, #D97706)' },
  burst: { position: 'absolute', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  piece: { position: 'absolute', width: 8, height: 12, borderRadius: 2 },
  coin: { position: 'absolute', top: 0, alignItems: 'center', justifyContent: 'center', backgroundImage: 'radial-gradient(circle at 35% 30%, #FEF3C7, #F59E0B 60%, #B45309)', borderWidth: 1.5, borderColor: '#FDE68A' },
  coinText: { color: '#92400E', fontFamily: FONT.bold },
  rewardSub: { color: 'rgba(255,247,224,0.65)', fontFamily: FONT.medium, fontSize: 15, marginTop: 8 },
  footer: { paddingHorizontal: 24, alignItems: 'center', gap: 14 },
  goldButton: { alignSelf: 'stretch', borderRadius: 999, paddingVertical: 17, alignItems: 'center', backgroundImage: 'linear-gradient(90deg, #F59E0B, #FCD34D)', boxShadow: '0 8px 32px rgba(245,158,11,0.45)' },
  goldButtonText: { color: '#2A1602', fontFamily: FONT.bold, fontSize: 17 },

  tPage: { flex: 1, paddingHorizontal: 18 },
  tHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  tBack: { color: '#fff', fontSize: 34, lineHeight: 36, width: 32 },
  tBackSpacer: { width: 32 },
  tTitle: { color: '#fff', fontFamily: FONT.semibold, fontSize: 17 },
  tCard: { borderRadius: 22, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14, backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)' },
  tCardLabel: { color: 'rgba(255,255,255,0.5)', fontFamily: FONT.medium, fontSize: 13 },
  tCardRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 12 },
  tCurrency: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4, paddingRight: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  flag: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  flagText: { fontSize: 18 },
  tCode: { color: '#fff', fontFamily: FONT.bold, fontSize: 16 },
  tChevron: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: -6 },
  tAmount: { flex: 1 },
  tBalance: { color: 'rgba(255,255,255,0.4)', fontFamily: FONT.medium, fontSize: 12, marginTop: 8 },
  tSwapRow: { height: 10, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  tSwap: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1B2230', borderWidth: 3, borderColor: '#0A0D12' },
  tSwapText: { color: '#5EEAD4', fontSize: 17, fontFamily: FONT.bold },
  tRate: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  tRateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: UP, marginRight: 7, boxShadow: `0 0 6px ${UP}` },
  tRateText: { color: 'rgba(255,255,255,0.5)', fontFamily: FONT.medium, fontSize: 13 },
  tBreakdown: { marginTop: 14, paddingHorizontal: 6, gap: 9 },
  tLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tLineLabel: { color: 'rgba(255,255,255,0.5)', fontFamily: FONT.medium, fontSize: 14 },
  tLineValue: { color: '#5EEAD4', fontFamily: FONT.semibold, fontSize: 14 },
  tRecipientSlot: { flex: 1, justifyContent: 'center' },
  tRecipient: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' },
  tAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundImage: 'linear-gradient(135deg, #5EEAD4, #3B82F6)' },
  tAvatarText: { color: '#04201C', fontFamily: FONT.bold, fontSize: 15 },
  tRecipientText: { flex: 1 },
  tRecipientLabel: { color: 'rgba(255,255,255,0.45)', fontFamily: FONT.medium, fontSize: 12 },
  tRecipientName: { color: '#fff', fontFamily: FONT.semibold, fontSize: 16, marginTop: 2 },
  tRecipientAccount: { color: 'rgba(255,255,255,0.55)', fontFamily: FONT.medium, fontSize: 14 },
  tBottom: { paddingHorizontal: 18, gap: 12 },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 4 },
  key: { width: '31.5%', height: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  keyText: { color: '#fff', fontFamily: FONT.semibold, fontSize: 26 },
  tCta: { borderRadius: 999, paddingVertical: 17, alignItems: 'center', backgroundColor: '#5EEAD4', boxShadow: '0 8px 28px rgba(45,212,191,0.35)' },
  tCtaText: { color: '#04201C', fontFamily: FONT.bold, fontSize: 17 },
})
