import type { HybridObject, Int64 } from 'react-native-nitro-modules'

// The option types of `Intl.NumberFormat` (ECMA-402), for the native `NumberFormat`.

export type NumberFormatStyle = 'decimal' | 'currency' | 'percent' | 'unit'
export type NumberFormatCurrencyDisplay = 'symbol' | 'narrowSymbol' | 'code' | 'name'
export type NumberFormatCurrencySign = 'standard' | 'accounting'
export type NumberFormatUnitDisplay = 'short' | 'narrow' | 'long'
export type NumberFormatNotation = 'standard' | 'scientific' | 'engineering' | 'compact'
export type NumberFormatCompactDisplay = 'short' | 'long'
export type NumberFormatSignDisplay = 'auto' | 'never' | 'always' | 'exceptZero' | 'negative'
export type NumberFormatRoundingMode = 'ceil' | 'floor' | 'expand' | 'trunc' | 'halfCeil' | 'halfFloor' | 'halfExpand' | 'halfTrunc' | 'halfEven'
export type NumberFormatRoundingPriority = 'auto' | 'morePrecision' | 'lessPrecision'
export type NumberFormatTrailingZeroDisplay = 'auto' | 'stripIfInteger'
export type NumberFormatGrouping = 'always' | 'auto' | 'min2'

/** `Intl.NumberFormatOptions`, less `localeMatcher` (the lookup matcher is always used). */
export interface NumberFormatOptions {
  numberingSystem?: string
  style?: NumberFormatStyle
  currency?: string
  currencyDisplay?: NumberFormatCurrencyDisplay
  currencySign?: NumberFormatCurrencySign
  unit?: string
  unitDisplay?: NumberFormatUnitDisplay
  minimumIntegerDigits?: number
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  minimumSignificantDigits?: number
  maximumSignificantDigits?: number
  roundingPriority?: NumberFormatRoundingPriority
  roundingIncrement?: number
  roundingMode?: NumberFormatRoundingMode
  trailingZeroDisplay?: NumberFormatTrailingZeroDisplay
  notation?: NumberFormatNotation
  compactDisplay?: NumberFormatCompactDisplay
  useGrouping?: boolean | NumberFormatGrouping
  signDisplay?: NumberFormatSignDisplay
}

/** `Intl.ResolvedNumberFormatOptions`. */
export interface ResolvedNumberFormatOptions {
  locale: string
  numberingSystem: string
  style: NumberFormatStyle
  currency?: string
  currencyDisplay?: NumberFormatCurrencyDisplay
  currencySign?: NumberFormatCurrencySign
  unit?: string
  unitDisplay?: NumberFormatUnitDisplay
  minimumIntegerDigits: number
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  minimumSignificantDigits?: number
  maximumSignificantDigits?: number
  useGrouping: boolean | NumberFormatGrouping
  notation: NumberFormatNotation
  compactDisplay?: NumberFormatCompactDisplay
  signDisplay: NumberFormatSignDisplay
  roundingIncrement: number
  roundingMode: NumberFormatRoundingMode
  roundingPriority: NumberFormatRoundingPriority
  trailingZeroDisplay: NumberFormatTrailingZeroDisplay
}

/** One piece of a formatted number, as `Intl.NumberFormat#formatToParts` reports it. */
export interface NumberFormatPart {
  type: string
  value: string
}

/**
 * A number formatter with the API of `Intl.NumberFormat`. It learns a
 * locale's format once from the platform (Foundation on iOS, ICU on Android)
 * and formats in C++ from then on, without calling into the platform per
 * number. Instances are immutable and shared: the same locales and options
 * return the same object.
 */
export interface NitroNumberFormat extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  format(value: number | Int64 | string): string
  formatToParts(value: number | Int64 | string): NumberFormatPart[]
  resolvedOptions(): ResolvedNumberFormatOptions
}

export interface NitroNumberFormatFactory extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  create(locales: string[], options: NumberFormatOptions): NitroNumberFormat
  supportedLocalesOf(locales: string[]): string[]
}

// ---------------------------------------------------------------------------
// The platform side, used by the C++ formatter only: builds the system's own
// formatter for a configuration, so C++ can learn the locale's format from it,
// and formats with it where C++ does not (compact and scientific notation,
// units, currency names).

export interface NumberFormatPlatformOptions {
  locales: string[]
  numberingSystem?: string
  style: NumberFormatStyle
  currency?: string
  currencyDisplay: NumberFormatCurrencyDisplay
  currencySign: NumberFormatCurrencySign
  unit?: string
  unitDisplay: NumberFormatUnitDisplay
  notation: NumberFormatNotation
  compactDisplay: NumberFormatCompactDisplay
  useGrouping: boolean
  minimumIntegerDigits: number
  minimumFractionDigits: number
  maximumFractionDigits: number
  /** 0 when significant digits are not used. */
  minimumSignificantDigits: number
  maximumSignificantDigits: number
  roundingMode: NumberFormatRoundingMode
  signDisplay: NumberFormatSignDisplay
}

export interface NumberFormatPlatformSymbols {
  /** The locale the platform resolved the request to, as a BCP 47 tag. */
  locale: string
  numberingSystem: string
  minusSign: string
  plusSign: string
  percentSign: string
  /** The currency as this formatter shows it (symbol, narrow symbol or code). */
  currency: string
  /** The locale's symbol for NaN. */
  nan: string
  /** The locale's symbol for infinity, without a sign. */
  infinity: string
  /** The "E" of scientific notation. */
  exponentSeparator: string
}

export interface NitroPlatformNumberFormatter extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  readonly symbols: NumberFormatPlatformSymbols
  format(value: number): string
  /** A decimal string, formatted without going through a double. */
  formatDecimal(value: string): string
}

export interface NitroNumberFormatPlatform extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  create(options: NumberFormatPlatformOptions): NitroPlatformNumberFormatter
  supportedLocalesOf(locales: string[]): string[]
}
