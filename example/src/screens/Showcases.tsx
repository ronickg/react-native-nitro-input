import React, { useEffect, useRef, useState } from 'react'
import { Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { NitroInput, NitroNumber, type NitroInputHandle, type NitroNumberHandle } from 'react-native-nitro-input'

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

/** Timers that are all cleared when the screen goes away. */
function useTimers() {
  const pending = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => pending.current.forEach(clearTimeout), [])
  return (ms: number, fn: () => void) => {
    pending.current.push(setTimeout(fn, ms))
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

// ------------------------------------------------------------------- reward

/** The win levels a slot machine escalates through, one per milestone. */
const TIERS = [
  { name: 'BIG WIN', color: '#5EEAD4', glow: 'rgba(45,212,191,0.9)' },
  { name: 'MEGA WIN', color: '#F0ABFC', glow: 'rgba(232,121,249,0.9)' },
  { name: 'EPIC WIN', color: '#FDE047', glow: 'rgba(250,204,21,0.95)' },
]
/** The stake the win is measured against, for the multiplier. */
const BET = 250
/** Other machines on the floor, each showing its latest win. */
const FLOOR = [
  { name: 'Golden Reels', icon: '🎰', base: 1_240 },
  { name: 'Lucky Sevens', icon: '7️⃣', base: 380 },
  { name: 'Diamond Rush', icon: '💎', base: 2_860 },
]

/** The progressive jackpot pool: it grows by a few cents every beat, driven through its handle. */
function JackpotPool() {
  const ref = useRef<NitroNumberHandle>(null)
  useEffect(() => {
    let pool = 1_284_512.37
    const id = setInterval(() => {
      pool = Math.round((pool + 0.37 + Math.random() * 3.1) * 100) / 100
      ref.current?.animateTo(pool)
    }, 140)
    return () => clearInterval(id)
  }, [])
  return (
    <View style={s.pool}>
      <Text style={s.poolLabel}>Progressive jackpot</Text>
      <NitroNumber
        ref={ref}
        value={1_284_512.37}
        prefix="$"
        fractionDigits={2}
        groupingSeparator=","
        transition="numeric"
        fontFamily={FONT.bold}
        fontSize={26}
        color="#FDE68A"
      />
    </View>
  )
}

/** The latest win on each of the other machines, one of them changing every beat. */
function LiveWins() {
  const refs = useRef<(NitroNumberHandle | null)[]>([])
  useEffect(() => {
    let i = 0
    const id = setInterval(() => {
      const m = FLOOR[i % FLOOR.length]
      const win = Math.round(m.base * (0.3 + Math.random() * Math.random() * 4)) + Math.round(Math.random() * 100) / 100
      refs.current[i % FLOOR.length]?.animateTo(win)
      i++
    }, 700)
    return () => clearInterval(id)
  }, [])
  return (
    <View style={s.feed}>
      <View style={s.feedHead}>
        <View style={s.feedDot} />
        <Text style={s.feedTitle}>Live wins</Text>
      </View>
      {FLOOR.map((m, i) => (
        <View key={m.name} style={s.feedRow}>
          <Text style={s.feedName}>
            {m.icon}  {m.name}
          </Text>
          <NitroNumber
            ref={(h) => {
              refs.current[i] = h
            }}
            value={m.base}
            prefix="$"
            fractionDigits={2}
            groupingSeparator=","
            transition="numeric"
            flashUpColor="#FDE68A"
            flashDownColor="#F0ABFC"
            fontFamily={FONT.semibold}
            fontSize={15}
            color="rgba(255,247,224,0.9)"
          />
        </View>
      ))}
    </View>
  )
}

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
 * lands with a pop and a confetti burst, then the next gift arrives.
 */
export function RewardShowcase({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const later = useTimers()
  const [amount, setAmount] = useState(50_000)
  const [reveal, setReveal] = useState(false)
  const [tier, setTier] = useState(-1)
  const [burst, setBurst] = useState(0)
  const [balance, setBalance] = useState(12_480.5)
  const [multiplier, setMultiplier] = useState(0)

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

  const playRound = () => {
    setMultiplier(0)
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
      setAmount(50_000)
      later(350, () => setReveal(true))
    })
  }

  useEffect(() => {
    later(500, () => playRound())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onRevealMilestone = (index: number, value: number) => {
    setTier(index)
    setMultiplier(value / BET)
    punch()
    rain.value = withTiming(0.45 + index * 0.25, { duration: 250 })
  }

  const onRevealEnd = () => {
    setBurst((b) => b + 1)
    setMultiplier(amount / BET)
    // The win lands in the balance a beat later.
    later(700, () => setBalance((b) => Math.round((b + amount) * 100) / 100))
    punch()
    rain.value = withTiming(1, { duration: 200 })
    later(2600, () => {
      setReveal(false)
      later(500, () => playRound())
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
      <View style={[s.rewardTop, { paddingTop: insets.top + 8 }]}>
        <JackpotPool />
        <View style={s.chips}>
          <View style={s.chip}>
            <Text style={s.chipLabel}>Balance</Text>
            <NitroNumber
              value={balance}
              prefix="$"
              fractionDigits={2}
              groupingSeparator=","
              duration={1400}
              stagger={40}
              easing="easeInOut"
              fontFamily={FONT.semibold}
              fontSize={15}
              color="#FFF7DB"
            />
          </View>
          <View style={s.chip}>
            <Text style={s.chipLabel}>Bet</Text>
            <NitroNumber value={BET} prefix="$" fractionDigits={2} fontFamily={FONT.semibold} fontSize={15} color="#FFF7DB" />
          </View>
        </View>
      </View>
      <Animated.View style={[s.center, shakeStyle]}>
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
              revealStyle="count"
              revealMilestones={[1000, 10000, 25000]}
              revealMilestoneHold={420}
              revealDuration={5200}
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
        {/* Hidden, not unmounted, until the first tier: "×0 your bet" reads as a loss. */}
        <View style={[s.multiplier, multiplier === 0 && s.hidden]}>
          <NitroNumber
            value={multiplier}
            prefix="×"
            transition="numeric"
            groupingSeparator=","
            fontFamily={FONT.bold}
            fontSize={20}
            color="#FDE68A"
          />
          <Text style={s.rewardSub}> your bet</Text>
        </View>
      </Animated.View>
      <View style={[s.footer, { paddingBottom: insets.bottom + 20 }]}>
        <LiveWins />
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
/** The strip of other currencies and the space around it. */
const COMPARE_HEIGHT = 62

/** A keypad key; every new `press` count lights it for a moment. */
function Key({ label, press }: { label: string; press: number }) {
  const glow = useSharedValue(0)
  useEffect(() => {
    if (press === 0) return
    glow.value = withSequence(withTiming(1, { duration: 50 }), withDelay(40, withTiming(0, { duration: 240 })))
  }, [press, glow])
  const style = useAnimatedStyle(() => ({
    // Fixed digits: a decaying glow reaches values like 5.7e-8, which is no colour.
    backgroundColor: `rgba(255,255,255,${(glow.value * 0.14).toFixed(3)})`,
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
 * receive, the fee, the amount converted and the same money in three other
 * currencies are NitroNumbers following it, the rate ticks live, and the
 * payout currency changes format as it goes.
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
        </View>

        {/* The same money in the other currencies, following every keystroke. */}
        <View style={s.tCompareSlot} onLayout={(e) => setRoom(e.nativeEvent.layout.height)}>
          {room >= COMPARE_HEIGHT && (
            <View style={s.tCompare}>
              {PAYOUTS.filter((_, i) => i !== payout)
                .slice(0, 3)
                .map((c) => (
                  <View key={c.code} style={s.tChip}>
                    <Text style={s.tChipCode}>
                      {c.flag} {c.code}
                    </Text>
                    <NitroNumber
                      value={round(converted * c.rate * drift, c.digits)}
                      prefix={c.prefix}
                      suffix={c.suffix}
                      groupingSeparator={c.grouping}
                      decimalSeparator={c.decimal}
                      fractionDigits={c.digits}
                      transition="numeric"
                      fontFamily={FONT.semibold}
                      fontSize={14}
                      color="rgba(255,255,255,0.9)"
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                      style={s.tChipAmount}
                    />
                  </View>
                ))}
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

  hero: { width: '100%' },

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
  rewardSub: { color: 'rgba(255,247,224,0.65)', fontFamily: FONT.medium, fontSize: 15 },
  multiplier: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  hidden: { opacity: 0 },
  rewardTop: { paddingHorizontal: 20, gap: 10, alignItems: 'center' },
  pool: { alignItems: 'center', paddingHorizontal: 22, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(253,224,71,0.35)', backgroundColor: 'rgba(0,0,0,0.25)', boxShadow: '0 0 24px rgba(250,204,21,0.18)' },
  poolLabel: { color: 'rgba(253,230,138,0.75)', fontFamily: FONT.bold, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', gap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  chipLabel: { color: 'rgba(255,247,224,0.55)', fontFamily: FONT.medium, fontSize: 12 },
  feed: { alignSelf: 'stretch', gap: 6, padding: 12, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)' },
  feedHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  feedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F472B6', boxShadow: '0 0 6px #F472B6' },
  feedTitle: { color: 'rgba(255,247,224,0.6)', fontFamily: FONT.bold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  feedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feedName: { color: 'rgba(255,247,224,0.8)', fontFamily: FONT.medium, fontSize: 14 },
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
  tCompareSlot: { flex: 1, justifyContent: 'center' },
  tCompare: { flexDirection: 'row', gap: 8 },
  tChip: { flex: 1, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 14, gap: 3, backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' },
  tChipCode: { color: 'rgba(255,255,255,0.5)', fontFamily: FONT.medium, fontSize: 11 },
  tChipAmount: { width: '100%' },
  tBottom: { paddingHorizontal: 18, gap: 12 },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 4 },
  key: { width: '31.5%', height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  keyText: { color: '#fff', fontFamily: FONT.semibold, fontSize: 26 },
  tCta: { borderRadius: 999, paddingVertical: 17, alignItems: 'center', backgroundColor: '#5EEAD4', boxShadow: '0 8px 28px rgba(45,212,191,0.35)' },
  tCtaText: { color: '#04201C', fontFamily: FONT.bold, fontSize: 17 },
})
