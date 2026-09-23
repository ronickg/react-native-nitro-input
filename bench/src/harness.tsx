import React, { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

/** A timestamped line in a screen's event log. */
export interface LogLine {
  id: number
  at: number
  who: 'morph' | 'rn' | 'screen'
  what: string
}

let nextId = 1

/**
 * Collects the callbacks both inputs fire so their order and timing can be
 * compared directly. `t0` is the first line, so every `+ms` is relative to the
 * start of the interaction being measured.
 */
export function useEventLog() {
  const [lines, setLines] = useState<LogLine[]>([])
  const t0 = useRef<number | null>(null)

  const push = useCallback((who: LogLine['who'], what: string) => {
    const now = Date.now()
    if (t0.current == null) t0.current = now
    setLines(prev => [{ id: nextId++, at: now - (t0.current ?? now), who, what }, ...prev].slice(0, 60))
  }, [])

  const clear = useCallback(() => {
    t0.current = null
    setLines([])
  }, [])

  return { lines, push, clear }
}

export function EventLog({ lines, testID }: { lines: LogLine[]; testID?: string }) {
  return (
    <View style={styles.log} testID={testID}>
      <ScrollView style={styles.logScroll} contentContainerStyle={styles.logContent}>
        {lines.length === 0 ? (
          <Text style={styles.logEmpty}>no events yet</Text>
        ) : (
          lines.map(l => (
            <Text
              key={l.id}
              style={[styles.logLine, l.who === 'morph' ? styles.logMorph : l.who === 'rn' ? styles.logRn : styles.logScreen]}
            >
              {`+${String(l.at).padStart(4, ' ')}ms  ${l.who.padEnd(6, ' ')} ${l.what}`}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  )
}

export function Btn({ title, onPress, testID, tone }: { title: string; onPress: () => void; testID: string; tone?: 'plain' | 'primary' }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, tone === 'primary' && styles.btnPrimary, pressed && styles.btnPressed]}
    >
      <Text style={[styles.btnText, tone === 'primary' && styles.btnTextPrimary]}>{title}</Text>
    </Pressable>
  )
}

export function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>
}

export function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {hint ? <Text style={styles.cardHint}>{hint}</Text> : null}
      {children}
    </View>
  )
}

/** Label above each field so screenshots say which component is which. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F2F2F7' },
  content: { padding: 16, gap: 14, paddingBottom: 60 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  cardHint: { fontSize: 12, color: '#6B7280', lineHeight: 16 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: '#E5E7EB' },
  btnPrimary: { backgroundColor: '#2563EB' },
  btnPressed: { opacity: 0.6 },
  btnText: { fontSize: 13, fontWeight: '600', color: '#111' },
  btnTextPrimary: { color: '#fff' },
  log: { borderRadius: 10, backgroundColor: '#111827', height: 108, overflow: 'hidden' },
  logScroll: { flex: 1 },
  logContent: { padding: 8 },
  logEmpty: { color: '#6B7280', fontSize: 11, fontFamily: 'Menlo' },
  logLine: { fontSize: 10, fontFamily: 'Menlo', lineHeight: 15 },
  logMorph: { color: '#34D399' },
  logRn: { color: '#93C5FD' },
  logScreen: { color: '#FCD34D' },
  /** Both fields get the same box so any difference is the component's. */
  field: {
    width: '100%',
    height: 52,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    justifyContent: 'center',
  },
  rnField: { fontSize: 22, color: '#111', padding: 0 },
})
