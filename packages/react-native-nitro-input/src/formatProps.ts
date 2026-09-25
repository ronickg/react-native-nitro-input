import { NumberFormat, sharedFormatterOf } from './NumberFormat'

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
  /** Compact notation: the prefix, suffix and digits follow the value (`compactParts`). */
  compact: boolean
}

const NUMBER_PARTS = new Set(['integer', 'group', 'decimal', 'fraction'])
// By the native formatter, which instances built with the same locales and options share.
const cache = new WeakMap<object, FormatProps>()

type Part = { type: string; value: string }

function join(parts: Part[], from: number, to: number): string {
  return parts
    .slice(from, to)
    .map((p) => p.value)
    .join('')
}

/** The text before and after the number in `parts`. */
function affixes(parts: Part[]): { prefix: string; suffix: string } {
  const first = parts.findIndex((p) => NUMBER_PARTS.has(p.type))
  let last = first
  parts.forEach((p, i) => {
    if (NUMBER_PARTS.has(p.type)) last = i
  })
  // The sign is the component's own glyph, not part of an affix.
  const unsigned = (from: number, to: number) =>
    join(
      parts.map((p) => (p.type === 'minusSign' || p.type === 'plusSign' ? { ...p, value: '' } : p)),
      from,
      to
    )
  return {
    prefix: first < 0 ? '' : unsigned(0, first),
    suffix: first < 0 ? '' : unsigned(last + 1, parts.length),
  }
}

/**
 * The prefix, suffix, separators and digit counts of `format`, read off its
 * parts once and cached per formatter. The components keep their own model
 * (a sign, a prefix, digits in groups, a suffix), so a format outside it
 * (accounting parentheses, a unit between the digits) is followed as far as
 * that model goes.
 */
export function formatProps(format: NumberFormat): FormatProps {
  const key = sharedFormatterOf(format) ?? format
  const cached = cache.get(key)
  if (cached) return cached
  const resolved = format.resolvedOptions()
  const compact = resolved.notation === 'compact'
  const fractionDigits = resolved.maximumFractionDigits ?? 0
  // A value with every part: groups, and a fraction when the format has one.
  // Compact notation would print it "1.2M", so its affixes come per value.
  const parts = format.formatToParts(compact ? 1 : fractionDigits > 0 ? 1234567.5 : 1234567) as Part[]
  const negative = format.formatToParts(-1) as Part[]
  const minus = negative.findIndex((p) => p.type === 'minusSign')
  const currency = negative.findIndex((p) => p.type === 'currency' || p.type === 'percentSign')
  const integers = parts.filter((p) => p.type === 'integer').map((p) => p.value.length)
  const props: FormatProps = {
    ...affixes(parts),
    groupingSeparator: parts.find((p) => p.type === 'group')?.value ?? '',
    decimalSeparator: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    fractionDigits,
    minimumIntegerDigits: resolved.minimumIntegerDigits,
    signPlacement: minus >= 0 && currency >= 0 && minus > currency ? 'afterAffix' : 'beforeAffix',
    signDisplay: (resolved.signDisplay ?? 'auto') as FormatProps['signDisplay'],
    minusSign: negative[minus]?.value ?? '-',
    plusSign: '+',
    digitGlyphs: digitGlyphsOf(resolved.locale, resolved.numberingSystem),
    // "12,34,567": the last group is the first size, the one before it every later one.
    groupingSizes: integers.length >= 3 ? [integers[integers.length - 1]!, integers[integers.length - 2]!] : [3],
    compact,
  }
  cache.set(key, props)
  return props
}

const digitGlyphCache = new Map<string, string[]>()

/** The ten digits of a numbering system, or [] for Latin ones. */
function digitGlyphsOf(locale: string, numberingSystem: string | undefined): string[] {
  if (!numberingSystem || numberingSystem === 'latn') return []
  const cached = digitGlyphCache.get(numberingSystem)
  if (cached) return cached
  const digits = new NumberFormat(locale, { numberingSystem, useGrouping: false })
  const glyphs = Array.from({ length: 10 }, (_, d) => digits.format(d))
  const result = glyphs.every((g, d) => g === String(d)) ? [] : glyphs
  digitGlyphCache.set(numberingSystem, result)
  return result
}

/** What a compact format shows for one value: the figure to roll and the text around it. */
export interface CompactParts {
  /** The figure as the digits show it: 1.2 for "1.2K". */
  value: number
  fractionDigits: number
  prefix: string
  suffix: string
}

/**
 * Compact notation's parts for `value`: "1.2K" is the figure 1.2 with the
 * suffix "K", so the digits roll and the suffix swaps as the value crosses
 * a thousand, a million…
 */
export function compactParts(format: NumberFormat, value: number): CompactParts {
  const parts = format.formatToParts(value) as Part[]
  const props = formatProps(format)
  const latin = (text: string) =>
    props.digitGlyphs.length === 10
      ? Array.from(text)
          .map((c) => {
            const d = props.digitGlyphs.indexOf(c)
            return d >= 0 ? String(d) : c
          })
          .join('')
      : text
  const integer = latin(parts.filter((p) => p.type === 'integer').map((p) => p.value).join(''))
  const fraction = latin(parts.filter((p) => p.type === 'fraction').map((p) => p.value).join(''))
  const magnitude = Number(fraction ? `${integer}.${fraction}` : integer)
  return {
    value: (value < 0 ? -1 : 1) * (Number.isFinite(magnitude) ? magnitude : 0),
    fractionDigits: fraction.length,
    ...affixes(parts),
  }
}
