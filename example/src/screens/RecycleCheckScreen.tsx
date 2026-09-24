import React, { useMemo, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { NitroNumber } from 'react-native-nitro-input'
import { NitroInput } from 'react-native-nitro-input'
import { Btn, Row } from '../harness'

/**
 * A screen for checking, from the outside, that a recycled or re-mounted view
 * shows the value of the row it is in and not the one it had before: 400 rows,
 * each with a label saying what its number (or field) must read, in a list
 * with a small render window so rows leave and come back as it scrolls. A
 * driver (argent, a test) scrolls, reads the accessibility tree and compares
 * every visible pair; the label carries the row's index as its testID, so a
 * driver can also compute the expectation without trusting any painted text.
 * "Bump values" rolls every row by one so settled values after an animation
 * can be checked too; "Unmount list" / "Mount list" is the mount/unmount
 * path; "Show fields" swaps the numbers for text fields. The driver is
 * `scripts/ui/recycle-check.mjs`.
 */
const ROWS = 400
const ROW_HEIGHT = 48

export function RecycleCheckScreen() {
  const [base, setBase] = useState(10000)
  const [shown, setShown] = useState(true)
  const [kind, setKind] = useState<'number' | 'field'>('number')
  const data = useMemo(() => Array.from({ length: ROWS }, (_, i) => i), [])

  return (
    <View style={styles.screen}>
      <Row>
        <Btn testID="recycle-bump" tone="primary" title="Bump values" onPress={() => setBase((b) => b + 1)} />
        <Btn testID="recycle-toggle" title={shown ? 'Unmount list' : 'Mount list'} onPress={() => setShown((s) => !s)} />
        <Btn testID="recycle-kind" title={kind === 'number' ? 'Show fields' : 'Show numbers'} onPress={() => setKind((k) => (k === 'number' ? 'field' : 'number'))} />
      </Row>
      <Text testID="recycle-base" style={styles.hint}>{`base ${base} · ${kind}s`}</Text>
      {shown ? (
        <FlatList
          testID="recycle-list"
          data={data}
          keyExtractor={(i) => String(i)}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          windowSize={5}
          initialNumToRender={12}
          renderItem={({ item }) => {
            const expected = base + item
            return (
              <View style={styles.row}>
                <Text style={styles.label} testID={`row-${item}`}>{`expect ${expected}`}</Text>
                {kind === 'number' ? (
                  <NitroNumber value={expected} groupingSeparator="" fontSize={20} style={styles.number} />
                ) : (
                  <NitroInput value={String(expected)} fontSize={16} style={styles.field} />
                )}
              </View>
            )
          }}
        />
      ) : (
        <Text style={styles.hint}>list unmounted</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  hint: { paddingHorizontal: 16, paddingVertical: 6, color: '#666' },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  label: { fontSize: 14, color: '#333' },
  number: { minWidth: 90, alignItems: 'flex-end' },
  field: { width: 120, height: 36 },
})
