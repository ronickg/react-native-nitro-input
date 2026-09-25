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
 * that is formatted in C++, without calling into the platform. Building a
 * formatter with locales and options seen before reuses the native one, so
 * there is no need to memoize them.
 *
 * ```ts
 * const php = new NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
 * php.format(1234.5) // "₱1,234.50"
 * php.formatToParts(-12) // works on iOS too
 * ```
 *
 * It behaves as ECMA-402 specifies `Intl.NumberFormat` (options are read,
 * coerced and checked in the specified order, `format` is a bound getter,
 * `NumberFormat()` works without `new`), and is checked against test262.
 */
export interface NumberFormat {
  /** Formats a number, a bigint, or a decimal string (exactly, without going through a double). A bound function: `values.map(nf.format)` works. */
  readonly format: (value: number | bigint | string) => string
  formatToParts(value: number | bigint | string): NumberFormatPart[]
  formatRange(start: number | bigint | string, end: number | bigint | string): string
  formatRangeToParts(start: number | bigint | string, end: number | bigint | string): NumberFormatRangePart[]
  resolvedOptions(): ResolvedNumberFormatOptions
}

export interface NumberFormatRangePart extends NumberFormatPart {
  source: 'startRange' | 'endRange' | 'shared'
}

export interface NumberFormatConstructor {
  new (locales?: string | readonly string[], options?: NumberFormatOptions): NumberFormat
  (locales?: string | readonly string[], options?: NumberFormatOptions): NumberFormat
  readonly prototype: NumberFormat
  /** The given locales that have number data, as `Intl.NumberFormat.supportedLocalesOf` returns them. */
  supportedLocalesOf(locales: string | readonly string[], options?: { localeMatcher?: 'lookup' | 'best fit' }): string[]
}

// MARK: - The native side

let factory: NitroNumberFormatFactory | undefined
function getFactory(): NitroNumberFormatFactory {
  factory ??= NitroModules.createHybridObject<NitroNumberFormatFactory>('NitroNumberFormatFactory')
  return factory
}

/** Native formatters by locales and resolved options: building one twice is a Map lookup. */
const natives = new Map<string, NitroNumberFormat>()
const MAX_NATIVES = 512

// MARK: - ECMA-402 abstract operations

/** ToString, which (unlike `String()`) throws for a Symbol. */
const toString = (value: unknown): string => `${value as string}`

/** ToNumber, which throws for a Symbol and a BigInt. */
const toNumber = (value: unknown): number => +(value as number)

function getOption<T extends string>(options: Record<string, unknown>, property: string, values: readonly T[] | null, fallback: T): T
function getOption<T extends string>(options: Record<string, unknown>, property: string, values: readonly T[] | null, fallback: undefined): T | undefined
function getOption<T extends string>(options: Record<string, unknown>, property: string, values: readonly T[] | null, fallback: T | undefined): T | undefined {
  const value = options[property]
  if (value === undefined) return fallback
  const text = toString(value) as T
  if (values && !values.includes(text)) throw new RangeError(`Value ${text} out of range for Intl.NumberFormat options property ${property}`)
  return text
}

function defaultNumberOption(value: unknown, min: number, max: number, property: string): number | undefined {
  if (value === undefined) return undefined
  const n = toNumber(value)
  if (Number.isNaN(n) || n < min || n > max) throw new RangeError(`${property} value is out of range.`)
  return Math.floor(n)
}

function getNumberOption(options: Record<string, unknown>, property: string, min: number, max: number, fallback: number): number {
  return defaultNumberOption(options[property], min, max, property) ?? fallback
}

const isAlphanumeric = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)

/** A Unicode `type`: parts of 3 to 8 letters or digits. Without a RegExp: it would update the legacy RegExp statics. */
function isUnicodeType(value: string) {
  let part = 0
  for (let i = 0; i <= value.length; i++) {
    if (i === value.length || value.charCodeAt(i) === 45) {
      if (part < 3 || part > 8) return false
      part = 0
    } else if (isAlphanumeric(value.charCodeAt(i))) {
      part++
    } else {
      return false
    }
  }
  return true
}

const SANCTIONED_UNITS = new Set(
  'acre bit byte celsius centimeter day degree fahrenheit fluid-ounce foot gallon gigabit gigabyte gram hectare hour inch kilobit kilobyte kilogram kilometer liter megabit megabyte meter microsecond mile mile-scandinavian milliliter millimeter millisecond minute month nanosecond ounce percent petabyte pound second stone terabit terabyte week yard year'.split(
    ' ',
  ),
)
function isWellFormedUnit(unit: string) {
  if (SANCTIONED_UNITS.has(unit)) return true
  const per = unit.indexOf('-per-')
  return per > 0 && SANCTIONED_UNITS.has(unit.slice(0, per)) && SANCTIONED_UNITS.has(unit.slice(per + 5))
}

/** ISO 4217 minor-unit digits, as ECMA-402's CurrencyDigits. */
const CURRENCY_DIGITS: Record<string, number> = {
  BHD: 3, BIF: 0, CLF: 4, CLP: 0, DJF: 0, GNF: 0, IQD: 3, ISK: 0, JOD: 3, JPY: 0, KMF: 0, KRW: 0, KWD: 3,
  LYD: 3, OMR: 3, PYG: 0, RWF: 0, TND: 3, UGX: 0, UYI: 0, UYW: 4, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
}

const ROUNDING_INCREMENTS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000]

/** CanonicalizeLocaleList; each tag is checked and canonicalized by Hermes' `Intl.getCanonicalLocales`. */
function canonicalizeLocaleList(locales: unknown): string[] {
  if (locales === undefined) return []
  if (locales === null) throw new TypeError('Cannot convert null to object')
  const list = typeof locales === 'string' ? [locales] : (Object(locales) as Record<string, unknown>)
  const length = Math.min(Math.max(Math.floor(toNumber((list as { length?: unknown }).length)) || 0, 0), Number.MAX_SAFE_INTEGER)
  const seen: string[] = []
  for (let k = 0; k < length; k++) {
    const key = String(k)
    if (!(key in list)) continue
    const value = (list as Record<string, unknown>)[key]
    if (typeof value !== 'string' && (typeof value !== 'object' || value === null)) throw new TypeError('Language ID should be string or object.')
    const tag = Intl.getCanonicalLocales(toString(value))[0]!
    if (!seen.includes(tag)) seen.push(tag)
  }
  return seen
}

/** The `-u-nu-` of a tag, when it names a numbering system Intl accepts there. */
function unicodeNumberingSystem(tag: string | undefined): string | undefined {
  if (tag === undefined) return undefined
  const subtags = tag.toLowerCase().split('-')
  const u = subtags.indexOf('u')
  if (u < 0) return undefined
  for (let i = u + 1; i < subtags.length - 1; i++) {
    if (subtags[i]!.length === 1) break
    if (subtags[i] === 'nu') {
      const value = subtags[i + 1]!
      return value === 'native' || value === 'traditio' || value === 'finance' ? undefined : value
    }
  }
  return undefined
}

/** ToIntlMathematicalValue: numbers stay numbers; bigints and strings go to native as exact decimal text. */
function toMathematicalValue(value: unknown): number | string {
  let primitive = value
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') primitive = toPrimitiveNumber(value as object)
  if (typeof primitive === 'bigint') return primitive.toString()
  if (typeof primitive === 'string') return primitive
  return toNumber(primitive)
}

function toPrimitiveNumber(object: object): unknown {
  const exotic = (object as { [Symbol.toPrimitive]?: unknown })[Symbol.toPrimitive]
  if (exotic !== undefined && exotic !== null) {
    if (typeof exotic !== 'function') throw new TypeError('Symbol.toPrimitive is not a function')
    const result = exotic.call(object, 'number')
    if ((typeof result === 'object' && result !== null) || typeof result === 'function') throw new TypeError('Cannot convert object to primitive value')
    return result
  }
  for (const method of ['valueOf', 'toString'] as const) {
    const fn = (object as Record<string, unknown>)[method]
    if (typeof fn === 'function') {
      const result = fn.call(object)
      if (!((typeof result === 'object' && result !== null) || typeof result === 'function')) return result
    }
  }
  throw new TypeError('Cannot convert object to primitive value')
}

// MARK: - InitializeNumberFormat

const STYLES = ['decimal', 'percent', 'currency', 'unit'] as const
const CURRENCY_DISPLAYS = ['code', 'symbol', 'narrowSymbol', 'name'] as const
const CURRENCY_SIGNS = ['standard', 'accounting'] as const
const UNIT_DISPLAYS = ['short', 'narrow', 'long'] as const
const NOTATIONS = ['standard', 'scientific', 'engineering', 'compact'] as const
const ROUNDING_MODES = ['ceil', 'floor', 'expand', 'trunc', 'halfCeil', 'halfFloor', 'halfExpand', 'halfTrunc', 'halfEven'] as const
const ROUNDING_PRIORITIES = ['auto', 'morePrecision', 'lessPrecision'] as const
const TRAILING_ZERO_DISPLAYS = ['auto', 'stripIfInteger'] as const
const COMPACT_DISPLAYS = ['short', 'long'] as const
const SIGN_DISPLAYS = ['auto', 'never', 'always', 'exceptZero', 'negative'] as const

/** Reads `options` the way ECMA-402's InitializeNumberFormat does and returns the native formatter. */
function createNative(locales: unknown, optionsArgument: unknown): { native: NitroNumberFormat; localeNumberingSystem: string | undefined } {
  const requested = canonicalizeLocaleList(locales)
  // The numbering system of the locale's -u-nu-, when options do not override it.
  const localeNumberingSystem = unicodeNumberingSystem(requested[0])
  // CoerceOptionsToObject.
  if (optionsArgument === null) throw new TypeError('Cannot convert null to object')
  const options = (optionsArgument === undefined ? Object.create(null) : Object(optionsArgument)) as Record<string, unknown>

  getOption(options, 'localeMatcher', ['lookup', 'best fit'], 'best fit')
  const numberingSystem = getOption(options, 'numberingSystem', null, undefined)
  if (numberingSystem !== undefined && !isUnicodeType(numberingSystem)) throw new RangeError(`Invalid numberingSystem: ${numberingSystem}`)

  // SetNumberFormatUnitOptions.
  const style = getOption(options, 'style', STYLES, 'decimal')
  let currency = getOption(options, 'currency', null, undefined)
  if (currency === undefined) {
    if (style === 'currency') throw new TypeError('Currency code is required with currency style.')
  } else if (currency.length !== 3 || !isLetter(currency.charCodeAt(0)) || !isLetter(currency.charCodeAt(1)) || !isLetter(currency.charCodeAt(2))) {
    throw new RangeError(`Invalid currency code: ${currency}`)
  }
  const currencyDisplay = getOption(options, 'currencyDisplay', CURRENCY_DISPLAYS, 'symbol')
  const currencySign = getOption(options, 'currencySign', CURRENCY_SIGNS, 'standard')
  const unit = getOption(options, 'unit', null, undefined)
  if (unit === undefined) {
    if (style === 'unit') throw new TypeError('Unit is required with unit style.')
  } else if (!isWellFormedUnit(unit)) {
    throw new RangeError(`Invalid unit argument for Intl.NumberFormat() '${unit}'`)
  }
  const unitDisplay = getOption(options, 'unitDisplay', UNIT_DISPLAYS, 'short')
  if (currency !== undefined) currency = currency.toUpperCase()

  const notation = getOption(options, 'notation', NOTATIONS, 'standard')
  let mnfdDefault = 0
  let mxfdDefault = style === 'percent' ? 0 : 3
  if (style === 'currency' && notation === 'standard') mnfdDefault = mxfdDefault = CURRENCY_DIGITS[currency!] ?? 2

  // SetNumberFormatDigitOptions.
  const minimumIntegerDigits = getNumberOption(options, 'minimumIntegerDigits', 1, 21, 1)
  const mnfdValue = options.minimumFractionDigits
  const mxfdValue = options.maximumFractionDigits
  const mnsdValue = options.minimumSignificantDigits
  const mxsdValue = options.maximumSignificantDigits
  const roundingIncrement = getNumberOption(options, 'roundingIncrement', 1, 5000, 1)
  if (!ROUNDING_INCREMENTS.includes(roundingIncrement)) throw new RangeError('roundingIncrement value is out of range.')
  const roundingMode = getOption(options, 'roundingMode', ROUNDING_MODES, 'halfExpand')
  const roundingPriority = getOption(options, 'roundingPriority', ROUNDING_PRIORITIES, 'auto')
  const trailingZeroDisplay = getOption(options, 'trailingZeroDisplay', TRAILING_ZERO_DISPLAYS, 'auto')
  if (roundingIncrement !== 1) mxfdDefault = mnfdDefault
  const hasSd = mnsdValue !== undefined || mxsdValue !== undefined
  const hasFd = mnfdValue !== undefined || mxfdValue !== undefined
  let needSd = true
  let needFd = true
  if (roundingPriority === 'auto') {
    needSd = hasSd
    if (needSd || (!hasFd && notation === 'compact')) needFd = false
  }
  let minimumSignificantDigits: number | undefined
  let maximumSignificantDigits: number | undefined
  if (needSd && hasSd) {
    minimumSignificantDigits = defaultNumberOption(mnsdValue, 1, 21, 'minimumSignificantDigits') ?? 1
    maximumSignificantDigits = defaultNumberOption(mxsdValue, minimumSignificantDigits, 21, 'maximumSignificantDigits') ?? 21
  }
  let minimumFractionDigits: number | undefined
  let maximumFractionDigits: number | undefined
  if (needFd && hasFd) {
    minimumFractionDigits = defaultNumberOption(mnfdValue, 0, 100, 'minimumFractionDigits')
    maximumFractionDigits = defaultNumberOption(mxfdValue, 0, 100, 'maximumFractionDigits')
    if (minimumFractionDigits === undefined) minimumFractionDigits = Math.min(mnfdDefault, maximumFractionDigits!)
    else if (maximumFractionDigits === undefined) maximumFractionDigits = Math.max(mxfdDefault, minimumFractionDigits)
    else if (minimumFractionDigits > maximumFractionDigits) throw new RangeError('maximumFractionDigits value is out of range.')
  }
  if (roundingIncrement !== 1) {
    const fractionOnly = !needSd && needFd
    if (!fractionOnly) throw new TypeError('roundingIncrement can only be used with fraction digits.')
    const mn = minimumFractionDigits ?? mnfdDefault
    const mx = maximumFractionDigits ?? mxfdDefault
    if (mn !== mx) throw new RangeError('maximumFractionDigits must equal minimumFractionDigits with a roundingIncrement.')
  }

  const compactDisplay = getOption(options, 'compactDisplay', COMPACT_DISPLAYS, 'short')
  // GetBooleanOrStringNumberFormatOption.
  const defaultUseGrouping = notation === 'compact' ? 'min2' : 'auto'
  let useGrouping: boolean | 'min2' | 'auto' | 'always'
  const groupingValue = options.useGrouping
  if (groupingValue === undefined) useGrouping = defaultUseGrouping
  else if (groupingValue === true) useGrouping = 'always'
  else if (!groupingValue) useGrouping = false
  else {
    const text = toString(groupingValue)
    if (text === 'true' || text === 'false') useGrouping = defaultUseGrouping
    else if (text === 'min2' || text === 'auto' || text === 'always') useGrouping = text
    else throw new RangeError(`Value ${text} out of range for Intl.NumberFormat options property useGrouping`)
  }
  const signDisplay = getOption(options, 'signDisplay', SIGN_DISPLAYS, 'auto')

  // Only what was read goes to native, already checked and coerced.
  const clean: NumberFormatOptions = {
    numberingSystem: numberingSystem?.toLowerCase() ?? localeNumberingSystem,
    style,
    currency,
    currencyDisplay,
    currencySign,
    unit,
    unitDisplay,
    notation,
    minimumIntegerDigits,
    minimumFractionDigits: needFd ? minimumFractionDigits : undefined,
    maximumFractionDigits: needFd ? maximumFractionDigits : undefined,
    minimumSignificantDigits: needSd ? minimumSignificantDigits : undefined,
    maximumSignificantDigits: needSd ? maximumSignificantDigits : undefined,
    roundingIncrement,
    roundingMode,
    roundingPriority,
    trailingZeroDisplay,
    compactDisplay,
    useGrouping,
    signDisplay,
  }
  const key =
    requested.join(',') +
    '|' +
    [
      clean.numberingSystem, style, currency, currencyDisplay, currencySign, unit, unitDisplay, notation, minimumIntegerDigits,
      clean.minimumFractionDigits, clean.maximumFractionDigits, clean.minimumSignificantDigits, clean.maximumSignificantDigits,
      roundingIncrement, roundingMode, roundingPriority, trailingZeroDisplay, compactDisplay, useGrouping, signDisplay,
    ].join('|')
  let native = natives.get(key)
  let fromLocale = numberingSystem === undefined ? localeNumberingSystem : undefined
  if (native === undefined) {
    // The numbering system travels as an option; native gets the tags without -u- extensions.
    const tags = requested.map(withoutUnicodeExtension)
    native = getFactory().create(tags, clean)
    // An option naming a numbering system the platform lacks is ignored for the locale's.
    if (numberingSystem !== undefined && localeNumberingSystem !== undefined && native.resolvedOptions().numberingSystem !== clean.numberingSystem) {
      native = getFactory().create(tags, { ...clean, numberingSystem: localeNumberingSystem })
    }
    if (natives.size >= MAX_NATIVES) natives.clear()
    natives.set(key, native)
  }
  if (numberingSystem !== undefined && native.resolvedOptions().numberingSystem === localeNumberingSystem) fromLocale = localeNumberingSystem
  return { native, localeNumberingSystem: fromLocale }
}

function withoutUnicodeExtension(tag: string) {
  const subtags = tag.split('-')
  const u = subtags.findIndex((t, i) => i > 0 && t.toLowerCase() === 'u')
  if (u < 0) return tag
  let end = u + 1
  while (end < subtags.length && subtags[end]!.length > 1) end++
  return [...subtags.slice(0, u), ...subtags.slice(end)].join('-')
}

// MARK: - The constructor

/** An instance's internal slots, invisible on the object as the specification's are. */
type Slots = { native: NitroNumberFormat; boundFormat?: (value: unknown) => string; localeNumberingSystem?: string }
const slots = new WeakMap<object, Slots>()

/** %Intl%.[[FallbackSymbol]]: where the legacy constructor mode keeps the real instance. */
const FALLBACK = Symbol('IntlLegacyConstructedSymbol')

/** OrdinaryHasInstance(%NumberFormat%, value): the prototype chain, not Symbol.hasInstance. */
function inheritsFromNumberFormat(value: unknown): boolean {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false
  for (let p = Object.getPrototypeOf(value); p !== null; p = Object.getPrototypeOf(p)) if (p === prototype) return true
  return false
}

/** The receiver's slots; `unwrap` follows the legacy constructor mode's fallback (UnwrapNumberFormat). */
function slotsOf(value: unknown, method: string, unwrap = false): Slots {
  let found = typeof value === 'object' && value !== null ? slots.get(value) : undefined
  if (found === undefined && unwrap && inheritsFromNumberFormat(value)) {
    const inner = (value as Record<symbol, unknown>)[FALLBACK]
    found = typeof inner === 'object' && inner !== null ? slots.get(inner) : undefined
  }
  if (found === undefined) throw new TypeError(`Method Intl.NumberFormat.prototype.${method} called on incompatible receiver ${String(value)}`)
  return found
}
const nativeOf = (value: unknown, method: string, unwrap = false) => slotsOf(value, method, unwrap).native

// `length` is 0 as the specification says: the arguments are read from `arguments`.
function NumberFormatConstructor(this: unknown): unknown {
  const locales = arguments[0]
  const options = arguments[1]
  if (new.target === undefined) {
    const numberFormat = new (NumberFormatConstructor as unknown as NumberFormatConstructor)(locales, options)
    // ChainNumberFormat, the normative optional legacy mode: `NumberFormat.call(instance)` initializes it.
    if (inheritsFromNumberFormat(this)) {
      Object.defineProperty(this, FALLBACK, { value: numberFormat, writable: false, enumerable: false, configurable: false })
      return this
    }
    return numberFormat
  }
  const { native, localeNumberingSystem } = createNative(locales, options)
  slots.set(this as object, { native, localeNumberingSystem })
  return this
}
Object.defineProperty(NumberFormatConstructor, 'name', { value: 'NumberFormat' })
const prototype = NumberFormatConstructor.prototype as object

export const NumberFormat = NumberFormatConstructor as unknown as NumberFormatConstructor

// MARK: - formatRange

/** CLDR's range separator where it is not "–" (en dash), by language or locale. */
const RANGE_SEPARATORS: Record<string, string> = {
  'bg': ' – ', 'bs': ' – ', 'ca': '-', 'da': '-', 'es': '-', 'et': '‒', 'eu': '-', 'fil': '-', 'gu': '-',
  'hr': ' – ', 'it': '-', 'ja': '～', 'ka': '-', 'ko': '~', 'mk': ' – ', 'ml': '-', 'my': ' - ',
  'nl': '-', 'pt-PT': ' - ', 'ro': ' - ', 'sk': ' – ', 'sq': '-', 'th': '-', 'vi': '-', 'zh': '-',
}
/** CLDR's approximately sign where it is not "~". */
const APPROXIMATELY_SIGNS: Record<string, string> = {
  'be': '≈', 'bs': '≈', 'de': '≈', 'et': '≈', 'fr': '≃', 'ja': '約', 'ka': '≈',
  'lt': '∼', 'mk': '≈', 'nb': 'ca.', 'ru': '≈', 'sq': '≈',
}
/** A locale's entry: the whole tag, then language-region, then the language. */
function localeData(locale: string, table: Record<string, string>, fallback: string) {
  const subtags = locale.split('-')
  const language = subtags[0]!
  const region = subtags.slice(1).find((t) => t.length === 2 || (t.length === 3 && t >= '000' && t <= '999'))
  return table[locale] ?? (region ? table[`${language}-${region}`] : undefined) ?? table[language] ?? fallback
}

const NUMBER_PARTS = new Set(['integer', 'group', 'decimal', 'fraction', 'nan', 'infinity', 'exponentSeparator', 'exponentMinusSign', 'exponentInteger'])

/** A formatted number split into the text before the number, the number, and the text after it. */
function splitNumber(parts: NumberFormatPart[]) {
  let first = parts.findIndex((p) => NUMBER_PARTS.has(p.type))
  if (first < 0) first = parts.length
  let last = first
  for (let i = first; i < parts.length; i++) if (NUMBER_PARTS.has(parts[i]!.type)) last = i
  return { prefix: parts.slice(0, first), number: parts.slice(first, last + 1), suffix: parts.slice(last + 1) }
}
const text = (parts: NumberFormatPart[]) => parts.map((p) => p.value).join('')
const codePoints = (parts: NumberFormatPart[]) => [...text(parts)].length
const withSource = (parts: NumberFormatPart[], source: NumberFormatRangePart['source']): NumberFormatRangePart[] =>
  parts.map((p) => ({ type: p.type, value: p.value, source }))

function isNaNValue(value: number | string) {
  return typeof value === 'number' ? Number.isNaN(value) : Number.isNaN(Number(value))
}

/** ICU's range formatting: a shared sign or currency longer than one character is written once. */
function formatRangeToParts(self: unknown, start: unknown, end: unknown): NumberFormatRangePart[] {
  const native = nativeOf(self, 'formatRangeToParts')
  if (start === undefined || end === undefined) throw new TypeError('start and end are required')
  const x = toMathematicalValue(start)
  const y = toMathematicalValue(end)
  if (isNaNValue(x) || isNaNValue(y)) throw new RangeError('start and end must not be NaN')
  const xParts = native.formatToParts(x)
  const yParts = native.formatToParts(y)
  const locale = native.resolvedOptions().locale
  if (text(xParts) === text(yParts)) {
    // FormatApproximately: the approximately sign goes before the sign, or in front of everything.
    const sign = xParts.findIndex((p) => p.type === 'minusSign' || p.type === 'plusSign')
    const parts = [...xParts]
    parts.splice(Math.max(sign, 0), 0, { type: 'approximatelySign', value: localeData(locale, APPROXIMATELY_SIGNS, '~') })
    return withSource(parts, 'shared')
  }
  const a = splitNumber(xParts)
  const b = splitNumber(yParts)
  let separator = localeData(locale, RANGE_SEPARATORS, '–')
  const affixCount = codePoints(a.prefix) + codePoints(a.suffix)
  const collapse = text(a.prefix) === text(b.prefix) && text(a.suffix) === text(b.suffix) && affixCount > 1
  if (collapse) {
    return [
      ...withSource(a.prefix, 'shared'),
      ...withSource(a.number, 'startRange'),
      { type: 'literal', value: separator, source: 'shared' },
      ...withSource(b.number, 'endRange'),
      ...withSource(a.suffix, 'shared'),
    ]
  }
  // Repeated affixes get spaces around the separator.
  if (affixCount > 0) {
    const isSpace = (c: string | undefined) => c === ' ' || c === '\u00a0' || c === '\u2009' || c === '\u202f'
    if (!isSpace(separator[0])) separator = ' ' + separator
    if (!isSpace(separator[separator.length - 1])) separator = separator + ' '
  }
  return [...withSource(xParts, 'startRange'), { type: 'literal', value: separator, source: 'shared' }, ...withSource(yParts, 'endRange')]
}

// MARK: - The prototype

const methods = {
  // A plain method, installed as the `format` getter below: an accessor
  // written as `get format()` gets a `prototype` property in Hermes, which a
  // built-in getter must not have.
  formatGetter(): (value: unknown) => string {
    const state = slotsOf(this, 'format', true)
    const native = state.native
    let bound = state.boundFormat
    if (bound === undefined) {
      // An arrow function: like the specification's bound format function, not a constructor.
      bound = (value: unknown) => native.format(typeof value === 'number' ? value : toMathematicalValue(value))
      Object.defineProperty(bound, 'name', { value: '' })
      state.boundFormat = bound
    }
    return bound
  },
  formatToParts(value: unknown): NumberFormatPart[] {
    const native = nativeOf(this, 'formatToParts')
    return native.formatToParts(typeof value === 'number' ? value : toMathematicalValue(value)).map((p) => ({ type: p.type, value: p.value }))
  },
  formatRange(start: unknown, end: unknown): string {
    return formatRangeToParts(this, start, end)
      .map((p) => p.value)
      .join('')
  },
  formatRangeToParts(start: unknown, end: unknown): NumberFormatRangePart[] {
    return formatRangeToParts(this, start, end)
  },
  resolvedOptions(): ResolvedNumberFormatOptions {
    const state = slotsOf(this, 'resolvedOptions', true)
    const resolved = state.native.resolvedOptions() as unknown as Record<string, unknown>
    // A -u-nu- that was honoured stays in the locale, as ResolveLocale keeps it.
    const nu = state.localeNumberingSystem
    if (nu !== undefined && resolved.numberingSystem === nu) resolved.locale = `${resolved.locale as string}-u-nu-${nu}`
    // A fresh object with only the options that apply, in the specified order.
    const out: Record<string, unknown> = {}
    for (const key of RESOLVED_ORDER) if (resolved[key] !== undefined) out[key] = resolved[key]
    return out as unknown as ResolvedNumberFormatOptions
  },
}

const RESOLVED_ORDER = [
  'locale', 'numberingSystem', 'style', 'currency', 'currencyDisplay', 'currencySign', 'unit', 'unitDisplay', 'minimumIntegerDigits',
  'minimumFractionDigits', 'maximumFractionDigits', 'minimumSignificantDigits', 'maximumSignificantDigits', 'useGrouping', 'notation',
  'compactDisplay', 'signDisplay', 'roundingIncrement', 'roundingMode', 'roundingPriority', 'trailingZeroDisplay',
]

Object.defineProperty(methods.formatGetter, 'name', { value: 'get format' })
Object.defineProperty(prototype, 'format', { get: methods.formatGetter, enumerable: false, configurable: true })
for (const name of ['formatToParts', 'formatRange', 'formatRangeToParts', 'resolvedOptions'] as const) {
  Object.defineProperty(prototype, name, { value: methods[name], writable: true, enumerable: false, configurable: true })
}
Object.defineProperty(prototype, Symbol.toStringTag, { value: 'Intl.NumberFormat', writable: false, enumerable: false, configurable: true })
Object.defineProperty(NumberFormatConstructor, 'prototype', { writable: false, enumerable: false, configurable: false })

// supportedLocalesOf(locales [, options]): `length` 1, and a method, so not a constructor.
const statics = {
  supportedLocalesOf(locales: unknown): string[] {
    const requested = canonicalizeLocaleList(locales)
    const optionsArgument = arguments[1]
    if (optionsArgument === null) throw new TypeError('Cannot convert null to object')
    const options = (optionsArgument === undefined ? Object.create(null) : Object(optionsArgument)) as Record<string, unknown>
    getOption(options, 'localeMatcher', ['lookup', 'best fit'], 'best fit')
    return requested.length === 0 ? [] : getFactory().supportedLocalesOf(requested.map(withoutUnicodeExtension))
  },
}
Object.defineProperty(NumberFormatConstructor, 'supportedLocalesOf', { value: statics.supportedLocalesOf, writable: true, enumerable: false, configurable: true })
