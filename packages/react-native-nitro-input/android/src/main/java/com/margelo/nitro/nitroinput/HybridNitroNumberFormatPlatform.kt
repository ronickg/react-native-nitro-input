package com.margelo.nitro.nitroinput

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
      o.notation == NumberFormatNotation.COMPACT && o.style != NumberFormatStyle.CURRENCY -> CompactDecimalFormat.getInstance(
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

    if (o.style == NumberFormatStyle.UNIT) {
      val id = o.unit ?: throw IllegalArgumentException("NumberFormat: a unit is required with style 'unit'.")
      unit = MeasureUnit.getAvailable().firstOrNull { it.subtype == id }
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
    )
  }

  @Synchronized
  override fun format(value: Double): String {
    val measure = measureFormat
    return if (measure != null) measure.format(Measure(value, unit)) else format.format(value)
  }

  @Synchronized
  override fun formatDecimal(value: String): String {
    if (value == "NaN") return format(Double.NaN)
    if (value.endsWith("Infinity")) return format(if (value.startsWith("-")) Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY)
    val number = BigDecimal(value)
    val measure = measureFormat
    return if (measure != null) measure.format(Measure(number, unit)) else format.format(number)
  }
}
