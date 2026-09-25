import { sharedFormatterOf, type NumberFormat } from './NumberFormat'

/** What `NitroNumber` and `NitroInput` take from a `NumberFormat` through their `format` prop. */
export interface FormatProps {
  prefix: string
  suffix: string
  groupingSeparator: string
  decimalSeparator: string
  /** The digits after the decimal separator: the format's maximum. */
  fractionDigits: number
  minimumIntegerDigits: number
  /** Whether a negative amount's sign comes before the prefix ("-$5") or after it ("$-5"). */
  signPlacement: 'beforeAffix' | 'afterAffix'
}

const NUMBER_PARTS = new Set(['integer', 'group', 'decimal', 'fraction'])
// By the native formatter, which instances built with the same locales and options share.
const cache = new WeakMap<object, FormatProps>()

/**
 * The prefix, suffix, separators and digit counts of `format`, read off its
 * parts once and cached per formatter. The components keep their own model
 * (a sign, a prefix, digits grouped in threes, a suffix), so a format outside
 * it (Indian grouping, native digits, accounting parentheses) is followed as
 * far as that model goes.
 */
export function formatProps(format: NumberFormat): FormatProps {
  const key = sharedFormatterOf(format) ?? format
  const cached = cache.get(key)
  if (cached) return cached
  const resolved = format.resolvedOptions()
  const fractionDigits = resolved.maximumFractionDigits ?? 0
  // A value with every part: groups, and a fraction when the format has one.
  const parts = format.formatToParts(fractionDigits > 0 ? 1234567.5 : 1234567)
  const first = parts.findIndex((p) => NUMBER_PARTS.has(p.type))
  let last = first
  parts.forEach((p, i) => {
    if (NUMBER_PARTS.has(p.type)) last = i
  })
  const text = (from: number, to: number) =>
    parts
      .slice(from, to)
      .map((p) => p.value)
      .join('')
  const negative = format.formatToParts(-1)
  const minus = negative.findIndex((p) => p.type === 'minusSign')
  const currency = negative.findIndex((p) => p.type === 'currency' || p.type === 'percentSign')
  const props: FormatProps = {
    prefix: first < 0 ? '' : text(0, first),
    suffix: first < 0 ? '' : text(last + 1, parts.length),
    groupingSeparator: parts.find((p) => p.type === 'group')?.value ?? '',
    decimalSeparator: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    fractionDigits,
    minimumIntegerDigits: resolved.minimumIntegerDigits,
    signPlacement: minus >= 0 && currency >= 0 && minus > currency ? 'afterAffix' : 'beforeAffix',
  }
  cache.set(key, props)
  return props
}
