/**
 * On-device checks of `NumberFormat`: it prints what `Intl.NumberFormat`
 * prints. Hermes formats with the same platform formatter (Foundation on iOS,
 * ICU on Android) the native formatter learns its locale data from, so for
 * the options Hermes supports the two must agree character for character.
 * For the options Hermes leaves out (rounding modes, increments, sign display
 * on iOS…) and where Hermes departs from ECMA-402, the expected strings are
 * V8's (Node 26, ICU 78).
 */
import { Platform } from 'react-native'
import { describe, expect, it } from 'react-native-harness'
import { NumberFormat, type NumberFormatOptions } from 'react-native-nitro-input'
// The components' internals, which the package does not export.
import { figureOf, formatProps, withMinorDigits } from '../../packages/react-native-nitro-input/src/formatProps'

const LOCALES = [
  'en-US', 'en-GB', 'en-IN', 'en-PH', 'fil-PH', 'de-DE', 'de-CH', 'fr-FR', 'es-ES', 'es-MX', 'it-IT', 'pt-BR', 'nl-NL', 'sv-SE', 'pl-PL',
  'ru-RU', 'tr-TR', 'ja-JP', 'zh-CN', 'ko-KR', 'hi-IN', 'th-TH', 'id-ID', 'ar-EG', 'he-IL',
]

const OPTIONS: NumberFormatOptions[] = [
  {},
  { maximumFractionDigits: 0 },
  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  { style: 'currency', currency: 'USD' },
  { style: 'currency', currency: 'EUR' },
  { style: 'currency', currency: 'PHP' },
  { style: 'currency', currency: 'JPY' },
  { style: 'currency', currency: 'INR' },
  { style: 'currency', currency: 'BHD' },
  { style: 'currency', currency: 'USD', currencyDisplay: 'code' },
  { style: 'currency', currency: 'EUR', currencySign: 'accounting' },
  { style: 'percent' },
  { style: 'percent', minimumFractionDigits: 1 },
  { maximumSignificantDigits: 3 },
  { minimumSignificantDigits: 3, maximumSignificantDigits: 5 },
  { useGrouping: false },
  { minimumIntegerDigits: 3 },
]

// No ties at a rounding position and no NaN or infinities: there Hermes on iOS
// departs from ECMA-402 (it rounds ties to even on the binary double, so 1.005
// prints 1.00, and prints NaN and ±∞ without the pattern's affixes). Those are
// checked against V8 below instead.
const VALUES = [0, -0, 1, -1, 7.25, 1234.56, -1234.5678, 12345.678, 1234567.891, 0.000123, 1e21]

// Hermes on Android shows a currency's narrow symbol in zh-CN ("$1.00" for
// USD, where CLDR and V8 say "US$1.00"); checked against V8 below.
const hermesDeviates = (locale: string, options: NumberFormatOptions) =>
  Platform.OS === 'android' && locale === 'zh-CN' && options.style === 'currency' && (options.currencyDisplay ?? 'symbol') === 'symbol'

/** Parts as "type:value" strings: Hermes lists `value` before `type`. */
const partsText = (parts: { type: string; value: string }[]) => parts.map((p) => `${p.type}:${p.value}`).join(' ')

describe('NumberFormat', () => {
  it('prints what Intl.NumberFormat prints, across locales, styles and digit options', () => {
    const mismatches: string[] = []
    for (const locale of LOCALES) {
      for (const options of OPTIONS) {
        if (hermesDeviates(locale, options)) continue
        const ours = new NumberFormat(locale, options)
        const intl = new Intl.NumberFormat(locale, options as Intl.NumberFormatOptions)
        for (const value of VALUES) {
          const a = ours.format(value)
          const b = intl.format(value)
          if (a !== b) mismatches.push(`${locale} ${JSON.stringify(options)} ${value}: ${JSON.stringify(a)} vs Intl ${JSON.stringify(b)}`)
        }
      }
    }
    if (mismatches.length > 0) throw new Error(`${mismatches.length} mismatches\n${mismatches.slice(0, 60).join('\n')}`)
  })

  it('resolves the same options as Intl.NumberFormat', () => {
    for (const locale of ['en-US', 'de-DE', 'ja-JP']) {
      for (const options of OPTIONS) {
        const ours = new NumberFormat(locale, options).resolvedOptions()
        const intl = new Intl.NumberFormat(locale, options as Intl.NumberFormatOptions).resolvedOptions()
        expect({ locale: ours.locale, style: ours.style, min: ours.minimumFractionDigits, max: ours.maximumFractionDigits }).toEqual({
          locale: intl.locale,
          style: intl.style,
          min: intl.minimumFractionDigits,
          max: intl.maximumFractionDigits,
        })
      }
    }
  })

  it('splits into the parts Intl.NumberFormat reports', () => {
    const parts = new NumberFormat('en-US', { style: 'currency', currency: 'USD' }).formatToParts(-1234.5)
    expect(parts).toEqual([
      { type: 'minusSign', value: '-' },
      { type: 'currency', value: '$' },
      { type: 'integer', value: '1' },
      { type: 'group', value: ',' },
      { type: 'integer', value: '234' },
      { type: 'decimal', value: '.' },
      { type: 'fraction', value: '50' },
    ])
    // Where Hermes has formatToParts (Android), every locale and option agrees with it.
    const intlParts = (Intl.NumberFormat.prototype as { formatToParts?: unknown }).formatToParts
    if (Platform.OS !== 'android' || typeof intlParts !== 'function') return
    const mismatches: string[] = []
    for (const locale of LOCALES) {
      for (const options of OPTIONS) {
        if (hermesDeviates(locale, options)) continue
        const ours = new NumberFormat(locale, options)
        const intl = new Intl.NumberFormat(locale, options as Intl.NumberFormatOptions)
        for (const value of VALUES) {
          const a = partsText(ours.formatToParts(value))
          const b = partsText(intl.formatToParts(value))
          if (a !== b) mismatches.push(`${locale} ${JSON.stringify(options)} ${value}: ${a} vs Intl ${b}`)
        }
      }
    }
    if (mismatches.length > 0) throw new Error(`${mismatches.length} mismatches\n${mismatches.slice(0, 30).join('\n')}`)
  })

  it('follows ECMA-402 for the options Hermes does not implement (V8 output, en-US)', () => {
    const cases: [NumberFormatOptions, [number, string][]][] = [
      [{ roundingMode: 'halfEven', maximumFractionDigits: 0 }, [[0.5, '0'], [1.5, '2'], [2.5, '2'], [-2.5, '-2']]],
      [{ roundingMode: 'ceil', maximumFractionDigits: 0 }, [[2.1, '3'], [-2.9, '-2']]],
      [{ roundingMode: 'floor', maximumFractionDigits: 0 }, [[2.9, '2'], [-2.1, '-3']]],
      [{ roundingMode: 'trunc', maximumFractionDigits: 1 }, [[1.99, '1.9'], [-1.99, '-1.9']]],
      [{ roundingMode: 'expand', maximumFractionDigits: 1 }, [[1.01, '1.1'], [-1.01, '-1.1']]],
      [{ roundingMode: 'halfTrunc', maximumFractionDigits: 0 }, [[2.5, '2'], [-2.5, '-2'], [2.51, '3']]],
      [{ roundingMode: 'halfCeil', maximumFractionDigits: 0 }, [[2.5, '3'], [-2.5, '-2']]],
      [{ roundingMode: 'halfFloor', maximumFractionDigits: 0 }, [[2.5, '2'], [-2.5, '-3']]],
      [{ style: 'currency', currency: 'USD', roundingIncrement: 5, minimumFractionDigits: 2, maximumFractionDigits: 2 }, [[1.22, '$1.20'], [1.225, '$1.25'], [1.275, '$1.30'], [0.03, '$0.05']]],
      [{ roundingIncrement: 25, minimumFractionDigits: 2, maximumFractionDigits: 2 }, [[1.13, '1.25'], [1.12, '1.00']]],
      [{ signDisplay: 'always' }, [[5, '+5'], [0, '+0'], [-0, '-0'], [-5, '-5']]],
      [{ signDisplay: 'exceptZero' }, [[5, '+5'], [0, '0'], [-0, '0'], [-5, '-5'], [0.0001, '0']]],
      [{ signDisplay: 'negative' }, [[5, '5'], [-0, '0'], [-5, '-5']]],
      [{ signDisplay: 'never', style: 'currency', currency: 'EUR' }, [[-5, '€5.00']]],
      [{ style: 'currency', currency: 'USD', currencySign: 'accounting' }, [[-5, '($5.00)'], [5, '$5.00']]],
      [{ style: 'currency', currency: 'USD', currencySign: 'accounting', signDisplay: 'always' }, [[5, '+$5.00'], [-5, '($5.00)']]],
      [{ trailingZeroDisplay: 'stripIfInteger', minimumFractionDigits: 2 }, [[5, '5'], [5.1, '5.10']]],
      [{ useGrouping: 'min2' }, [[1234, '1234'], [12345, '12,345']]],
      [{ maximumSignificantDigits: 2, maximumFractionDigits: 1, roundingPriority: 'morePrecision' }, [[1.23456, '1.2'], [0.0123, '0.012']]],
      [{ maximumSignificantDigits: 2, maximumFractionDigits: 1, roundingPriority: 'lessPrecision' }, [[0.0123, '0'], [123.45, '120']]],
      // Ties round half away from zero, on the decimal the double stands for.
      [{ maximumFractionDigits: 0 }, [[0.5, '1'], [1234.5, '1,235'], [-2.5, '-3']]],
      [{ style: 'currency', currency: 'USD' }, [[1.005, '$1.01'], [999.995, '$1,000.00'], [0.125, '$0.13']]],
      [{ style: 'currency', currency: 'JPY' }, [[1234.5, '¥1,235']]],
      [{ maximumSignificantDigits: 3 }, [[1.005, '1.01']]],
      // NaN and infinities wear the pattern's affixes.
      [{}, [[NaN, 'NaN'], [Infinity, '∞'], [-Infinity, '-∞']]],
      [{ style: 'currency', currency: 'USD' }, [[NaN, '$NaN'], [Infinity, '$∞'], [-Infinity, '-$∞']]],
      [{ style: 'percent' }, [[NaN, 'NaN%'], [Infinity, '∞%'], [-Infinity, '-∞%']]],
      [{ style: 'currency', currency: 'USD', currencySign: 'accounting' }, [[-Infinity, '($∞)']]],
      // Compact notation keeps the currency, the percent sign and signDisplay's plus.
      [{ style: 'currency', currency: 'USD', notation: 'compact' }, [[950, '$950'], [1500, '$1.5K'], [-1500, '-$1.5K'], [2_300_000, '$2.3M']]],
      [{ style: 'currency', currency: 'USD', notation: 'compact', signDisplay: 'exceptZero' }, [[1500, '+$1.5K'], [0, '$0']]],
      [{ style: 'percent', notation: 'compact' }, [[0.5, '50%'], [12345, '1.2M%']]],
      [{ notation: 'compact', signDisplay: 'always' }, [[1500, '+1.5K']]],
    ]
    const mismatches: string[] = []
    const zh: [NumberFormatOptions, [number, string][]][] = [
      [{ style: 'currency', currency: 'USD' }, [[1, 'US$1.00']]],
      [{ style: 'currency', currency: 'JPY' }, [[1, 'JP¥1']]],
      [{ style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' }, [[1, '$1.00']]],
    ]
    const de: [NumberFormatOptions, [number, string][]][] = [
      [{ style: 'currency', currency: 'EUR', notation: 'compact' }, [[1_500_000, '1,5\u00a0Mio.\u00a0€']]],
    ]
    for (const [options, expected] of de) {
      const f = new NumberFormat('de-DE', options)
      for (const [value, text] of expected) {
        const got = f.format(value)
        if (got !== text) mismatches.push(`de-DE ${JSON.stringify(options)} ${value}: ${JSON.stringify(got)}, expected ${JSON.stringify(text)}`)
      }
    }
    for (const [options, expected] of zh) {
      const f = new NumberFormat('zh-CN', options)
      for (const [value, text] of expected) {
        const got = f.format(value)
        if (got !== text) mismatches.push(`zh-CN ${JSON.stringify(options)} ${value}: ${JSON.stringify(got)}, expected ${JSON.stringify(text)}`)
      }
    }
    for (const [options, expected] of cases) {
      const f = new NumberFormat('en-US', options)
      for (const [value, text] of expected) {
        const got = f.format(value)
        if (got !== text) mismatches.push(`${JSON.stringify(options)} ${value}: ${JSON.stringify(got)}, expected ${JSON.stringify(text)}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('formats bigints and decimal strings exactly', () => {
    const f = new NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    expect(f.format(9223372036854775807n)).toBe('$9,223,372,036,854,775,807.00')
    expect(f.format(-9223372036854775808n)).toBe('-$9,223,372,036,854,775,808.00')
    expect(f.format('12345678901234567890.125')).toBe('$12,345,678,901,234,567,890.13')
    expect(f.format('1.005')).toBe('$1.01')
  })

  it('is shaped like Intl.NumberFormat', () => {
    const a = new NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    expect(a instanceof NumberFormat).toBe(true)
    expect(Object.prototype.toString.call(a)).toBe('[object Intl.NumberFormat]')
    // Callable without new, and `format` is bound.
    const b = (NumberFormat as unknown as (l: string) => typeof a)('en-US')
    expect([1234.5, 2].map(b.format)).toEqual(['1,234.5', '2'])
    expect(b.formatRange(3, 5)).toBe('3–5')
    expect(a.formatRange(3, 5)).toBe('$3.00 – $5.00')
    expect(a.formatRange(2.999, 3.001)).toBe('~$3.00')
    // Options are coerced as Intl coerces them.
    expect(new NumberFormat('en-US', { maximumFractionDigits: '1' as unknown as number }).format(1.25)).toBe('1.3')
  })

  it('rejects what Intl.NumberFormat rejects', () => {
    expect(() => new NumberFormat('en-US', { style: 'currency' })).toThrow()
    expect(() => new NumberFormat('en-US', { style: 'currency', currency: 'US' })).toThrow()
    expect(() => new NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 1 })).toThrow()
    expect(() => new NumberFormat('en-US', { maximumFractionDigits: 101 })).toThrow()
  })
})

// The components' reading of a format (`figureOf`, `formatProps`), done in C++
// since 0.3.8. The reference below is the JS it replaced, run on the same
// parts: the two must agree for every locale, option and value.
type Part = { type: string; value: string }
const NUMBER_PARTS = new Set(['integer', 'group', 'decimal', 'fraction'])

function referenceAffixes(parts: Part[]) {
  const first = parts.findIndex((p) => NUMBER_PARTS.has(p.type))
  let last = first
  parts.forEach((p, i) => {
    if (NUMBER_PARTS.has(p.type)) last = i
  })
  const text = (from: number, to: number) =>
    parts
      .slice(from, to)
      .map((p) => (p.type === 'minusSign' || p.type === 'plusSign' ? '' : p.value))
      .join('')
  return { prefix: first < 0 ? '' : text(0, first), suffix: first < 0 ? '' : text(last + 1, parts.length) }
}

function referenceFigure(format: NumberFormat, value: number | bigint | string, glyphs: string[]) {
  const parts = format.formatToParts(value) as Part[]
  const latin = (text: string) =>
    glyphs.length === 10 ? Array.from(text).map((c) => (glyphs.indexOf(c) >= 0 ? String(glyphs.indexOf(c)) : c)).join('') : text
  const integer = latin(parts.filter((p) => p.type === 'integer').map((p) => p.value).join(''))
  const fraction = latin(parts.filter((p) => p.type === 'fraction').map((p) => p.value).join(''))
  const magnitude = Number(fraction ? `${integer}.${fraction}` : integer)
  const negative = typeof value === 'bigint' ? value < 0n : typeof value === 'string' ? value.trim().startsWith('-') : value < 0
  if (integer === '' || !Number.isFinite(magnitude)) {
    return { value: 0, fractionDigits: format.resolvedOptions().maximumFractionDigits ?? 0, ...referenceAffixes(parts) }
  }
  return { value: magnitude === 0 ? 0 : (negative ? -1 : 1) * magnitude, fractionDigits: fraction.length, ...referenceAffixes(parts) }
}

describe('NumberFormat, as the components read it', () => {
  const FIGURE_OPTIONS: NumberFormatOptions[] = [
    ...OPTIONS,
    { style: 'currency', currency: 'USD', trailingZeroDisplay: 'stripIfInteger' },
    { style: 'currency', currency: 'USD', roundingMode: 'halfEven' },
    { minimumFractionDigits: 0, maximumFractionDigits: 3 },
    { notation: 'compact' },
    { style: 'currency', currency: 'EUR', notation: 'compact' },
  ]
  const FIGURE_VALUES: (number | bigint | string)[] = [...VALUES, NaN, -Infinity, '2.125', '-0.004', '1234.00', 123456n, -98765n, 999999]

  it('reads the figure the format prints, as the JS reading did', () => {
    const mismatches: string[] = []
    for (const locale of LOCALES) {
      for (const options of FIGURE_OPTIONS) {
        const format = new NumberFormat(locale, options)
        const glyphs = formatProps(format).digitGlyphs
        for (const value of FIGURE_VALUES) {
          const ours = figureOf(format, value)
          const expected = referenceFigure(format, value, glyphs)
          const a = JSON.stringify({ ...ours, value: Object.is(ours.value, -0) ? '-0' : ours.value })
          const b = JSON.stringify({ ...expected, value: Object.is(expected.value, -0) ? '-0' : expected.value })
          if (a !== b) mismatches.push(`${locale} ${JSON.stringify(options)} ${String(value)}: ${a} vs ${b}`)
        }
      }
    }
    if (mismatches.length > 0) throw new Error(`${mismatches.length} mismatches\n${mismatches.slice(0, 30).join('\n')}`)
  })

  it('reads the layout of the format, as the JS reading did', () => {
    const mismatches: string[] = []
    for (const locale of LOCALES) {
      for (const options of FIGURE_OPTIONS) {
        const format = new NumberFormat(locale, options)
        const resolved = format.resolvedOptions()
        const compact = resolved.notation === 'compact'
        const max = resolved.maximumFractionDigits ?? 0
        const parts = format.formatToParts(compact ? 1 : max > 0 ? 1234567.5 : 1234567) as Part[]
        const negative = format.formatToParts(-1) as Part[]
        const minus = negative.findIndex((p) => p.type === 'minusSign')
        const currency = negative.findIndex((p) => p.type === 'currency' || p.type === 'percentSign')
        const integers = parts.filter((p) => p.type === 'integer').map((p) => Array.from(p.value).length)
        const expected = {
          ...referenceAffixes(parts),
          groupingSeparator: parts.find((p) => p.type === 'group')?.value ?? '',
          decimalSeparator: parts.find((p) => p.type === 'decimal')?.value ?? '.',
          signPlacement: minus >= 0 && currency >= 0 && minus > currency ? 'afterAffix' : 'beforeAffix',
          minusSign: negative[minus]?.value ?? '-',
          groupingSizes: integers.length >= 3 ? [integers[integers.length - 1], integers[integers.length - 2]] : [3],
        }
        const props = formatProps(format)
        const ours = {
          prefix: props.prefix,
          suffix: props.suffix,
          groupingSeparator: props.groupingSeparator,
          decimalSeparator: props.decimalSeparator,
          signPlacement: props.signPlacement,
          minusSign: props.minusSign,
          groupingSizes: props.groupingSizes,
        }
        if (JSON.stringify(ours) !== JSON.stringify(expected)) {
          mismatches.push(`${locale} ${JSON.stringify(options)}: ${JSON.stringify(ours)} vs ${JSON.stringify(expected)}`)
        }
        // The digits it prints are the ones it says it prints.
        if (props.digitGlyphs.length > 0 && !format.format(1234567890).split('').every((c) => !/[0-9]/.test(c))) {
          mismatches.push(`${locale} ${JSON.stringify(options)}: Latin digits printed with glyphs ${props.digitGlyphs.join('')}`)
        }
      }
    }
    if (mismatches.length > 0) throw new Error(`${mismatches.length} mismatches\n${mismatches.slice(0, 30).join('\n')}`)
  })

  it('rounds the exact decimal, the format\'s way', () => {
    const usd = new NumberFormat('en-US', { style: 'currency', currency: 'USD', roundingMode: 'halfEven', maximumFractionDigits: 0 })
    expect(figureOf(usd, '2.50')).toMatchObject({ value: 2, fractionDigits: 0, prefix: '$' })
    expect(figureOf(usd, '3.50')).toMatchObject({ value: 4, fractionDigits: 0 })
    expect(figureOf(new NumberFormat('en-US', { style: 'currency', currency: 'USD' }), '1.005').value).toBe(1.01)
    expect(Object.is(figureOf(new NumberFormat('en-US', { style: 'currency', currency: 'USD' }), '-0.004').value, -0)).toBe(false)
    // Minor units given as an exponent or a hex string reach the formatter shifted, exactly.
    const cents = new NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    expect(figureOf(cents, withMinorDigits('1.2345e5', 2))).toMatchObject({ value: 1234.5, fractionDigits: 2 })
    expect(figureOf(cents, withMinorDigits('0x10', 2)).value).toBe(0.16)
    expect(figureOf(cents, withMinorDigits('1,234.56', 2)).value).toBe(0)
  })
})
