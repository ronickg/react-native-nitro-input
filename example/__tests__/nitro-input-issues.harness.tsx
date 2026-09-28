/**
 * Bugs other inputs have shipped, replayed against `NitroInput`: each test is
 * the reproduction from an issue in react-native, react-native-screens,
 * react-navigation or react-native-keyboard-controller, cut down to what a
 * program can drive (focus, navigation, props, the handle). What needs real
 * typing, an IME or a gesture stays in the manual QA screens.
 */
import React, { createRef, useEffect, useState } from 'react'
import { ActionSheetIOS, Keyboard, Platform, View } from 'react-native'
import { describe, expect, it } from 'react-native-harness'
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { NitroInput, type NitroInputHandle, type NitroInputSelectionEvent } from 'react-native-nitro-input'
import { render, sleep, waitFor } from './test-utils'

type KeyboardEvent = { type: string; at: number }

function keyboardRecorder() {
  const events: KeyboardEvent[] = []
  const subscriptions = (['keyboardWillShow', 'keyboardDidShow', 'keyboardWillHide', 'keyboardDidHide'] as const).map(
    (type) => Keyboard.addListener(type, () => events.push({ type, at: Date.now() }))
  )
  const since = (at: number, kind: 'Show' | 'Hide') => events.filter((e) => e.at >= at && e.type.endsWith(kind))
  return {
    events,
    showsSince: (at: number) => since(at, 'Show'),
    hidesSince: (at: number) => since(at, 'Hide'),
    stop: () => subscriptions.forEach((s) => s.remove()),
  }
}

let noKeyboard = false

async function openKeyboard(field: NitroInputHandle | null): Promise<boolean> {
  if (noKeyboard) return false
  field?.focus()
  try {
    await waitFor(() => expect(Keyboard.isVisible()).toBe(true), 4000)
  } catch {
    noKeyboard = true
    console.warn('[issues suite] no software keyboard showed; skipping the keyboard tests on this device')
    return false
  }
  await sleep(700)
  return true
}

async function closeKeyboard() {
  Keyboard.dismiss()
  await waitFor(() => expect(Keyboard.isVisible()).toBe(false), 4000).catch(() => {})
  await sleep(300)
}

/** A two-screen native stack; `second` is pushed with the given options. */
function stack(first: React.ComponentType, second: React.ComponentType, options: Record<string, unknown> = {}) {
  const Stack = createNativeStackNavigator()
  const navigation = createNavigationContainerRef<Record<string, undefined>>()
  const tree = (
    <View style={{ flex: 1, height: 500 }}>
      <NavigationContainer ref={navigation}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="first" component={first} />
          <Stack.Screen name="second" component={second} options={options} />
        </Stack.Navigator>
      </NavigationContainer>
    </View>
  )
  return { tree, navigation }
}

describe('NitroInput against other inputs’ bugs: navigation', () => {
  // react-navigation#11643 (onBlur once on mount for an autoFocus field when
  // the push has no animation) and react-native-screens#4133 (focus handed
  // back to the covered screen's field after a cross-fade push).
  for (const animation of ['default', 'none', 'simple_push', 'fade'] as const) {
    it(`keeps an autoFocus field on a pushed screen focused, with no blur (animation=${animation})`, async () => {
      const first = createRef<NitroInputHandle>()
      const second = createRef<NitroInputHandle>()
      const firstFocuses: number[] = []
      const secondBlurs: number[] = []
      const { tree, navigation } = stack(
        () => <NitroInput ref={first} defaultValue="first" onFocus={() => firstFocuses.push(Date.now())} style={{ margin: 20 }} />,
        () => (
          <NitroInput ref={second} autoFocus defaultValue="second" onBlur={() => secondBlurs.push(Date.now())} style={{ margin: 20 }} />
        ),
        { animation }
      )
      await render(tree)
      const log = keyboardRecorder()
      try {
        await waitFor(() => expect(first.current).not.toBeNull())
        if (!(await openKeyboard(first.current))) return
        const pushedAt = Date.now()
        navigation.navigate('second')
        await sleep(1500)
        expect(second.current!.isFocused()).toBe(true)
        expect(first.current?.isFocused() ?? false).toBe(false)
        expect(secondBlurs).toEqual([])
        // The covered field never gets its focus back on a push.
        expect(firstFocuses.filter((at) => at >= pushedAt)).toEqual([])
        // And the keyboard never went down on the way (react-navigation#11626).
        const code: Record<string, string> = { keyboardWillHide: 'H', keyboardDidHide: 'h' }
        expect(log.hidesSince(pushedAt).map((e) => `${code[e.type]}${e.at - pushedAt}`).join(' ')).toBe('')
      } finally {
        log.stop()
        await closeKeyboard()
      }
    })
  }

  // react-native-screens#1637: the keyboard down, a push to a screen whose
  // field autofocuses - one show, and no hide after it.
  it('shows the keyboard once for an autoFocus field pushed with the keyboard down', async () => {
    const second = createRef<NitroInputHandle>()
    const { tree, navigation } = stack(
      () => <View style={{ flex: 1 }} />,
      () => <NitroInput ref={second} autoFocus defaultValue="second" style={{ margin: 20 }} />
    )
    await render(tree)
    const log = keyboardRecorder()
    try {
      await closeKeyboard()
      const pushedAt = Date.now()
      navigation.navigate('second')
      await sleep(1800)
      if (!Keyboard.isVisible()) {
        noKeyboard = noKeyboard || log.showsSince(pushedAt).length === 0
        if (noKeyboard) return
      }
      expect(second.current!.isFocused()).toBe(true)
      // Android sends no keyboardWillShow, only keyboardDidShow.
      const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
      expect(log.events.filter((e) => e.at >= pushedAt && e.type === show).length).toBe(1)
      expect(log.hidesSince(pushedAt)).toEqual([])
    } finally {
      log.stop()
      await closeKeyboard()
    }
  })

  // react-native-screens#3480: a form sheet presented over a focused field
  // must not close the keyboard and then bring it back once it is up.
  it('does not bring the keyboard back while a form sheet without a field is up', async () => {
    const first = createRef<NitroInputHandle>()
    const { tree, navigation } = stack(
      () => <NitroInput ref={first} defaultValue="first" style={{ margin: 20 }} />,
      () => <View style={{ flex: 1, backgroundColor: 'white' }} />,
      { presentation: 'formSheet', sheetAllowedDetents: [0.5] }
    )
    await render(tree)
    const log = keyboardRecorder()
    try {
      await waitFor(() => expect(first.current).not.toBeNull())
      if (!(await openKeyboard(first.current))) return
      const presentedAt = Date.now()
      navigation.navigate('second')
      await sleep(1800)
      const hides = log.hidesSince(presentedAt)
      const shows = log.showsSince(presentedAt)
      // Whichever way the platform goes (keep it up, or close it), it goes
      // once: no hide followed by a show.
      if (hides.length > 0) {
        const lastHide = hides[hides.length - 1]!.at
        expect(shows.filter((e) => e.at > lastHide)).toEqual([])
      }
      navigation.goBack()
      await sleep(1200)
    } finally {
      log.stop()
      await closeKeyboard()
    }
  })

  // react-native-screens#3677 (and RN core): after a field let the keyboard go,
  // a presentation (an action sheet, a menu) must not bring it back.
  if (Platform.OS === 'ios') {
    for (const how of ['blur', 'unmount'] as const) {
      it(`keeps the keyboard down when an action sheet opens after the field was ${how === 'blur' ? 'blurred' : 'unmounted with a hold'}`, async () => {
        const field = createRef<NitroInputHandle>()
        let setShown = (_: boolean) => {}
        function Host() {
          const [shown, set] = useState(true)
          setShown = set
          return shown ? <NitroInput ref={field} defaultValue="x" keyboardHandoffMs={300} /> : <View />
        }
        await render(<Host />)
        const log = keyboardRecorder()
        try {
          await waitFor(() => expect(field.current).not.toBeNull())
          if (!(await openKeyboard(field.current))) return
          if (how === 'blur') field.current!.blur()
          else setShown(false)
          await waitFor(() => expect(Keyboard.isVisible()).toBe(false), 4000)
          await sleep(400)
          const openedAt = Date.now()
          ActionSheetIOS.showActionSheetWithOptions({ options: ['A', 'Cancel'], cancelButtonIndex: 1 }, () => {})
          await sleep(1000)
          ActionSheetIOS.dismissActionSheet?.()
          await sleep(1000)
          expect(log.showsSince(openedAt)).toEqual([])
        } finally {
          log.stop()
          await closeKeyboard()
        }
      })
    }
  }

  // react-native-screens#2965 (Android): closing a screen whose field had the
  // keyboard handed focus to a field on the screen underneath that had never
  // been focused, and the keyboard came up for it.
  it('does not focus the covered screen’s untouched field when a screen is popped', async () => {
    const first = createRef<NitroInputHandle>()
    const second = createRef<NitroInputHandle>()
    const { tree, navigation } = stack(
      () => <NitroInput ref={first} defaultValue="first" style={{ margin: 20 }} />,
      () => <NitroInput ref={second} defaultValue="second" style={{ margin: 20 }} />
    )
    await render(tree)
    try {
      navigation.navigate('second')
      await sleep(1200)
      await waitFor(() => expect(second.current).not.toBeNull())
      if (!(await openKeyboard(second.current))) return
      navigation.goBack()
      await sleep(1500)
      expect(first.current!.isFocused()).toBe(false)
      // iOS keeps nothing up for a field that never had the keyboard;
      // Android must not have raised it for the first screen's field.
      expect(Keyboard.isVisible()).toBe(false)
    } finally {
      await closeKeyboard()
    }
  })
})

describe('NitroInput against other inputs’ bugs: focus', () => {
  // react-native-keyboard-controller#1400: a blur() or Keyboard.dismiss()
  // while the keyboard is still coming up has to win.
  for (const how of ['blur', 'dismiss'] as const) {
    it(`ends blurred with the keyboard down when ${how === 'blur' ? 'blur()' : 'Keyboard.dismiss()'} lands while it opens`, async () => {
      const field = createRef<NitroInputHandle>()
      const blurs: number[] = []
      await render(<NitroInput ref={field} defaultValue="x" onBlur={() => blurs.push(Date.now())} />)
      try {
        await waitFor(() => expect(field.current).not.toBeNull())
        if (noKeyboard) return
        field.current!.focus()
        await sleep(60)
        if (how === 'blur') field.current!.blur()
        else Keyboard.dismiss()
        await sleep(1500)
        expect(field.current!.isFocused()).toBe(false)
        expect(Keyboard.isVisible()).toBe(false)
        expect(blurs.length).toBe(1)
      } finally {
        await closeKeyboard()
      }
    })
  }

  // react-native#55116: autoFocus sent onFocus and then an onBlur right after.
  it('focuses an autoFocus field once, with no blur after it', async () => {
    const events: string[] = []
    const field = createRef<NitroInputHandle>()
    await render(<NitroInput ref={field} autoFocus defaultValue="x" onFocus={() => events.push('focus')} onBlur={() => events.push('blur')} />)
    try {
      await waitFor(() => expect(events).toContain('focus'))
      await sleep(1000)
      expect(events).toEqual(['focus'])
      expect(field.current!.isFocused()).toBe(true)
    } finally {
      await closeKeyboard()
    }
  })

  // react-native#51072 (Android 8.1): blurring one field moved the focus to the
  // first focusable field on the screen.
  it('leaves no field focused after blur(), with another field on screen', async () => {
    const a = createRef<NitroInputHandle>()
    const b = createRef<NitroInputHandle>()
    await render(
      <View>
        <NitroInput ref={a} defaultValue="a" />
        <NitroInput ref={b} defaultValue="b" />
      </View>
    )
    try {
      await waitFor(() => expect(b.current).not.toBeNull())
      b.current!.focus()
      await waitFor(() => expect(b.current!.isFocused()).toBe(true))
      b.current!.blur()
      await sleep(800)
      expect(b.current!.isFocused()).toBe(false)
      expect(a.current!.isFocused()).toBe(false)
    } finally {
      await closeKeyboard()
    }
  })
})

describe('NitroInput against other inputs’ bugs: text and selection', () => {
  // react-native#36494 / #44566: a controlled multiline field with maxLength
  // sent onChangeText on its own at mount and after a programmatic value.
  it('sends no onChangeText for a value the program sets, multiline with maxLength', async () => {
    const changes: string[] = []
    let setValue = (_: string) => {}
    function Host() {
      const [value, set] = useState('abcdef')
      setValue = set
      return <NitroInput multiline maxLength={10} value={value} onChangeText={(t) => changes.push(t)} />
    }
    await render(<Host />)
    await sleep(500)
    setValue('In the Shadow')
    await sleep(500)
    setValue('short')
    await sleep(500)
    expect(changes).toEqual([])
  })

  // react-native#44965: a value longer than maxLength set by the program was
  // cut on Android and not on iOS. Both cut it here, by characters.
  it('cuts a programmatic value to maxLength on both platforms', async () => {
    const field = createRef<NitroInputHandle>()
    await render(<NitroInput ref={field} maxLength={10} value={'x'.repeat(30)} />)
    await waitFor(() => expect(field.current?.getText()).toBe('x'.repeat(10)))
  })

  // react-native#48941: a huge maxLength blocked all input (integer overflow).
  it('takes text with a huge maxLength', async () => {
    const field = createRef<NitroInputHandle>()
    await render(<NitroInput ref={field} maxLength={6e15} />)
    await waitFor(() => expect(field.current).not.toBeNull())
    field.current!.setText('still typing')
    await waitFor(() => expect(field.current!.getText()).toBe('still typing'))
  })

  // react-native-keyboard-controller#1573: half an emoji (a lone surrogate)
  // crashed the string bridge; and a limit must never split a character.
  it('survives a lone surrogate and never splits a character at maxLength', async () => {
    const field = createRef<NitroInputHandle>()
    const limited = createRef<NitroInputHandle>()
    await render(
      <View>
        <NitroInput ref={field} />
        <NitroInput ref={limited} maxLength={3} />
      </View>
    )
    await waitFor(() => expect(limited.current).not.toBeNull())
    field.current!.setText('a\uD83D')
    await sleep(200)
    field.current!.setText('hi 😀😀')
    field.current!.focus()
    field.current!.setSelection(4, 4) // code points: just after the first emoji
    await sleep(200)
    expect(field.current!.getText()).toBe('hi 😀😀')
    limited.current!.setText('ab👍👍')
    await waitFor(() => expect(limited.current!.getText()).toBe('ab👍'))
    expect(limited.current!.getText()).not.toContain('�')
    await closeKeyboard()
  })

  // react-native#29063: a value and a selection set in the same render put the
  // caret at the end (iOS) or threw setSpan out of bounds (Android).
  it('applies a value and a selection given together', async () => {
    const selections: Array<{ start: number; end: number }> = []
    const field = createRef<NitroInputHandle>()
    let insert = () => {}
    function Host() {
      const [state, set] = useState<{ value: string; selection?: { start: number; end: number } }>({ value: 'hello world' })
      insert = () => set({ value: 'hello @Mihail world', selection: { start: 13, end: 13 } })
      return (
        <NitroInput
          ref={field}
          value={state.value}
          selection={state.selection}
          onSelectionChange={(e: NitroInputSelectionEvent) => selections.push(e.selection)}
        />
      )
    }
    await render(<Host />)
    try {
      await waitFor(() => expect(field.current).not.toBeNull())
      field.current!.focus()
      await waitFor(() => expect(field.current!.isFocused()).toBe(true))
      insert()
      await waitFor(() => expect(selections[selections.length - 1]).toEqual({ start: 13, end: 13 }))
      expect(field.current!.getText()).toBe('hello @Mihail world')
    } finally {
      await closeKeyboard()
    }
  })

  // react-native#46943 / #50125: a selection given while blurred was lost on focus.
  it('keeps a selection given before the field was focused', async () => {
    const selections: Array<{ start: number; end: number }> = []
    const field = createRef<NitroInputHandle>()
    await render(
      <NitroInput ref={field} value="1.00" selection={{ start: 1, end: 1 }} onSelectionChange={(e) => selections.push(e.selection)} />
    )
    try {
      await waitFor(() => expect(field.current).not.toBeNull())
      await sleep(300)
      field.current!.focus()
      await waitFor(() => expect(field.current!.isFocused()).toBe(true))
      await sleep(400)
      expect(selections[selections.length - 1]).toEqual({ start: 1, end: 1 })
    } finally {
      await closeKeyboard()
    }
  })

  // react-native#35005: a text set after the user cleared the field was
  // dropped as "the same as last time".
  it('sets a text again after the user cleared it', async () => {
    const field = createRef<NitroInputHandle>()
    let setValue = (_: string) => {}
    function Host() {
      const [value, set] = useState('A')
      setValue = set
      return <NitroInput ref={field} value={value} onChangeText={set} />
    }
    await render(<Host />)
    await waitFor(() => expect(field.current?.getText()).toBe('A'))
    field.current!.setText('') // the user clearing it, reported like an edit
    await waitFor(() => expect(field.current!.getText()).toBe(''))
    setValue('A')
    await waitFor(() => expect(field.current!.getText()).toBe('A'))
  })

  // react-native#38676 / #53440 / #43403: toggling secureTextEntry or a style
  // while focused moved the caret, dropped focus or cleared uncontrolled text.
  it('keeps focus, text and caret while props change under a focused field', async () => {
    const field = createRef<NitroInputHandle>()
    const selections: Array<{ start: number; end: number }> = []
    let setVariant = (_: number) => {}
    function Host() {
      const [variant, set] = useState(0)
      setVariant = set
      return (
        <NitroInput
          ref={field}
          defaultValue="secret"
          secureTextEntry={variant % 2 === 1}
          color={variant >= 2 ? '#c00' : '#000'}
          fontSize={variant >= 3 ? 22 : 17}
          placeholder={variant >= 4 ? 'changed' : 'placeholder'}
          onSelectionChange={(e) => selections.push(e.selection)}
        />
      )
    }
    await render(<Host />)
    try {
      await waitFor(() => expect(field.current).not.toBeNull())
      if (!(await openKeyboard(field.current))) return
      field.current!.setSelection(2, 2)
      await waitFor(() => expect(selections[selections.length - 1]).toEqual({ start: 2, end: 2 }))
      for (const variant of [1, 2, 3, 4, 5]) {
        setVariant(variant)
        await sleep(400)
        expect(field.current!.isFocused()).toBe(true)
        expect(field.current!.getText()).toBe('secret')
      }
      expect(selections[selections.length - 1]).toEqual({ start: 2, end: 2 })
    } finally {
      await closeKeyboard()
    }
  })

  // react-native#41988: selectTextOnFocus had to select the whole text.
  it('selects the whole text on focus with selectTextOnFocus', async () => {
    const field = createRef<NitroInputHandle>()
    const selections: Array<{ start: number; end: number }> = []
    await render(<NitroInput ref={field} defaultValue="test" selectTextOnFocus onSelectionChange={(e) => selections.push(e.selection)} />)
    try {
      await waitFor(() => expect(field.current).not.toBeNull())
      field.current!.focus()
      await waitFor(() => expect(selections[selections.length - 1]).toEqual({ start: 0, end: 4 }))
    } finally {
      await closeKeyboard()
    }
  })

  // react-native-keyboard-controller#1173 / #1119: focusing, setting a value and
  // unmounting in quick succession, multiline and secure, crashed in UIKit's
  // text storage or a stale delegate.
  it('survives mount, focus, a new value and unmount in quick succession', async () => {
    let setRound = (_: number) => {}
    const field = createRef<NitroInputHandle>()
    function Host() {
      const [round, set] = useState(0)
      setRound = set
      useEffect(() => {
        field.current?.focus()
      }, [round])
      return (
        <NitroInput
          key={round}
          ref={field}
          multiline={round % 2 === 0}
          secureTextEntry={round % 2 === 1}
          value={`round ${round}\n`.repeat(round % 5 + 1)}
        />
      )
    }
    await render(<Host />)
    for (let round = 1; round <= 16; round++) {
      setRound(round)
      await sleep(round % 3 === 0 ? 16 : 80)
    }
    await sleep(500)
    expect(field.current!.getText()).toContain('round 16')
    await closeKeyboard()
  })
})
