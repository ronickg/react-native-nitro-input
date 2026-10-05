import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { NitroNumber } from '../NitroNumber'
import type { NumberFormat } from '../NumberFormat'
import { figureOf, withMinorDigits } from '../formatProps'

// No native formatter in Jest: the platform's Intl.NumberFormat stands in for
// it, which is what NumberFormat follows (rounding modes and
// trailingZeroDisplay included).
function intl(locale: string, options: Intl.NumberFormatOptions & Record<string, unknown>): NumberFormat {
  const real = new Intl.NumberFormat(locale, options)
  return {
    format: (value: number | bigint | string) => real.format(value as never),
    formatToParts: (value: number | bigint | string) => real.formatToParts(value as never),
    resolvedOptions: () => real.resolvedOptions(),
  } as unknown as NumberFormat
}

function nativeProps(renderer: ReactTestRenderer) {
  return renderer.root.findByType('NitroNumberView' as never).props
}

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(element)
  })
  return renderer
}

const usd = (options: Record<string, unknown> = {}) => intl('en-US', { style: 'currency', currency: 'USD', ...options })

describe('withMinorDigits', () => {
  it('shifts a bigint, a decimal string and a safe integer exactly', () => {
    expect(withMinorDigits(123456n, 2)).toBe('1234.56')
    expect(withMinorDigits(-5n, 2)).toBe('-0.05')
    expect(withMinorDigits(5n, 0)).toBe(5n)
    expect(withMinorDigits('12.5', 2)).toBe('0.125')
    expect(withMinorDigits(7, 3)).toBe('0.007')
    expect(withMinorDigits(123456789012345678901234567890n, 2)).toBe('1234567890123456789012345678.90')
  })

  it('divides a number that is not a safe integer', () => {
    expect(withMinorDigits(12.5, 1)).toBe(1.25)
  })
})

describe('figureOf', () => {
  it('shows the fraction digits the format prints for each value (trailingZeroDisplay)', () => {
    const format = usd({ trailingZeroDisplay: 'stripIfInteger' })
    expect(figureOf(format, 1234)).toMatchObject({ value: 1234, fractionDigits: 0 })
    expect(figureOf(format, 1234.5)).toMatchObject({ value: 1234.5, fractionDigits: 2 })
    expect(figureOf(format, '1234.00')).toMatchObject({ value: 1234, fractionDigits: 0 })
  })

  it('shows fewer digits when the minimum is below the maximum', () => {
    const format = intl('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
    expect(figureOf(format, 1.5)).toMatchObject({ value: 1.5, fractionDigits: 1 })
    expect(figureOf(format, 1.25)).toMatchObject({ value: 1.25, fractionDigits: 2 })
    expect(figureOf(format, 2)).toMatchObject({ value: 2, fractionDigits: 0 })
  })

  it('rounds with the format\'s roundingMode, on the exact decimal', () => {
    expect(figureOf(usd({ roundingMode: 'halfEven' }), '2.125').value).toBe(2.12)
    expect(figureOf(usd({ roundingMode: 'halfEven' }), '2.135').value).toBe(2.14)
    expect(figureOf(usd(), '2.125').value).toBe(2.13)
    // 1.005 is 1.00499999… as a double: only a decimal input rounds it up.
    expect(figureOf(usd(), '1.005').value).toBe(1.01)
    expect(figureOf(usd({ roundingMode: 'trunc' }), '-2.129').value).toBe(-2.12)
  })

  it('rounds minor units the format\'s way without a double in between', () => {
    expect(figureOf(usd({ maximumFractionDigits: 0, roundingMode: 'halfEven' }), withMinorDigits(250n, 2)).value).toBe(2)
    expect(figureOf(usd({ maximumFractionDigits: 0, roundingMode: 'halfEven' }), withMinorDigits(350n, 2)).value).toBe(4)
  })

  it('carries no minus for a value that rounds to nothing', () => {
    const shown = figureOf(usd(), '-0.004').value
    expect(shown).toBe(0)
    expect(Object.is(shown, -0)).toBe(false)
    expect(figureOf(usd(), -0.5).value).toBe(-0.5)
  })

  it('keeps compact notation: the figure and its suffix', () => {
    const figure = figureOf(intl('en-US', { notation: 'compact' }), 1234)
    expect(figure).toMatchObject({ value: 1.2, fractionDigits: 1, suffix: 'K' })
  })
})

describe('NitroNumber with a format', () => {
  it('sends the figure the format prints, rounded and trimmed per value', () => {
    const format = usd({ trailingZeroDisplay: 'stripIfInteger', roundingMode: 'halfEven' })
    const renderer = render(<NitroNumber format={format} value={1234} />)
    expect(nativeProps(renderer)).toMatchObject({ value: 1234, fractionDigits: 0, prefix: '$' })

    act(() => renderer.update(<NitroNumber format={format} value="2.125" />))
    expect(nativeProps(renderer)).toMatchObject({ value: 2.12, fractionDigits: 2 })
  })

  it('takes money as minor units, a bigint passed straight in', () => {
    const format = usd({ trailingZeroDisplay: 'stripIfInteger' })
    const renderer = render(<NitroNumber format={format} value={123456n} minorDigits={2} />)
    expect(nativeProps(renderer)).toMatchObject({ value: 1234.56, fractionDigits: 2 })

    act(() => renderer.update(<NitroNumber format={format} value={100000n} minorDigits={2} />))
    expect(nativeProps(renderer)).toMatchObject({ value: 1000, fractionDigits: 0 })
  })

  it('lets fractionDigits hold every value to one count', () => {
    const format = usd({ trailingZeroDisplay: 'stripIfInteger' })
    const renderer = render(<NitroNumber format={format} value={1234} fractionDigits={2} />)
    expect(nativeProps(renderer).fractionDigits).toBe(2)
  })

  it('takes a bigint without a format too, as a double for the engine', () => {
    const renderer = render(<NitroNumber value={123456n} minorDigits={2} fractionDigits={2} />)
    expect(nativeProps(renderer)).toMatchObject({ value: 1234.56, fractionDigits: 2 })
  })
})
