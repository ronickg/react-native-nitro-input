import React, { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { NitroNumber, NumberFormat } from 'react-native-nitro-input'

/**
 * Money the way an app keeps it: minor units in a bigint, shown by a
 * `NumberFormat`. The figure follows the format per value: whole amounts drop
 * their cents (`trailingZeroDisplay: 'stripIfInteger'`) and the decimal
 * columns roll in and out, and halves round to even (`roundingMode:
 * 'halfEven'`) when the format shows no cents.
 */

const STEPS: { label: string; cents: bigint }[] = [
  { label: '$1,234', cents: 123400n },
  { label: '$1,234.50', cents: 123450n },
  { label: '$1,235', cents: 123500n },
  { label: '$1,235.05', cents: 123505n },
  { label: '$99,000', cents: 9900000n },
]

export function MoneyFormatScreen() {
  const [cents, setCents] = useState(123400n)
  const strip = useMemo(
    () =>
      new NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        trailingZeroDisplay: 'stripIfInteger',
      }),
    []
  )
  // Whole dollars, banker's rounding: $2.50 → $2, $3.50 → $4.
  const whole = useMemo(
    () =>
      new NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
        roundingMode: 'halfEven',
      }),
    []
  )
  const [halves, setHalves] = useState(250n)

  return (
    <View style={s.page}>
      <View style={s.card}>
        <Text style={s.caption}>stripIfInteger, minor units in a bigint</Text>
        <NitroNumber
          testID="money-strip"
          format={strip}
          value={cents}
          minorDigits={2}
          fontSize={44}
          fontWeight="700"
          duration={600}
          style={s.figure}
          textAlign="center"
        />
        <Text style={s.small}>{`${cents}n cents · format.format: ${strip.format(Number(cents) / 100)}`}</Text>
        <View style={s.row}>
          {STEPS.map((step) => (
            <Btn key={step.label} testID={`money-${step.cents}`} title={step.label} onPress={() => setCents(step.cents)} />
          ))}
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.caption}>whole dollars, roundingMode halfEven</Text>
        <NitroNumber
          testID="money-even"
          format={whole}
          value={halves}
          minorDigits={2}
          fontSize={44}
          fontWeight="700"
          duration={600}
          style={s.figure}
          textAlign="center"
        />
        <Text style={s.small}>{`${halves}n cents · Intl says ${whole.format(String(halves).replace(/(\d\d)$/, '.$1'))}`}</Text>
        <View style={s.row}>
          {[150n, 250n, 350n, 450n].map((c) => (
            <Btn key={String(c)} testID={`even-${c}`} title={`$${Number(c) / 100}`} onPress={() => setHalves(c)} />
          ))}
        </View>
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
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, gap: 10, alignItems: 'center' },
  caption: { fontSize: 13, color: '#6B7280' },
  figure: { width: 320 },
  small: { fontSize: 12, color: '#374151' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#E0E7FF' },
  btnText: { fontSize: 14, color: '#1E3A8A', fontWeight: '600' },
})
