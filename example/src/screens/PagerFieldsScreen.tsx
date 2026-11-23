import React, { useState } from 'react'
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { NitroInput } from 'react-native-nitro-input'

/**
 * Fields inside a vertical ScrollView inside a horizontal pager, the layout of
 * a tab view or onboarding carousel. On Android a touch that starts on a field
 * has to go to whoever the gesture is for: a vertical swipe scrolls the page,
 * a horizontal one pages, and a long-press selection drag or a cursor drag
 * stays with the field however the finger drifts. `e2e/touch-handoff-android.sh`
 * drives it.
 */
const PAGES = ['One', 'Two', 'Three']
const FIELDS = 14

export function PagerFieldsScreen() {
  const { width } = useWindowDimensions()
  const [page, setPage] = useState(0)
  return (
    <View style={s.screen}>
      <Text testID="pager-status" style={s.status}>{`page ${page + 1} of ${PAGES.length}`}</Text>
      <ScrollView
        testID="pager"
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {PAGES.map((name, p) => (
          <ScrollView key={name} testID={`pager-page-${p}`} style={{ width }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <Text style={s.title}>{`Page ${name}`}</Text>
            {Array.from({ length: FIELDS }, (_, i) => (
              <View key={i} style={s.box}>
                <NitroInput
                  testID={`pager-field-${p}-${i}`}
                  style={s.field}
                  defaultValue={`alpha bravo charlie delta ${p}-${i}`}
                  fontSize={16}
                  color="#081033"
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            ))}
          </ScrollView>
        ))}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F8FA' },
  status: { paddingHorizontal: 16, paddingVertical: 8, fontSize: 14, color: '#555B73' },
  body: { padding: 16, gap: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#081033' },
  box: { height: 56, borderRadius: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 16, justifyContent: 'center' },
  field: { height: 40 },
})
