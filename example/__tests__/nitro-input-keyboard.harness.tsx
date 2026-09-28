/**
 * On-device checks of how `NitroInput` hands the system keyboard around: from
 * one field to the next, across a native-stack push and pop, and away when
 * nothing takes it. Each test records every keyboard event, so a dip - the
 * keyboard dropping and rising again between two fields - shows up as a
 * `keyboardWillHide` where there should be none, not something to eyeball.
 * The events come from React Native's own `Keyboard` module: keyboard-controller
 * pulls Reanimated worklets in when it is imported, which Harness's test
 * bundles cannot load under Worklets Bundle Mode. Android sends only the `Did`
 * events, so a hide is either kind.
 *
 * They need a software keyboard: run them on a phone
 * (`test:harness:ios-device` / `:android-device`). A simulator with the Mac's
 * keyboard connected never shows one; there every test returns early once the
 * first one has found no keyboard.
 */
import React, { Activity, createRef, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { FlatList, Keyboard, Platform, ScrollView, Text, View } from 'react-native'
import { describe, expect, it } from 'react-native-harness'
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { NitroInput, type NitroInputHandle } from 'react-native-nitro-input'
import { render, sleep, waitFor } from './test-utils'

type KeyboardEvent = { type: string; at: number; height: number }

/** Every keyboard event from now on. */
function keyboardRecorder() {
  const events: KeyboardEvent[] = []
  const subscriptions = (['keyboardWillShow', 'keyboardDidShow', 'keyboardWillHide', 'keyboardDidHide'] as const).map(
    (type) =>
      Keyboard.addListener(type, (e) =>
        events.push({
          type,
          at: Date.now(),
          height: type.endsWith('Hide') ? 0 : e.endCoordinates.height,
        })
      )
  )
  return {
    events,
    hidesSince: (at: number) =>
      events.filter((e) => e.at >= at && (e.type === 'keyboardWillHide' || e.type === 'keyboardDidHide')),
    /** The lowest height any keyboard event reported since `at` (a hide reports 0). */
    lowestSince: (at: number) =>
      Math.min(...events.filter((e) => e.at >= at).map((e) => e.height), Number.POSITIVE_INFINITY),
    stop: () => subscriptions.forEach((s) => s.remove()),
  }
}

let noKeyboard = false

/** Focuses `field` and waits for the keyboard; false when none shows (a simulator with the Mac's keyboard). */
async function openKeyboard(field: NitroInputHandle | null): Promise<boolean> {
  if (noKeyboard) return false
  field?.focus()
  try {
    await waitFor(() => expect(Keyboard.isVisible()).toBe(true), 4000)
  } catch {
    noKeyboard = true
    console.warn('[keyboard suite] no software keyboard showed; skipping the keyboard tests on this device')
    return false
  }
  // Let the show animation finish so the frames that follow are the test's.
  await sleep(700)
  return true
}

async function closeKeyboard() {
  Keyboard.dismiss()
  await waitFor(() => expect(Keyboard.isVisible()).toBe(false), 4000).catch(() => {})
  await sleep(300)
}

describe('NitroInput keyboard handoff', () => {
  it('keeps the keyboard up when focus moves to another field', async () => {
    const first = createRef<NitroInputHandle>()
    const second = createRef<NitroInputHandle>()
    const log = keyboardRecorder()
    await render(
      <View style={{ gap: 12, padding: 20 }}>
        <NitroInput ref={first} defaultValue="first" />
        <NitroInput ref={second} defaultValue="second" />
      </View>
    )
    try {
      if (!(await openKeyboard(first.current))) return
      const open = Keyboard.metrics()?.height ?? 0
      const from = Date.now()
      // What a "next" button does after onSubmitEditing with submitBehavior="submit".
      second.current!.focus()
      await sleep(900)
      expect(log.hidesSince(from)).toEqual([])
      expect(log.lowestSince(from)).toBeGreaterThanOrEqual(open - 1)
    } finally {
      log.stop()
      await closeKeyboard()
    }
  })

  it('keeps the keyboard up when a focused field unmounts as the next one autofocuses', async () => {
    const first = createRef<NitroInputHandle>()
    const log = keyboardRecorder()
    let swap = () => {}
    function Swapper() {
      const [step, setStep] = useState(0)
      swap = () => setStep(1)
      return step === 0 ? (
        <NitroInput key="a" ref={first} defaultValue="step one" keyboardHandoffMs={400} />
      ) : (
        <NitroInput key="b" autoFocus defaultValue="step two" />
      )
    }
    await render(
      <View style={{ padding: 20 }}>
        <Swapper />
      </View>
    )
    try {
      if (!(await openKeyboard(first.current))) return
      const open = Keyboard.metrics()?.height ?? 0
      const from = Date.now()
      swap()
      await sleep(900)
      expect(log.hidesSince(from)).toEqual([])
      expect(log.lowestSince(from)).toBeGreaterThanOrEqual(open - 1)
    } finally {
      log.stop()
      await closeKeyboard()
    }
  })

  // The case `keyboardHandoffMs` exists for: popping a screen whose field has
  // the keyboard, back to a screen that refocuses its own field once it is
  // focused again - as an app's "refocus on return" hook does.
  // Android keeps the IME up either way once the returning field's focus()
  // waits for its view to be back on the window; iOS drops it without the
  // handoff, the control that shows the test measures something.
  for (const handoffMs of [400, 0]) {
    const keeps = handoffMs > 0 || Platform.OS === 'android'
    it(`${keeps ? 'keeps' : 'drops'} the keyboard across a stack pop (keyboardHandoffMs=${handoffMs})`, async () => {
      const Stack = createNativeStackNavigator()
      const navigation = createNavigationContainerRef<Record<string, undefined>>()
      const home = createRef<NitroInputHandle>()
      const log = keyboardRecorder()

      function Home({ navigation: nav }: { navigation: { addListener: (e: 'focus', cb: () => void) => () => void } }) {
        useEffect(
          () =>
            nav.addListener('focus', () => {
              if (Keyboard.isVisible()) home.current?.focus()
            }),
          [nav]
        )
        return <NitroInput ref={home} defaultValue="home" keyboardHandoffMs={handoffMs} style={{ margin: 20 }} />
      }
      function Next() {
        return <NitroInput autoFocus defaultValue="next" keyboardHandoffMs={handoffMs} style={{ margin: 20 }} />
      }

      await render(
        <View style={{ flex: 1, height: 500 }}>
          <NavigationContainer ref={navigation}>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="home" component={Home} />
              <Stack.Screen name="next" component={Next} />
            </Stack.Navigator>
          </NavigationContainer>
        </View>
      )
      try {
        await waitFor(() => expect(home.current).not.toBeNull())
        if (!(await openKeyboard(home.current))) return
        navigation.navigate('next')
        await sleep(1200)
        const open = Keyboard.metrics()?.height ?? 0
        const from = Date.now()
        navigation.goBack()
        await sleep(1500)
        if (keeps) {
          expect(log.hidesSince(from)).toEqual([])
          expect(log.lowestSince(from)).toBeGreaterThanOrEqual(open - 1)
          expect(Keyboard.isVisible()).toBe(true)
        } else {
          // Closed by the time the screen is focused again, it stays down.
          expect(log.lowestSince(from)).toBeLessThan(open / 2)
        }
      } finally {
        log.stop()
        await closeKeyboard()
      }
    })
  }

  // What the platform apps do when you come back to a screen whose field had the
  // keyboard: iOS (UIKit) gives the field its focus and the keyboard back, with
  // the pop; Android leaves the keyboard down. Native-stack gets both for free as
  // long as `keyboardHandlingEnabled` (react-native-screens' hideKeyboardOnSwipe)
  // stays off: on, it resigns the field as the screen starts to leave, and UIKit
  // has nothing to give back.
  it(`${Platform.OS === 'ios' ? 'gives the keyboard back to' : 'leaves the keyboard down for'} the field that had it when its screen is popped back to`, async () => {
    const Stack = createNativeStackNavigator()
    const navigation = createNavigationContainerRef<Record<string, undefined>>()
    const home = createRef<NitroInputHandle>()
    function Home() {
      return <NitroInput ref={home} defaultValue="home" style={{ margin: 20 }} />
    }
    function Detail() {
      return <View style={{ flex: 1 }} />
    }
    await render(
      <View style={{ flex: 1, height: 500 }}>
        <NavigationContainer ref={navigation}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="home" component={Home} />
            <Stack.Screen name="detail" component={Detail} />
          </Stack.Navigator>
        </NavigationContainer>
      </View>
    )
    try {
      await waitFor(() => expect(home.current).not.toBeNull())
      if (!(await openKeyboard(home.current))) return
      navigation.navigate('detail')
      await sleep(1200)
      navigation.goBack()
      await sleep(1500)
      if (Platform.OS === 'ios') {
        expect(home.current!.isFocused()).toBe(true)
        expect(Keyboard.isVisible()).toBe(true)
      } else {
        expect(Keyboard.isVisible()).toBe(false)
      }
    } finally {
      await closeKeyboard()
    }
  })

  // A backend-driven questionnaire in one screen (Uno's DynamicForm): one
  // question at a time keyed by its id, Next swaps it in place, a tap-only
  // question dismisses the keyboard. With autoFocus on the text questions the
  // keyboard stays up from one text question to the next and only a tap-only
  // question closes it.
  it('keeps the keyboard across a one-screen questionnaire, closing it only for a tap-only question', async () => {
    type Q = { id: string; keyboard: boolean; keyboardType?: 'default' | 'number-pad' }
    const questions: Q[] = [
      { id: 'name', keyboard: true },
      { id: 'email', keyboard: true },
      { id: 'job', keyboard: false },
      { id: 'income', keyboard: true, keyboardType: 'number-pad' },
    ]
    const field = createRef<NitroInputHandle>()
    let go = (_index: number) => {}
    function Questionnaire() {
      const [index, setIndex] = useState(0)
      go = setIndex
      const q = questions[index]!
      useEffect(() => {
        if (!q.keyboard) Keyboard.dismiss()
      }, [q])
      return (
        <View style={{ padding: 20 }}>
          {q.keyboard ? (
            <NitroInput key={q.id} ref={field} autoFocus keyboardType={q.keyboardType} keyboardHandoffMs={400} defaultValue={q.id} />
          ) : (
            <View key={q.id} style={{ height: 48 }} />
          )}
        </View>
      )
    }
    const log = keyboardRecorder()
    await render(<Questionnaire />)
    try {
      if (!(await openKeyboard(field.current))) return
      // name -> email: text to text, the keyboard stays.
      let from = Date.now()
      go(1)
      await sleep(900)
      expect(log.hidesSince(from)).toEqual([])
      expect(field.current!.isFocused()).toBe(true)
      // email -> job: tap-only, the keyboard goes - at once, not when the
      // leaving field's hold runs out (no field is left to release it).
      from = Date.now()
      go(2)
      await waitFor(() => expect(log.hidesSince(from).length).toBeGreaterThan(0), 3000)
      expect(log.hidesSince(from)[0]!.at - from).toBeLessThan(300)
      await waitFor(() => expect(Keyboard.isVisible()).toBe(false), 3000)
      // job -> income: the number pad comes up for the new field on its own.
      go(3)
      await waitFor(() => expect(Keyboard.isVisible()).toBe(true), 3000)
      await waitFor(() => expect(field.current!.isFocused()).toBe(true))
      await sleep(700)
      // income -> back to email: text to text again, no hide.
      from = Date.now()
      go(1)
      await sleep(900)
      expect(log.hidesSince(from)).toEqual([])
      expect(field.current!.isFocused()).toBe(true)
    } finally {
      log.stop()
      await closeKeyboard()
    }
  })

  it('keeps focus and the keyboard while a search list filters under the field', async () => {
    // A search screen: every keystroke re-renders the list below the field.
    const field = createRef<NitroInputHandle>()
    const names = Array.from({ length: 80 }, (_, i) => `Person ${i} ${i % 3 === 0 ? 'Anna' : 'Bert'}`)
    function Search() {
      const [query, setQuery] = useState('')
      const rows = useMemo(() => names.filter((n) => n.toLowerCase().includes(query.toLowerCase())), [query])
      return (
        <View style={{ height: 500 }}>
          <NitroInput ref={field} value={query} onChangeText={setQuery} placeholder="Search" />
          <FlatList
            data={rows}
            keyExtractor={(n) => n}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <Text style={{ padding: 12 }}>{item}</Text>}
          />
        </View>
      )
    }
    const log = keyboardRecorder()
    await render(<Search />)
    try {
      if (!(await openKeyboard(field.current))) return
      const from = Date.now()
      for (const query of ['a', 'an', 'ann', 'anna', 'ann', 'an', '']) {
        field.current!.setText(query)
        await sleep(150)
      }
      await sleep(400)
      expect(field.current!.isFocused()).toBe(true)
      expect(log.hidesSince(from)).toEqual([])
    } finally {
      log.stop()
      await closeKeyboard()
    }
  })

  it('keeps focus and the keyboard when the scroll view moves the field out of sight', async () => {
    // Only a drag dismisses (keyboardDismissMode), and only when asked for: a
    // programmatic scroll - a list jumping, a form scrolling to an error - never does.
    const field = createRef<NitroInputHandle>()
    const scroll = createRef<React.ComponentRef<typeof ScrollView>>()
    const log = keyboardRecorder()
    await render(
      <ScrollView ref={scroll} style={{ height: 400 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
        <NitroInput ref={field} defaultValue="top" />
        <View style={{ height: 2000 }} />
      </ScrollView>
    )
    try {
      if (!(await openKeyboard(field.current))) return
      const from = Date.now()
      scroll.current!.scrollToEnd({ animated: true })
      await sleep(700)
      scroll.current!.scrollTo({ y: 0, animated: true })
      await sleep(700)
      expect(field.current!.isFocused()).toBe(true)
      expect(log.hidesSince(from)).toEqual([])
    } finally {
      log.stop()
      await closeKeyboard()
    }
  })

  it('lets Keyboard.dismiss() end a hold at once', async () => {
    const field = createRef<NitroInputHandle>()
    const log = keyboardRecorder()
    let unmount = () => {}
    function Host() {
      const [shown, setShown] = useState(true)
      unmount = () => setShown(false)
      return (
        <>
          {shown ? <NitroInput ref={field} defaultValue="leaving" keyboardHandoffMs={3000} /> : null}
          <NitroInput defaultValue="staying" />
        </>
      )
    }
    await render(
      <View style={{ gap: 12, padding: 20 }}>
        <Host />
      </View>
    )
    try {
      if (!(await openKeyboard(field.current))) return
      unmount()
      await sleep(200)
      const from = Date.now()
      Keyboard.dismiss()
      await waitFor(() => expect(log.hidesSince(from).length).toBeGreaterThan(0), 3000)
      expect(log.hidesSince(from)[0]!.at - from).toBeLessThan(500)
    } finally {
      log.stop()
      await closeKeyboard()
    }
  })

  it('lets the keyboard go once keyboardHandoffMs runs out and no field has taken it', async () => {
    const field = createRef<NitroInputHandle>()
    const log = keyboardRecorder()
    let unmount = () => {}
    function Host() {
      const [shown, setShown] = useState(true)
      unmount = () => setShown(false)
      return shown ? <NitroInput ref={field} defaultValue="alone" keyboardHandoffMs={300} /> : null
    }
    await render(
      <View style={{ padding: 20 }}>
        <Host />
      </View>
    )
    try {
      if (!(await openKeyboard(field.current))) return
      const from = Date.now()
      unmount()
      await waitFor(() => expect(log.hidesSince(from).length).toBeGreaterThan(0), 3000)
      const hid = log.hidesSince(from)[0]!.at - from
      // Not at once (the hold), and not much later than the hold either.
      expect(hid).toBeGreaterThanOrEqual(250)
      expect(hid).toBeLessThan(1000)
      await waitFor(() => expect(Keyboard.isVisible()).toBe(false), 3000)
    } finally {
      log.stop()
      await closeKeyboard()
    }
  })
})

// React 19.2's <Activity> keeps a hidden subtree mounted with its state, but
// cleans up its effects and refs while hidden. Uno's sign-in keeps a phone
// form and an email form mounted this way and toggles between them.
describe('NitroInput under <Activity>', () => {
  type Mode = 'phone' | 'email'
  function makeSignIn(onShow?: (mode: Mode, fields: { phone: NitroInputHandle | null; email: NitroInputHandle | null }) => void) {
    const phone = createRef<NitroInputHandle>()
    const email = createRef<NitroInputHandle>()
    let setMode = (_m: Mode) => {}
    function SignIn() {
      const [mode, set] = useState<Mode>('phone')
      setMode = set
      useLayoutEffect(() => {
        onShow?.(mode, { phone: phone.current, email: email.current })
      }, [mode])
      return (
        <View style={{ padding: 20, gap: 12 }}>
          <Activity mode={mode === 'phone' ? 'visible' : 'hidden'}>
            <NitroInput ref={phone} defaultValue="0612" keyboardType="phone-pad" keyboardHandoffMs={400} />
          </Activity>
          <Activity mode={mode === 'email' ? 'visible' : 'hidden'}>
            <NitroInput ref={email} defaultValue="ada@acme.io" keyboardType="email-address" keyboardHandoffMs={400} />
          </Activity>
        </View>
      )
    }
    return { phone, email, setMode: (m: Mode) => setMode(m), SignIn }
  }

  it('closes the keyboard when the focused field is hidden, and keeps its text for when it is shown', async () => {
    const { phone, setMode, SignIn } = makeSignIn()
    await render(<SignIn />)
    await waitFor(() => expect(phone.current).not.toBeNull())
    const log = keyboardRecorder()
    try {
      if (!(await openKeyboard(phone.current))) return
      const handle = phone.current!
      const from = Date.now()
      setMode('email')
      // Nothing takes the keyboard: it goes (after the hold), and no hidden
      // field is left focused to type into.
      await waitFor(() => expect(Keyboard.isVisible()).toBe(false), 3000)
      expect(log.hidesSince(from).length).toBeGreaterThan(0)
      expect(phone.current).toBeNull()
      // A handle kept from before: focus() on the hidden field does nothing.
      handle.focus()
      await sleep(600)
      expect(Keyboard.isVisible()).toBe(false)
      setMode('phone')
      await waitFor(() => expect(phone.current).not.toBeNull())
      expect(phone.current!.getText()).toBe('0612')
      expect(phone.current!.isFocused()).toBe(false)
      phone.current!.focus()
      await waitFor(() => expect(Keyboard.isVisible()).toBe(true), 3000)
    } finally {
      log.stop()
      await closeKeyboard()
    }
  })

  it('keeps the keyboard up when the form that is shown focuses its own field', async () => {
    // "Use email instead": the phone field has the keyboard, the email form is
    // shown and its field focused as it appears.
    const { phone, email, setMode, SignIn } = makeSignIn((mode, fields) => {
      if (mode === 'email') fields.email?.focus()
    })
    await render(<SignIn />)
    await waitFor(() => expect(phone.current).not.toBeNull())
    const log = keyboardRecorder()
    try {
      if (!(await openKeyboard(phone.current))) return
      const from = Date.now()
      setMode('email')
      await sleep(1000)
      expect(log.hidesSince(from)).toEqual([])
      expect(email.current!.isFocused()).toBe(true)
      expect(Keyboard.isVisible()).toBe(true)
    } finally {
      log.stop()
      await closeKeyboard()
    }
  })

  it('keeps text typed before it was hidden', async () => {
    const { phone, setMode, SignIn } = makeSignIn()
    await render(<SignIn />)
    await waitFor(() => expect(phone.current).not.toBeNull())
    phone.current!.setText('0699')
    await waitFor(() => expect(phone.current!.getText()).toBe('0699'))
    setMode('email')
    await sleep(500)
    setMode('phone')
    await waitFor(() => expect(phone.current).not.toBeNull())
    await waitFor(() => expect(phone.current!.getText()).toBe('0699'))
  })

  it('never lets a handle kept from before reach the field that got its old view', async () => {
    // A hidden field's native view goes back to the pool; the email field is
    // given it when shown. The phone field's old handle must not read or
    // focus it.
    const { phone, email, setMode, SignIn } = makeSignIn()
    await render(<SignIn />)
    await waitFor(() => expect(phone.current).not.toBeNull())
    const oldPhone = phone.current!
    setMode('email')
    await waitFor(() => expect(email.current).not.toBeNull())
    await sleep(300)
    expect(oldPhone.getText()).toBe('0612')
    oldPhone.focus()
    await sleep(500)
    expect(email.current!.isFocused()).toBe(false)
    expect(email.current!.getText()).toBe('ada@acme.io')
  })

  it('survives rapid toggling while the text changes', async () => {
    const { phone, email, setMode, SignIn } = makeSignIn()
    await render(<SignIn />)
    await waitFor(() => expect(phone.current).not.toBeNull())
    for (let i = 0; i < 20; i++) {
      phone.current?.setText(`06${i}`)
      setMode(i % 2 === 0 ? 'email' : 'phone')
      await sleep(40)
    }
    setMode('phone')
    await waitFor(() => expect(phone.current).not.toBeNull())
    await waitFor(() => expect(phone.current!.getText()).toBe('0618'))
    setMode('email')
    await waitFor(() => expect(email.current?.getText()).toBe('ada@acme.io'))
  })
})

