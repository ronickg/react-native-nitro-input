import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { NitroNumber, type NitroNumberHandle } from 'react-native-nitro-input'

// ---------------------------------------------------------------------------
// The market showcase: a trading dashboard where every figure is a
// NitroNumber and dozens of them move at once. One loop drives them all
// through their handles (`animateTo`), so a tick re-renders nothing: the
// count of numbers and the updates a second in the header are the point.
// Auto-playing and button-free for the recordings (scripts/record-demos.md);
// tap the top-right corner to leave.
// ---------------------------------------------------------------------------

const FONT = {
  medium: 'OpenRunde-Medium',
  semibold: 'OpenRunde-Semibold',
  bold: 'OpenRunde-Bold',
}
const UP = '#34D399'
const DOWN = '#FB7185'
const INK = '#F1F5F9'
const MUTED = 'rgba(226,232,240,0.5)'

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places
/** A seeded random walk, so every run of the screen looks alike. */
function makeRandom(seed: number) {
  let x = seed
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return x / 4294967296
  }
}

type Handle = NitroNumberHandle | null
/** A list of handles filled by callback refs, one per slot. */
function useHandles(count: number) {
  const handles = useRef<Handle[]>(Array.from({ length: count }, () => null))
  const setters = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => (h: Handle) => {
        handles.current[i] = h
      }),
    [count]
  )
  return [handles, setters] as const
}

// --------------------------------------------------------------- data

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
/** Order book levels kept; the card shows as many as fit. */
const BOOK_ROWS = 7
const BOOK_ROW_HEIGHT = 23
const TAPE_ROWS = 3
const TAPE_ROW_HEIGHT = 22
const TICK_MS = 50

/** How many NitroNumbers the screen draws, for the header, with `tape` trade rows on screen. */
const numberCount = (book: number) =>
  2 + // header: this count, and the updates a second
  3 + // portfolio, change, percent
  TILES.length * 2 +
  1 + // spread
  book * 4 +
  TAPE_ROWS * 2

// --------------------------------------------------------------- pieces

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

/** Frames per second on the UI thread, measured and drawn there. */
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
    <AnimatedTextInput editable={false} underlineColorAndroid="transparent" style={s.pillText} animatedProps={props} defaultValue="— fps" />
  )
}

function LiveDot() {
  const pulse = useSharedValue(0)
  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0, { duration: 700 })), -1)
  }, [pulse])
  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + pulse.value * 0.55,
    transform: [{ scale: 0.85 + pulse.value * 0.3 }],
  }))
  return <Animated.View style={[s.liveDot, style]} />
}

/** A heatmap tile: its colour follows the day's change. */
function Tile({
  sym,
  price,
  digits,
  change,
  priceRef,
  pctRef,
}: {
  sym: string
  price: number
  digits: number
  change: SharedValue<number>
  priceRef: (h: Handle) => void
  pctRef: (h: Handle) => void
}) {
  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(change.value, [-3, -0.4, 0, 0.4, 3], ['#7F1D2D', '#3A1D27', '#1A2230', '#12362C', '#0E6B4A']),
  }))
  return (
    <Animated.View style={[s.tile, style]}>
      <Text style={s.tileSym}>{sym}</Text>
      <NitroNumber
        ref={priceRef}
        value={price}
        fractionDigits={digits}
        groupingSeparator=","
        prefix="$"
        transition="numeric"
        fontFamily={FONT.semibold}
        fontSize={15}
        color={INK}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={s.fill}
      />
      <NitroNumber
        ref={pctRef}
        value={0}
        fractionDigits={2}
        suffix="%"
        transition="numeric"
        fontFamily={FONT.medium}
        fontSize={12}
        color="rgba(241,245,249,0.75)"
      />
    </Animated.View>
  )
}

/** One order book level: price and size, with a depth bar behind them. */
function BookRow({
  side,
  depth,
  priceRef,
  sizeRef,
  price,
  size,
}: {
  side: 'bid' | 'ask'
  depth: SharedValue<number>
  priceRef: (h: Handle) => void
  sizeRef: (h: Handle) => void
  price: number
  size: number
}) {
  const bid = side === 'bid'
  // A transform, not a width: animating a layout prop re-laid the screen out every frame.
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.min(1, depth.value) }] }))
  return (
    <View style={s.bookRow}>
      <Animated.View style={[s.depth, bid ? s.depthBid : s.depthAsk, bar]} />
      {bid ? (
        <>
          <NitroNumber
            ref={sizeRef}
            value={size}
            fractionDigits={3}
            transition="numeric"
            fontFamily={FONT.medium}
            fontSize={13}
            color={MUTED}
            flashUpColor={INK}
            flashDownColor={INK}
          />
          <NitroNumber
            ref={priceRef}
            value={price}
            fractionDigits={1}
            groupingSeparator=","
            transition="numeric"
            fontFamily={FONT.semibold}
            fontSize={13}
            color={UP}
          />
        </>
      ) : (
        <>
          <NitroNumber
            ref={priceRef}
            value={price}
            fractionDigits={1}
            groupingSeparator=","
            transition="numeric"
            fontFamily={FONT.semibold}
            fontSize={13}
            color={DOWN}
          />
          <NitroNumber
            ref={sizeRef}
            value={size}
            fractionDigits={3}
            transition="numeric"
            fontFamily={FONT.medium}
            fontSize={13}
            color={MUTED}
            flashUpColor={INK}
            flashDownColor={INK}
          />
        </>
      )}
    </View>
  )
}

// --------------------------------------------------------------- screen

export function MarketShowcase({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets()

  // Handles, one list per kind of figure.
  const [tilePrice, tilePriceRef] = useHandles(TILES.length)
  const [tilePct, tilePctRef] = useHandles(TILES.length)
  const [bidPrice, bidPriceRef] = useHandles(BOOK_ROWS)
  const [bidSize, bidSizeRef] = useHandles(BOOK_ROWS)
  const [askPrice, askPriceRef] = useHandles(BOOK_ROWS)
  const [askSize, askSizeRef] = useHandles(BOOK_ROWS)
  const [tapePrice, tapePriceRef] = useHandles(TAPE_ROWS)
  const [tapeSize, tapeSizeRef] = useHandles(TAPE_ROWS)
  const portfolio = useRef<Handle>(null)
  const pnl = useRef<Handle>(null)
  const pnlPct = useRef<Handle>(null)
  const spread = useRef<Handle>(null)
  const rate = useRef<Handle>(null)

  // Colours and depth bars are Reanimated shared values, set from the same loop.
  const changes = [
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
  ]
  const bidDepth = Array.from({ length: BOOK_ROWS }, (_, i) => useSharedValue(0.3 + i * 0.1)) // eslint-disable-line react-hooks/rules-of-hooks
  const askDepth = Array.from({ length: BOOK_ROWS }, (_, i) => useSharedValue(0.3 + i * 0.1)) // eslint-disable-line react-hooks/rules-of-hooks
  const [tone, setTone] = useState(true)
  const [bookFit, setBookFit] = useState(0)

  // The initial book around BTC, and the tape.
  const mid0 = TILES[0].price
  const book0 = useMemo(() => {
    const r = makeRandom(7)
    return {
      bids: Array.from({ length: BOOK_ROWS }, (_, i) => ({
        price: round(mid0 - 0.5 - i * 2.5, 1),
        size: round(0.2 + r() * 3, 3),
      })),
      asks: Array.from({ length: BOOK_ROWS }, (_, i) => ({
        price: round(mid0 + 0.5 + i * 2.5, 1),
        size: round(0.2 + r() * 3, 3),
      })),
      tape: Array.from({ length: TAPE_ROWS }, () => ({
        price: round(mid0 + (r() - 0.5) * 4, 1),
        size: round(r() * 0.8, 4),
      })),
    }
  }, [mid0])

  useEffect(() => {
    const r = makeRandom(42)
    const open = TILES.map((t) => t.price)
    const prices = TILES.map((t) => t.price)
    const openValue = TILES.reduce((sum, t) => sum + t.price * t.qty, 0)
    const bids = book0.bids.map((b) => ({ ...b }))
    const asks = book0.asks.map((a) => ({ ...a }))
    const tape = book0.tape.map((t) => ({ ...t }))
    let updates = 0
    let second = Date.now()
    let tick = 0
    let lastUp = true

    const set = (h: Handle, v: number) => {
      if (!h) return
      h.animateTo(v)
      updates++
    }

    const loop = setInterval(() => {
      tick++
      // Heatmap: a few tiles move every tick.
      for (let k = 0; k < 4; k++) {
        const i = Math.floor(r() * TILES.length)
        const t = TILES[i]
        // A random walk pulled back towards the open, so the board stays a
        // mix of red and green instead of drifting one way for good.
        const away = (prices[i] - open[i]) / open[i]
        const drift = (r() - 0.5) * 0.0024 - away * 0.03
        prices[i] = round(Math.max(10 ** -t.digits, prices[i] * (1 + drift)), t.digits)
        const pct = round(((prices[i] - open[i]) / open[i]) * 100, 2)
        set(tilePrice.current[i], prices[i])
        set(tilePct.current[i], pct)
        changes[i].value = withTiming(pct, { duration: 400 })
      }

      // Order book: sizes churn every tick, the ladder moves with BTC.
      const mid = prices[0]
      for (let k = 0; k < 5; k++) {
        const i = Math.floor(r() * BOOK_ROWS)
        const book = r() < 0.5 ? bids : asks
        book[i].size = round(Math.min(24, Math.max(0.001, book[i].size * (0.6 + r() * 0.8) + (r() < 0.1 ? r() * 2 : 0))), 3)
        const sizes = book === bids ? bidSize : askSize
        set(sizes.current[i], book[i].size)
        const depth = book === bids ? bidDepth : askDepth
        const total = book.slice(0, i + 1).reduce((sum, l) => sum + l.size, 0)
        depth[i].value = withTiming(Math.min(1, total / 14), {
          duration: 250,
          easing: Easing.out(Easing.quad),
        })
      }
      if (tick % 6 === 0) {
        for (let i = 0; i < BOOK_ROWS; i++) {
          bids[i].price = round(mid - 0.5 - i * 2.5, 1)
          asks[i].price = round(mid + 0.5 + i * 2.5 + (r() < 0.2 ? 1 : 0), 1)
          set(bidPrice.current[i], bids[i].price)
          set(askPrice.current[i], asks[i].price)
        }
        set(spread.current, round(asks[0].price - bids[0].price, 1))
      }

      // Tape: a trade every few ticks pushes every row down one.
      if (tick % 5 === 0) {
        tape.pop()
        tape.unshift({
          price: round(mid + (r() - 0.5) * 3, 1),
          size: round(0.001 + r() * r() * 1.2, 4),
        })
        tape.forEach((t, i) => {
          set(tapePrice.current[i], t.price)
          set(tapeSize.current[i], t.size)
        })
      }

      // The portfolio follows its holdings, twice a second.
      if (tick % 10 === 0) {
        const value = TILES.reduce((sum, t, i) => sum + prices[i] * t.qty, 0)
        const change = round(value - openValue, 2)
        set(portfolio.current, round(value, 2))
        set(pnl.current, Math.abs(change))
        set(pnlPct.current, Math.abs(round((change / openValue) * 100, 2)))
        const up = change >= 0
        if (up !== lastUp) {
          lastUp = up
          setTone(up)
        }
      }

      const now = Date.now()
      if (now - second >= 1000) {
        set(rate.current, Math.round((updates * 1000) / (now - second)))
        updates = 0
        second = now
      }
    }, TICK_MS)
    return () => clearInterval(loop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toneColor = tone ? UP : DOWN
  const openValue = useMemo(() => TILES.reduce((sum, t) => sum + t.price * t.qty, 0), [])

  return (
    <View style={s.root}>
      <StatusBar hidden />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.backdrop]} />
      <Pressable style={s.exit} onPress={onExit} testID="showcase-exit" />
      <View style={[s.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 10 }]}>
        <View style={s.header}>
          <Text style={s.title}>Markets</Text>
          <View style={s.pill}>
            <LiveDot />
            <Text style={s.pillLive}>LIVE</Text>
            <View style={s.pillDivider} />
            <UiFps />
          </View>
        </View>
        <View style={s.stats}>
          <NitroNumber value={numberCount(bookFit)} transition="numeric" fontFamily={FONT.semibold} fontSize={13} color={INK} />
          <Text style={s.statsText}> NitroNumbers live · </Text>
          <NitroNumber
            ref={rate}
            value={0}
            groupingSeparator=","
            transition="numeric"
            fontFamily={FONT.semibold}
            fontSize={13}
            color={INK}
          />
          <Text style={s.statsText}> updates/s · no re-renders</Text>
        </View>

        <View style={s.card}>
          <Text style={s.label}>Portfolio value</Text>
          <NitroNumber
            ref={portfolio}
            value={round(openValue, 2)}
            prefix="$"
            prefixFontSize={24}
            affixAlign="top"
            fractionDigits={2}
            groupingSeparator=","
            easing="spring"
            bounce={0.1}
            stagger={20}
            duration={450}
            fontFamily={FONT.bold}
            fontSize={40}
            color={INK}
          />
          <View style={s.pnlRow}>
            <Text style={[s.pnlArrow, { color: toneColor }]}>{tone ? '▲' : '▼'}</Text>
            <NitroNumber
              ref={pnl}
              value={0}
              prefix="$"
              fractionDigits={2}
              groupingSeparator=","
              transition="numeric"
              fontFamily={FONT.semibold}
              fontSize={14}
              color={toneColor}
            />
            <NitroNumber
              ref={pnlPct}
              value={0}
              prefix=" ("
              suffix="%)"
              fractionDigits={2}
              transition="numeric"
              fontFamily={FONT.semibold}
              fontSize={14}
              color={toneColor}
            />
            <Text style={s.pnlToday}>today</Text>
          </View>
        </View>

        <View style={s.grid}>
          {TILES.map((t, i) => (
            <Tile
              key={t.sym}
              sym={t.sym}
              price={t.price}
              digits={t.digits}
              change={changes[i]}
              priceRef={tilePriceRef[i]}
              pctRef={tilePctRef[i]}
            />
          ))}
        </View>

        <View style={[s.card, s.bookCard]}>
          <View style={s.bookHead}>
            <Text style={s.label}>Order book · BTC/USD</Text>
            <View style={s.spread}>
              <Text style={s.spreadLabel}>spread </Text>
              <NitroNumber
                ref={spread}
                value={1}
                fractionDigits={1}
                transition="numeric"
                fontFamily={FONT.semibold}
                fontSize={12}
                color={INK}
              />
            </View>
          </View>
          <View
            style={s.bookCols}
            onLayout={(e) => setBookFit(Math.min(BOOK_ROWS, Math.floor(e.nativeEvent.layout.height / BOOK_ROW_HEIGHT)))}
          >
            <View style={s.bookSide}>
              {book0.bids.slice(0, bookFit).map((b, i) => (
                <BookRow
                  key={i}
                  side="bid"
                  depth={bidDepth[i]}
                  price={b.price}
                  size={b.size}
                  priceRef={bidPriceRef[i]}
                  sizeRef={bidSizeRef[i]}
                />
              ))}
            </View>
            <View style={s.bookSide}>
              {book0.asks.slice(0, bookFit).map((a, i) => (
                <BookRow
                  key={i}
                  side="ask"
                  depth={askDepth[i]}
                  price={a.price}
                  size={a.size}
                  priceRef={askPriceRef[i]}
                  sizeRef={askSizeRef[i]}
                />
              ))}
            </View>
          </View>
        </View>

        <View style={[s.card, s.tapeCard]}>
          <Text style={s.label}>Trades</Text>
          <View>
            {book0.tape.map((t, i) => (
              <View key={i} style={[s.tapeRow, { opacity: 1 - i * 0.25 }]}>
                <NitroNumber
                  ref={tapePriceRef[i]}
                  value={t.price}
                  fractionDigits={1}
                  groupingSeparator=","
                  transition="numeric"
                  fontFamily={FONT.semibold}
                  fontSize={13}
                  color={INK}
                  flashUpColor={UP}
                  flashDownColor={DOWN}
                />
                <NitroNumber
                  ref={tapeSizeRef[i]}
                  value={t.size}
                  fractionDigits={4}
                  suffix=" BTC"
                  transition="numeric"
                  fontFamily={FONT.medium}
                  fontSize={13}
                  color={MUTED}
                />
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#06080D' },
  backdrop: {
    backgroundImage:
      'radial-gradient(circle at 100% 0%, rgba(59,130,246,0.14), transparent 45%), radial-gradient(circle at 0% 40%, rgba(16,185,129,0.10), transparent 45%)',
  },
  exit: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 72,
    height: 72,
    zIndex: 10,
  },
  page: { flex: 1, paddingHorizontal: 14, gap: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: INK, fontFamily: FONT.bold, fontSize: 26 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: UP,
    boxShadow: `0 0 8px ${UP}`,
  },
  pillLive: {
    color: UP,
    fontFamily: FONT.bold,
    fontSize: 11,
    letterSpacing: 1,
  },
  pillDivider: {
    width: StyleSheet.hairlineWidth,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  pillText: {
    color: INK,
    fontFamily: FONT.semibold,
    fontSize: 12,
    padding: 0,
    minWidth: 48,
  },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: -4 },
  statsText: { color: MUTED, fontFamily: FONT.medium, fontSize: 13 },
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  label: { color: MUTED, fontFamily: FONT.medium, fontSize: 13 },
  pnlRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  pnlArrow: { fontSize: 10 },
  pnlToday: {
    color: MUTED,
    fontFamily: FONT.medium,
    fontSize: 14,
    marginLeft: 3,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // Three to a row: a basis under a third, grown to fill (a percentage width plus the gaps wrapped to two).
  tile: {
    flexBasis: '30%',
    flexGrow: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  tileSym: {
    color: 'rgba(241,245,249,0.9)',
    fontFamily: FONT.bold,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  fill: { width: '100%' },
  bookCard: { flex: 1, paddingBottom: 10, overflow: 'hidden' },
  bookHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  spread: { flexDirection: 'row', alignItems: 'center' },
  spreadLabel: { color: MUTED, fontFamily: FONT.medium, fontSize: 12 },
  bookCols: { flex: 1, flexDirection: 'row', gap: 8 },
  bookSide: { flex: 1, gap: 2 },
  bookRow: {
    height: 21,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  depth: { position: 'absolute', top: 1, bottom: 1, borderRadius: 4 },
  depthBid: { left: 0, right: 0, transformOrigin: 'right', backgroundColor: 'rgba(52,211,153,0.14)' },
  depthAsk: { left: 0, right: 0, transformOrigin: 'left', backgroundColor: 'rgba(251,113,133,0.14)' },
  tapeCard: { gap: 4 },
  tapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: TAPE_ROW_HEIGHT,
  },
})
