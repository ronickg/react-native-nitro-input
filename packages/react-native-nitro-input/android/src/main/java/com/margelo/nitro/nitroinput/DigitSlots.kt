package com.margelo.nitro.nitroinput

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.text.NoCopySpan
import android.text.Spannable
import android.text.TextPaint
import android.text.style.ReplacementSpan
import kotlin.math.ceil

private const val DIGITS = "0123456789"

/**
 * Tabular figures for a font that has none.
 *
 * The paints ask for `tnum`, but a font without the feature (Open Runde) keeps
 * its proportional digits: every typed "1" was narrower than the placeholder's
 * "0" it replaced, so `keepPlaceholder`'s tail slid left on each keystroke and
 * an amount changed width as its digits did. Every digit is given a slot as
 * wide as the widest digit instead, centred in it, as NitroNumber's columns
 * are. In a font with tabular figures the digits are all that wide already,
 * and nothing changes.
 *
 * In the edit text a slot is a [ReplacementSpan], whose width is a whole
 * pixel, so a slot is the widest digit and one letter spacing rounded up, and
 * [InputFonts] measures and draws with that same width. (Letter spacing on the
 * digit was the first try: from API 35 the platform trims it at either end of
 * a line, so the first and last digit went without.)
 */
internal object DigitSlots {
  fun isDigit(codePoint: Int): Boolean = codePoint in '0'.code..'9'.code

  /** Each digit's advance in a paint, letter spacing aside, and the widest of them. */
  class Digits(val widths: FloatArray) {
    val widest = widths.max()

    /** A slot in px, for a letter spacing of [spacing] px. */
    fun slot(spacing: Float): Int = ceil(widest + spacing - 0.001f).toInt()
  }

  /**
   * The digits of [paint] (its letter spacing aside), or null when they are
   * one width already (within a hundredth of the font size).
   */
  fun measure(paint: Paint): Digits? {
    val bare = Paint(paint)
    bare.letterSpacing = 0f
    val widths = FloatArray(10) { bare.measureText(DIGITS, it, it + 1) }
    if (widths.max() - widths.min() <= paint.textSize * 0.01f) return null
    return Digits(widths)
  }

  private data class Key(val typeface: Typeface?, val size: Float, val features: String?)

  // For the edit text's paint, which the spans are handed a copy of on every layout pass.
  private val cache = HashMap<Key, Digits?>()

  private fun digits(paint: Paint): Digits? = synchronized(cache) {
    val key = Key(paint.typeface, paint.textSize, paint.fontFeatureSettings)
    if (key in cache) cache[key] else measure(paint).also {
      if (cache.size > 32) cache.clear()
      cache[key] = it
    }
  }

  private fun spacing(paint: Paint): Float = paint.letterSpacing * paint.textSize

  /**
   * Re-spans every digit of [text] for [paint] (the edit text's), or only
   * clears the spans when its font has tabular figures, or when [off].
   */
  fun apply(text: Spannable, paint: Paint, off: Boolean) {
    val on = !off && paint.textSize > 0f && digits(paint) != null
    // Only what changed: every span set or removed lays the edit text out
    // again, and a keystroke adds one digit (the spans of the others move
    // with their characters). Re-spanning the lot cost ~1.5 ms a keystroke.
    val spanned = BooleanArray(text.length)
    for (span in text.getSpans(0, text.length, Slot::class.java)) {
      val start = text.getSpanStart(span)
      val keep = on && text.getSpanEnd(span) == start + 1 && isDigit(text[start].code) && !spanned[start]
      if (keep) spanned[start] = true else text.removeSpan(span)
    }
    if (!on) return
    for (i in text.indices) {
      if (!spanned[i] && isDigit(text[i].code)) text.setSpan(Slot(), i, i + 1, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
  }

  /**
   * Draws [text] at [x] in [paint] as the spans lay it out in the edit text:
   * digits in their slots, the runs between them whole.
   */
  fun draw(canvas: Canvas, text: String, x: Float, y: Float, paint: Paint) {
    val digits = digits(paint)
    if (digits == null) {
      canvas.drawText(text, x, y, paint)
      return
    }
    val slot = digits.slot(spacing(paint))
    val spacing = paint.letterSpacing
    var left = x
    var start = 0
    while (start < text.length) {
      if (isDigit(text[start].code)) {
        paint.letterSpacing = 0f
        canvas.drawText(text, start, start + 1, left + (slot - digits.widths[text[start] - '0']) / 2f, y, paint)
        paint.letterSpacing = spacing
        left += slot
        start++
        continue
      }
      var end = start + 1
      while (end < text.length && !isDigit(text[end].code)) end++
      canvas.drawText(text, start, end, left, y, paint)
      left += paint.measureText(text, start, end)
      start = end
    }
  }

  /**
   * One digit, drawn centred in its slot. Not copied with the text (the
   * clipboard, a saved state): the watcher puts the spans back on whatever
   * text the field ends up with.
   */
  private class Slot : ReplacementSpan(), NoCopySpan {
    private val bare = TextPaint()

    override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
      if (fm != null) paint.getFontMetricsInt(fm)
      val digits = digits(paint) ?: return ceil(paint.measureText(text, start, end)).toInt()
      return digits.slot(spacing(paint))
    }

    override fun draw(canvas: Canvas, text: CharSequence, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
      bare.set(paint)
      bare.letterSpacing = 0f
      val digits = digits(paint)
      val inset = if (digits == null) 0f else (digits.slot(spacing(paint)) - digits.widths[text[start] - '0']) / 2f
      canvas.drawText(text, start, end, x + inset, y.toFloat(), bare)
    }
  }
}
