import React, { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NitroNumber } from 'react-native-nitro-input'

// ---------------------------------------------------------------------------
// Edge cases for NitroNumber's text and format transitions, the auto
// alignment of a figure that hugs its content, and opening columns. Every
// card cycles on its own, so a screen recording shows them all; the label
// says what each should do. Tap the top-right corner to leave.
// ---------------------------------------------------------------------------

/** A counter that advances every `ms`. */
function useStep(ms: number) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setStep((s) => s + 1), ms)
    return () => clearInterval(id)
  }, [ms])
  return step
}

const CURRENCIES = [
  { rate: 1, prefix: '$', suffix: '', grouping: ',', decimal: '.', digits: 2 },
  { rate: 0.9218, prefix: '', suffix: ' €', grouping: '.', decimal: ',', digits: 2 },
  { rate: 149.31, prefix: '¥', suffix: '', grouping: ',', decimal: '.', digits: 0 },
  { rate: 0.8634, prefix: 'CHF ', suffix: '', grouping: '’', decimal: '.', digits: 2 },
]

function currency(i: number, usd: number) {
  const c = CURRENCIES[i % CURRENCIES.length]
  const value = Math.round(usd * c.rate * 10 ** c.digits) / 10 ** c.digits
  return {
    value,
    prefix: c.prefix,
    suffix: c.suffix,
    groupingSeparator: c.grouping,
    decimalSeparator: c.decimal,
    fractionDigits: c.digits,
  }
}

function Card({ title, expect, children }: { title: string; expect: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.title}>{title}</Text>
      <View style={s.stage}>{children}</View>
      <Text style={s.expect}>{expect}</Text>
    </View>
  )
}

const BASE = { fontSize: 30, fontWeight: '700' as const, color: '#F8FAFC', transition: 'numeric' as const }

export function EdgeCasesScreen({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets()
  const step = useStep(1400)
  const fast = useStep(150)
  const usd = 4280 + (step % 3) * 1337.25

  const prefixes = ['', '$', 'US$ ']
  const units = [
    { suffix: ' kg', digits: 1, value: 72.4 },
    { suffix: ' lb', digits: 2, value: 159.62 },
    { suffix: '', digits: 0, value: 72 },
  ]
  const unit = units[step % units.length]
  const negative = step % 2 === 0 ? { ...currency(1, -1234.56) } : { ...currency(0, 1234.56) }
  const grow = [7, 1234, 98765.4, 12][step % 4]

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Pressable style={s.exit} onPress={onExit} testID="edge-exit" />
      <ScrollView contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={s.heading}>NitroNumber edge cases</Text>

        <Card title="Prefix appears and goes" expect="Fades in and out; digits slide to make room">
          <NitroNumber {...BASE} value={1234.5} fractionDigits={2} groupingSeparator="," prefix={prefixes[step % prefixes.length]} />
        </Card>

        <Card title="Unit suffix, decimals change" expect="kg → lb → none; decimals open and close">
          <NitroNumber {...BASE} value={unit.value} fractionDigits={unit.digits} suffix={unit.suffix} />
        </Card>

        <Card title="Negative, currency flips" expect="Sign fades with the switch">
          <NitroNumber {...BASE} {...negative} />
        </Card>

        <Card title="Right to left" expect="Prefix on the right; swaps against the digits">
          <NitroNumber {...BASE} {...currency(step, usd)} style={s.rtl} />
        </Card>

        <Card title="Centred, hugging" expect="Grows and shrinks from its centre">
          <View style={s.center}>
            <NitroNumber {...BASE} value={grow} fractionDigits={grow % 1 ? 1 : 0} groupingSeparator="," prefix="$" />
          </View>
        </Card>

        <Card title="End of a row, hugging" expect="Right edge stays put">
          <View style={s.row}>
            <Text style={s.rowLabel}>Total</Text>
            <NitroNumber {...BASE} value={grow} fractionDigits={grow % 1 ? 1 : 0} groupingSeparator="," prefix="$" />
          </View>
        </Card>

        <Card title="Full width, auto" expect="Left edge stays put (start edge)">
          <NitroNumber {...BASE} value={grow} fractionDigits={grow % 1 ? 1 : 0} groupingSeparator="," prefix="$" style={s.full} />
        </Card>

        <Card title="Loading while switching" expect="Glint keeps running; text still swaps">
          <NitroNumber {...BASE} {...currency(step, usd)} loading={step % 4 < 2} />
        </Card>

        <Card title="Switching every 150 ms" expect="Never stuck blank or half-changed">
          <NitroNumber {...BASE} {...currency(fast, usd)} />
        </Card>

        <Card title="Scramble, currency" expect="Digits scramble; text still swaps">
          <NitroNumber {...BASE} {...currency(step, usd)} transition="scramble" />
        </Card>

        <Card title="Roll, currency" expect="Rolls into the new format, decimals and all">
          <NitroNumber {...BASE} {...currency(step, usd)} transition="roll" />
        </Card>

        <Card title="Flash on, currency" expect="Flash colours, no stray tint after">
          <NitroNumber {...BASE} {...currency(step, usd)} flashUpColor="#34D399" flashDownColor="#FB7185" />
        </Card>

        <Card title="Squeezed to fit" expect="Shrinks, never clipped">
          <View style={s.narrow}>
            <NitroNumber {...BASE} {...currency(step, usd * 40)} adjustsFontSizeToFit minimumFontScale={0.4} style={s.full} textAlign="right" />
          </View>
        </Card>

        <Card title="Translucent ink" expect="Stays 50 % through every change">
          <NitroNumber {...BASE} {...currency(step, usd)} color="rgba(248,250,252,0.5)" />
        </Card>
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F17' },
  exit: { position: 'absolute', top: 0, right: 0, width: 72, height: 72, zIndex: 10 },
  list: { padding: 16, gap: 12 },
  heading: { color: '#F8FAFC', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  card: { backgroundColor: '#151B26', borderRadius: 16, padding: 14, gap: 8 },
  title: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  stage: { minHeight: 44, justifyContent: 'center' },
  expect: { color: '#64748B', fontSize: 12 },
  rtl: { direction: 'rtl', alignSelf: 'flex-end' },
  center: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: '#CBD5E1', fontSize: 16 },
  full: { width: '100%' },
  narrow: { width: 170, alignSelf: 'flex-end' },
})
