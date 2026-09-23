import React, { useEffect, useRef, useState } from 'react'
import { Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native'
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
} from 'react-native-reanimated'
import { NitroInput, NitroNumber, type NitroInputHandle } from 'react-native-nitro-input'

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

/** Frames per second on the JS thread, from requestAnimationFrame: it stops while JS is blocked. */
function useJsFps() {
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
  return fps
}

function LiveDot() {
  const o = useSharedValue(1)
  useEffect(() => {
    o.value = withRepeat(withSequence(withTiming(0.25, { duration: 700 }), withTiming(1, { duration: 700 })), -1)
  }, [o])
  const style = useAnimatedStyle(() => ({ opacity: o.value }))
  return <Animated.View style={[s.liveDot, style]} />
}

// ------------------------------------------------------------------ market

const TICKERS = [
  ['BTC', 64_210.9], ['ETH', 3_412.75], ['SOL', 148.32],
  ['AAPL', 227.48], ['NVDA', 131.26], ['TSLA', 248.5],
  ['MSFT', 418.12], ['AMZN', 186.4], ['GOOG', 163.9],
  ['META', 512.33], ['NFLX', 684.2], ['AMD', 158.71],
  ['GOLD', 2_412.6], ['EUR', 1.0842], ['OIL', 78.34],
  ['JPM', 214.3], ['UBER', 71.25], ['XRP', 0.6123],
] as const

function Tile({ sym, price, open }: { sym: string; price: number; open: number }) {
  const change = ((price - open) / open) * 100
  const up = change >= 0
  const digits = price < 10 ? 4 : 2
  return (
    <View style={s.tile}>
      <View style={s.tileTop}>
        <Text style={s.tileSym}>{sym}</Text>
        <NitroNumber
          value={Math.abs(round(change, 2))}
          prefix={up ? '+' : '−'}
          suffix="%"
          fractionDigits={2}
          transition="numeric"
          fontFamily={FONT.semibold}
          fontSize={11}
          color={up ? UP : DOWN}
          textAlign="right"
          style={s.tileChange}
        />
      </View>
      <NitroNumber
        value={price}
        fractionDigits={digits}
        groupingSeparator=","
        transition="numeric"
        flashUpColor={UP}
        flashDownColor={DOWN}
        flashDuration={500}
        fontFamily={FONT.semibold}
        fontSize={17}
        color="#F8FAFC"
        style={s.tilePrice}
      />
    </View>
  )
}

type Phase = 'live' | 'blocking' | 'after'

/**
 * A live board: eighteen prices tick several times a second, the portfolio
 * rolls, and every ten seconds the JS thread is blocked for two: the native
 * roll carries on, the UI thread keeps its frame rate, and a Text driven by
 * setState next to it freezes.
 */
export function MarketShowcase({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets()
  const later = useTimers()
  const jsFps = useJsFps()
  const open = useRef(TICKERS.map(([, p]) => p as number)).current
  const [prices, setPrices] = useState(() => [...open])
  const [hero, setHero] = useState(248_613.42)
  const [heroDuration, setHeroDuration] = useState(600)
  const [jsHero, setJsHero] = useState(248_613.42)
  const [phase, setPhase] = useState<Phase>('live')
  const phaseRef = useRef<Phase>('live')
  phaseRef.current = phase
  const heroRef = useRef(hero)
  heroRef.current = hero

  // The feed: three prices move every 120 ms, the portfolio every 700.
  useEffect(() => {
    const prices = setInterval(() => {
      if (phaseRef.current !== 'live') return
      setPrices((previous) => {
        const next = [...previous]
        for (let n = 0; n < 3; n++) {
          const i = Math.floor(Math.random() * next.length)
          const digits = next[i] < 10 ? 4 : 2
          next[i] = round(next[i] * (1 + (Math.random() - 0.48) * 0.006), digits)
        }
        return next
      })
    }, 120)
    const portfolio = setInterval(() => {
      if (phaseRef.current !== 'live') return
      setHero((h) => {
        const next = round(h * (1 + (Math.random() - 0.45) * 0.004), 2)
        setJsHero(next)
        return next
      })
    }, 700)
    return () => {
      clearInterval(prices)
      clearInterval(portfolio)
    }
  }, [])

  // The stress test, every ten seconds; up one time, down the next, so the
  // figure stays in range however long the recording runs.
  useEffect(() => {
    let up = true
    const cycle = () => {
      later(6000, () => {
        const from = heroRef.current
        const to = round(from * (up ? 1.0873 : 0.9197), 2)
        up = !up
        setPhase('blocking')
        setHeroDuration(2600)
        setHero(to)
        // The same climb, driven from JS the way a Text has to be: it can only
        // move when the JS thread gets a turn.
        const started = Date.now()
        const tween = setInterval(() => {
          const t = Math.min(1, (Date.now() - started) / 2600)
          const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
          setJsHero(round(from + (to - from) * eased, 2))
          if (t === 1) clearInterval(tween)
        }, 16)
        // Let the new value reach native, then take the JS thread away.
        later(250, () => blockJsThread(2000))
        later(2900, () => {
          setPhase('after')
          setHeroDuration(600)
        })
        later(5200, () => {
          setPhase('live')
          cycle()
        })
      })
    }
    cycle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const blocked = phase === 'blocking'
  return (
    <View style={s.root}>
      <StatusBar hidden />
      <Backdrop
        base="#05070D"
        lights={[
          'radial-gradient(circle at 15% 0%, rgba(56,189,248,0.30), transparent 50%)',
          'radial-gradient(circle at 100% 30%, rgba(99,102,241,0.25), transparent 45%)',
          blocked
            ? 'radial-gradient(circle at 50% 100%, rgba(244,63,94,0.28), transparent 55%)'
            : 'radial-gradient(circle at 50% 100%, rgba(16,185,129,0.14), transparent 55%)',
        ]}
      />
      <Exit onExit={onExit} />
      <View style={[s.page, { paddingTop: insets.top + 18 }]}>
        <View style={s.topBar}>
          <View style={s.live}>
            <LiveDot />
            <Text style={s.liveText}>Live</Text>
          </View>
          <View style={s.meters}>
            <View style={s.meter}>
              <Text style={s.meterLabel}>UI</Text>
              <UiFps />
            </View>
            <View style={[s.meter, blocked && s.meterBlocked]}>
              <Text style={s.meterLabel}>JS</Text>
              <Text style={[s.meterValue, blocked && s.meterValueBlocked]}>{blocked ? 'blocked' : `${jsFps} fps`}</Text>
            </View>
          </View>
        </View>

        <Text style={s.label}>Portfolio</Text>
        <NitroNumber
          value={hero}
          prefix="$"
          prefixFontSize={30}
          affixAlign="top"
          fractionDigits={2}
          groupingSeparator=","
          fontFamily={FONT.bold}
          fontSize={54}
          color="#FFFFFF"
          easing={blocked ? 'easeInOut' : 'spring'}
          bounce={0.1}
          stagger={blocked ? 0 : 22}
          duration={heroDuration}
          style={s.hero}
        />

        <View style={[s.versus, blocked && s.versusBlocked]}>
          <View style={s.lane}>
            <Text style={s.laneLabel}>NitroNumber · native</Text>
            <NitroNumber
              value={hero}
              prefix="$"
              fractionDigits={2}
              groupingSeparator=","
              fontFamily={FONT.semibold}
              fontSize={19}
              color={UP}
              duration={heroDuration}
              easing={blocked ? 'easeInOut' : 'easeOut'}
            />
          </View>
          <View style={s.laneDivider} />
          <View style={s.lane}>
            <Text style={s.laneLabel}>Text · setState</Text>
            <Text style={[s.laneJs, blocked && s.laneJsFrozen]}>${money(jsHero)}</Text>
          </View>
        </View>
        <Text style={[s.caption, blocked && s.captionBlocked]}>
          {phase === 'blocking'
            ? 'JS thread blocked for 2 s. The roll keeps going natively.'
            : phase === 'after'
              ? 'The Text froze. The NitroNumber never waited for JS.'
              : 'Eighteen prices, several updates a second, every one native.'}
        </Text>

        <View style={s.grid}>
          {TICKERS.map(([sym], i) => (
            <Tile key={sym} sym={sym} price={prices[i]} open={open[i]} />
          ))}
        </View>
      </View>
    </View>
  )
}

// ------------------------------------------------------------------- reward

const TIERS = ['Big win', 'Mega win', 'Epic win']
const CONFETTI = ['#FBBF24', '#F472B6', '#60A5FA', '#34D399', '#FDE68A', '#C084FC']

/** One piece of confetti, launched on every change of `burst`. */
function Piece({ burst, index }: { burst: number; index: number }) {
  const t = useSharedValue(0)
  const angle = (index / 28) * Math.PI * 2 + (index % 3) * 0.2
  const speed = 150 + ((index * 37) % 90)
  useEffect(() => {
    if (burst === 0) return
    t.value = 0
    t.value = withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) })
  }, [burst, t])
  const style = useAnimatedStyle(() => {
    const x = Math.cos(angle) * speed * t.value
    const y = Math.sin(angle) * speed * t.value + 260 * t.value * t.value
    return {
      opacity: t.value === 0 ? 0 : 1 - t.value,
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${t.value * (index % 2 ? 540 : -540)}deg` }],
    }
  })
  return <Animated.View style={[s.piece, { backgroundColor: CONFETTI[index % CONFETTI.length] }, style]} />
}

/** A reward: the win meter counts up tier by tier, lands with a pop and a burst, then the reels play. */
export function RewardShowcase({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets()
  const later = useTimers()
  const [style, setStyle] = useState<'count' | 'spin'>('count')
  const [amount, setAmount] = useState(50_000)
  const [reveal, setReveal] = useState(false)
  const [tier, setTier] = useState<string | null>(null)
  const [burst, setBurst] = useState(0)
  const glow = useSharedValue(0.6)

  useEffect(() => {
    later(900, () => setReveal(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pulse = () => {
    glow.value = withSequence(withTiming(1, { duration: 160 }), withTiming(0.6, { duration: 900 }))
  }
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value, transform: [{ scale: 0.9 + glow.value * 0.15 }] }))

  // Count with tiers, hold, reels, hold, again.
  const onRevealEnd = () => {
    pulse()
    setBurst((b) => b + 1)
    later(2200, () => {
      setReveal(false)
      setTier(null)
      later(600, () => {
        setStyle((v) => (v === 'count' ? 'spin' : 'count'))
        setAmount((a) => (a === 50_000 ? 25_750 : 50_000))
        later(400, () => setReveal(true))
      })
    })
  }

  return (
    <View style={s.root}>
      <StatusBar hidden />
      <Backdrop
        base="#0E0A1F"
        lights={[
          'radial-gradient(circle at 50% 42%, rgba(251,191,36,0.30), transparent 42%)',
          'radial-gradient(circle at 0% 100%, rgba(168,85,247,0.35), transparent 55%)',
          'radial-gradient(circle at 100% 0%, rgba(59,130,246,0.25), transparent 50%)',
        ]}
      />
      <Exit onExit={onExit} />
      <View style={[s.center, { paddingTop: insets.top }]}>
        <Text style={s.kicker}>Reward unlocked</Text>
        <View style={s.tierSlot}>
          {tier != null && (
            <View style={s.tier}>
              <Text style={s.tierText}>{tier}</Text>
            </View>
          )}
        </View>
        <View style={s.stage}>
          <Animated.View style={[s.halo, glowStyle]} />
          <View style={s.burst} pointerEvents="none">
            {Array.from({ length: 28 }, (_, i) => (
              <Piece key={i} burst={burst} index={i} />
            ))}
          </View>
          <NitroNumber
            value={amount}
            reveal={reveal}
            revealStyle={style}
            revealMilestones={[1000, 10000, 25000]}
            revealMilestoneHold={380}
            revealDuration={style === 'count' ? 4800 : 2400}
            onRevealMilestone={(index) => {
              setTier(TIERS[index] ?? null)
              pulse()
            }}
            onRevealEnd={onRevealEnd}
            prefix="$"
            prefixFontSize={34}
            affixAlign="top"
            fractionDigits={2}
            groupingSeparator=","
            fontFamily={FONT.bold}
            fontSize={60}
            color="#FFF7E0"
            textAlign="center"
            style={s.hero}
          />
        </View>
        <Text style={s.rewardSub}>added to your balance</Text>
      </View>
      <View style={[s.footer, { paddingBottom: insets.bottom + 28 }]}>
        <View style={s.goldButton}>
          <Text style={s.goldButtonText}>Collect</Text>
        </View>
        <Text style={s.footerNote}>Counted, tier by tier, entirely in native code</Text>
      </View>
    </View>
  )
}

// --------------------------------------------------------------------- send

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']

/** What the recipient gets, in their currency: each formatted natively, separators and all. */
const PAYOUTS = [
  { code: 'EUR', flag: '🇪🇺', rate: 0.9218, prefix: '', suffix: ' €', grouping: '.', decimal: ',', digits: 2 },
  { code: 'JPY', flag: '🇯🇵', rate: 149.31, prefix: '¥', suffix: '', grouping: ',', decimal: '.', digits: 0 },
  { code: 'GBP', flag: '🇬🇧', rate: 0.7712, prefix: '£', suffix: '', grouping: ',', decimal: '.', digits: 2 },
  { code: 'CHF', flag: '🇨🇭', rate: 0.8634, prefix: 'CHF ', suffix: '', grouping: '’', decimal: '.', digits: 2 },
]

/** A keypad key; every new `press` count lights it for a moment. */
function Key({ label, press }: { label: string; press: number }) {
  const glow = useSharedValue(0)
  useEffect(() => {
    if (press === 0) return
    glow.value = withSequence(withTiming(1, { duration: 50 }), withDelay(40, withTiming(0, { duration: 240 })))
  }, [press, glow])
  const style = useAnimatedStyle(() => ({
    backgroundColor: `rgba(255,255,255,${0.035 + glow.value * 0.2})`,
    transform: [{ scale: 1 - glow.value * 0.06 }],
  }))
  return (
    <Animated.View style={[s.key, style]}>
      <Text style={s.keyText}>{label}</Text>
    </Animated.View>
  )
}

/**
 * Send money: the keypad types in fast bursts and every keystroke is
 * formatted in C++ before the frame is drawn; the recipient's amount is a
 * NitroNumber that reformats for each currency, and so is the button.
 */
export function SendShowcase({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets()
  const field = useRef<NitroInputHandle>(null)
  const [value, setValue] = useState(0)
  const [payout, setPayout] = useState(0)
  const [presses, setPresses] = useState<Record<string, number>>({})
  const pending = useRef<ReturnType<typeof setTimeout>[]>([])

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
      // A fast burst, about twelve keys a second: the commas reflow as the
      // magnitude grows, formatted before every frame.
      for (const k of ['1', '2', '4', '8', '5', '.', '7', '5']) type(k, 85)
      t += 500
      // The recipient's currency changes: the same amount, formatted natively for each.
      for (let i = 1; i < PAYOUTS.length; i++) {
        const next = i
        at(t, () => setPayout(next))
        t += 1000
      }
      at(t, () => setPayout(0))
      t += 700
      // Back down, just as fast.
      for (const k of ['⌫', '⌫', '⌫', '⌫', '⌫']) type(k, 90)
      t += 900
      // A value set from code: the columns reshape.
      at(t, () => field.current?.setValue(250))
      t += 1500
      at(t, () => field.current?.clear())
      t += 1100
      at(t, run)
    }
    run()
    const timers = pending.current
    return () => timers.forEach(clearTimeout)
  }, [])

  const p = PAYOUTS[payout]
  return (
    <View style={s.root}>
      <StatusBar hidden />
      <Backdrop
        base="#08050F"
        lights={[
          'radial-gradient(circle at 50% 12%, rgba(139,92,246,0.50), transparent 48%)',
          'radial-gradient(circle at 0% 55%, rgba(59,130,246,0.22), transparent 45%)',
          'radial-gradient(circle at 100% 70%, rgba(236,72,153,0.26), transparent 45%)',
        ]}
      />
      <Exit onExit={onExit} />
      <View style={[s.sendTop, { paddingTop: insets.top + 22 }]}>
        <View style={s.recipient}>
          <View style={s.recipientAvatar}>
            <Text style={s.recipientInitials}>MJ</Text>
          </View>
          <View>
            <Text style={s.recipientLabel}>Sending to</Text>
            <Text style={s.recipientName}>Maya Johnson</Text>
          </View>
        </View>
        <NitroInput
          ref={field}
          transition="reflow"
          mode="number"
          prefix="$"
          prefixFontSize={36}
          affixAlign="top"
          placeholder="0"
          fontFamily={FONT.bold}
          fontSize={72}
          color="#FFFFFF"
          placeholderTextColor="rgba(255,255,255,0.28)"
          textAlign="center"
          editable={false}
          adjustsFontSizeToFit
          minimumFontScale={0.45}
          onChangeValue={(v) => setValue(Number.isNaN(v) ? 0 : v)}
          style={s.sendField}
        />
        <View style={s.payout}>
          <Text style={s.payoutFlag}>{p.flag}</Text>
          <Text style={s.payoutLabel}>They receive</Text>
          <NitroNumber
            value={round(value * p.rate, p.digits)}
            prefix={p.prefix}
            suffix={p.suffix}
            groupingSeparator={p.grouping}
            decimalSeparator={p.decimal}
            fractionDigits={p.digits}
            transition="numeric"
            fontFamily={FONT.semibold}
            fontSize={17}
            color="#F5F3FF"
          />
        </View>
        <View style={s.currencies}>
          {PAYOUTS.map((c, i) => (
            <View key={c.code} style={[s.currency, i === payout && s.currencyActive]}>
              <Text style={[s.currencyText, i === payout && s.currencyTextActive]}>{c.code}</Text>
            </View>
          ))}
        </View>
        <Text style={s.sendNote}>Formatted in C++ as you type · no JS round trip</Text>
      </View>
      <View style={[s.sendBottom, { paddingBottom: insets.bottom + 18 }]}>
        <View style={s.keypad}>
          {KEYS.map((k) => (
            <Key key={k} label={k} press={presses[k] ?? 0} />
          ))}
        </View>
        <View style={s.sendButton}>
          <Text style={s.sendButtonText}>Send </Text>
          <NitroNumber
            value={value}
            prefix="$"
            fractionDigits={2}
            groupingSeparator=","
            transition="numeric"
            fontFamily={FONT.bold}
            fontSize={17}
            color="#0B0716"
          />
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070D', overflow: 'hidden' },
  exit: { position: 'absolute', top: 0, right: 0, width: 72, height: 72, zIndex: 10 },
  page: { flex: 1, paddingHorizontal: 18 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(52,211,153,0.12)' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: UP, boxShadow: `0 0 8px ${UP}` },
  liveText: { color: UP, fontFamily: FONT.bold, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' },
  meters: { flexDirection: 'row', gap: 8 },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 11, paddingRight: 8, height: 30, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  meterBlocked: { backgroundColor: 'rgba(244,63,94,0.18)', borderColor: 'rgba(244,63,94,0.5)' },
  meterLabel: { color: 'rgba(226,232,240,0.5)', fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.8 },
  meterValue: { color: '#F8FAFC', fontFamily: FONT.semibold, fontSize: 13, padding: 0, minWidth: 54 },
  meterValueBlocked: { color: '#FDA4AF' },

  label: { color: 'rgba(226,232,240,0.55)', fontFamily: FONT.medium, fontSize: 14, marginBottom: 2 },
  hero: { width: '100%' },

  versus: { flexDirection: 'row', marginTop: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)', paddingVertical: 12 },
  versusBlocked: { borderColor: 'rgba(244,63,94,0.55)', backgroundColor: 'rgba(244,63,94,0.07)' },
  lane: { flex: 1, paddingHorizontal: 14, gap: 4 },
  laneDivider: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)' },
  laneLabel: { color: 'rgba(226,232,240,0.5)', fontFamily: FONT.medium, fontSize: 12 },
  laneJs: { color: '#F8FAFC', fontFamily: FONT.semibold, fontSize: 19, fontVariant: ['tabular-nums'] },
  laneJsFrozen: { color: '#FDA4AF' },
  caption: { color: 'rgba(226,232,240,0.5)', fontFamily: FONT.medium, fontSize: 13, marginTop: 10, marginBottom: 16, textAlign: 'center' },
  captionBlocked: { color: '#FDA4AF' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  tile: { flexBasis: '30%', flexGrow: 1, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.09)' },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileSym: { color: 'rgba(226,232,240,0.6)', fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.6 },
  tileChange: { width: 56 },
  tilePrice: { width: '100%', marginTop: 3 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  kicker: { color: '#FCD34D', fontFamily: FONT.semibold, fontSize: 14, letterSpacing: 2, textTransform: 'uppercase' },
  tierSlot: { height: 44, justifyContent: 'center', marginTop: 10 },
  tier: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(251,191,36,0.16)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.45)' },
  tierText: { color: '#FDE68A', fontFamily: FONT.bold, fontSize: 15, letterSpacing: 0.5 },
  stage: { width: '100%', alignItems: 'center', justifyContent: 'center', height: 160 },
  halo: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundImage: 'radial-gradient(circle, rgba(251,191,36,0.45), transparent 65%)' },
  burst: { position: 'absolute', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  piece: { position: 'absolute', width: 8, height: 12, borderRadius: 2 },
  rewardSub: { color: 'rgba(255,247,224,0.7)', fontFamily: FONT.medium, fontSize: 16, marginTop: 4 },
  footer: { paddingHorizontal: 24, alignItems: 'center', gap: 14 },
  goldButton: { alignSelf: 'stretch', borderRadius: 999, paddingVertical: 17, alignItems: 'center', backgroundImage: 'linear-gradient(90deg, #F59E0B, #FCD34D)', boxShadow: '0 8px 32px rgba(245,158,11,0.45)' },
  goldButtonText: { color: '#2A1602', fontFamily: FONT.bold, fontSize: 17 },
  footerNote: { color: 'rgba(255,255,255,0.4)', fontFamily: FONT.medium, fontSize: 12 },

  sendTop: { flex: 1, alignItems: 'center', paddingHorizontal: 24 },
  recipient: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingLeft: 8, paddingRight: 18, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  recipientAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundImage: 'linear-gradient(135deg, #F472B6, #8B5CF6)' },
  recipientInitials: { color: '#fff', fontFamily: FONT.bold, fontSize: 14 },
  recipientLabel: { color: 'rgba(255,255,255,0.5)', fontFamily: FONT.medium, fontSize: 12 },
  recipientName: { color: '#fff', fontFamily: FONT.semibold, fontSize: 15 },
  sendField: { width: '100%', marginTop: 44 },
  payout: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)' },
  payoutFlag: { fontSize: 16 },
  payoutLabel: { color: 'rgba(255,255,255,0.55)', fontFamily: FONT.medium, fontSize: 14 },
  currencies: { flexDirection: 'row', gap: 8, marginTop: 18 },
  currency: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  currencyActive: { backgroundColor: 'rgba(196,181,253,0.18)', borderColor: 'rgba(196,181,253,0.6)' },
  currencyText: { color: 'rgba(255,255,255,0.45)', fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.8 },
  currencyTextActive: { color: '#EDE9FE' },
  sendNote: { color: 'rgba(255,255,255,0.38)', fontFamily: FONT.medium, fontSize: 12, marginTop: 18 },
  sendBottom: { paddingHorizontal: 20, gap: 14 },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 9 },
  key: { width: '31.5%', height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  keyText: { color: '#fff', fontFamily: FONT.semibold, fontSize: 26 },
  sendButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderRadius: 999, paddingVertical: 17, backgroundColor: '#F5F3FF', boxShadow: '0 8px 30px rgba(139,92,246,0.45)' },
  sendButtonText: { color: '#0B0716', fontFamily: FONT.bold, fontSize: 17 },
})
