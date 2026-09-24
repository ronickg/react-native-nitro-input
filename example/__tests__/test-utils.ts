/**
 * The few helpers the on-device suites share. Tests otherwise set their
 * trees up inline, the way an app would.
 */

import { PixelRatio } from 'react-native'
import { expect, render as harnessRender } from 'react-native-harness'

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
