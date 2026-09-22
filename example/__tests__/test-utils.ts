/**
 * The few helpers the on-device suites share. Tests otherwise set their
 * trees up inline, the way an app would.
 */

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
