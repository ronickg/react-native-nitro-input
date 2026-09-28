import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { FlowField, type FlowFieldHandle, type Impl } from './KeyboardFlow'
import type { RootStackParamList } from '../navigation'

/**
 * The input lab: the same flows the platform apps have (a search over a list,
 * a form chained with the keyboard's Next key, a push while a field has the
 * keyboard), built from one component or the other, to hold against iOS
 * Contacts and Samsung Settings / Contacts.
 *
 * The lists and the form use the scroll props a native list behaves like:
 * a drag dismisses the keyboard (`keyboardDismissMode="on-drag"`, Contacts
 * and Settings do this on both platforms) and a tap on a row opens it at once
 * (`keyboardShouldPersistTaps="handled"`; RN's default `'never'` spends the
 * first tap on closing the keyboard, which no native list does).
 *
 * The status line at the top says which field has focus and whether the
 * keyboard is up, from the fields' own focus events and the Keyboard module,
 * so a recording shows what happened and a UI dump can assert it.
 */

const NAMES = [
  'Ada Lovelace',
  'Alan Turing',
  'Anna Haro',
  'Barbara Liskov',
  'Brian Kernighan',
  'Charles Babbage',
  'Claude Shannon',
  'Daniel Higgins',
  'David Taylor',
  'Dennis Ritchie',
  'Donald Knuth',
  'Edsger Dijkstra',
  'Frances Allen',
  'Grace Hopper',
  'Guido van Rossum',
  'Hank Zakroff',
  'Hedy Lamarr',
  'Ivan Sutherland',
  'James Gosling',
  'John Appleseed',
  'John McCarthy',
  'Kate Bell',
  'Ken Thompson',
  'Leslie Lamport',
  'Linus Torvalds',
  'Margaret Hamilton',
  'Niklaus Wirth',
  'Radia Perlman',
  'Richard Hamming',
  'Rob Pike',
  'Shafi Goldwasser',
  'Sophie Wilson',
  'Tim Berners-Lee',
  'Tony Hoare',
  'Vint Cerf',
  'Whitfield Diffie',
  'Yukihiro Matsumoto',
  'Adele Goldberg',
  'Bjarne Stroustrup',
  'Carl Sassenrath',
  'Dan Abramov',
  'Evelyn Boyd Granville',
  'Fran Bilas',
  'Gerald Sussman',
  'Hal Abelson',
  'Jean Bartik',
  'Kathleen Booth',
  'Lynn Conway',
  'Mary Keller',
  'Nancy Leveson',
  'Olin Shivers',
  'Peter Norvig',
  'Robin Milner',
  'Susan Kare',
  'Ted Nelson',
  'Ward Cunningham',
  'Xavier Leroy',
  'Yann LeCun',
  'Zhou Yu',
]

/** Which field has focus and whether the keyboard is up, kept for the status line. */
export function useLabStatus() {
  const [focused, setFocused] = useState<string | null>(null)
  const [keyboard, setKeyboard] = useState(Keyboard.isVisible() ? 'up' : 'down')
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const subs = [
      Keyboard.addListener(show, () => setKeyboard('up')),
      Keyboard.addListener(hide, () => setKeyboard('down')),
    ]
    return () => subs.forEach(s => s.remove())
  }, [])
  const track = (name: string) => ({
    onFocus: () => setFocused(name),
    onBlur: () => setFocused(current => (current === name ? null : current)),
  })
  return { focused, keyboard, track }
}

export function StatusLine({ impl, focused, keyboard }: { impl: Impl; focused: string | null; keyboard: string }) {
  return (
    <View style={lab.status}>
      <Text testID="lab-status" style={lab.statusText}>
        {`${impl === 'ours' ? 'NitroInput' : 'TextInput'} · focus: ${focused ?? 'none'} · keyboard: ${keyboard}`}
      </Text>
    </View>
  )
}

export function LabSearchScreen() {
  const { impl } = useRoute<RouteProp<RootStackParamList, 'LabSearch'>>().params
  const nav = useNavigation<any>()
  const [query, setQuery] = useState('')
  const { focused, keyboard, track } = useLabStatus()
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? NAMES.filter(n => n.toLowerCase().includes(q)) : NAMES
  }, [query])

  return (
    <View style={lab.screen}>
      <StatusLine impl={impl} focused={focused} keyboard={keyboard} />
      <View style={lab.searchWrap}>
        <FlowField
          impl={impl}
          testID="lab-search"
          placeholder="Search"
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          {...track('search')}
        />
      </View>
      <FlatList
        testID="lab-list"
        data={rows}
        keyExtractor={item => item}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            testID={`lab-row-${item}`}
            accessibilityRole="button"
            style={({ pressed }) => [lab.row, pressed && lab.rowPressed]}
            onPress={() => nav.navigate('LabDetail', { title: item })}
          >
            <Text style={lab.rowText}>{item}</Text>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={lab.separator} />}
      />
    </View>
  )
}

const FORM_FIELDS = [
  { key: 'first', placeholder: 'First name', autoCapitalize: 'words' as const },
  { key: 'last', placeholder: 'Last name', autoCapitalize: 'words' as const },
  { key: 'company', placeholder: 'Company', autoCapitalize: 'words' as const },
  { key: 'email', placeholder: 'Email', keyboardType: 'email-address' as const, autoCapitalize: 'none' as const },
  { key: 'phone', placeholder: 'Phone', keyboardType: 'phone-pad' as const },
  { key: 'notes', placeholder: 'Notes', autoCapitalize: 'sentences' as const },
]

export function LabFormScreen() {
  const { impl } = useRoute<RouteProp<RootStackParamList, 'LabForm'>>().params
  const nav = useNavigation<any>()
  const { focused, keyboard, track } = useLabStatus()
  const refs = useRef<Array<FlowFieldHandle | null>>([])

  return (
    <View style={lab.screen}>
      <StatusLine impl={impl} focused={focused} keyboard={keyboard} />
      <ScrollView
        testID="lab-form"
        contentContainerStyle={lab.form}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {FORM_FIELDS.map((field, i) => {
          const last = i === FORM_FIELDS.length - 1
          return (
            <FlowField
              key={field.key}
              ref={r => {
                refs.current[i] = r
              }}
              impl={impl}
              testID={`lab-${field.key}`}
              placeholder={field.placeholder}
              keyboardType={field.keyboardType}
              autoCapitalize={field.autoCapitalize}
              autoFocus={i === 0}
              returnKeyType={last ? 'done' : 'next'}
              // Next keeps the keyboard: the field stays focused until the next one takes over.
              submitBehavior={last ? 'blurAndSubmit' : 'submit'}
              onSubmitEditing={last ? undefined : () => refs.current[i + 1]?.focus()}
              {...track(field.key)}
            />
          )
        })}
        <Pressable
          testID="lab-form-label"
          accessibilityRole="button"
          style={({ pressed }) => [lab.row, lab.card, pressed && lab.rowPressed]}
          onPress={() => nav.navigate('LabDetail', { title: 'Phone label' })}
        >
          <Text style={lab.rowText}>Phone label: mobile ›</Text>
        </Pressable>
        {Array.from({ length: 10 }, (_, i) => (
          <View key={i} style={[lab.row, lab.card]}>
            <Text style={lab.filler}>{`More settings ${i + 1}`}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

export function LabDetailScreen() {
  const { title } = useRoute<RouteProp<RootStackParamList, 'LabDetail'>>().params
  return (
    <View style={[lab.screen, lab.detail]}>
      <Text testID="lab-detail" style={lab.detailTitle}>
        {title}
      </Text>
      <Text style={lab.filler}>Go back to see what the field and the keyboard do.</Text>
    </View>
  )
}

const lab = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F2F2F7' },
  status: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#1F2937' },
  statusText: { color: '#F9FAFB', fontSize: 13, fontVariant: ['tabular-nums'] },
  searchWrap: { padding: 12 },
  row: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: 'white' },
  rowPressed: { backgroundColor: '#E5E7EB' },
  rowText: { fontSize: 17, color: '#111827' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#D1D5DB', marginLeft: 16 },
  form: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { borderRadius: 12 },
  filler: { fontSize: 15, color: '#6B7280' },
  detail: { padding: 24, gap: 12 },
  detailTitle: { fontSize: 28, fontWeight: '700', color: '#111827' },
})
