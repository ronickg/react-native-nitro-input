/**
 * The 0.3.1 features on one screen: signs, styled cents, clocks, compact
 * figures, continuous rolls, native digits and Indian grouping, the
 * animation events, NitroText and a figure driven from the UI thread.
 */
import React, { useEffect, useRef, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { NitroNumber, NitroText, NitroTime, NumberFormat } from 'react-native-nitro-input'
import { Btn, Card, Row, styles } from '../harness'

const INK = '#111827'
const MUTED = '#9CA3AF'
const UP = '#16A34A'
const DOWN = '#DC2626'

const usdCompact = new NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const inr = new NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
const arabic = new NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' })
const gain = new NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'exceptZero' })

function Label({ children }: { children: string }) {
  return <Text style={styles.cardHint}>{children}</Text>
}

function SignDemo() {
  const [value, setValue] = useState(12.4)
  return (
    <Card title="Signs" hint="signDisplay 'exceptZero' (from the format): a plus on gains, a minus on losses, none on zero; the plus swaps into the minus.">
      <NitroNumber testID="features-sign" value={value} format={gain} fontSize={40} fontWeight="700" color={value > 0 ? UP : value < 0 ? DOWN : INK} />
      <Row>
        <Btn testID="features-sign-up" title="+12.40" onPress={() => setValue(12.4)} />
        <Btn testID="features-sign-down" title="−3.10" onPress={() => setValue(-3.1)} />
        <Btn testID="features-sign-zero" title="0" onPress={() => setValue(0)} />
        <Btn testID="features-sign-random" title="Random" onPress={() => setValue(Math.round((Math.random() - 0.5) * 20000) / 100)} />
      </Row>
    </Card>
  )
}

function CentsDemo() {
  const [value, setValue] = useState(1234.56)
  return (
    <Card title="Styled cents and affixes" hint="fractionFontSize, fractionColor and fractionAlign 'top' (superscript cents), and prefixColor.">
      <NitroNumber
        testID="features-cents"
        value={value}
        fractionDigits={2}
        groupingSeparator=","
        prefix="$"
        fontSize={44}
        fontWeight="700"
        color={INK}
        prefixColor={MUTED}
        prefixFontSize={26}
        prefixAlign="top"
        fractionFontSize={24}
        fractionColor={MUTED}
        fractionAlign="top"
      />
      <Label>Baseline cents:</Label>
      <NitroNumber value={value} fractionDigits={2} groupingSeparator="," prefix="$" fontSize={36} fontWeight="600" color={INK} fractionFontSize={22} fractionColor={MUTED} />
      <Row>
        <Btn testID="features-cents-random" title="Random" onPress={() => setValue(Math.round(Math.random() * 1_000_000) / 100)} />
        <Btn testID="features-cents-plus" title="+0.01" onPress={() => setValue((v) => Math.round((v + 0.01) * 100) / 100)} />
      </Row>
    </Card>
  )
}

function ClockDemo() {
  const [elapsed, setElapsed] = useState(55)
  const [remaining, setRemaining] = useState(3605)
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed((s) => s + 1)
      setRemaining((s) => (s > 0 ? s - 1 : 3605))
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <Card title="Clocks and timers" hint="NitroTime: the tens of seconds and minutes wrap after 5, so 0:59 → 1:00 turns them one step.">
      <NitroTime testID="features-timer" seconds={elapsed} fontSize={40} fontWeight="700" color={INK} />
      <NitroTime testID="features-countdown" seconds={remaining} timeFormat="h:mm:ss" fontSize={28} fontWeight="600" color={MUTED} />
      <Row>
        <Btn testID="features-timer-59" title="Jump to 0:58" onPress={() => setElapsed(58)} />
        <Btn testID="features-timer-reset" title="Reset" onPress={() => setElapsed(0)} />
      </Row>
    </Card>
  )
}

function CompactDemo() {
  const [value, setValue] = useState(950)
  return (
    <Card title="Compact notation" hint="A compact format: the figure rolls and the suffix swaps as the value crosses a thousand, a million.">
      <NitroNumber testID="features-compact" value={value} format={usdCompact} fontSize={40} fontWeight="700" color={INK} />
      <Row>
        <Btn testID="features-compact-x10" title="×10" onPress={() => setValue((v) => Math.min(v * 10, 9.5e11))} />
        <Btn testID="features-compact-div" title="÷10" onPress={() => setValue((v) => Math.max(v / 10, 1))} />
        <Btn testID="features-compact-add" title="+50" onPress={() => setValue((v) => v + 50)} />
      </Row>
    </Card>
  )
}

function ContinuousDemo() {
  const [value, setValue] = useState(100)
  return (
    <Card title="Continuous" hint="continuous: the wheels below the highest one that changes turn a full turn, so 100 → 200 seems to pass through every value.">
      <NitroNumber testID="features-continuous" value={value} continuous fontSize={40} fontWeight="700" color={INK} duration={900} />
      <NitroNumber value={value} fontSize={24} color={MUTED} duration={900} />
      <Row>
        <Btn testID="features-continuous-up" title="+100" onPress={() => setValue((v) => v + 100)} />
        <Btn testID="features-continuous-down" title="−100" onPress={() => setValue((v) => Math.max(0, v - 100))} />
      </Row>
    </Card>
  )
}

function LocaleDemo() {
  const [value, setValue] = useState(1234567.5)
  return (
    <Card title="Native digits and Indian grouping" hint="From the format: en-IN groups 12,34,567; ar-EG draws Arabic-Indic digits.">
      <NitroNumber testID="features-inr" value={value} format={inr} fontSize={32} fontWeight="600" color={INK} />
      <NitroNumber testID="features-arabic" value={value} format={arabic} fontSize={32} fontWeight="600" color={INK} />
      <Row>
        <Btn testID="features-locale-random" title="Random" onPress={() => setValue(Math.round(Math.random() * 1e9) / 100)} />
      </Row>
    </Card>
  )
}

function EventsDemo() {
  const [value, setValue] = useState(10)
  const [log, setLog] = useState<string[]>([])
  const push = (line: string) => setLog((l) => [line, ...l].slice(0, 4))
  return (
    <Card title="Animation events" hint="onAnimationStart when the figure sets off, onAnimationEnd once when it rests, however many changes came meanwhile.">
      <NitroNumber
        testID="features-events"
        value={value}
        fontSize={36}
        fontWeight="700"
        color={INK}
        duration={800}
        onAnimationStart={() => push('start')}
        onAnimationEnd={(v) => push(`end ${v}`)}
      />
      <Text testID="features-events-log" style={styles.cardHint}>{log.join(' · ') || 'no events yet'}</Text>
      <Row>
        <Btn testID="features-events-one" title="+1" onPress={() => setValue((v) => v + 1)} />
        <Btn
          testID="features-events-burst"
          title="Three quick"
          onPress={() => {
            setValue((v) => v + 1)
            setTimeout(() => setValue((v) => v + 1), 150)
            setTimeout(() => setValue((v) => v + 1), 300)
          }}
        />
      </Row>
    </Card>
  )
}

const LABELS = ['Sign in', 'Signing in…', 'Signed in', 'Total $1,204', 'Total $1,318']

function TextDemo() {
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  return (
    <Card title="NitroText" hint="Any text morphs: shared characters keep their shapes and move, the rest fade (Torph's effect, natively). One draw at rest, like a label; it shimmers while loading.">
      <NitroText testID="features-text" fontSize={30} fontWeight="700" color={INK} loading={loading}>
        {LABELS[index]!}
      </NitroText>
      <NitroText fontSize={17} color={MUTED} loading={loading} shimmerBaseColor="#E5E7EB" shimmerColor="#9CA3AF">
        {`Step ${index + 1} of ${LABELS.length}`}
      </NitroText>
      <Row>
        <Btn testID="features-text-next" title="Next" onPress={() => setIndex((i) => (i + 1) % LABELS.length)} />
        <Btn testID="features-text-loading" title={loading ? 'Loaded' : 'Loading'} onPress={() => setLoading((l) => !l)} />
      </Row>
    </Card>
  )
}

function ShimmerDemo() {
  const [loading, setLoading] = useState(true)
  const common = { value: 1234.56, fractionDigits: 2, groupingSeparator: ',', prefix: '$', fontSize: 32, fontWeight: '700', color: INK, loading } as const
  return (
    <Card title="Shimmer" hint="The loading glint's angle, width, base colour, direction and pause.">
      <Label>Default</Label>
      <NitroNumber testID="features-shimmer-default" {...common} />
      <Label>Skeleton: shimmerBaseColor, a wide band</Label>
      <NitroNumber testID="features-shimmer-skeleton" {...common} shimmerBaseColor="#E5E7EB" shimmerColor="#9CA3AF" shimmerWidth={1.4} />
      <Label>A narrow, upright glint with a pause</Label>
      <NitroNumber testID="features-shimmer-glint" {...common} shimmerWidth={0.35} shimmerAngle={0} shimmerDuration={600} shimmerDelay={900} />
      <Label>Leaning back, right to left</Label>
      <NitroNumber testID="features-shimmer-rtl" {...common} shimmerAngle={-35} shimmerDirection="rtl" />
      <Row>
        <Btn testID="features-shimmer-toggle" title={loading ? 'Loaded' : 'Loading'} onPress={() => setLoading((l) => !l)} />
      </Row>
    </Card>
  )
}

export function FeaturesScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SignDemo />
      <ShimmerDemo />
      <CentsDemo />
      <ClockDemo />
      <CompactDemo />
      <ContinuousDemo />
      <LocaleDemo />
      <EventsDemo />
      <TextDemo />
      <View style={{ height: 40 }} />
    </ScrollView>
  )
}
