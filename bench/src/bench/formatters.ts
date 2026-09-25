import { NumberFormat } from 'react-native-nitro-input'

/**
 * Number formatters measured by the `format` scenarios: what an app pays to
 * build a formatter and to format with it, per call, on the JS thread.
 */

export type FormatOp = 'construct' | 'format' | 'formatToParts' | 'toLocaleString'
export const FORMAT_OPS: FormatOp[] = ['construct', 'format', 'formatToParts', 'toLocaleString']

type Options = Intl.NumberFormatOptions
type Formatter = { format(value: number): string; formatToParts?(value: number): unknown[] }

export type FormatImplKey = 'intl' | 'nitro'
export type FormatImpl = {
  key: FormatImplKey
  label: string
  create(locale: string, options: Options): Formatter
  /** `Number.prototype.toLocaleString`, or its equivalent: a formatter built and used for one call. */
  toLocaleString(value: number, locale: string, options: Options): string
}

export const FORMAT_IMPLS: FormatImpl[] = [
  {
    key: 'intl',
    label: 'Intl.NumberFormat (Hermes)',
    create: (locale, options) => new Intl.NumberFormat(locale, options),
    toLocaleString: (value, locale, options) => value.toLocaleString(locale, options),
  },
  {
    key: 'nitro',
    label: 'NumberFormat (react-native-nitro-input)',
    create: (locale, options) => new NumberFormat(locale, options as never),
    toLocaleString: (value, locale, options) => new NumberFormat(locale, options as never).format(value),
  },
]

/**
 * The setups every op cycles through: the currencies of a payments app, the
 * Indian grouping, a currency without decimals and a plain decimal with a
 * narrow-space grouping separator.
 */
export const FORMAT_CASES: { locale: string; options: Options }[] = [
  { locale: 'en-US', options: { style: 'currency', currency: 'USD' } },
  { locale: 'en-PH', options: { style: 'currency', currency: 'PHP' } },
  { locale: 'de-DE', options: { style: 'currency', currency: 'EUR' } },
  { locale: 'en-IN', options: { style: 'currency', currency: 'INR' } },
  { locale: 'ja-JP', options: { style: 'currency', currency: 'JPY' } },
  { locale: 'fr-FR', options: { maximumFractionDigits: 2 } },
]

/** Amounts from cents to millions, negative ones included, fixed so every run formats the same values. */
export const FORMAT_VALUES: number[] = (() => {
  let seed = 42
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  return Array.from({ length: 512 }, () => {
    const magnitude = 10 ** Math.floor(random() * 8)
    const value = Math.round(random() * magnitude * 100) / 100
    return random() < 0.1 ? -value : value
  })
})()
