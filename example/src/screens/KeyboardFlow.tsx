import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
  KeyboardToolbar,
  useKeyboardHandler,
} from 'react-native-keyboard-controller'
import { runOnJS } from 'react-native-reanimated'
import { NitroInput, type NitroInputHandle } from 'react-native-nitro-input'
import { Btn, FieldLabel, Row, styles } from '../harness'
import { clearKbLog, logKb, useKbLog } from '../keyboardLog'
import type { RootStackParamList } from '../navigation'

/**
 * Which text input the whole flow is built from. A run is one or the other
 * end to end — the point is to feel a real four-screen form, not to diff two
 * fields sitting side by side.
 */
export type Impl = 'ours' | 'rn'

type KeyboardKind = 'default' | 'email-address' | 'decimal-pad' | 'number-pad' | 'phone-pad' | 'url'
type ReturnKind = 'default' | 'done' | 'go' | 'next' | 'search' | 'send'

/* ------------------------------------------------------------------ field */

export interface FlowFieldHandle {
  focus(): void
  blur(): void
}

interface FlowFieldProps {
  impl: Impl
  testID: string
  placeholder?: string
  keyboardType?: KeyboardKind
  returnKeyType?: ReturnKind
  /** `'submit'` keeps focus so the return key can move to the next field. */
  submitBehavior?: 'submit' | 'blurAndSubmit'
  autoFocus?: boolean
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  autoCorrect?: boolean
  textContentType?: string
  secureTextEntry?: boolean
  /** Ours only: native numeric formatting as you type. Ignored for `'rn'`. */
  numeric?: boolean
  prefix?: string
  value?: string
  onChangeText?: (text: string) => void
  onSubmitEditing?: () => void
  onFocus?: () => void
  onBlur?: () => void
}

/**
 * One field, rendered as whichever component the flow is running. Every screen
 * below uses this, so none of them branch on `impl` themselves and the two
 * runs differ only in the native view underneath.
 */
export const FlowField = forwardRef<FlowFieldHandle, FlowFieldProps>(function FlowField(
  {
    impl,
    testID,
    placeholder,
    keyboardType,
    returnKeyType,
    submitBehavior,
    autoFocus,
    autoCapitalize,
    autoCorrect,
    textContentType,
    secureTextEntry,
    numeric,
    prefix,
    value,
    onChangeText,
    onSubmitEditing,
    onFocus,
    onBlur,
  },
  ref,
) {
  const ours = useRef<NitroInputHandle>(null)
  const rn = useRef<React.ComponentRef<typeof TextInput>>(null)

  useImperativeHandle(ref, () => ({
    focus: () => (impl === 'ours' ? ours.current?.focus() : rn.current?.focus()),
    blur: () => (impl === 'ours' ? ours.current?.blur() : rn.current?.blur()),
  }))

  if (impl === 'ours') {
    return (
      <NitroInput
        testID={testID}
        ref={ours}
        style={styles.field}
        fontSize={20}
        autoFocus={autoFocus}
        placeholder={placeholder}
        keyboardType={keyboardType}
        returnKeyType={returnKeyType}
        submitBehavior={submitBehavior}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        textContentType={textContentType}
        secureTextEntry={secureTextEntry}
        mode={numeric ? 'number' : 'text'}
        prefix={prefix}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    )
  }

  return (
    <TextInput
      testID={testID}
      ref={rn}
      style={[styles.field, styles.rnField]}
      autoFocus={autoFocus}
      placeholder={placeholder}
      keyboardType={keyboardType}
      returnKeyType={returnKeyType}
      submitBehavior={submitBehavior}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      textContentType={textContentType as never}
      secureTextEntry={secureTextEntry}
      value={value}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmitEditing}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  )
})

/* ------------------------------------------------------------- scaffolding */

/**
 * Keyboard events straight from the native observer, so the timeline shows
 * what the keyboard actually did rather than what the app asked for.
 */
function useKeyboardLogging(step: string) {
  useKeyboardHandler(
    {
      onStart: e => {
        'worklet'
        runOnJS(logKb)('kb', `${step} onStart  h=${Math.round(e.height)} dur=${e.duration}`)
      },
      onEnd: e => {
        'worklet'
        runOnJS(logKb)('kb', `${step} onEnd    h=${Math.round(e.height)}`)
      },
    },
    [step],
  )
}

function useStepLogging(step: string, impl: Impl) {
  useFocusEffect(
    useCallback(() => {
      logKb('screen', `${step} entered (${impl})`)
      return () => logKb('screen', `${step} left`)
    }, [step, impl]),
  )
}

/**
 * The shape most apps actually ship: a CTA pinned to the bottom that rides up
 * with the keyboard. If the keyboard dips or bounces across a navigation this
 * is where it is most visible — the button slides down and back up.
 */
function StickyFooter({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={footer.wrap}>
      <View style={footer.inner}>
        <Cta testID={testID} label={label} onPress={onPress} />
      </View>
    </KeyboardStickyView>
  )
}

/** The one button a step is asking you to press. */
function Cta({
  label,
  onPress,
  testID,
  tone = 'primary',
}: {
  label: string
  onPress: () => void
  testID: string
  tone?: 'primary' | 'quiet'
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        footer.cta,
        tone === 'quiet' ? footer.ctaQuiet : footer.ctaPrimary,
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <Text style={[footer.ctaText, tone === 'quiet' ? footer.ctaTextQuiet : null]}>{label}</Text>
    </Pressable>
  )
}

const footer = {
  wrap: { position: 'absolute' as const, left: 0, right: 0, bottom: 0 },
  inner: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30, backgroundColor: '#F7F8FA' },
  cta: { height: 52, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const },
  ctaPrimary: { backgroundColor: '#2563EB' },
  ctaQuiet: { backgroundColor: '#EDEFF3' },
  ctaText: { fontSize: 17, fontWeight: '600' as const, color: '#FFFFFF' },
  ctaTextQuiet: { color: '#39414E' },
}

/**
 * A plain `ScrollView`, not a `FlatList`: every screen here puts the timeline
 * inside another scroll view, and a nested VirtualizedList does not just warn —
 * it measures wrong and drags its siblings' layout with it.
 */
function Timeline({ height = 170 }: { height?: number }) {
  const events = useKbLog()
  return (
    <View style={[styles.log, { height }]}>
      <ScrollView contentContainerStyle={{ padding: 8 }} keyboardShouldPersistTaps="handled">
        {events.length === 0 ? (
          <Text style={styles.logEmpty}>no events yet</Text>
        ) : (
          events.map(e => (
            <Text
              key={e.id}
              style={[
                styles.logLine,
                e.source === 'kb' ? styles.logScreen : e.source === 'field' ? styles.logMorph : styles.logRn,
              ]}
            >
              {`+${String(e.at).padStart(5, ' ')}ms ${e.source.padEnd(6, ' ')} ${e.text}`}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  )
}

/**
 * The step chrome, as an onboarding rather than a test harness: a progress
 * rail, the question as a headline, and one line under it. Which
 * implementation is running stays visible - the whole point of the flow is
 * comparing them - but as a quiet chip rather than the loudest thing on screen.
 */
function StepHeader({ step, of, impl }: { step: number; of: number; impl: Impl }) {
  return (
    <View style={header.wrap}>
      <View style={header.rail}>
        {Array.from({ length: of }, (_, i) => (
          <View
            key={i}
            style={[
              header.pip,
              i < step ? header.pipDone : null,
              i === step - 1 ? header.pipHere : null,
            ]}
          />
        ))}
      </View>
      <View style={[header.badge, impl === 'ours' ? header.badgeOurs : header.badgeRn]}>
        <Text style={header.badgeText}>{impl === 'ours' ? 'NitroInput' : 'RN TextInput'}</Text>
      </View>
    </View>
  )
}

/** The question, and the one line that explains it. */
function Hero({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={header.hero}>
      <Text style={header.title}>{title}</Text>
      {hint ? <Text style={header.hint}>{hint}</Text> : null}
    </View>
  )
}

/**
 * The timeline, out of the way. It is the reason these screens exist, but an
 * onboarding does not show you its logs - so it folds away and the flow reads
 * as the thing it is imitating.
 */
function Diagnostics({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <View style={header.diag}>
      <Pressable onPress={() => setOpen(o => !o)} style={header.diagHead} testID="flow-diagnostics">
        <Text style={header.diagLabel}>{open ? 'Hide timeline' : 'Show timeline'}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  )
}

const header = {
  wrap: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  rail: { flexDirection: 'row' as const, gap: 5, flex: 1 },
  pip: { height: 4, flex: 1, borderRadius: 2, backgroundColor: '#E2E5EA' },
  pipDone: { backgroundColor: '#B9C0CA' },
  pipHere: { backgroundColor: '#2563EB' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeOurs: { backgroundColor: '#34D399' },
  badgeRn: { backgroundColor: '#93C5FD' },
  badgeText: { fontSize: 11, fontWeight: '700' as const, color: '#0B2818' },
  hero: { gap: 6, paddingTop: 18, paddingBottom: 6 },
  title: { fontSize: 30, fontWeight: '700' as const, color: '#0B1220', letterSpacing: -0.5 },
  hint: { fontSize: 15, lineHeight: 21, color: '#6B7280' },
  diag: { marginTop: 8 },
  diagHead: { paddingVertical: 8 },
  diagLabel: { fontSize: 13, fontWeight: '600' as const, color: '#9AA1AC' },
  diagNote: { fontSize: 13, lineHeight: 19, color: '#6B7280', paddingBottom: 8 },
}

function useImpl<T extends 'FlowEmail' | 'FlowAmount' | 'FlowForm' | 'FlowSheet'>(name: T): Impl {
  const route = useRoute<RouteProp<RootStackParamList, T>>()
  return (route.params as { impl?: Impl } | undefined)?.impl ?? 'ours'
}

const page = { flex: 1, backgroundColor: '#F7F8FA' }
/** Fields, spaced. The field draws its own box, so nothing is drawn behind it. */
const group = { gap: 14 }
const scroll = { paddingHorizontal: 20, paddingTop: 8, gap: 10, paddingBottom: 150 }

/* -------------------------------------------------------- 1. email (text) */

/** Step 1: one text field that autofocuses. The baseline keyboard. */
export function FlowEmailScreen() {
  const nav = useNavigation<any>()
  const impl = useImpl('FlowEmail')
  useKeyboardLogging('1')
  useStepLogging('1 email', impl)

  const next = () => {
    logKb('screen', 'push 2 amount')
    nav.navigate('FlowAmount', { impl })
  }

  return (
    <View style={page}>
      <KeyboardAwareScrollView
        style={page}
        contentContainerStyle={scroll}
        bottomOffset={90}
        keyboardShouldPersistTaps="handled"
      >
        <StepHeader step={1} of={4} impl={impl} />
        <Hero title="What's your email?" hint="We'll use it to sign you in. The keyboard is already up." />
        <View style={group}>
          <FlowField
            impl={impl}
            testID="flow-email"
            autoFocus
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={next}
            onFocus={() => logKb('field', 'email onFocus')}
            onBlur={() => logKb('field', 'email onBlur')}
          />
        </View>

        <Diagnostics>
          <Timeline />
          <Row>
            <Btn testID="flow-clear" title="clear timeline" onPress={clearKbLog} />
          </Row>
        </Diagnostics>
      </KeyboardAwareScrollView>
      <StickyFooter testID="flow-footer-1" label="Continue" onPress={next} />
    </View>
  )
}

/* ------------------------------------------------------------- 2. amount */

/**
 * Step 2: a decimal pad that autofocuses. Arriving from step 1's email
 * keyboard, iOS has to swap the keyboard type in place — the height changes
 * but the keyboard must never dismiss and come back.
 */
export function FlowAmountScreen() {
  const nav = useNavigation<any>()
  const impl = useImpl('FlowAmount')
  const [amount, setAmount] = useState('')
  useKeyboardLogging('2')
  useStepLogging('2 amount', impl)

  const next = () => {
    logKb('screen', 'push 3 details')
    nav.navigate('FlowForm', { impl })
  }

  return (
    <View style={page}>
      <KeyboardAwareScrollView
        style={page}
        contentContainerStyle={scroll}
        bottomOffset={90}
        keyboardShouldPersistTaps="handled"
      >
        <StepHeader step={2} of={4} impl={impl} />
        <Hero
          title="How much?"
          hint={
            impl === 'ours'
              ? 'Grouped as you type, natively. The pad swaps in place — the keyboard never drops.'
              : 'A decimal pad. The pad swaps in place — the keyboard never drops.'
          }
        />
        <View style={group}>
          <FlowField
            impl={impl}
            testID="flow-amount"
            autoFocus
            numeric
            prefix="$"
            placeholder="0"
            keyboardType="decimal-pad"
            value={impl === 'rn' ? amount : undefined}
            onChangeText={impl === 'rn' ? setAmount : undefined}
            onFocus={() => logKb('field', 'amount onFocus')}
            onBlur={() => logKb('field', 'amount onBlur')}
          />
        </View>

        <Diagnostics><Timeline /></Diagnostics>
      </KeyboardAwareScrollView>
      <StickyFooter testID="flow-footer-2" label="Continue" onPress={next} />
    </View>
  )
}

/* -------------------------------------------------------------- 3. details */

interface FormRow {
  key: string
  label: string
  placeholder: string
  keyboardType: KeyboardKind
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  textContentType?: string
  secureTextEntry?: boolean
}

const FORM_ROWS: FormRow[] = [
  { key: 'name', label: 'FULL NAME', placeholder: 'Ada Lovelace', keyboardType: 'default', autoCapitalize: 'words', textContentType: 'name' },
  { key: 'email', label: 'EMAIL', placeholder: 'you@example.com', keyboardType: 'email-address', autoCapitalize: 'none', textContentType: 'emailAddress' },
  { key: 'phone', label: 'PHONE', placeholder: '+1 555 0199', keyboardType: 'phone-pad', textContentType: 'telephoneNumber' },
  { key: 'card', label: 'CARD NUMBER', placeholder: '4242 4242 4242 4242', keyboardType: 'number-pad', textContentType: 'creditCardNumber' },
  { key: 'site', label: 'WEBSITE', placeholder: 'example.com', keyboardType: 'url', autoCapitalize: 'none' },
  { key: 'pin', label: 'PIN', placeholder: '••••', keyboardType: 'number-pad', secureTextEntry: true },
]

/**
 * Step 3: six fields whose keyboards differ, chained by the return key. This
 * is where a keyboard usually misbehaves — every `next` swaps the type under a
 * keyboard that must stay up, and the focused field has to stay above it.
 */
export function FlowFormScreen() {
  const nav = useNavigation<any>()
  const impl = useImpl('FlowForm')
  const refs = useRef<Record<string, FlowFieldHandle | null>>({})
  useKeyboardLogging('3')
  useStepLogging('3 details', impl)

  const next = () => {
    logKb('screen', 'open search sheet')
    nav.navigate('FlowSheet', { impl })
  }

  const focusNext = (index: number) => {
    const following = FORM_ROWS[index + 1]
    if (following) {
      logKb('screen', `return → ${following.key}`)
      refs.current[following.key]?.focus()
    } else {
      next()
    }
  }

  return (
    <View style={page}>
      <KeyboardAwareScrollView
        style={page}
        contentContainerStyle={[scroll, { paddingBottom: 40 }]}
        bottomOffset={70}
        keyboardShouldPersistTaps="handled"
      >
        <StepHeader step={3} of={4} impl={impl} />
        <Hero
          title="Your details"
          hint="Six fields, five keyboards. Return walks down them — the pad changes type without ever dropping."
        />
        <View style={group}>
          {FORM_ROWS.map((row, i) => (
            <View key={row.key} style={{ gap: 6 }}>
              <FieldLabel>{row.label}</FieldLabel>
              <FlowField
                impl={impl}
                testID={`flow-form-${row.key}`}
                ref={r => {
                  refs.current[row.key] = r
                }}
                autoFocus={i === 0}
                placeholder={row.placeholder}
                keyboardType={row.keyboardType}
                autoCapitalize={row.autoCapitalize}
                autoCorrect={false}
                textContentType={row.textContentType}
                secureTextEntry={row.secureTextEntry}
                returnKeyType={i === FORM_ROWS.length - 1 ? 'done' : 'next'}
                submitBehavior={i === FORM_ROWS.length - 1 ? 'blurAndSubmit' : 'submit'}
                onSubmitEditing={() => focusNext(i)}
                onFocus={() => logKb('field', `${row.key} onFocus`)}
                onBlur={() => logKb('field', `${row.key} onBlur`)}
              />
            </View>
          ))}
        </View>

        <Cta testID="flow-footer-3" label="Continue" onPress={next} />

        <Diagnostics>
          <Row>
            <Btn
              testID="flow-form-focus-first"
              title="focus first"
              onPress={() => refs.current[FORM_ROWS[0]!.key]?.focus()}
            />
            <Btn
              testID="flow-form-focus-pin"
              title="jump to PIN"
              onPress={() => refs.current.pin?.focus()}
            />
          </Row>
          <Text style={header.diagNote}>
            Phone and number pads have no return key, so the chain stops there. The toolbar's arrows
            walk the fields natively — which only works because the field registered itself as a
            real text input.
          </Text>
          <Timeline />
        </Diagnostics>
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </View>
  )
}

/* ---------------------------------------------------------------- 4. sheet */

const COUNTRIES = [
  'Argentina', 'Australia', 'Austria', 'Belgium', 'Brazil', 'Canada', 'Chile', 'Croatia',
  'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary',
  'Iceland', 'India', 'Ireland', 'Italy', 'Japan', 'Kenya', 'Latvia', 'Lithuania',
  'Mexico', 'Netherlands', 'New Zealand', 'Norway', 'Poland', 'Portugal', 'Romania',
  'Singapore', 'Slovakia', 'Slovenia', 'South Africa', 'Spain', 'Sweden', 'Switzerland',
  'Turkey', 'Ukraine', 'United Kingdom', 'United States', 'Uruguay', 'Vietnam',
]

/**
 * Step 4: a `formSheet` with a search field and a list. Presented over a screen
 * whose keyboard is already up, the sheet has to take the keyboard over
 * without it dropping, keep the field above it, and let the list scroll and
 * dismiss under the finger.
 */
export function FlowSheetScreen() {
  const nav = useNavigation<any>()
  const impl = useImpl('FlowSheet')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  useKeyboardLogging('4')
  useStepLogging('4 sheet', impl)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? COUNTRIES.filter(c => c.toLowerCase().includes(q)) : COUNTRIES
  }, [query])

  // A form sheet only lays out children that have an intrinsic height, as
  // direct children of the screen root — a wrapper `View` or a `flex: 1` child
  // collapses to zero and the siblings pile up on top of each other. So: no
  // wrappers, and the list gets a fixed height.
  const { height: windowHeight } = useWindowDimensions()

  return (
    <View style={[page, { padding: 16, gap: 10 }]}>
      <StepHeader step={4} of={4} impl={impl} />
      <Hero title="Where are you?" hint="The sheet takes the keyboard over without it dropping." />
      <FlowField
        impl={impl}
        testID="flow-sheet-search"
        autoFocus
        placeholder="Search countries"
        keyboardType="default"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        value={query}
        onChangeText={setQuery}
        onFocus={() => logKb('field', 'search onFocus')}
        onBlur={() => logKb('field', 'search onBlur')}
      />
      {/* `overflow: 'hidden'` is load-bearing: inside a form sheet a scroll view
          whose box does not clip escapes its frame entirely and covers the whole
          sheet, drawing over everything above it. The height is fixed for the
          same reason — `flex: 1` collapses there. 44 rows need no virtualising. */}
      <View style={{ height: windowHeight * 0.22, overflow: 'hidden' }}>
        <ScrollView
          testID="flow-sheet-list"
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {results.length === 0 ? (
            <Text style={styles.cardHint}>{`No match for "${query}".`}</Text>
          ) : (
            results.map(item => (
              <Pressable
                key={item}
                testID={`flow-sheet-item-${item}`}
                onPress={() => {
                  setPicked(item)
                  logKb('screen', `picked ${item}`)
                }}
                style={({ pressed }) => [row.item, pressed && { opacity: 0.6 }]}
              >
                <Text style={row.label}>{item}</Text>
                {picked === item ? <Text style={row.tick}>✓</Text> : null}
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
      <Cta
        testID="flow-sheet-close"
        tone={picked ? 'primary' : 'quiet'}
        label={picked ? `Done · ${picked}` : 'Done'}
        onPress={() => nav.goBack()}
      />
      <Pressable
        testID="flow-sheet-restart"
        onPress={() => {
          clearKbLog()
          nav.navigate('Home')
        }}
        style={header.diagHead}
      >
        <Text style={[header.diagLabel, { textAlign: 'center' }]}>Start over</Text>
      </Pressable>
    </View>
  )
}

const row = {
  item: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  label: { fontSize: 15, color: '#111' },
  tick: { fontSize: 15, color: '#2563EB', fontWeight: '700' as const },
}
