import { layoutOf, sharedFormatterOf, type NumberFormat } from './NumberFormat'

export { figureOf } from './NumberFormat'

/** What `NitroNumber` and `NitroInput` take from a `NumberFormat` through their `format` prop. */
export interface FormatProps {
  prefix: string
  suffix: string
  groupingSeparator: string
  decimalSeparator: string
  /**
   * The digits after the decimal separator: the format's maximum. What one
   * value shows can be fewer (`trailingZeroDisplay`, a minimum below the
   * maximum): `figureOf` says per value.
   */
  fractionDigits: number
  minimumIntegerDigits: number
  /** Whether a negative amount's sign comes before the prefix ("-$5") or after it ("$-5"). */
  signPlacement: 'beforeAffix' | 'afterAffix'
  /** Which values carry a sign, as the format's `signDisplay`. */
  signDisplay: 'auto' | 'always' | 'exceptZero' | 'negative' | 'never'
  /** The minus sign the locale writes ("-", or "−" in Swedish and Finnish). */
  minusSign: string
  /** The plus sign the locale writes. */
  plusSign: string
  /** The glyphs for 0…9 in the format's numbering system; empty for Latin digits. */
  digitGlyphs: string[]
  /** The first digit group and every later one, from the decimal point ([3, 2]: 12,34,567). */
  groupingSizes: number[]
  /** Compact notation: the prefix, suffix and digits follow the value (`figureOf`). */
  compact: boolean
}

// By the native formatter, which instances built with the same locales and options share.
const cache = new WeakMap<object, FormatProps>()

/**
 * The prefix, suffix, separators and digit counts of `format`, read in C++
 * off its parts once and cached per formatter. The components keep their own
 * model (a sign, a prefix, digits in groups, a suffix), so a format outside it
 * (accounting parentheses, a unit between the digits) is followed as far as
 * that model goes.
 */
export function formatProps(format: NumberFormat): FormatProps {
  const key = sharedFormatterOf(format) ?? format
  const cached = cache.get(key)
  if (cached) return cached
  const resolved = format.resolvedOptions()
  const layout = layoutOf(format)
  const props: FormatProps = {
    prefix: layout.prefix,
    suffix: layout.suffix,
    groupingSeparator: layout.groupingSeparator,
    decimalSeparator: layout.decimalSeparator,
    fractionDigits: resolved.maximumFractionDigits ?? 0,
    minimumIntegerDigits: resolved.minimumIntegerDigits,
    signPlacement: layout.signAfterAffix ? 'afterAffix' : 'beforeAffix',
    signDisplay: (resolved.signDisplay ?? 'auto') as FormatProps['signDisplay'],
    minusSign: layout.minusSign,
    plusSign: '+',
    digitGlyphs: layout.digitGlyphs,
    groupingSizes: layout.groupingSizes,
    compact: resolved.notation === 'compact',
  }
  cache.set(key, props)
  return props
}

/** A value as `NumberFormat` takes it: a number, a bigint or a decimal string. */
export type NumericInput = number | bigint | string

/**
 * `value` read in units of 10^-`minorDigits`, exactly: 123456n with 2 minor
 * digits is "1234.56". A bigint or a numeric string is shifted as text, so no
 * digit goes through a double: a decimal ("1234.5"), one with an exponent
 * ("1e5" becomes "1e3"), or a 0x / 0o / 0b integer, as `Intl.NumberFormat`
 * reads strings. A number that is a safe integer is shifted the same way, any
 * other number is divided. A string that is not a number ("1,234.56") comes
 * back as it is, which the format shows as NaN, never as a wrong amount.
 */
export function withMinorDigits(value: NumericInput, minorDigits: number | undefined): NumericInput {
  const digits = minorDigits === undefined ? 0 : Math.max(0, Math.trunc(minorDigits))
  if (digits === 0) return value
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return value / 10 ** digits
    value = BigInt(value)
  }
  let text = typeof value === 'bigint' ? value.toString() : value.trim()
  if (/^0[xob][0-9a-f]+$/i.test(text)) {
    // A non-decimal integer: BigInt reads it as Intl does, exactly.
    text = BigInt(text).toString()
  }
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (!match || (match[2] === '' && match[3] === undefined && text !== '')) return value
  const [, sign = '', whole = '', fraction = '', exponent] = match
  if (whole === '' && fraction === '' && text.includes('.')) return value
  if (exponent !== undefined) {
    // Moving the point is moving the exponent.
    return `${sign}${whole}${fraction ? `.${fraction}` : ''}e${Number(exponent) - digits}`
  }
  const all = (whole + fraction).padStart(digits + fraction.length + 1, '0')
  const point = all.length - fraction.length - digits
  return `${sign}${all.slice(0, point)}.${all.slice(point)}`
}

/** `value` as a double, for comparisons and for the engine when there is no format. */
export function toNumber(value: NumericInput): number {
  return typeof value === 'number' ? value : Number(value)
}
