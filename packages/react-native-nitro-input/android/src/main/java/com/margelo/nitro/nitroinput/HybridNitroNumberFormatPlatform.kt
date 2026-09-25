package com.margelo.nitro.nitroinput

import android.icu.number.LocalizedNumberFormatter
import android.icu.number.Notation
import android.icu.number.NumberFormatter
import android.icu.number.Precision
import android.icu.number.Scale
import android.icu.text.CompactDecimalFormat
import android.icu.text.DecimalFormat
import android.icu.text.DecimalFormatSymbols
import android.icu.text.MeasureFormat
import android.icu.text.NumberFormat
import android.icu.text.NumberingSystem
import android.icu.util.Currency
import android.icu.util.Measure
import android.icu.util.MeasureUnit
import android.icu.util.ULocale
import android.os.Build
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import java.math.BigDecimal

/**
 * ICU's `NumberFormat`, for the C++ `NumberFormat`: C++ learns a locale's
 * format from it once (see NumberFormatProbe) and formats with it only for
 * what C++ does not draw itself (compact and scientific notation, units,
 * currency names). Hermes' `Intl.NumberFormat` uses the same classes on
 * Android, so the two agree.
 */
@Keep
@DoNotStrip
class HybridNitroNumberFormatPlatform : HybridNitroNumberFormatPlatformSpec() {
  override fun create(options: NumberFormatPlatformOptions): HybridNitroPlatformNumberFormatterSpec =
    HybridNitroPlatformNumberFormatter(options)

  override fun supportedLocalesOf(locales: Array<String>): Array<String> =
    locales.mapNotNull { NumberFormatLocales.match(it)?.tag }.toTypedArray()
}

/** ECMA-402's lookup matcher over the locales ICU has number data for. */
internal object NumberFormatLocales {
  private val available: Set<String> by lazy { NumberFormat.getAvailableLocales().map { it.toLanguageTag() }.toSet() }

  class Match(val tag: String, val locale: ULocale, val numberingSystem: String?)

  fun match(requested: String): Match? {
    val locale = try {
      ULocale.forLanguageTag(requested.replace('_', '-'))
    } catch (e: Exception) {
      return null
    }
    val numberingSystem = locale.getKeywordValue("numbers")
    var tag = locale.toLanguageTag().substringBefore("-u-").substringBefore("-x-")
    // ICU lists some locales with their script only ("zh-Hant-TW" for zh-TW): try the likely form too.
    if (!available.contains(tag)) {
      val likely = ULocale.addLikelySubtags(ULocale.forLanguageTag(tag)).toLanguageTag()
      if (available.contains(likely)) return Match(tag, ULocale.forLanguageTag(likely), numberingSystem)
    }
    while (tag.isNotEmpty() && tag != "und") {
      if (available.contains(tag)) return Match(tag, ULocale.forLanguageTag(tag), numberingSystem)
      tag = tag.substringBeforeLast('-', "")
    }
    return null
  }

  /** The first requested locale ICU knows, or the device's. */
  fun resolve(requested: Array<String>): Match =
    requested.firstNotNullOfOrNull { match(it) } ?: ULocale.getDefault().let { Match(it.toLanguageTag(), it, null) }
}

@Keep
@DoNotStrip
class HybridNitroPlatformNumberFormatter(o: NumberFormatPlatformOptions) : HybridNitroPlatformNumberFormatterSpec() {
  private val format: NumberFormat
  private val unit: MeasureUnit?
  private val measureFormat: MeasureFormat?
  /** `unit: 'percent'`, which MeasureFormat prints without its sign: a percent formatter that does not multiply. */
  private val percentUnit: NumberFormat?
  /**
   * Compact notation with a currency or a percent, or a signDisplay plus:
   * CompactDecimalFormat prints bare numbers ("1.5K" for "$1.5K"). Android 11+
   * has ICU's number formatter, which prints the locale's compact patterns;
   * before it, the compact number goes inside the style's own affixes.
   */
  private val compact: ((BigDecimal) -> String)?
  override val symbols: NumberFormatPlatformSymbols

  init {
    val match = NumberFormatLocales.resolve(o.locales)
    val numberingSystem = o.numberingSystem ?: match.numberingSystem
    val locale = if (numberingSystem != null) match.locale.setKeywordValue("numbers", numberingSystem) else match.locale
    val scientific = o.notation == NumberFormatNotation.SCIENTIFIC || o.notation == NumberFormatNotation.ENGINEERING
    val currencyStyle = when (o.currencyDisplay) {
      NumberFormatCurrencyDisplay.CODE -> NumberFormat.ISOCURRENCYSTYLE
      NumberFormatCurrencyDisplay.NAME -> NumberFormat.PLURALCURRENCYSTYLE
      else -> if (o.currencySign == NumberFormatCurrencySign.ACCOUNTING) NumberFormat.ACCOUNTINGCURRENCYSTYLE else NumberFormat.CURRENCYSTYLE
    }
    format = when {
      o.notation == NumberFormatNotation.COMPACT -> CompactDecimalFormat.getInstance(
        locale,
        if (o.compactDisplay == NumberFormatCompactDisplay.LONG) CompactDecimalFormat.CompactStyle.LONG else CompactDecimalFormat.CompactStyle.SHORT,
      )
      scientific -> NumberFormat.getInstance(locale, NumberFormat.SCIENTIFICSTYLE)
      o.style == NumberFormatStyle.PERCENT -> NumberFormat.getInstance(locale, NumberFormat.PERCENTSTYLE)
      o.style == NumberFormatStyle.CURRENCY -> NumberFormat.getInstance(locale, currencyStyle)
      else -> NumberFormat.getInstance(locale, NumberFormat.NUMBERSTYLE)
    }

    var currencyShown = ""
    val code = o.currency
    if (o.style == NumberFormatStyle.CURRENCY && code != null) {
      val currency = Currency.getInstance(code)
      format.currency = currency
      val decimal = format as? DecimalFormat
      if (o.currencyDisplay == NumberFormatCurrencyDisplay.NARROWSYMBOL && decimal != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val narrow = currency.getName(locale, Currency.NARROW_SYMBOL_NAME, null)
        decimal.decimalFormatSymbols = decimal.decimalFormatSymbols.apply { currencySymbol = narrow }
      }
      currencyShown = if (o.currencyDisplay == NumberFormatCurrencyDisplay.CODE) code else decimal?.decimalFormatSymbols?.currencySymbol ?: currency.getSymbol(locale)
    }

    format.isGroupingUsed = o.useGrouping
    format.minimumIntegerDigits = o.minimumIntegerDigits.toInt()
    val decimal = format as? DecimalFormat
    if (o.minimumSignificantDigits > 0 && decimal != null) {
      decimal.setSignificantDigitsUsed(true)
      decimal.minimumSignificantDigits = o.minimumSignificantDigits.toInt()
      decimal.maximumSignificantDigits = o.maximumSignificantDigits.toInt()
    } else {
      format.minimumFractionDigits = o.minimumFractionDigits.toInt()
      format.maximumFractionDigits = o.maximumFractionDigits.toInt()
    }
    if (o.notation == NumberFormatNotation.ENGINEERING && decimal != null) decimal.maximumIntegerDigits = 3
    format.roundingMode = when (o.roundingMode) {
      NumberFormatRoundingMode.CEIL -> BigDecimal.ROUND_CEILING
      NumberFormatRoundingMode.FLOOR -> BigDecimal.ROUND_FLOOR
      NumberFormatRoundingMode.EXPAND -> BigDecimal.ROUND_UP
      NumberFormatRoundingMode.TRUNC -> BigDecimal.ROUND_DOWN
      NumberFormatRoundingMode.HALFTRUNC -> BigDecimal.ROUND_HALF_DOWN
      NumberFormatRoundingMode.HALFEVEN -> BigDecimal.ROUND_HALF_EVEN
      else -> BigDecimal.ROUND_HALF_UP
    }
    if (decimal != null) {
      when (o.signDisplay) {
        NumberFormatSignDisplay.ALWAYS, NumberFormatSignDisplay.EXCEPTZERO ->
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) decimal.isSignAlwaysShown = true
          else decimal.positivePrefix = decimal.decimalFormatSymbols.plusSign + decimal.positivePrefix
        NumberFormatSignDisplay.NEVER -> {
          decimal.negativePrefix = decimal.positivePrefix
          decimal.negativeSuffix = decimal.positiveSuffix
        }
        else -> Unit
      }
    }

    compact = if (o.notation != NumberFormatNotation.COMPACT) {
      null
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      modernCompact(o, locale)
    } else if (o.style == NumberFormatStyle.CURRENCY || o.style == NumberFormatStyle.PERCENT) {
      // The style's own pattern around the compact number: "$" + "1.5K", "1.2M" + "%".
      val pattern = NumberFormat.getInstance(locale, if (o.style == NumberFormatStyle.PERCENT) NumberFormat.PERCENTSTYLE else currencyStyle) as DecimalFormat
      if (o.style == NumberFormatStyle.CURRENCY && code != null) pattern.currency = Currency.getInstance(code)
      val plus = o.signDisplay == NumberFormatSignDisplay.ALWAYS || o.signDisplay == NumberFormatSignDisplay.EXCEPTZERO
      val positivePrefix = (if (plus) pattern.decimalFormatSymbols.plusSign.toString() else "") + pattern.positivePrefix
      val scale = if (o.style == NumberFormatStyle.PERCENT) 100 else 1
      val number = format
      { value ->
        val body = number.format(value.abs().multiply(BigDecimal(scale)))
        if (value.signum() < 0) pattern.negativePrefix + body + pattern.negativeSuffix else positivePrefix + body + pattern.positiveSuffix
      }
    } else {
      null
    }

    if (o.style == NumberFormatStyle.UNIT && o.unit == "percent") {
      percentUnit = (NumberFormat.getInstance(locale, NumberFormat.PERCENTSTYLE) as DecimalFormat).also { p ->
        p.multiplier = 1
        p.isGroupingUsed = format.isGroupingUsed
        p.minimumIntegerDigits = format.minimumIntegerDigits
        p.minimumFractionDigits = format.minimumFractionDigits
        p.maximumFractionDigits = format.maximumFractionDigits
        p.roundingMode = format.roundingMode
        if (decimal != null && decimal.areSignificantDigitsUsed()) {
          p.setSignificantDigitsUsed(true)
          p.minimumSignificantDigits = decimal.minimumSignificantDigits
          p.maximumSignificantDigits = decimal.maximumSignificantDigits
        }
      }
    } else {
      percentUnit = null
    }
    if (o.style == NumberFormatStyle.UNIT && percentUnit == null) {
      val id = o.unit ?: throw IllegalArgumentException("NumberFormat: a unit is required with style 'unit'.")
      unit = MeasureUnit.getAvailable().firstOrNull { it.subtype == id }
        // A compound unit ("acre-per-day") is built from its identifier (Android 11+).
        ?: (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) try { MeasureUnit.forIdentifier(id) } catch (e: Exception) { null } else null)
        ?: throw IllegalArgumentException("NumberFormat: unknown unit '$id'.")
      val width = when (o.unitDisplay) {
        NumberFormatUnitDisplay.LONG -> MeasureFormat.FormatWidth.WIDE
        NumberFormatUnitDisplay.NARROW -> MeasureFormat.FormatWidth.NARROW
        else -> MeasureFormat.FormatWidth.SHORT
      }
      measureFormat = MeasureFormat.getInstance(locale, width, format)
    } else {
      unit = null
      measureFormat = null
    }

    val dfs = decimal?.decimalFormatSymbols ?: DecimalFormatSymbols.getInstance(locale)
    val modern = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
    symbols = NumberFormatPlatformSymbols(
      locale = match.tag,
      numberingSystem = NumberingSystem.getInstance(locale).name,
      minusSign = if (modern) dfs.minusSignString else dfs.minusSign.toString(),
      plusSign = if (modern) dfs.plusSignString else dfs.plusSign.toString(),
      percentSign = if (modern) dfs.percentString else dfs.percent.toString(),
      currency = currencyShown,
      nan = dfs.naN,
      infinity = dfs.infinity,
      exponentSeparator = dfs.exponentSeparator,
    )
  }

  @Synchronized
  override fun format(value: Double): String {
    compact?.let { if (value.isFinite()) return it(BigDecimal(value)) }
    percentUnit?.let { return it.format(value) }
    val measure = measureFormat
    return if (measure != null) measure.format(Measure(value, unit)) else format.format(value)
  }

  @Synchronized
  override fun formatDecimal(value: String): String {
    if (value == "NaN") return format(Double.NaN)
    if (value.endsWith("Infinity")) return format(if (value.startsWith("-")) Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY)
    val number = BigDecimal(value)
    compact?.let { return it(number) }
    percentUnit?.let { return it.format(number) }
    val measure = measureFormat
    return if (measure != null) measure.format(Measure(number, unit)) else format.format(number)
  }

  private companion object {
    /** ICU's number formatter (Android 11+): compact currency, percent and signs as CLDR writes them. */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.R)
    fun modernCompact(o: NumberFormatPlatformOptions, locale: ULocale): (BigDecimal) -> String {
      var f: LocalizedNumberFormatter = NumberFormatter.withLocale(locale)
        .notation(if (o.compactDisplay == NumberFormatCompactDisplay.LONG) Notation.compactLong() else Notation.compactShort())
        .grouping(if (o.useGrouping) NumberFormatter.GroupingStrategy.AUTO else NumberFormatter.GroupingStrategy.OFF)
      f = if (o.minimumSignificantDigits > 0) {
        f.precision(Precision.minMaxSignificantDigits(o.minimumSignificantDigits.toInt(), o.maximumSignificantDigits.toInt()))
      } else {
        f.precision(Precision.minMaxFraction(o.minimumFractionDigits.toInt(), o.maximumFractionDigits.toInt()))
      }
      val code = o.currency
      if (o.style == NumberFormatStyle.CURRENCY && code != null) {
        f = f.unit(Currency.getInstance(code)).unitWidth(
          when (o.currencyDisplay) {
            NumberFormatCurrencyDisplay.CODE -> NumberFormatter.UnitWidth.ISO_CODE
            NumberFormatCurrencyDisplay.NAME -> NumberFormatter.UnitWidth.FULL_NAME
            NumberFormatCurrencyDisplay.NARROWSYMBOL -> NumberFormatter.UnitWidth.NARROW
            else -> NumberFormatter.UnitWidth.SHORT
          }
        )
      } else if (o.style == NumberFormatStyle.PERCENT) {
        f = f.unit(MeasureUnit.PERCENT).scale(Scale.powerOfTen(2))
      }
      val accounting = o.currencySign == NumberFormatCurrencySign.ACCOUNTING
      f = f.sign(
        when (o.signDisplay) {
          NumberFormatSignDisplay.ALWAYS -> if (accounting) NumberFormatter.SignDisplay.ACCOUNTING_ALWAYS else NumberFormatter.SignDisplay.ALWAYS
          NumberFormatSignDisplay.EXCEPTZERO -> if (accounting) NumberFormatter.SignDisplay.ACCOUNTING_EXCEPT_ZERO else NumberFormatter.SignDisplay.EXCEPT_ZERO
          NumberFormatSignDisplay.NEVER -> NumberFormatter.SignDisplay.NEVER
          else -> if (accounting) NumberFormatter.SignDisplay.ACCOUNTING else NumberFormatter.SignDisplay.AUTO
        }
      )
      val formatter = f
      return { value -> formatter.format(value).toString() }
    }
  }
}
