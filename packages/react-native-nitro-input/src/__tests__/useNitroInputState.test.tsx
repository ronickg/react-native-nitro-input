import React, { useState } from 'react'
import { act, create } from 'react-test-renderer'
import { useNitroInputState, type NitroInputState, type SharedValueLike } from '../useNitroInputState'

/** Reanimated's `useSharedValue`, reduced to what the hook needs: a stable box. */
function useFakeSharedValue<T>(initial: T): SharedValueLike<T> {
  return useState(() => ({ value: initial }))[0]
}

function Harness({ onState, tick }: { onState: (state: NitroInputState) => void; tick: number }) {
  const state = useNitroInputState(useFakeSharedValue)
  onState(state)
  return <>{tick}</>
}

function mount() {
  const states: NitroInputState[] = []
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<Harness onState={(s) => states.push(s)} tick={0} />)
  })
  return {
    latest: () => states[states.length - 1]!,
    rerender: () =>
      act(() => {
        renderer.update(<Harness onState={(s) => states.push(s)} tick={states.length} />)
      }),
  }
}

describe('useNitroInputState', () => {
  it('starts empty, unfocused, with the caret at the start', () => {
    const state = mount().latest()
    expect(state.text.value).toBe('')
    expect(Number.isNaN(state.value.value)).toBe(true)
    expect(state.focused.value).toBe(false)
    expect(state.selection.value).toEqual({ start: 0, end: 0 })
  })

  it('writes the field’s events into the shared values', () => {
    const { handlers, text, value, focused, selection } = mount().latest()
    handlers.onChangeText('1,234')
    handlers.onChangeValue(1234)
    handlers.onFocus()
    handlers.onSelectionChange({ start: 1, end: 3 })
    expect(text.value).toBe('1,234')
    expect(value.value).toBe(1234)
    expect(focused.value).toBe(true)
    expect(selection.value).toEqual({ start: 1, end: 3 })
    handlers.onBlur()
    expect(focused.value).toBe(false)
  })

  it('copies the selection rather than keeping the event object', () => {
    const { handlers, selection } = mount().latest()
    const event = { start: 2, end: 2, extra: true }
    handlers.onSelectionChange(event)
    expect(selection.value).toEqual({ start: 2, end: 2 })
    expect(selection.value).not.toBe(event)
  })

  it('keeps the handlers and the shared values stable across renders', () => {
    // A new handler identity would re-register the worklet on the UI runtime
    // every render, which is what the hook exists to avoid.
    const harness = mount()
    const first = harness.latest()
    harness.rerender()
    const second = harness.latest()
    expect(second.handlers).toBe(first.handlers)
    expect(second.text).toBe(first.text)
    expect(second.value).toBe(first.value)
    expect(second.focused).toBe(first.focused)
    expect(second.selection).toBe(first.selection)
  })

  it('spreads onto the field as the five worklet handlers', () => {
    const { handlers } = mount().latest()
    expect(Object.keys(handlers).sort()).toEqual(
      ['onBlur', 'onChangeText', 'onChangeValue', 'onFocus', 'onSelectionChange'].sort()
    )
  })
})
