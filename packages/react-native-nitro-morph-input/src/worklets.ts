import { NitroModules } from 'react-native-nitro-modules'
import type { MorphWorklets } from './specs/MorphWorklets.nitro'

/**
 * Optional integration with `react-native-worklets`: a `transform` worklet
 * and worklet `onChangeText` / `onChangeValue` handlers run synchronously on
 * the UI thread while the native input handles an edit (the way Expo UI's
 * worklet callbacks and react-native-transformer-text-input do), so a mask
 * written in JS applies before a frame is drawn and a shared value can be
 * updated without the JS thread.
 *
 * The native side gets the worklets UI runtime once (`install`), JS keeps the
 * registered worklets in a `Map` on that runtime under `__morphInputWorklets`,
 * and the views call them by id.
 */

export interface MorphSelection {
  start: number
  end: number
}

/** A worklet that rewrites the text (and optionally the selection) after every edit. */
export type MorphTransform = (input: {
  text: string
  previousText: string
  selection: MorphSelection
  previousSelection: MorphSelection
}) =>
  | {
      text?: string | null
      selection?: MorphSelection | null
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
  var __morphInputWorklets: Map<number, (...args: never[]) => unknown> | undefined
}

let workletsModule: WorkletsModule | null | undefined
let hybrid: MorphWorklets | null = null
let installed = false
let warned = false
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
    hybrid ??= NitroModules.createHybridObject<MorphWorklets>('MorphWorklets')
  } catch {
    return warnOnce('the native module is missing (rebuild the app)')
  }
  if (!hybrid.isAvailable) return warnOnce('the native code was built without react-native-worklets (reinstall pods / rebuild)')
  worklets.executeOnUIRuntimeSync(() => {
    'worklet'
    if (!globalThis.__morphInputWorklets) globalThis.__morphInputWorklets = new Map()
  })()
  const install = (hybrid as unknown as { install: (holder: unknown) => boolean }).install
  installed = install.call(hybrid, worklets.getUIRuntimeHolder()) === true
  if (!installed) return warnOnce('the worklets UI runtime could not be installed')
  return true
}

function warnOnce(reason: string): false {
  if (!warned) {
    warned = true
    console.warn(`[MorphInput] worklets are unavailable (${reason}); transform and worklet callbacks run nowhere.`)
  }
  return false
}

/** Where the caret lands when a transform returns no selection (react-native-transformer-text-input's rule). */
function defaultSelection(oldText: string, newText: string, start: number, end: number): MorphSelection {
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
 * Registers a `transform` worklet; returns its id (0 when worklets are
 * unavailable). Native calls the registered wrapper with the edited text, the
 * previous text and both selections (code point offsets) and gets back the
 * final text and selection.
 */
export function registerTransform(transform: MorphTransform): number {
  if (!ensureWorkletsInstalled()) return 0
  const worklets = loadWorklets()!
  const id = nextId++
  worklets.runOnUI(() => {
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
    globalThis.__morphInputWorklets?.set(id, wrapper as (...args: never[]) => unknown)
  })()
  return id
}

/** Registers a worklet callback (`onChangeText` / `onChangeValue`); returns its id (0 when unavailable). */
export function registerCallback(callback: (arg: never) => void): number {
  if (!ensureWorkletsInstalled()) return 0
  const worklets = loadWorklets()!
  const id = nextId++
  worklets.runOnUI(() => {
    'worklet'
    globalThis.__morphInputWorklets?.set(id, callback as (...args: never[]) => unknown)
  })()
  return id
}

export function unregisterWorklet(id: number): void {
  if (id === 0 || !installed) return
  const worklets = loadWorklets()
  if (!worklets) return
  worklets.runOnUI(() => {
    'worklet'
    globalThis.__morphInputWorklets?.delete(id)
  })()
}
