import { useCallback, useEffect, useState } from 'react'

/**
 * A log that outlives navigation, so the sequence of keyboard, focus and screen
 * events can be read across a push and a pop as one timeline.
 */
export interface KbEvent {
  id: number
  at: number
  source: 'kb' | 'field' | 'screen'
  text: string
}

let nextId = 1
let t0: number | null = null
let events: KbEvent[] = []
const listeners = new Set<() => void>()

declare const performance: { now(): number }

export function logKb(source: KbEvent['source'], text: string) {
  const now = performance.now()
  if (t0 == null) t0 = now
  events = [{ id: nextId++, at: Math.round(now - t0), source, text }, ...events].slice(0, 80)
  listeners.forEach(l => l())
}

export function clearKbLog() {
  t0 = null
  events = []
  listeners.forEach(l => l())
}

export function useKbLog(): KbEvent[] {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force(n => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return events
}

export function useKbLogActions() {
  return { log: useCallback(logKb, []), clear: useCallback(clearKbLog, []) }
}
