import { NitroModules } from 'react-native-nitro-modules'
import type {
  NitroNumberFormat,
  NitroNumberFormatFactory,
  NumberFormatOptions,
  NumberFormatPart,
  ResolvedNumberFormatOptions,
} from './specs/NumberFormat.nitro'

/**
 * A number formatter with the API of `Intl.NumberFormat`, formatted natively.
 *
 * The locale's format is learned once from the platform (Foundation on iOS,
 * ICU on Android, the same data Hermes' `Intl` uses) and every number after
 * that is formatted in C++, without calling into the platform. Formatters are
 * immutable and cached: building one with locales and options seen before
 * returns the same object, so there is no need to memoize them.
 *
 * ```ts
 * const php = new NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
 * php.format(1234.5) // "₱1,234.50"
 * php.formatToParts(-12) // works on iOS too
 * ```
 *
 * A formatter can be used in a worklet.
 */
export interface NumberFormat {
  /** Formats a number, a bigint, or a decimal string (exactly, without going through a double). */
  format(value: number | bigint | string): string
  formatToParts(value: number | bigint | string): NumberFormatPart[]
  resolvedOptions(): ResolvedNumberFormatOptions
}

export interface NumberFormatConstructor {
  new (locales?: string | readonly string[], options?: NumberFormatOptions): NumberFormat
  (locales?: string | readonly string[], options?: NumberFormatOptions): NumberFormat
  /** The given locales that have number data, as `Intl.NumberFormat.supportedLocalesOf` returns them. */
  supportedLocalesOf(locales: string | readonly string[]): string[]
}

let factory: NitroNumberFormatFactory | undefined
function getFactory(): NitroNumberFormatFactory {
  factory ??= NitroModules.createHybridObject<NitroNumberFormatFactory>('NitroNumberFormatFactory')
  return factory
}

function toLocales(locales: string | readonly string[] | undefined): string[] {
  if (locales === undefined) return []
  return typeof locales === 'string' ? [locales] : [...locales]
}

function createNumberFormat(locales?: string | readonly string[], options?: NumberFormatOptions): NumberFormat {
  // The native formatter itself is returned (from `new` too), so calls go straight to C++.
  return getFactory().create(toLocales(locales), options ?? {}) as NitroNumberFormat as unknown as NumberFormat
}

export const NumberFormat = createNumberFormat as unknown as NumberFormatConstructor

NumberFormat.supportedLocalesOf = (locales) => getFactory().supportedLocalesOf(toLocales(locales))

Object.defineProperty(NumberFormat, Symbol.hasInstance, {
  value: (value: unknown) =>
    typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'NitroNumberFormat',
})
