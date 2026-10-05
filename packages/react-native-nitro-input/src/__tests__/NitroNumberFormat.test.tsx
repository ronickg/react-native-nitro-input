import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { NitroNumber } from '../NitroNumber'
import type { NumberFormat } from '../NumberFormat'
import type { NumberFigure, NumberFormatLayout } from '../specs/NumberFormat.nitro'
import { withMinorDigits } from '../formatProps'

// No native formatter in Jest. What it shows per value (rounding modes,
// trailingZeroDisplay, compact notation) is checked in C++
// (NumberFormatCoreTest) and on device (number-format.harness); here a fake
// stands in for it, to check what NitroNumber does with its answers.
jest.mock('../NumberFormat', () => ({
  ...jest.requireActual('../NumberFormat'),
  figureOf: (format: FakeFormat, value: unknown) => format.figure(value),
  layoutOf: (format: FakeFormat) => format.layout(),
}))

type FakeFormat = NumberFormat & { figure: jest.Mock<NumberFigure, [unknown]>; layout: () => NumberFormatLayout }

const USD_LAYOUT: NumberFormatLayout = {
  prefix: '$',
  suffix: '',
  groupingSeparator: ',',
  decimalSeparator: '.',
  signAfterAffix: false,
  minusSign: '-',
  groupingSizes: [3, 3],
  digitGlyphs: [],
}

/** A USD format whose native figure for each value is `figures[String(value)]`. */
function usd(figures: Record<string, Pick<NumberFigure, 'value' | 'fractionDigits'>>): FakeFormat {
  return {
    resolvedOptions: () => ({ maximumFractionDigits: 2, minimumIntegerDigits: 1, signDisplay: 'auto', notation: 'standard' }),
    layout: () => USD_LAYOUT,
    figure: jest.fn((value: unknown) => {
      const figure = figures[String(value)]
      if (!figure) throw new Error(`no figure for ${String(value)}`)
      return { ...figure, prefix: '$', suffix: '' }
    }),
  } as unknown as FakeFormat
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

describe('NitroNumber with a format', () => {
  it('sends the figure the native formatter reads for each value', () => {
    const format = usd({ '1234': { value: 1234, fractionDigits: 0 }, '2.125': { value: 2.12, fractionDigits: 2 } })
    const renderer = render(<NitroNumber format={format} value={1234} />)
    expect(nativeProps(renderer)).toMatchObject({ value: 1234, fractionDigits: 0, prefix: '$' })

    act(() => renderer.update(<NitroNumber format={format} value="2.125" />))
    expect(format.figure).toHaveBeenLastCalledWith('2.125')
    expect(nativeProps(renderer)).toMatchObject({ value: 2.12, fractionDigits: 2 })
  })

  it('takes money as minor units, a bigint passed straight in', () => {
    const format = usd({ '1234.56': { value: 1234.56, fractionDigits: 2 }, '1000.00': { value: 1000, fractionDigits: 0 } })
    const renderer = render(<NitroNumber format={format} value={123456n} minorDigits={2} />)
    // Shifted as text: the formatter rounds the exact decimal.
    expect(format.figure).toHaveBeenLastCalledWith('1234.56')
    expect(nativeProps(renderer)).toMatchObject({ value: 1234.56, fractionDigits: 2 })

    act(() => renderer.update(<NitroNumber format={format} value={100000n} minorDigits={2} />))
    expect(nativeProps(renderer)).toMatchObject({ value: 1000, fractionDigits: 0 })
  })

  it('lets fractionDigits hold every value to one count', () => {
    const format = usd({ '1234': { value: 1234, fractionDigits: 0 } })
    const renderer = render(<NitroNumber format={format} value={1234} fractionDigits={2} />)
    expect(nativeProps(renderer).fractionDigits).toBe(2)
  })

  it('takes a bigint without a format too, as a double for the engine', () => {
    const renderer = render(<NitroNumber value={123456n} minorDigits={2} fractionDigits={2} />)
    expect(nativeProps(renderer)).toMatchObject({ value: 1234.56, fractionDigits: 2 })
  })
})
