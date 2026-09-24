/**
 * On-device checks of `NitroInput`, plain and with `transition="reflow"`: the imperative handle,
 * the events, the formatter and the mask engine, driven the way an app drives
 * them. Typing needs a keyboard, which these tests do not have; what a
 * program can do to the field is covered here, what a finger does stays in
 * the manual QA screens.
 */
import React, { createRef, useEffect, useRef } from 'react'
import { View, type LayoutRectangle } from 'react-native'
import { describe, expect, it, waitFor } from 'react-native-harness'
import {
  NitroInput,
  type NitroInputHandle,
  type NitroInputFocusEvent,
  type NitroInputSelectionEvent,
} from 'react-native-nitro-input'
import { deferred, render, sleep, withTimeout } from './test-utils'
import { forceGc, trackNativeViews, trackedLiveCount } from 'bench-probe'

function layoutOf() {
  const state: { current: LayoutRectangle | null } = { current: null }
  const onLayout = (e: { nativeEvent: { layout: LayoutRectangle } }) => {
    state.current = e.nativeEvent.layout
  }
  return { state, onLayout }
}

describe('NitroInput', () => {
  it('sizes a plain field with autoWidth to its text, not to the reflow engine', async () => {
    // A plain field never feeds the glyph engine, so its width has to come
    // from the system field. This is the shape a reflowing `NitroInput` has by default,
    // asked of the plain component.
    const { state, onLayout } = layoutOf()
    await render(
      <View style={{ alignSelf: 'flex-start' }}>
        <NitroInput autoWidth fontSize={20} value="Hello world" onLayout={onLayout} />
      </View>
    )
    // "Hello world" at 20pt is well over 60pt wide on every platform font.
    await waitFor(() => expect(state.current?.width ?? 0).toBeGreaterThan(60))
    expect(state.current!.width).toBeLessThan(200)
  })

  it('keeps the caret where it is when a controlled parent echoes the same text back', async () => {
    // The parent below does what every controlled form does: onChangeText
    // into state, state back into `value`. That echo must be a no-op on the
    // native side; re-applying an unchanged text is what threw the caret to
    // the end after every keystroke typed mid-word.
    const ref = createRef<NitroInputHandle>()
    const selections: string[] = []
    const echoed = deferred<string>()
    function Controlled() {
      const [value, setValue] = React.useState('hello')
      useEffect(() => {
        if (value === 'hello!') echoed.resolve(value)
      }, [value])
      return (
        <NitroInput
          ref={ref}
          value={value}
          onChangeText={setValue}
          onSelectionChange={(e: NitroInputSelectionEvent) => selections.push(`${e.start}-${e.end}`)}
        />
      )
    }
    await render(<Controlled />)
    await waitFor(() => expect(ref.current?.getText()).toBe('hello'))

    // A method edit lands the caret at the end and reports the change; the
    // caret is then moved back inside the word before the echo can arrive.
    ref.current!.setText('hello!')
    ref.current!.setSelection(2, 2)
    await withTimeout(echoed.promise, 4000, 'the parent never echoed the edit back')
    await sleep(150)
    // Asking for the same caret again is silent only if it never moved.
    ref.current!.setSelection(2, 2)
    await sleep(150)
    expect(selections.filter((s) => s === '2-2')).toEqual(['2-2'])
  })

  it('mounts empty, stretches to its parent and hands out its handle', async () => {
    const ref = createRef<NitroInputHandle>()
    const { state, onLayout } = layoutOf()
    await render(<NitroInput ref={ref} placeholder="Email" onLayout={onLayout} />)
    await waitFor(() => expect(ref.current?.native).not.toBeNull())
    expect(ref.current!.getText()).toBe('')
    expect(ref.current!.isFocused()).toBe(false)
    await waitFor(() => expect(state.current?.width ?? 0).toBeGreaterThan(0))
    expect(state.current!.height).toBeGreaterThan(0)
  })

  it('sets text through the handle and reports it like an edit', async () => {
    const ref = createRef<NitroInputHandle>()
    const changes: string[] = []
    await render(<NitroInput ref={ref} onChangeText={(text) => changes.push(text)} />)
    await waitFor(() => expect(ref.current?.native).not.toBeNull())

    ref.current!.setText('hello')
    await waitFor(() => expect(ref.current!.getText()).toBe('hello'))
    await waitFor(() => expect(changes).toEqual(['hello']))

    ref.current!.clear()
    await waitFor(() => expect(ref.current!.getText()).toBe(''))
    await waitFor(() => expect(changes).toEqual(['hello', '']))
  })

  it('follows a controlled value silently, as TextInput does', async () => {
    const ref = createRef<NitroInputHandle>()
    let changes = 0
    const { rerender } = await render(<NitroInput ref={ref} value="abc" onChangeText={() => (changes += 1)} />)
    await waitFor(() => expect(ref.current?.getText()).toBe('abc'))
    await rerender(<NitroInput ref={ref} value="abcd" onChangeText={() => (changes += 1)} />)
    await waitFor(() => expect(ref.current?.getText()).toBe('abcd'))
    await sleep(200)
    expect(changes).toBe(0)
  })

  it('focuses and blurs on request, with the events a TextInput would send', async () => {
    const ref = createRef<NitroInputHandle>()
    const focused = deferred<NitroInputFocusEvent>()
    const blurred = deferred<NitroInputFocusEvent>()
    await render(<NitroInput ref={ref} defaultValue="hi" onFocus={focused.resolve} onBlur={blurred.resolve} />)
    await waitFor(() => expect(ref.current?.native).not.toBeNull())

    ref.current!.focus()
    const focusEvent = await withTimeout(focused.promise, 5000, 'onFocus')
    expect(focusEvent.text).toBe('hi')
    expect(focusEvent.nativeEvent.text).toBe('hi')
    expect(typeof focusEvent.eventCount).toBe('number')
    await waitFor(() => expect(ref.current!.isFocused()).toBe(true))

    ref.current!.blur()
    const blurEvent = await withTimeout(blurred.promise, 5000, 'onBlur')
    expect(blurEvent.text).toBe('hi')
    await waitFor(() => expect(ref.current!.isFocused()).toBe(false))
  })

  // React Native's own suite: a command sent from a ref callback, a layout
  // effect or an effect must reach the view even though it was created a
  // moment ago; the handle queues it until the native side is there.
  it('takes focus() the moment it mounts, from a ref callback or an effect', async () => {
    const focusEvents: string[] = []
    function FocusOnMount({ how }: { how: 'ref' | 'effect' }) {
      const ref = useRef<NitroInputHandle>(null)
      useEffect(() => {
        if (how === 'effect') ref.current?.focus()
      }, [how])
      return (
        <NitroInput
          ref={(handle) => {
            ref.current = handle
            if (how === 'ref') handle?.focus()
          }}
          defaultValue={how}
          onFocus={(e) => focusEvents.push(e.text)}
        />
      )
    }
    const { rerender } = await render(<FocusOnMount how="effect" />)
    // Ten seconds: a hosted emulator has taken more than five to deliver the first focus.
    await waitFor(() => expect(focusEvents).toEqual(['effect']), { timeout: 10_000 })
    await rerender(<View />)
    await rerender(<FocusOnMount how="ref" />)
    await waitFor(() => expect(focusEvents).toEqual(['effect', 'ref']), { timeout: 10_000 })
  })

  it('takes focus away from the field that had it, like the system field it wraps', async () => {
    const first = createRef<NitroInputHandle>()
    const second = createRef<NitroInputHandle>()
    const log: string[] = []
    await render(
      <View>
        <NitroInput ref={first} defaultValue="first" onFocus={() => log.push('focus first')} onBlur={() => log.push('blur first')} />
        <NitroInput ref={second} defaultValue="second" onFocus={() => log.push('focus second')} onBlur={() => log.push('blur second')} />
      </View>,
    )
    await waitFor(() => expect(second.current?.native).not.toBeNull())
    first.current!.focus()
    await waitFor(() => expect(first.current!.isFocused()).toBe(true))
    second.current!.focus()
    await waitFor(() => expect(second.current!.isFocused()).toBe(true))
    await waitFor(() => expect(first.current!.isFocused()).toBe(false))
    await waitFor(() => expect(log).toEqual(['focus first', 'blur first', 'focus second']))
    second.current!.blur()
    await waitFor(() => expect(log).toEqual(['focus first', 'blur first', 'focus second', 'blur second']))
  })

  it('ignores blur() on a field that is not focused', async () => {
    const ref = createRef<NitroInputHandle>()
    let blurs = 0
    await render(<NitroInput ref={ref} onBlur={() => (blurs += 1)} />)
    await waitFor(() => expect(ref.current?.native).not.toBeNull())
    ref.current!.blur()
    await sleep(400)
    expect(blurs).toBe(0)
    expect(ref.current!.isFocused()).toBe(false)
  })

  it('reports no focus once unmounted, focused before or not', async () => {
    const focused = createRef<NitroInputHandle>()
    const untouched = createRef<NitroInputHandle>()
    const { rerender } = await render(
      <View>
        <NitroInput ref={focused} defaultValue="a" />
        <NitroInput ref={untouched} defaultValue="b" />
      </View>,
    )
    await waitFor(() => expect(untouched.current?.native).not.toBeNull())
    focused.current!.focus()
    await waitFor(() => expect(focused.current!.isFocused()).toBe(true))
    // The handles outlive the unmount for whoever still holds them.
    const focusedHandle = focused.current!
    const untouchedHandle = untouched.current!
    await rerender(<View />)
    await waitFor(() => expect(focusedHandle.isFocused()).toBe(false))
    expect(untouchedHandle.isFocused()).toBe(false)
  })

  it('declines focus while not editable', async () => {
    const ref = createRef<NitroInputHandle>()
    let focuses = 0
    await render(<NitroInput ref={ref} editable={false} onFocus={() => (focuses += 1)} />)
    await waitFor(() => expect(ref.current?.native).not.toBeNull())
    ref.current!.focus()
    await sleep(500)
    expect(ref.current!.isFocused()).toBe(false)
    expect(focuses).toBe(0)
  })

  it('reports a programmatic selection while focused', async () => {
    const ref = createRef<NitroInputHandle>()
    const selections: NitroInputSelectionEvent[] = []
    await render(<NitroInput ref={ref} defaultValue="hello world" onSelectionChange={(e) => selections.push(e)} />)
    await waitFor(() => expect(ref.current?.native).not.toBeNull())
    ref.current!.focus()
    await waitFor(() => expect(ref.current!.isFocused()).toBe(true))
    ref.current!.setSelection(1, 3)
    await waitFor(() => expect(selections.some((e) => e.start === 1 && e.end === 3)).toBe(true))
    const last = selections[selections.length - 1]!
    expect(last.selection).toEqual({ start: 1, end: 3 })
    expect(last.nativeEvent.selection).toEqual({ start: 1, end: 3 })
    ref.current!.blur()
  })

  it('formats an amount natively in number mode', async () => {
    const ref = createRef<NitroInputHandle>()
    const texts: string[] = []
    const values: number[] = []
    await render(
      <NitroInput
        ref={ref}
        mode="number"
        fractionDigits={2}
        prefix="$"
        onChangeText={(text) => texts.push(text)}
        onChangeValue={(value) => values.push(value)}
      />,
    )
    await waitFor(() => expect(ref.current?.native).not.toBeNull())
    expect(Number.isNaN(ref.current!.getValue())).toBe(true)

    ref.current!.setValue(1234567.5)
    await waitFor(() => expect(ref.current!.getValue()).toBe(1234567.5))
    expect(ref.current!.getText()).toBe('1,234,567.5')
    await waitFor(() => expect(values).toEqual([1234567.5]))
    expect(texts).toEqual(['1,234,567.5'])

    // A string in the field's own format is taken as is; the grouping is the formatter's, not the caller's.
    ref.current!.setText('98765.25')
    await waitFor(() => expect(ref.current!.getText()).toBe('98,765.25'))
    expect(ref.current!.getValue()).toBe(98765.25)

    ref.current!.clear()
    await waitFor(() => expect(ref.current!.getText()).toBe(''))
    expect(Number.isNaN(ref.current!.getValue())).toBe(true)
  })

  it('applies a mask natively and reports what is filled in, from every route that changes the text', async () => {
    const ref = createRef<NitroInputHandle>()
    const reports: Array<[string, string, string, boolean]> = []
    const onChangeMask = (formatted: string, extracted: string, tail: string, complete: boolean) =>
      reports.push([formatted, extracted, tail, complete])
    const { rerender } = await render(<NitroInput ref={ref} mode="mask" mask="+1 ([000]) [000]-[0000]" onChangeMask={onChangeMask} />)
    await waitFor(() => expect(ref.current?.native).not.toBeNull())
    // Mounting with nothing to show reports nothing.
    await sleep(200)
    expect(reports).toEqual([])

    ref.current!.setText('555123')
    await waitFor(() => expect(ref.current!.getText()).toBe('+1 (555) 123-'))
    await waitFor(() => expect(reports.length).toBe(1), { timeout: 5000 })
    expect(reports[0]).toEqual(['+1 (555) 123-', '555123', '0000', false])

    ref.current!.setText('5551234567')
    await waitFor(() => expect(ref.current!.getText()).toBe('+1 (555) 123-4567'))
    await waitFor(() => expect(reports.length).toBe(2), { timeout: 5000 })
    expect(reports[1]).toEqual(['+1 (555) 123-4567', '5551234567', '', true])

    // The `value` prop is silent for onChangeText but a mask still reports what it fills in.
    await rerender(<NitroInput ref={ref} mode="mask" mask="+1 ([000]) [000]-[0000]" value="4155550" onChangeMask={onChangeMask} />)
    await waitFor(() => expect(ref.current!.getText()).toBe('+1 (415) 555-0'))
    await waitFor(() => expect(reports.length).toBe(3), { timeout: 5000 })
    expect(reports[2]).toEqual(['+1 (415) 555-0', '4155550', '000', false])

    // Emptied, the field shows its placeholder again: no literal is completed into nothing.
    ref.current!.clear()
    await waitFor(() => expect(ref.current!.getText()).toBe(''))
    await waitFor(() => expect(reports.length).toBe(4), { timeout: 5000 })
    expect(reports[3]).toEqual(['', '', '+1 (000) 000-0000', false])
  })

  it('caps the text at maxLength in text mode', async () => {
    const ref = createRef<NitroInputHandle>()
    await render(<NitroInput ref={ref} maxLength={4} />)
    await waitFor(() => expect(ref.current?.native).not.toBeNull())
    ref.current!.setText('abcdefgh')
    await waitFor(() => expect(ref.current!.getText()).toBe('abcd'))
  })

  it('wraps a multiline field: grows with its lines, or holds a given line count', async () => {
    const one = createRef<NitroInputHandle>()
    const three = createRef<NitroInputHandle>()
    const fixed = createRef<NitroInputHandle>()
    const oneLayout = layoutOf()
    const threeLayout = layoutOf()
    const fixedLayout = layoutOf()
    await render(
      <View>
        <NitroInput ref={one} multiline fontSize={16} defaultValue="one" onLayout={oneLayout.onLayout} />
        <NitroInput ref={three} multiline fontSize={16} defaultValue={'one\ntwo\nthree'} onLayout={threeLayout.onLayout} />
        <NitroInput ref={fixed} multiline numberOfLines={4} fontSize={16} defaultValue="one" onLayout={fixedLayout.onLayout} />
      </View>,
    )
    await waitFor(() => expect(three.current?.getText()).toBe('one\ntwo\nthree'))
    await waitFor(() => expect(oneLayout.state.current?.height ?? 0).toBeGreaterThan(0))
    // Without a line count the field grows with its text...
    await waitFor(() => expect(threeLayout.state.current?.height ?? 0).toBeGreaterThan(oneLayout.state.current!.height))
    // ...and with one it is that tall from the start, whatever the text.
    await waitFor(() => expect(fixedLayout.state.current?.height ?? 0).toBeGreaterThan(threeLayout.state.current!.height))
  })

  it('renders two dozen fields at once', async () => {
    const refs = Array.from({ length: 24 }, () => createRef<NitroInputHandle>())
    await render(
      <View>
        {refs.map((ref, i) => (
          <NitroInput key={i} ref={ref} defaultValue={`field ${i}`} fontSize={14} variant={i % 2 ? 'outlined' : 'filled'} label={`Label ${i}`} />
        ))}
      </View>,
    )
    await waitFor(() => expect(refs.every((ref) => ref.current?.native != null)).toBe(true))
    expect(refs.map((ref) => ref.current!.getText())).toEqual(refs.map((_, i) => `field ${i}`))
  })
})

describe('NitroInput, transition="reflow"', () => {
  it('reflows an amount and sizes to it', async () => {
    const ref = createRef<NitroInputHandle>()
    const { state, onLayout } = layoutOf()
    // `flex-start` keeps the box content-sized from the first layout. Left to
    // stretch, the first `onLayout` can carry the parent's full width before
    // the native measurement lands, and "wider than empty" never holds.
    await render(
      <View style={{ alignSelf: 'flex-start' }}>
        <NitroInput transition="reflow" ref={ref} mode="number" prefix="$" fontSize={40} onLayout={onLayout} />
      </View>
    )
    await waitFor(() => expect(ref.current?.native).not.toBeNull())
    await waitFor(() => expect(state.current?.width ?? 0).toBeGreaterThan(0))
    const empty = state.current!.width

    ref.current!.setValue(1)
    await waitFor(() => expect(ref.current!.getText()).toBe('1'))
    await waitFor(() => expect(state.current!.width).toBeGreaterThan(empty))
    const oneDigit = state.current!.width

    ref.current!.setValue(1234567.89)
    await waitFor(() => expect(ref.current!.getText()).toBe('1,234,567.89'))
    expect(ref.current!.getValue()).toBe(1234567.89)
    // The reflow is a native animation; the box follows the settled text.
    await waitFor(() => expect(state.current!.width).toBeGreaterThan(oneDigit), { timeout: 3000 })
  })
})

describe('NitroInput lifetime', () => {
  // The same check as the rolling number's: 20 fields mounted and unmounted
  // 30 times, a forced collection, the live View count where it started
  // (Android), and fields mounted after the churn that read what they were given.
  it('frees its views on unmount and mounts working fields after the churn', async () => {
    const fields = 20
    const cycles = 30
    const refs = Array.from({ length: fields }, () => createRef<NitroInputHandle>())
    const tree = (base: number) => (
      <View>
        {refs.map((ref, i) => (
          <NitroInput key={i} ref={ref} defaultValue={String(base + i)} />
        ))}
      </View>
    )
    const { rerender } = await render(<View />)
    let tracked: number | null = 0
    for (let cycle = 1; cycle <= cycles; cycle++) {
      await rerender(tree(1000 * cycle))
      await waitFor(() => expect(refs[fields - 1].current?.native).not.toBeNull(), { timeout: 5000 })
      // Remember this cycle's native views (weakly) while they are mounted.
      tracked = trackNativeViews()
      await rerender(<View />)
    }
    forceGc()
    await sleep(500)
    forceGc()
    await sleep(300)
    const alive = trackedLiveCount()
    if (tracked != null && alive != null) {
      // Every cycle's fields (and their inner views) were tracked; after the
      // collection none should be alive. A leak is a cycle's worth or more.
      expect(tracked).toBeGreaterThanOrEqual(fields)
      expect(alive).toBeLessThan(fields)
    }
    await rerender(tree(5000))
    await waitFor(() => expect(refs.map((ref) => ref.current?.getText())).toEqual(refs.map((_, i) => String(5000 + i))), { timeout: 5000 })
  })
})
