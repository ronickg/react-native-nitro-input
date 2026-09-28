import React, { useEffect, useRef, useState } from 'react'
import { FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import {
  KeyboardAwareScrollView,
  KeyboardController,
  KeyboardStickyView,
  useKeyboardHandler,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller'
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle } from 'react-native-reanimated'
import { FlowField, type FlowFieldHandle, type Impl } from './KeyboardFlow'
import { StatusLine, useLabStatus } from './InputLab'
import type { RootStackParamList } from '../navigation'

/**
 * The input lab's motion screens: what moves with the keyboard. A sticky
 * "Continue" button (keyboard-controller's KeyboardStickyView) and a form that
 * scrolls the focused field above it (KeyboardAwareScrollView), across fields
 * with different keyboards, a push to a screen that focuses its own field, a
 * form sheet, and a list of fields that scroll out of existence.
 *
 * The button is one flat colour on a white page so a recording can be read
 * frame by frame: where the button is, and whether it jumps or lags the
 * keyboard.
 */

const CTA_BLUE = '#1452F0'
const HANDOFF_MS = 400

type Field = {
  key: string
  placeholder: string
  keyboardType?: 'default' | 'email-address' | 'number-pad' | 'phone-pad' | 'decimal-pad'
  secureTextEntry?: boolean
  multiline?: boolean
  autoCapitalize?: 'none' | 'sentences' | 'words'
  /** A React Native TextInput in the middle of a NitroInput form: switching between the two. */
  mixed?: boolean
}

const MOTION_FIELDS: Field[] = [
  { key: 'first', placeholder: 'First name', autoCapitalize: 'words' },
  { key: 'email', placeholder: 'Email', keyboardType: 'email-address', autoCapitalize: 'none' },
  { key: 'amount', placeholder: 'Amount', keyboardType: 'decimal-pad' },
  { key: 'password', placeholder: 'Password', secureTextEntry: true, autoCapitalize: 'none' },
  { key: 'referral', placeholder: 'Referral code (TextInput)', autoCapitalize: 'none', mixed: true },
  { key: 'phone', placeholder: 'Phone', keyboardType: 'phone-pad' },
  { key: 'city', placeholder: 'City', autoCapitalize: 'words' },
  { key: 'notes', placeholder: 'Notes (multiline)', multiline: true },
]

/**
 * The button that rides the keyboard, built as Uno's screens build their
 * footer (components/ui/screen/base-screen.tsx): the sticky view is the last
 * child of the screen column, not absolutely positioned; closed, it is lifted
 * over the home indicator / Android's navigation bar; opened, it sits on the
 * keyboard. The screen column keeps 16 below it.
 */
function StickyCta({
  label,
  onPress,
  onHeight,
}: {
  label: string
  onPress: () => void
  onHeight?: (h: number) => void
}) {
  const insets = useSafeAreaInsets()
  const offset = { closed: Platform.OS === 'ios' ? -24 : -insets.bottom, opened: 0 }
  return (
    <KeyboardStickyView offset={offset}>
      <View style={motion.footer} onLayout={e => onHeight?.(e.nativeEvent.layout.height)}>
        {/* Uno's footer has a backdrop that bleeds 16 below it (its gradient); a flat one here. */}
        <View pointerEvents="none" style={motion.backdrop} />
        <Pressable testID="lab-cta" accessibilityRole="button" onPress={onPress} style={motion.cta}>
          <Text style={motion.ctaText}>{label}</Text>
        </Pressable>
      </View>
    </KeyboardStickyView>
  )
}

const CTA_HEIGHT = 52
const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

/**
 * One button that is the full-width "Continue" while the keyboard is down and
 * a round "Done" check riding the keyboard while it is up - Uno's send-money
 * screen swaps two separate controls at the start of the keyboard animation;
 * this one changes shape with it. Width, label and check are all read from
 * keyboard-controller's per-frame keyboard progress on the UI thread (0 closed,
 * 1 open), so the shape is exactly where the keyboard is on every frame: a
 * keyboard that is dragged down interactively, or turns around half way,
 * takes the button with it.
 */
function MorphingCta({
  label,
  onPress,
  onHeight,
}: {
  label: string
  onPress: () => void
  onHeight?: (h: number) => void
}) {
  const insets = useSafeAreaInsets()
  const offset = { closed: Platform.OS === 'ios' ? -24 : -insets.bottom, opened: 0 }
  const { progress } = useReanimatedKeyboardAnimation()
  const [fullWidth, setFullWidth] = useState(0)
  const [open, setOpen] = useState(false)

  const shape = useAnimatedStyle(() => ({
    width: fullWidth > 0 ? interpolate(progress.value, [0, 1], [fullWidth, CTA_HEIGHT], Extrapolation.CLAMP) : '100%',
  }))
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.45], [1, 0], Extrapolation.CLAMP),
  }))
  // A full-width backdrop behind a circle would hide the form around it: it
  // fades out as the button becomes a circle (Uno's gradient fades with the
  // same progress).
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0], Extrapolation.CLAMP),
  }))
  const checkStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.55, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0.55, 1], [0.6, 1], Extrapolation.CLAMP) }],
  }))

  return (
    <KeyboardStickyView offset={offset}>
      <View
        style={motion.footer}
        onLayout={e => {
          onHeight?.(e.nativeEvent.layout.height)
          setFullWidth(e.nativeEvent.layout.width - 32)
        }}
      >
        <Animated.View pointerEvents="none" style={[motion.backdrop, backdropStyle]} />
        <View style={motion.morphTrack}>
          <AnimatedPressable
            testID="lab-cta"
            accessibilityRole="button"
            accessibilityLabel={open ? 'Done' : label}
            style={[motion.cta, motion.morph, shape]}
            onPressIn={() => setOpen(KeyboardController.isVisible())}
            onPress={() => (KeyboardController.isVisible() ? KeyboardController.dismiss() : onPress())}
          >
            <Animated.Text numberOfLines={1} style={[motion.ctaText, motion.morphLabel, labelStyle]}>
              {label}
            </Animated.Text>
            <Animated.Text style={[motion.ctaText, motion.morphCheck, checkStyle]}>✓</Animated.Text>
          </AnimatedPressable>
        </View>
      </View>
    </KeyboardStickyView>
  )
}

/**
 * A scripted run for a device nothing can tap on (a cabled iPhone): focus,
 * close with KeyboardController.dismiss(), again, while every keyboard event
 * keyboard-controller delivers is recorded. Read back through the debugger:
 * `globalThis.__labLog`. A keyboard animation it follows frame by frame has
 * a dozen or more `move` events; one that jumps has one or two.
 */
type LabEvent = { t: number; type: string; height?: number; progress?: number; note?: string }
const labLog: LabEvent[] = []
;(globalThis as any).__labLog = labLog
const logLab = (type: string, height?: number, progress?: number, note?: string) =>
  labLog.push({ t: Date.now(), type, height, progress, note })

function useKeyboardRecorder() {
  useKeyboardHandler(
    {
      onStart: e => {
        'worklet'
        runOnJS(logLab)('start', e.height, e.progress)
      },
      onMove: e => {
        'worklet'
        runOnJS(logLab)('move', e.height, e.progress)
      },
      onEnd: e => {
        'worklet'
        runOnJS(logLab)('end', e.height, e.progress)
      },
    },
    [],
  )
}

function useAutorun(enabled: boolean, fields: React.MutableRefObject<Array<{ focus(): void } | null>>) {
  useKeyboardRecorder()
  useEffect(() => {
    if (!enabled) return
    labLog.length = 0
    const steps: Array<[number, () => void]> = [
      [800, () => (logLab('step', undefined, undefined, 'focus first'), fields.current[0]?.focus())],
      [1800, () => (logLab('step', undefined, undefined, 'dismiss'), KeyboardController.dismiss())],
      [1800, () => (logLab('step', undefined, undefined, 'focus first again'), fields.current[0]?.focus())],
      [1800, () => (logLab('step', undefined, undefined, 'next: email'), fields.current[1]?.focus())],
      [1800, () => (logLab('step', undefined, undefined, 'dismiss'), KeyboardController.dismiss())],
      [1800, () => logLab('step', undefined, undefined, 'done')],
    ]
    let at = 0
    const timers = steps.map(([wait, run]) => setTimeout(run, (at += wait)))
    return () => timers.forEach(clearTimeout)
  }, [enabled, fields])
}

export function LabMotionScreen() {
  const { impl, cta = 'sticky', autorun = false } = useRoute<RouteProp<RootStackParamList, 'LabMotion'>>().params
  const nav = useNavigation<any>()
  const { focused, keyboard, track } = useLabStatus()
  const refs = useRef<Array<FlowFieldHandle | { focus(): void; blur(): void } | null>>([])
  const [footerHeight, setFooterHeight] = useState(0)
  useAutorun(autorun, refs)

  return (
    <View style={motion.screen}>
      <StatusLine impl={impl} focused={focused} keyboard={keyboard} />
      <View style={[motion.actions, motion.actionBar]}>
        <Pressable testID="lab-push-step" style={motion.action} onPress={() => nav.navigate('LabStep', { impl })}>
          <Text style={motion.actionText}>Next step ›</Text>
        </Pressable>
        <Pressable testID="lab-open-sheet" style={motion.action} onPress={() => nav.navigate('LabSheet', { impl })}>
          <Text style={motion.actionText}>Sheet ›</Text>
        </Pressable>
        <Pressable testID="lab-open-rows" style={motion.action} onPress={() => nav.navigate('LabRows', { impl })}>
          <Text style={motion.actionText}>Rows ›</Text>
        </Pressable>
      </View>
      <KeyboardAwareScrollView
        testID="lab-motion"
        contentContainerStyle={motion.form}
        style={motion.body}
        // As Uno's ScrollContent: the focused field clears the footer, not just the keyboard.
        bottomOffset={footerHeight + 16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {MOTION_FIELDS.map((field, i) => {
          const last = i === MOTION_FIELDS.length - 1
          const next = () => refs.current[i + 1]?.focus()
          if (field.mixed) {
            return (
              <TextInput
                key={field.key}
                ref={r => {
                  refs.current[i] = r
                }}
                testID={`lab-${field.key}`}
                style={[motion.field, motion.rnField]}
                placeholder={field.placeholder}
                autoCapitalize={field.autoCapitalize}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={next}
                {...track(field.key)}
              />
            )
          }
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
              secureTextEntry={field.secureTextEntry}
              multiline={field.multiline}
              autoCapitalize={field.autoCapitalize}
              returnKeyType={last ? 'done' : 'next'}
              submitBehavior={last ? 'blurAndSubmit' : 'submit'}
              onSubmitEditing={last ? undefined : next}
              keyboardHandoffMs={HANDOFF_MS}
              {...track(field.key)}
            />
          )
        })}
        {Array.from({ length: 4 }, (_, i) => (
          <Text key={i} style={motion.filler}>{`Terms paragraph ${i + 1}. Scroll room below the last field.`}</Text>
        ))}
      </KeyboardAwareScrollView>
      {cta === 'morph' ? (
        <MorphingCta label="Continue" onHeight={setFooterHeight} onPress={() => nav.navigate('LabStep', { impl })} />
      ) : (
        <StickyCta label="Continue" onHeight={setFooterHeight} onPress={() => nav.navigate('LabStep', { impl })} />
      )}
    </View>
  )
}

/** A pushed step that focuses its own field, as a multi-step form does. */
export function LabStepScreen() {
  const { impl } = useRoute<RouteProp<RootStackParamList, 'LabStep'>>().params
  const nav = useNavigation<any>()
  const { focused, keyboard, track } = useLabStatus()
  return (
    <View style={motion.screen}>
      <StatusLine impl={impl} focused={focused} keyboard={keyboard} />
      <View style={[motion.form, motion.body]}>
        <Text style={motion.title}>Verification code</Text>
        <FlowField
          impl={impl}
          testID="lab-step-code"
          placeholder="6-digit code"
          keyboardType="number-pad"
          returnKeyType="done"
          // The screen's own Verify button rides the keyboard; no second one.
          returnKeyBar={false}
          autoFocus
          keyboardHandoffMs={HANDOFF_MS}
          {...track('code')}
        />
      </View>
      <StickyCta label="Verify" onPress={() => nav.goBack()} />
    </View>
  )
}

/** A form sheet with its own field, opened over a screen whose field has the keyboard. */
export function LabSheetScreen() {
  const { impl } = useRoute<RouteProp<RootStackParamList, 'LabSheet'>>().params
  const nav = useNavigation<any>()
  const { focused, keyboard, track } = useLabStatus()
  // A form sheet lays out only children with a height of their own, as direct
  // children: no flex wrappers here.
  return (
    <View style={[motion.sheet]}>
      <StatusLine impl={impl} focused={focused} keyboard={keyboard} />
      <Text style={motion.title}>Add a note</Text>
      <FlowField
        impl={impl}
        testID="lab-sheet-note"
        placeholder="Note"
        autoFocus
        returnKeyType="done"
        keyboardHandoffMs={HANDOFF_MS}
        {...track('note')}
      />
      <Pressable testID="lab-sheet-done" style={motion.cta} onPress={() => nav.goBack()}>
        <Text style={motion.ctaText}>Done</Text>
      </Pressable>
    </View>
  )
}

const ROWS = Array.from({ length: 60 }, (_, i) => `Item ${i + 1}`)

/** A list of fields: quantity per row, chained with Next, rows scrolled out of existence. */
export function LabRowsScreen() {
  const { impl } = useRoute<RouteProp<RootStackParamList, 'LabRows'>>().params
  const { focused, keyboard, track } = useLabStatus()
  const refs = useRef(new Map<number, FlowFieldHandle | null>())
  const list = useRef<FlatList<string>>(null)
  const [pendingFocus, setPendingFocus] = useState<number | null>(null)

  // What a native list does on Next: bring the next row into view, then focus
  // it. A rendered row may still be off screen and detached (Android's
  // removeClippedSubviews); a row further down may not be rendered at all and
  // is focused as it mounts.
  const focusRow = (index: number) => {
    list.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true })
    const field = refs.current.get(index)
    if (field) field.focus()
    else setPendingFocus(index)
  }

  return (
    <View style={motion.screen}>
      <StatusLine impl={impl} focused={focused} keyboard={keyboard} />
      <FlatList
        ref={list}
        style={motion.body}
        testID="lab-rows"
        data={ROWS}
        keyExtractor={item => item}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        windowSize={3}
        initialNumToRender={12}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item, index }) => (
          <View style={motion.row}>
            <Text style={motion.rowLabel}>{item}</Text>
            <View style={motion.rowField}>
              <FlowField
                ref={r => {
                  refs.current.set(index, r)
                  if (r && pendingFocus === index) {
                    setPendingFocus(null)
                    r.focus()
                  }
                }}
                impl={impl}
                testID={`lab-row-${index + 1}`}
                placeholder="0"
                keyboardType="number-pad"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => focusRow(index + 1)}
                keyboardHandoffMs={HANDOFF_MS}
                {...track(`row ${index + 1}`)}
              />
            </View>
          </View>
        )}
      />
      <StickyCta label="Save" onPress={() => {}} />
    </View>
  )
}

const ROW_HEIGHT = 72

/**
 * A backend-driven questionnaire in one screen, as Uno's DynamicForm renders
 * it (containers/features/questionnaire/dynamic-form): the backend sends a
 * list of questions, the screen shows one at a time keyed by its id, and Next
 * swaps it in place - no navigation. Text questions have a keyboard, a select
 * is tap-only (and dismisses the keyboard, as DynamicForm does), and the Next
 * button rides the keyboard in a sticky footer. Each field has
 * `keyboardHandoffMs`, as Uno's Input sets on every field.
 *
 * `autoFocus` decides whether a new text question takes the keyboard as it
 * appears. Uno's questionnaire fields do not autofocus.
 */
type StepQuestion =
  | { id: string; type: 'text'; title: string; placeholder: string; keyboardType?: 'default' | 'email-address' | 'number-pad'; multiline?: boolean }
  | { id: string; type: 'select'; title: string; options: string[] }

const STEP_QUESTIONS: StepQuestion[] = [
  { id: 'name', type: 'text', title: 'What is your full name?', placeholder: 'Full name' },
  { id: 'email', type: 'text', title: 'Your email address', placeholder: 'Email', keyboardType: 'email-address' },
  { id: 'job', type: 'select', title: 'What do you do?', options: ['Employed', 'Self-employed', 'Student', 'Other'] },
  { id: 'income', type: 'text', title: 'Monthly income', placeholder: '0', keyboardType: 'number-pad' },
  { id: 'notes', type: 'text', title: 'Anything else?', placeholder: 'Tell us more', multiline: true },
]

export function LabStepsScreen() {
  const { impl, autoFocus = false, autorun = false } = useRoute<RouteProp<RootStackParamList, 'LabSteps'>>().params
  const { focused, keyboard, track } = useLabStatus()
  const [index, setIndex] = useState(0)
  const field = useRef<FlowFieldHandle | null>(null)
  const question = STEP_QUESTIONS[index]!
  const hasKeyboard = question.type === 'text'
  const last = index === STEP_QUESTIONS.length - 1
  useKeyboardRecorder()

  const next = () => setIndex(i => Math.min(i + 1, STEP_QUESTIONS.length - 1))
  const back = () => setIndex(i => Math.max(i - 1, 0))

  // As DynamicForm: a tap-only question closes the keyboard.
  useEffect(() => {
    logLab('step', undefined, undefined, `question ${question.id}`)
    if (!hasKeyboard) Keyboard.dismiss()
  }, [question.id, hasKeyboard])

  // A scripted run for a device nothing can tap on: `__lab.steps(autoFocus)`.
  useEffect(() => {
    if (!autorun) return
    labLog.length = 0
    const script: Array<[number, string, () => void]> = [
      [800, 'focus name', () => field.current?.focus()],
      [1600, 'Next -> email', next],
      [1600, 'Next -> job (tap-only)', next],
      [1600, 'Next -> income', next],
      [1600, 'Next -> notes', next],
      [1600, 'Back -> income', back],
      [1600, 'Back -> job', back],
      [1600, 'Back -> email', back],
      [1600, 'done', () => {}],
    ]
    let at = 0
    const timers = script.map(([wait, note, run]) =>
      setTimeout(() => {
        logLab('step', undefined, undefined, note)
        run()
      }, (at += wait)),
    )
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun])

  return (
    <View style={motion.screen}>
      <StatusLine impl={impl} focused={focused} keyboard={keyboard} />
      <View style={[motion.actions, motion.actionBar]}>
        <Pressable testID="lab-steps-back" style={motion.action} onPress={back}>
          <Text style={motion.actionText}>‹ Back</Text>
        </Pressable>
        <Text testID="lab-steps-progress" style={motion.stepProgress}>{`${index + 1} / ${STEP_QUESTIONS.length} · autoFocus ${autoFocus ? 'on' : 'off'}`}</Text>
      </View>
      <View style={[motion.form, motion.body]}>
        <Text style={motion.title}>{question.title}</Text>
        {question.type === 'text' ? (
          <FlowField
            key={question.id}
            ref={field}
            impl={impl}
            testID={`lab-step-${question.id}`}
            placeholder={question.placeholder}
            keyboardType={question.keyboardType}
            multiline={question.multiline}
            autoFocus={autoFocus}
            returnKeyType={last ? 'done' : 'next'}
            returnKeyBar={false}
            submitBehavior={question.multiline ? undefined : 'submit'}
            onSubmitEditing={next}
            keyboardHandoffMs={HANDOFF_MS}
            {...track(question.id)}
          />
        ) : (
          <View key={question.id} style={{ gap: 8 }}>
            {question.options.map(option => (
              <Pressable key={option} testID={`lab-option-${option}`} style={[motion.row, motion.option]} onPress={next}>
                <Text style={motion.rowLabel}>{option}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <StickyCta label={last ? 'Submit' : 'Next'} onPress={next} />
    </View>
  )
}

const motion = StyleSheet.create({
  // As Uno's base screen with a footer: a column that keeps 16 below the footer.
  screen: { flex: 1, backgroundColor: '#FFFFFF', paddingBottom: 16 },
  body: { flex: 1 },
  sheet: { backgroundColor: '#FFFFFF', padding: 16, gap: 12 },
  form: { padding: 16, gap: 12, paddingBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionBar: { paddingHorizontal: 16, paddingTop: 12 },
  action: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#EEF2F7' },
  actionText: { fontSize: 15, color: '#111827', fontWeight: '600' },
  field: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 52,
    backgroundColor: '#FFFFFF',
  },
  rnField: { fontSize: 20, color: '#111' },
  filler: { fontSize: 15, color: '#6B7280', lineHeight: 22 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: -16, backgroundColor: '#FFFFFF' },
  cta: { height: 52, borderRadius: 12, backgroundColor: CTA_BLUE, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  morphTrack: { flexDirection: 'row', justifyContent: 'flex-end' },
  morph: { height: CTA_HEIGHT, borderRadius: CTA_HEIGHT / 2, overflow: 'hidden' },
  morphLabel: { position: 'absolute', alignSelf: 'center' },
  morphCheck: { position: 'absolute', fontSize: 24, alignSelf: 'center' },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  rowLabel: { flex: 1, fontSize: 17, color: '#111827' },
  rowField: { width: 110 },
  option: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12, height: 56 },
  stepProgress: { alignSelf: 'center', color: '#6B7280', fontSize: 14, marginLeft: 8 },
})
