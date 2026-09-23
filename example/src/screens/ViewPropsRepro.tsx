import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { NitroInput } from 'react-native-nitro-input'

/**
 * The smallest thing that shows it.
 *
 * Two boxes, one style object. The left one is a plain React Native `View`,
 * the right one is a Nitro Hybrid View. On iOS they look identical. On Android
 * the Nitro one draws nothing at all: no fill, no border, no rotation.
 *
 * `transform` is the one to watch. A missing `backgroundColor` can always be
 * argued away ("the component paints its own surface"), but nothing paints a
 * rotation - so if the right box is upright while the left one is tilted, base
 * `ViewProps` are not reaching the view.
 *
 * Cause: `ViewComponentDescriptor::cloneProps` in react-native-nitro-modules
 * overrides React Native's and omits `initializeDynamicProps`, which is the
 * only writer of `Props::rawProps` - the map Android serializes to Java and
 * hands to `ViewManager.updateProperties`.
 */
const box = {
  width: 120,
  height: 120,
  backgroundColor: '#00C000',
  borderWidth: 4,
  borderColor: '#FF0000',
  borderRadius: 12,
  transform: [{ rotate: '10deg' }],
  opacity: 0.3,
} as const

export function ViewPropsReproScreen() {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Nitro view props on Android</Text>
      <Text style={styles.hint}>
        Same style object on both. Green fill, red border, rotated 10°.
      </Text>

      <View style={styles.row}>
        <View style={styles.cell}>
          <Text style={styles.label}>RN View</Text>
          <View style={box} testID="repro-rn" />
        </View>

        <View style={styles.cell}>
          <Text style={styles.label}>Nitro view</Text>
          <NitroInput transition="reflow" style={box} testID="repro-nitro" />
        </View>
      </View>

      <Text style={styles.footnote}>
        iOS: identical. Android before the fix: the right box is invisible.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F7F8FA', padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#0B1220', paddingTop: 12 },
  hint: { fontSize: 14, color: '#6B7280' },
  row: { flexDirection: 'row', gap: 40, paddingTop: 40, paddingLeft: 20 },
  cell: { gap: 24 },
  label: { fontSize: 12, fontWeight: '700', color: '#9AA1AC' },
  footnote: { fontSize: 12, color: '#9AA1AC', paddingTop: 60 },
})
