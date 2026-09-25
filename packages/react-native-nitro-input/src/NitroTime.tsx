import React, { forwardRef } from 'react'
import { NitroNumber, type NitroNumberHandle, type NitroNumberProps } from './NitroNumber'

/** How a {@link NitroTime} lays the time out. */
export type NitroTimeFormat = 'm:ss' | 'mm:ss' | 'h:mm:ss' | 'hh:mm:ss'

export interface NitroTimeProps
  extends Omit<
    NitroNumberProps,
    | 'value'
    | 'digits'
    | 'groupingSizes'
    | 'groupingSeparator'
    | 'minimumIntegerDigits'
    | 'fractionDigits'
    | 'decimalSeparator'
    | 'format'
  > {
  /** The time in whole seconds (a timer's elapsed time, a countdown's remaining one). Negatives show as 0. */
  seconds: number
  /** Default: `'m:ss'`. Without hours the minutes run past 59 (125:00). */
  timeFormat?: NitroTimeFormat
  /** Between the fields. Default: `':'`. */
  separator?: string
}

const LAYOUT: Record<NitroTimeFormat, { hours: boolean; digits: number }> = {
  'm:ss': { hours: false, digits: 3 },
  'mm:ss': { hours: false, digits: 4 },
  'h:mm:ss': { hours: true, digits: 5 },
  'hh:mm:ss': { hours: true, digits: 6 },
}

// The tens of seconds, and of minutes when hours are shown, wrap after 5.
const SECONDS = { 1: { max: 5 } }
const MINUTES_AND_SECONDS = { 1: { max: 5 }, 3: { max: 5 } }
// One separator before the seconds: 125:00 is 125 minutes, not 1:25:00.
const MINUTES_ONLY = [2, 0]
const PAIRS = [2]

/**
 * A clock, a timer or a countdown: `NitroNumber` with the time as its figure
 * (12:34:56 is 123456), grouped in pairs, and the tens of seconds and minutes
 * wrapping after 5, so 0:59 → 1:00 turns them one step, as a clock's wheels
 * do, instead of rolling back through 4, 3, 2, 1.
 */
export const NitroTime = forwardRef<NitroNumberHandle, NitroTimeProps>(function NitroTime(
  { seconds, timeFormat = 'm:ss', separator = ':', ...props },
  ref
) {
  const layout = LAYOUT[timeFormat]
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const s = total % 60
  const value = layout.hours
    ? Math.floor(total / 3600) * 10000 + (Math.floor(total / 60) % 60) * 100 + s
    : Math.floor(total / 60) * 100 + s
  return (
    <NitroNumber
      ref={ref}
      value={value}
      minimumIntegerDigits={layout.digits}
      groupingSeparator={separator}
      groupingSizes={layout.hours ? PAIRS : MINUTES_ONLY}
      digits={layout.hours ? MINUTES_AND_SECONDS : SECONDS}
      {...props}
    />
  )
})
