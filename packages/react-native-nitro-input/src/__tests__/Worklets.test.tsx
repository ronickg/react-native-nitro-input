/**
 * The worklet registry (`worklets.ts`) with `react-native-worklets` present.
 *
 * The other suites run without it and assert that everything degrades to id
 * `0` with one warning. This one stands a fake in for the package - the UI
 * runtime is this very runtime, so `executeOnUIRuntimeSync` just runs the
 * function - and for the native bridge, so the wrappers that native would call
 * by id can be called here and their arguments and results checked.
 *
 * The fake is a plain `jest.mock`, not a virtual one: the name resolves to
 * the stub in `__mocks__` (the reason is written there), so its module id is
 * the same from every file and in every worker, and the factory always wins.
 */
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

jest.mock(
  'react-native-worklets',
  () => ({
    executeOnUIRuntimeSync: (fn: () => unknown) => () => fn(),
    runOnUI:
      (fn: (...args: unknown[]) => void) =>
      (...args: unknown[]) =>
        fn(...args),
    getUIRuntimeHolder: () => ({ holder: true }),
  })
)

// `mock`-prefixed so the hoisted factory below may close over it.
const mockInstall = jest.fn(() => true)
jest.mock('react-native-nitro-modules', () => ({
  getHostComponent: (name: string) => name,
  callback: <T,>(f: T) => (typeof f === 'function' ? { f } : f),
  NitroModules: {
    createHybridObject: () => ({ isAvailable: true, install: mockInstall }),
  },
}))

/* eslint-disable @typescript-eslint/no-var-requires */
const worklets = require('../worklets') as typeof import('../worklets')
const { NitroInput } = require('../NitroInput') as typeof import('../NitroInput')
/* eslint-enable @typescript-eslint/no-var-requires */

type Wrapper = (...args: never[]) => unknown
const registry = () => globalThis.__nitroInputWorklets as Map<number, Wrapper>
const wrapper = (id: number) => registry().get(id) as (...args: unknown[]) => unknown

function render(element: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined
  act(() => {
    renderer = create(element)
  })
  return renderer!
}

function nativeProps(renderer: ReactTestRenderer): Record<string, unknown> {
  return renderer.root.findByType('NitroInputView' as never).props as Record<string, unknown>
}

/** A function the worklets Babel plugin would have compiled. */
const asWorklet = <T extends (...args: never[]) => unknown>(fn: T): T => Object.assign(fn, { __workletHash: 1 })

describe('installation', () => {
  it('installs the UI runtime once and allocates increasing ids', () => {
    expect(worklets.ensureWorkletsInstalled()).toBe(true)
    expect(worklets.ensureWorkletsInstalled()).toBe(true)
    expect(mockInstall).toHaveBeenCalledTimes(1)
    expect(mockInstall).toHaveBeenCalledWith({ holder: true })
    expect(registry()).toBeInstanceOf(Map)
    const a = worklets.allocateWorkletId()
    const b = worklets.allocateWorkletId()
    expect(a).toBeGreaterThan(0)
    expect(b).toBe(a + 1)
  })

  it('recognises a compiled worklet by its hash', () => {
    expect(worklets.isWorklet(asWorklet(() => {}))).toBe(true)
    expect(worklets.isWorklet(() => {})).toBe(false)
    expect(worklets.isWorklet(undefined)).toBe(false)
  })
})

describe('registration', () => {
  it('registers a transform whose wrapper returns the new text and a selection', () => {
    const id = worklets.allocateWorkletId()
    worklets.registerTransform(({ text }) => ({ text: text.toUpperCase() }), id)
    // (text, previousText, selectionStart, selectionEnd, previousStart, previousEnd)
    expect(wrapper(id)('ab', 'a', 2, 2, 1, 1)).toEqual({ text: 'AB', selectionStart: 2, selectionEnd: 2 })
  })

  it('a transform returning null keeps the edit', () => {
    const id = worklets.allocateWorkletId()
    worklets.registerTransform(() => null, id)
    expect(wrapper(id)('ab', 'a', 2, 2, 1, 1)).toBeNull()
  })

  it('a transform with no selection keeps the caret relative to the edit', () => {
    const id = worklets.allocateWorkletId()
    worklets.registerTransform(({ text }) => ({ text: '@' + text }), id)
    // Caret at the end stays at the end.
    expect(wrapper(id)('ab', 'a', 2, 2, 1, 1)).toEqual({ text: '@ab', selectionStart: 3, selectionEnd: 3 })
    // A caret inside the text moves by the length difference.
    expect(wrapper(id)('abc', 'ac', 1, 1, 1, 1)).toEqual({ text: '@abc', selectionStart: 2, selectionEnd: 2 })
    // A range moves as a whole.
    expect(wrapper(id)('abcd', 'abd', 1, 3, 1, 2)).toEqual({ text: '@abcd', selectionStart: 2, selectionEnd: 4 })
  })

  it('a transform may place the selection itself', () => {
    const id = worklets.allocateWorkletId()
    worklets.registerTransform(() => ({ text: 'xyz', selection: { start: 0, end: 1 } }), id)
    expect(wrapper(id)('ab', 'a', 2, 2, 1, 1)).toEqual({ text: 'xyz', selectionStart: 0, selectionEnd: 1 })
  })

  it('registers a callback as itself', () => {
    const id = worklets.allocateWorkletId()
    const onChangeText = jest.fn()
    worklets.registerCallback(onChangeText, id)
    wrapper(id)('abc')
    expect(onChangeText).toHaveBeenCalledWith('abc')
  })

  it('registers the focus pair under one id and picks the handler', () => {
    const id = worklets.allocateWorkletId()
    const onFocus = jest.fn()
    const onBlur = jest.fn()
    worklets.registerFocusChange(onFocus, onBlur, id)
    wrapper(id)(true, 'hello')
    wrapper(id)(false, 'hello')
    const event = { text: 'hello', target: 0, eventCount: 0, nativeEvent: { text: 'hello', target: 0, eventCount: 0 } }
    expect(onFocus).toHaveBeenCalledWith(event)
    expect(onBlur).toHaveBeenCalledWith(event)
    // Either half may be missing.
    const only = worklets.allocateWorkletId()
    worklets.registerFocusChange(undefined, onBlur, only)
    expect(() => wrapper(only)(true, '')).not.toThrow()
  })

  it('builds the selection, text and key events native sends the scalars of', () => {
    const select = jest.fn()
    const selectId = worklets.allocateWorkletId()
    worklets.registerSelectionChange(select, selectId)
    wrapper(selectId)(1, 3)
    expect(select).toHaveBeenCalledWith({
      selection: { start: 1, end: 3 },
      start: 1,
      end: 3,
      target: 0,
      nativeEvent: { selection: { start: 1, end: 3 }, target: 0 },
    })

    const submit = jest.fn()
    const submitId = worklets.allocateWorkletId()
    worklets.registerTextEvent(submit, submitId)
    wrapper(submitId)('done')
    expect(submit).toHaveBeenCalledWith({ text: 'done', target: 0, nativeEvent: { text: 'done', target: 0 } })

    const key = jest.fn()
    const keyId = worklets.allocateWorkletId()
    worklets.registerKeyPress(key, keyId)
    wrapper(keyId)('Backspace')
    expect(key).toHaveBeenCalledWith({
      key: 'Backspace',
      eventCount: 0,
      target: 0,
      nativeEvent: { key: 'Backspace', eventCount: 0, target: 0 },
    })
  })

  it('unregisters by id and ignores id 0', () => {
    const id = worklets.allocateWorkletId()
    worklets.registerCallback(() => {}, id)
    expect(registry().has(id)).toBe(true)
    worklets.unregisterWorklet(id)
    expect(registry().has(id)).toBe(false)
    expect(() => worklets.unregisterWorklet(0)).not.toThrow()
    worklets.registerCallback(() => {}, 0)
    expect(registry().has(0)).toBe(false)
  })
})

describe('through the component', () => {
  it('sends the ids of its worklet props and unregisters them on unmount', () => {
    const transform = asWorklet(() => null)
    const onChangeText = asWorklet(() => {})
    const onFocus = asWorklet(() => {})
    const onKeyPress = asWorklet(() => {})
    const renderer = render(
      <NitroInput transform={transform} onChangeText={onChangeText} onFocus={onFocus} onKeyPress={onKeyPress} />
    )
    const props = nativeProps(renderer)
    const ids = [
      props.transformWorklet,
      props.onChangeTextWorklet,
      props.onFocusChangeWorklet,
      props.onKeyPressWorklet,
    ] as number[]
    for (const id of ids) {
      expect(id).toBeGreaterThan(0)
      expect(registry().has(id)).toBe(true)
    }
    expect(new Set(ids).size).toBe(ids.length)
    // A handler that is not a worklet gets no id.
    expect(props.onChangeValueWorklet).toBe(0)
    expect(props.onSelectionChangeWorklet).toBe(0)
    act(() => renderer.unmount())
    for (const id of ids) expect(registry().has(id)).toBe(false)
  })

  it('keeps the id while the function stays the same and re-registers when it changes', () => {
    const first = asWorklet(() => {})
    const renderer = render(<NitroInput onChangeText={first} />)
    const id = nativeProps(renderer).onChangeTextWorklet as number
    act(() => {
      renderer.update(<NitroInput onChangeText={first} placeholder="changed" />)
    })
    expect(nativeProps(renderer).onChangeTextWorklet).toBe(id)
    const second = asWorklet(() => {})
    act(() => {
      renderer.update(<NitroInput onChangeText={second} />)
    })
    const next = nativeProps(renderer).onChangeTextWorklet as number
    expect(next).not.toBe(id)
    expect(registry().has(id)).toBe(false)
    expect(registry().get(next)).toBe(second)
  })

  it('does not also call a worklet handler on the JS thread', () => {
    const onChangeText = asWorklet(jest.fn())
    const renderer = render(<NitroInput onChangeText={onChangeText} />)
    const native = nativeProps(renderer).onChangeText as { f: (t: string, c: number) => void }
    act(() => native.f('abc', 1))
    expect(onChangeText).not.toHaveBeenCalled()
  })
})
