/**
 * The few helpers the on-device suites share. Tests otherwise set their
 * trees up inline, the way an app would.
 */

import { PixelRatio } from 'react-native'
import { expect, render as harnessRender, waitFor as harnessWaitFor, type WaitForOptions } from 'react-native-harness'

/**
 * How long a tree gets to mount or re-render. Harness waits 1 s by default,
 * which a debug build on an emulator misses often enough, and on different
 * tests each run, to make the Android suites flaky (11 and 12 of 32, every
 * failure a render timeout). What a test asserts still decides it.
 */
const RENDER_TIMEOUT_MS = 5000

/** Harness's `render`, with a mount and re-render timeout an emulator can meet. */
export function render(...[element, options]: Parameters<typeof harnessRender>) {
  return harnessRender(element, { timeout: RENDER_TIMEOUT_MS, ...options })
}

/**
 * How long a wait for the device gets: a size reported back from native, an
 * event, a state settling. Harness's 1 s default is the same trap as its
 * render timeout: on a slow CI machine (a hosted macOS runner once took 337 s
 * for the iOS suites that usually take 100-260 s) four waits for a first
 * size or a focus ran out, on the new tests of a run whose code passed
 * everywhere else. A wait that is met returns as soon as it is.
 */
const WAIT_TIMEOUT_MS = 5000

/** Harness's `waitFor`, with a timeout a slow CI machine can meet. */
export function waitFor<T>(callback: () => T | Promise<T>, options: number | WaitForOptions = {}): Promise<T> {
  const given = typeof options === 'number' ? { timeout: options } : options
  return harnessWaitFor(callback, { ...given, timeout: Math.max(given.timeout ?? 0, WAIT_TIMEOUT_MS) })
}

/**
 * A Promise with its resolve / reject exposed, for feeding a callback into
 * something a test can `await`.
 */
export function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Rejects with `label` if `promise` has not settled within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer != null) clearTimeout(timer)
  }
}

/** Waits for wall-clock time an animation is known to take (a roll, a reveal). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * `a` and `b`, two lengths from `onLayout`, within one physical pixel. React
 * Native snaps a view's edges to whole pixels, so two views of the same size
 * at different positions can measure a pixel apart, and at a density like the
 * Galaxy A22's 1.875 a pixel is more than the half point `toBeCloseTo(x, 0)`
 * allows.
 */
export function expectSameLength(a: number, b: number) {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(1 / PixelRatio.get() + 0.01)
}
