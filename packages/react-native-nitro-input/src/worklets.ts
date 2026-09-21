import { NitroModules } from 'react-native-nitro-modules'
import type { NitroInputWorklets } from './specs/NitroInputWorklets.nitro'

/**
 * Optional integration with `react-native-worklets`: a `transform` worklet
 * and worklet `onChangeText` / `onChangeValue` handlers run synchronously on
 * the UI thread while the native input handles an edit (the way Expo UI's
 * worklet callbacks and react-native-transformer-text-input do), so a mask
 * written in JS applies before a frame is drawn and a shared value can be
 * updated without the JS thread.
 *
 * The native side gets the worklets UI runtime once (`install`), JS keeps the
 * registered worklets in a `Map` on that runtime under `__nitroInputWorklets`,
 * and the views call them by id.
 */

export interface NitroInputSelection {
  start: number
  end: number
}

/**
 * What a worklet handler is given. The same shape the JS handler gets, except
 * `target` is always 0 and `eventCount` 0 where native does not send one: both
 * are JS-thread bookkeeping with nothing to read on the UI runtime.
 */
export interface WorkletTextEvent {
  text: string
  target: number
  nativeEvent: { text: string; target: number }
}

export interface WorkletFocusEvent {
  text: string
  target: number
  eventCount: number
  nativeEvent: { text: string; target: number; eventCount: number }
}

export interface WorkletSelectionEvent {
  selection: NitroInputSelection
  start: number
  end: number
  target: number
  nativeEvent: { selection: NitroInputSelection; target: number }
}

export interface WorkletKeyPressEvent {
  key: string
  eventCount: number
  target: number
  nativeEvent: { key: string; eventCount: number; target: number }
}

/** A worklet that rewrites the text (and optionally the selection) after every edit. */
export type NitroInputTransform = (input: {
  text: string
  previousText: string
  selection: NitroInputSelection
  previousSelection: NitroInputSelection
}) =>
  | {
      text?: string | null
      selection?: NitroInputSelection | null
    }
  | null
  | undefined

type WorkletsModule = {
  executeOnUIRuntimeSync: <T>(worklet: () => T) => () => T
  runOnUI: <A extends unknown[]>(worklet: (...args: A) => void) => (...args: A) => void
  getUIRuntimeHolder: () => unknown
}

declare global {
  // eslint-disable-next-line no-var
  var __nitroInputWorklets: Map<number, (...args: never[]) => unknown> | undefined
}

let workletsModule: WorkletsModule | null | undefined
let hybrid: NitroInputWorklets | null = null
let installed = false
const warned = new Set<string>()
let nextId = 1

function loadWorklets(): WorkletsModule | null {
  if (workletsModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      workletsModule = require('react-native-worklets') as WorkletsModule
    } catch {
      workletsModule = null
    }
  }
  return workletsModule
}

/** True for a function compiled by the worklets Babel plugin (`'worklet'` directive). */
export function isWorklet(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as { __workletHash?: number }).__workletHash != null
}

/** Whether worklets can run: react-native-worklets installed and the native side built with it. */
export function ensureWorkletsInstalled(): boolean {
  if (installed) return true
  const worklets = loadWorklets()
  if (!worklets) return warnOnce('react-native-worklets is not installed')
  try {
    hybrid ??= NitroModules.createHybridObject<NitroInputWorklets>('NitroInputWorklets')
  } catch {
    return warnOnce('the native module is missing (rebuild the app)')
  }
  if (!hybrid.isAvailable) return warnOnce('the native code was built without react-native-worklets (reinstall pods / rebuild)')
  worklets.executeOnUIRuntimeSync(() => {
    'worklet'
    if (!globalThis.__nitroInputWorklets) globalThis.__nitroInputWorklets = new Map()
  })()
  const install = (hybrid as unknown as { install: (holder: unknown) => boolean }).install
  installed = install.call(hybrid, worklets.getUIRuntimeHolder()) === true
  if (!installed) return warnOnce('the worklets UI runtime could not be installed')
  return true
}

/** One warning per distinct reason: a later, different failure must not be swallowed. */
function warnOnce(reason: string): false {
  if (!warned.has(reason)) {
    warned.add(reason)
    console.warn(`[NitroInput] worklets are unavailable (${reason}); transform and worklet callbacks run nowhere.`)
  }
  return false
}

/** Where the caret lands when a transform returns no selection (react-native-transformer-text-input's rule). */
function defaultSelection(oldText: string, newText: string, start: number, end: number): NitroInputSelection {
  'worklet'
  const oldLength = oldText.length
  const newLength = newText.length
  const delta = newLength - oldLength
  let s: number
  let e: number
  if (start === end) {
    if (end >= oldLength) {
      s = newLength
      e = newLength
    } else {
      s = end + delta
      e = s
    }
  } else {
    s = start + delta
    e = end + delta
  }
  if (s < 0 || e < 0 || s > newLength || e > newLength || s > e) {
    return { start: newLength, end: newLength }
  }
  return { start: s, end: e }
}

/**
 * Reserves an id for a worklet that is about to be registered. Safe to call
 * during render: a render React throws away only burns an integer, where an
 * actual registration would leak an entry on the UI runtime.
 */
export function allocateWorkletId(): number {
  if (!ensureWorkletsInstalled()) return 0
  return nextId++
}

/**
 * Registers a `transform` worklet under `id`. Native calls the registered
 * wrapper with the edited text, the previous text and both selections (code
 * point offsets) and gets back the final text and selection.
 *
 * Registration is synchronous on purpose: `runOnUI` would land a tick later,
 * and an edit in that window (an autofocused field typed into immediately)
 * would find no worklet and silently skip the transform.
 */
export function registerTransform(transform: NitroInputTransform, id: number): void {
  if (id === 0 || !ensureWorkletsInstalled()) return
  const worklets = loadWorklets()!
  worklets.executeOnUIRuntimeSync(() => {
    'worklet'
    const wrapper = (
      text: string,
      previousText: string,
      selectionStart: number,
      selectionEnd: number,
      previousSelectionStart: number,
      previousSelectionEnd: number
    ) => {
      const result = transform({
        text,
        previousText,
        selection: { start: selectionStart, end: selectionEnd },
        previousSelection: { start: previousSelectionStart, end: previousSelectionEnd },
      })
      if (result == null) return null
      const nextText = result.text ?? text
      const selection = result.selection ?? defaultSelection(text, nextText, selectionStart, selectionEnd)
      return { text: nextText, selectionStart: selection.start, selectionEnd: selection.end }
    }
    globalThis.__nitroInputWorklets?.set(id, wrapper as (...args: never[]) => unknown)
  })()
}

/** Registers a worklet callback (`onChangeText` / `onChangeValue`) under `id`. */
export function registerCallback(callback: (arg: never) => void, id: number): void {
  if (id === 0 || !ensureWorkletsInstalled()) return
  const worklets = loadWorklets()!
  worklets.executeOnUIRuntimeSync(() => {
    'worklet'
    globalThis.__nitroInputWorklets?.set(id, callback as (...args: never[]) => unknown)
  })()
}

/**
 * Registers the pair of focus worklets under one id: native reports a single
 * focus change, and the wrapper picks the handler. Built on the UI runtime -
 * like `registerTransform` - so it needs no Babel pass of its own, and the
 * handlers it captures must themselves be worklets.
 *
 * The event is the one the JS handlers get, minus `target`: a react tag is a
 * JS-thread notion and there is nothing on the UI runtime to ask for it.
 */
export function registerFocusChange(
  onFocus: ((event: WorkletFocusEvent) => void) | undefined,
  onBlur: ((event: WorkletFocusEvent) => void) | undefined,
  id: number
): void {
  if (id === 0 || !ensureWorkletsInstalled()) return
  const worklets = loadWorklets()!
  worklets.executeOnUIRuntimeSync(() => {
    'worklet'
    const wrapper = (focused: boolean, text: string) => {
      const event = { text, target: 0, eventCount: 0, nativeEvent: { text, target: 0, eventCount: 0 } }
      if (focused) onFocus?.(event)
      else onBlur?.(event)
    }
    globalThis.__nitroInputWorklets?.set(id, wrapper as (...args: never[]) => unknown)
  })()
}

/** Registers an `onSelectionChange` worklet, given the two scalars native sends. */
export function registerSelectionChange(
  handler: (event: WorkletSelectionEvent) => void,
  id: number
): void {
  if (id === 0 || !ensureWorkletsInstalled()) return
  const worklets = loadWorklets()!
  worklets.executeOnUIRuntimeSync(() => {
    'worklet'
    const wrapper = (start: number, end: number) => {
      const selection = { start, end }
      handler({ selection, start, end, target: 0, nativeEvent: { selection, target: 0 } })
    }
    globalThis.__nitroInputWorklets?.set(id, wrapper as (...args: never[]) => unknown)
  })()
}

/** Registers an `onSubmitEditing` / `onEndEditing` worklet, given the text. */
export function registerTextEvent(handler: (event: WorkletTextEvent) => void, id: number): void {
  if (id === 0 || !ensureWorkletsInstalled()) return
  const worklets = loadWorklets()!
  worklets.executeOnUIRuntimeSync(() => {
    'worklet'
    const wrapper = (text: string) => {
      handler({ text, target: 0, nativeEvent: { text, target: 0 } })
    }
    globalThis.__nitroInputWorklets?.set(id, wrapper as (...args: never[]) => unknown)
  })()
}

/** Registers an `onKeyPress` worklet, given the key. */
export function registerKeyPress(handler: (event: WorkletKeyPressEvent) => void, id: number): void {
  if (id === 0 || !ensureWorkletsInstalled()) return
  const worklets = loadWorklets()!
  worklets.executeOnUIRuntimeSync(() => {
    'worklet'
    const wrapper = (key: string) => {
      handler({ key, eventCount: 0, target: 0, nativeEvent: { key, eventCount: 0, target: 0 } })
    }
    globalThis.__nitroInputWorklets?.set(id, wrapper as (...args: never[]) => unknown)
  })()
}

/**
 * Removes a worklet. Asynchronous, unlike registration: nothing is waiting on
 * it, and stalling the JS thread on every unmount is the worse trade.
 */
export function unregisterWorklet(id: number): void {
  if (id === 0 || !installed) return
  const worklets = loadWorklets()
  if (!worklets) return
  worklets.runOnUI(() => {
    'worklet'
    globalThis.__nitroInputWorklets?.delete(id)
  })()
}
