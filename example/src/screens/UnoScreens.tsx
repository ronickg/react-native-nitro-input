import React, { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { KeyboardAwareScrollView, KeyboardController, KeyboardStickyView, useKeyboardHandler } from 'react-native-keyboard-controller'
import Animated, { Easing, FadeInDown, FadeOut, interpolate, interpolateColor, runOnJS, useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NitroInput, type NitroInputHandle, type NitroInputKeyboardType, type NitroInputNotation } from 'react-native-nitro-input'

/**
 * Two of Uno's screens as Uno draws them, on Uno's light-theme tokens
 * resolved to values (Open Runde, its neutrals and brand blue): the credit
 * repayment amount picker, whose "Enter a custom amount" card turns into an
 * amount field when picked, and the masked inputs of Uno's input gallery
 * (`Input` with a native mask, the rest of the placeholder kept greyed).
 */

const FONT = {
  regular: 'OpenRunde-Regular',
  semibold: 'OpenRunde-Semibold',
  bold: 'OpenRunde-Bold',
}
const C = {
  text: '#081033',
  textSecondary: '#555B73',
  textTertiary: '#898D9F',
  textDisabled: '#6F7489',
  surface: '#FFFFFF',
  surfaceSecondary: '#F5F6FA',
  surfaceTertiary: '#F0F2F7',
  brand: '#0066FF',
  brandPressed: '#0052CC',
  border: '#D6D9E1',
  error: '#CC2929',
  success: '#178128',
}
// Type scale: size / line height / letter spacing (a ratio of the size).
const BODY = { fontSize: 16, lineHeight: 21, letterSpacing: -0.44 }
const BODY_SMALL = { fontSize: 14, lineHeight: 18, letterSpacing: -0.35 }
const H4 = { fontSize: 24, lineHeight: 28, letterSpacing: -0.84 }

// MARK: - The amount picker

type Choice = 'minimum' | 'dueNow' | 'totalOwed' | 'custom'

const PRESETS: { key: Exclude<Choice, 'custom'>; title: string; amount: string; glyph: string }[] = [
  { key: 'minimum', title: 'Minimum payment', amount: '$150.00', glyph: '◷' },
  { key: 'dueNow', title: 'Due now', amount: '$640.25', glyph: '▦' },
  { key: 'totalOwed', title: 'Total owed', amount: '$2,180.75', glyph: '☰' },
]

/**
 * Uno's credit repayment amount step: a radio card per figure owed, then
 * "Enter a custom amount", which turns into the amount field when picked. The
 * card keeps its height (a 48 row in 16 padding), so the label moves up to
 * make room for the amount rather than the list jumping. The footer hides
 * while the keyboard is up and a Done check rides the keyboard instead.
 */
/** The footer's padding around the 56 pt button. */
const FOOTER_HEIGHT = 16 + 56 + 16

export function UnoAmountPickerScreen() {
  const insets = useSafeAreaInsets()
  const [choice, setChoice] = useState<Choice>('dueNow')
  // What the field shows ("1,250.5"), echoed back as its value so a remount
  // shows it again; the amount is the same without the grouping.
  const [customText, setCustomText] = useState('')
  const custom = customText.replace(/,/g, '')
  const [keyboardUp, setKeyboardUp] = useState(false)
  const customRef = useRef<NitroInputHandle>(null)

  // `onStart` carries the keyboard's target height, so the swap is instant both ways.
  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet'
        runOnJS(setKeyboardUp)(e.height > 0)
      },
    },
    []
  )

  const dismiss = () => {
    customRef.current?.blur()
    KeyboardController.dismiss()
  }
  // The field stays mounted once picked: its autoFocus fires the first time
  // only, so a later pick asks for focus by hand.
  const pickCustom = () => {
    setChoice('custom')
    customRef.current?.focus()
  }
  const pickPreset = (key: Choice) => {
    setChoice(key)
    dismiss()
  }

  const isCustom = choice === 'custom'
  const amount = isCustom ? (custom ? `$${Number(custom).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—') : PRESETS.find((p) => p.key === choice)!.amount

  return (
    <View style={[a.screen, { paddingBottom: insets.bottom }]}>
      {/* Uno's offset with a footer: its height plus 16, so the focused amount clears the Done check. */}
      <KeyboardAwareScrollView contentContainerStyle={a.body} bottomOffset={FOOTER_HEIGHT + 16} keyboardShouldPersistTaps="handled">
        <Text style={a.header}>How much do you want to pay?</Text>
        <View style={a.cards}>
          {PRESETS.map((p) => (
            <OptionCard
              key={p.key}
              testID={`uno-option-${p.key}`}
              glyph={p.glyph}
              title={p.title}
              selected={choice === p.key}
              onPress={() => pickPreset(p.key)}
              amount={<Text style={a.amount}>{p.amount}</Text>}
            />
          ))}
          <OptionCard
            testID="uno-option-custom"
            glyph="•••"
            title={isCustom && custom.length > 0 ? 'Custom amount' : 'Enter a custom amount'}
            selected={isCustom}
            onPress={pickCustom}
            fillText
            collapsible
            amount={
              isCustom ? (
                <View style={a.customRow}>
                  <Text style={a.amount}>$</Text>
                  <NitroInput
                    ref={customRef}
                    testID="uno-custom-amount"
                    accessibilityLabel="Custom amount"
                    autoFocus
                    mode="number"
                    fractionDigits={2}
                    maxIntegerDigits={9}
                    keyboardType="decimal-pad"
                    fontFamily={FONT.semibold}
                    fontSize={BODY.fontSize}
                    color={C.text}
                    style={a.customInput}
                    value={customText}
                    onChangeText={setCustomText}
                  />
                </View>
              ) : undefined
            }
          />
        </View>
        <Text style={a.summary} testID="uno-amount-summary">
          Paying {amount}
        </Text>
      </KeyboardAwareScrollView>

      {/* Hidden, not unmounted, while the keyboard is up: it never flashes under the check. */}
      <View style={[a.footer, keyboardUp && a.hidden]} pointerEvents={keyboardUp ? 'none' : 'auto'}>
        <Pressable testID="uno-continue" style={({ pressed }) => [a.cta, pressed && a.ctaPressed]}>
          <Text style={a.ctaText}>Continue</Text>
        </Pressable>
      </View>

      {keyboardUp && isCustom ? (
        // 16 above the keyboard: the layer's bottom padding counts the inset the open offset gives back.
        <KeyboardStickyView
          style={[a.accessory, { paddingBottom: 16 + insets.bottom }]}
          offset={{ closed: 0, opened: insets.bottom }}
          pointerEvents="box-none"
        >
          <Pressable
            testID="uno-done"
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={dismiss}
            style={({ pressed }) => [a.done, pressed && a.donePressed]}
          >
            <Text style={a.doneGlyph}>✓</Text>
          </Pressable>
        </KeyboardStickyView>
      ) : null}
    </View>
  )
}

// Picking the custom card animates where Uno swaps in one frame: the title
// slides up from the row's middle to the top line while the field rises in
// under it, and the radio's ring thickens. The column keeps the field's line
// either way and only the title moves, so nothing re-lays out mid-animation.
const PICK_MS = 250
const PICK_EASING = Easing.out(Easing.cubic)
// Half the field line and the gap: where a lone title sits centred in the column.
const TITLE_DROP = (BODY.lineHeight + 6) / 2
const FIELD_ENTERING = FadeInDown.duration(PICK_MS).easing(PICK_EASING).withInitialValues({ transform: [{ translateY: 8 }] })
const FIELD_EXITING = FadeOut.duration(150)

/** One radio card: icon well, the small title over the amount, the radio at the trailing edge. */
function OptionCard({
  testID,
  glyph,
  title,
  amount,
  selected,
  fillText,
  collapsible,
  onPress,
}: {
  testID: string
  glyph: string
  title: string
  amount?: React.ReactNode
  selected: boolean
  fillText?: boolean
  /** The custom card: the title is centred alone until `amount` arrives. */
  collapsible?: boolean
  onPress: () => void
}) {
  const open = useDerivedValue(() => withTiming(amount === undefined ? 0 : 1, { duration: PICK_MS, easing: PICK_EASING }), [amount === undefined])
  const titleShift = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(open.value, [0, 1], [TITLE_DROP, 0]) }],
  }))
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [a.card, pressed && a.cardPressed]}>
      <View style={a.row}>
        <View style={a.well}>
          <Text style={a.wellGlyph}>{glyph}</Text>
        </View>
        {/* `fillText`: the custom card's field fills the column instead of hugging the label's width. */}
        <View style={[a.textColumn, fillText && a.textColumnFill]}>
          {collapsible ? (
            <>
              <Animated.Text style={[a.title, titleShift]}>{title}</Animated.Text>
              <View style={a.fieldLine}>
                {amount === undefined ? null : (
                  <Animated.View entering={FIELD_ENTERING} exiting={FIELD_EXITING}>
                    {amount}
                  </Animated.View>
                )}
              </View>
            </>
          ) : (
            <>
              <Text style={a.title}>{title}</Text>
              {amount}
            </>
          )}
        </View>
        <Radio selected={selected} />
      </View>
    </Pressable>
  )
}

/** The radio: a 2 grey ring that thickens to a 7 brand ring around a 10 white dot. */
function Radio({ selected }: { selected: boolean }) {
  const on = useDerivedValue(() => withTiming(selected ? 1 : 0, { duration: PICK_MS, easing: PICK_EASING }), [selected])
  const ring = useAnimatedStyle(() => ({
    borderWidth: interpolate(on.value, [0, 1], [2, 7]),
    borderColor: interpolateColor(on.value, [0, 1], [C.border, C.brand]),
  }))
  return <Animated.View style={[a.radio, ring]} />
}

const a = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.surface },
  body: { paddingHorizontal: 16, paddingBottom: 24 },
  header: { ...H4, fontFamily: FONT.bold, color: C.text, paddingTop: 16, paddingBottom: 24 },
  cards: { gap: 8 },
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 24, padding: 16 },
  cardPressed: { backgroundColor: C.surfaceTertiary },
  // A fixed 48 row: a title-only card and a two-line one are the same height.
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  well: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  wellGlyph: { fontSize: 18, color: C.brand, fontWeight: '700' },
  textColumn: { flex: 1, flexShrink: 1, gap: 6 },
  textColumnFill: { flexGrow: 1 },
  title: { ...BODY_SMALL, fontFamily: FONT.regular, color: C.textSecondary },
  amount: { ...BODY, fontFamily: FONT.semibold, color: C.text },
  fieldLine: { height: BODY.lineHeight },
  customRow: { flexDirection: 'row', alignItems: 'center' },
  // Pinned to the amount's own line, so the card does not grow to a form field's height.
  customInput: { flex: 1, height: BODY.lineHeight },
  radio: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.surface },
  summary: { ...BODY_SMALL, fontFamily: FONT.regular, color: C.textSecondary, marginTop: 16 },
  footer: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 },
  hidden: { opacity: 0 },
  cta: { height: 56, borderRadius: 28, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  ctaPressed: { backgroundColor: C.brandPressed },
  ctaText: { ...BODY, fontFamily: FONT.semibold, color: C.surface },
  accessory: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, alignItems: 'flex-end' },
  done: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  donePressed: { backgroundColor: C.brandPressed },
  doneGlyph: { fontSize: 28, color: C.surface, fontWeight: '700' },
})

// MARK: - Masked inputs

const ASCII_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const ASCII_ALPHANUMERIC = `${ASCII_LETTERS}0123456789`
/** Uno's `ASCII_NOTATIONS`: `L` / `l` a letter, `X` / `x` a letter or digit. */
const ASCII_NOTATIONS: NitroInputNotation[] = [
  { character: 'L', characterSet: ASCII_LETTERS, isOptional: false },
  { character: 'l', characterSet: ASCII_LETTERS, isOptional: true },
  { character: 'X', characterSet: ASCII_ALPHANUMERIC, isOptional: false },
  { character: 'x', characterSet: ASCII_ALPHANUMERIC, isOptional: true },
]
/** Uno's card shapes: the leading digits pick Amex (4-6-5) or Diners (4-6-4) over the 16-digit default. */
const CARD_NOTATIONS: NitroInputNotation[] = [
  { character: 'N', characterSet: '012456789', isOptional: false },
  { character: 'T', characterSet: '3', isOptional: false },
  { character: 'Z', characterSet: '0', isOptional: false },
  { character: 'S', characterSet: '1235', isOptional: false },
  { character: 'E', characterSet: '678', isOptional: false },
  { character: 'F', characterSet: '47', isOptional: false },
  { character: 'D', characterSet: '689', isOptional: false },
  { character: 'Y', characterSet: '0123459', isOptional: false },
]
const CARD_AFFINITY = [
  '[TS00] [0000] [0000] [0000]',
  '[TZE0] [0000] [0000] [0000]',
  '[TF00] [000000] [00000]',
  '[TD00] [000000] [0000]',
  '[TZY0] [000000] [0000]',
]

type MaskedFormat = {
  key: string
  label: string
  placeholder: string
  mask: string
  keyboardType?: NitroInputKeyboardType
  notations?: NitroInputNotation[]
  affinity?: string[]
  upper?: boolean
  /** Uno keeps the placeholder greyed only when it is itself a value in the mask's shape ("MM/YY" is not). */
  keepPlaceholder: boolean
  valid: (raw: string) => boolean
}

const digitsOf = (n: number) => (raw: string) => new RegExp(`^\\d{${n}}$`).test(raw)

const MASKED: MaskedFormat[] = [
  { key: 'clabe', label: 'CLABE', placeholder: '0123 4567 8901 2345 67', mask: '[0000] [0000] [0000] [0000] [00]', keyboardType: 'number-pad', keepPlaceholder: true, valid: digitsOf(18) },
  { key: 'ssn', label: 'SSN', placeholder: '123-45-6789', mask: '[000]-[00]-[0000]', keyboardType: 'number-pad', keepPlaceholder: true, valid: (r) => /^(?!000|666|9)\d{3}(?!00)\d{2}(?!0000)\d{4}$/.test(r) },
  { key: 'expiry', label: 'CARD_EXPIRY', placeholder: 'MM/YY', mask: '[00]/[00]', keyboardType: 'number-pad', keepPlaceholder: false, valid: (r) => /^(0[1-9]|1[0-2])\d{2}$/.test(r) },
  { key: 'card', label: 'CREDIT_CARD', placeholder: '1234 5678 9012 3456', mask: '[N000] [0000] [0000] [0000]', keyboardType: 'number-pad', notations: CARD_NOTATIONS, affinity: CARD_AFFINITY, keepPlaceholder: true, valid: (r) => /^\d{14,16}$/.test(r) },
  { key: 'nino', label: 'GB_NINO', placeholder: 'AA 00 00 00 A', mask: '[XX] [XX] [XX] [XX] [X]', notations: ASCII_NOTATIONS, upper: true, keepPlaceholder: true, valid: (r) => /^[A-Z]{2}\d{6}[A-D]$/.test(r) },
  { key: 'curp', label: 'MX_CURP', placeholder: 'AAAA 000000 HAAAAA 00', mask: '[XXXX] [XXXXXX] [XXXXXX] [XX]', notations: ASCII_NOTATIONS, upper: true, keepPlaceholder: true, valid: (r) => r.length === 18 },
  { key: 'iban-de', label: 'IBAN (DE)', placeholder: 'DE89 3704 0044 0532 0130 00', mask: '[XXXX] [XXXX] [XXXX] [XXXX] [XXXX] [XX]', notations: ASCII_NOTATIONS, upper: true, keepPlaceholder: true, valid: (r) => r.length === 22 },
  { key: 'phone-us', label: 'Phone US parens  (###) ###-####', placeholder: '(555) 123-4567', mask: '([000]) [000]-[0000]', keyboardType: 'phone-pad', keepPlaceholder: true, valid: digitsOf(10) },
  { key: 'phone-intl', label: 'Phone intl +1  +# (###) ###-####', placeholder: '+1 (555) 123-4567', mask: '+[0] ([000]) [000]-[0000]', keyboardType: 'phone-pad', keepPlaceholder: true, valid: digitsOf(11) },
  { key: 'phone-uk', label: 'Phone UK spaces  ##### ######', placeholder: '07123 456789', mask: '[00000] [000000]', keyboardType: 'phone-pad', keepPlaceholder: true, valid: digitsOf(11) },
  { key: 'phone-mx', label: 'Phone MX  ## #### ####', placeholder: '55 1234 5678', mask: '[00] [0000] [0000]', keyboardType: 'phone-pad', keepPlaceholder: true, valid: digitsOf(10) },
]

/**
 * The "Masked formats" of Uno's input gallery, each an `Input` as Uno renders
 * it: the label over a filled box, a 2px brand ring while focused, the raw
 * value under it, "Valid" once it validates and an error once a complete value
 * does not. The mask props are the ones Uno passes NitroInput.
 */
export function UnoMaskedInputsScreen() {
  return (
    // Uno's screens scroll the focused field above the keyboard the same way.
    <KeyboardAwareScrollView style={m.screen} contentContainerStyle={m.body} bottomOffset={76} keyboardShouldPersistTaps="handled">
      <Text style={m.section}>Masked formats</Text>
      {MASKED.map((format) => (
        <MaskedField key={format.key} format={format} />
      ))}
      <Text style={m.section}>States</Text>
      <MaskedField format={MASKED[0]!} disabled defaultValue="012345678901234567" />
    </KeyboardAwareScrollView>
  )
}

function MaskedField({ format, disabled, defaultValue }: { format: MaskedFormat; disabled?: boolean; defaultValue?: string }) {
  const [raw, setRaw] = useState('')
  const [complete, setComplete] = useState(false)
  const [focused, setFocused] = useState(false)
  const valid = raw.length > 0 && format.valid(raw)
  const invalid = complete && !valid
  const testID = `uno-mask-${format.key}${disabled ? '-disabled' : ''}`

  return (
    <View style={m.root}>
      <Text style={[m.label, disabled && m.labelDisabled]}>{disabled ? `${format.label} (read-only)` : format.label}</Text>
      <View style={[m.box, invalid && m.boxError]} pointerEvents={disabled ? 'box-only' : 'auto'}>
        <NitroInput
          testID={testID}
          style={m.field}
          editable={!disabled}
          defaultValue={defaultValue}
          mode="mask"
          mask={format.mask}
          maskNotations={format.notations}
          maskAffinityFormats={format.affinity}
          maskTextCase={format.upper ? 'upper' : undefined}
          // A native mask fills its literals as the next slot is typed, and
          // backspace takes a literal with the slot before it, as in Uno.
          maskAutocomplete={false}
          maskAutoSkip
          keepPlaceholder={format.keepPlaceholder}
          placeholder={format.placeholder}
          placeholderTextColor={C.textTertiary}
          color={disabled ? C.textDisabled : C.text}
          fontFamily={FONT.regular}
          fontSize={BODY.fontSize}
          autoCorrect={false}
          autoCapitalize={format.upper ? 'characters' : 'none'}
          keyboardType={format.keyboardType}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChangeMask={(_formatted, extracted, _tail, isComplete) => {
            setRaw(format.upper ? extracted.toUpperCase() : extracted)
            setComplete(isComplete)
          }}
        />
        {/* The focus ring sits over the box's edge, 2px brand, and gives way to the error border. */}
        {focused && !invalid ? <View style={m.ring} pointerEvents="none" /> : null}
      </View>
      {invalid ? (
        <Text style={m.error}>{`That isn't a valid ${format.label}`}</Text>
      ) : (
        <>
          <Text style={m.description} testID={`${testID}-raw`}>
            Raw: {raw || '—'}
          </Text>
          {valid ? <Text style={m.success}>Valid</Text> : null}
        </>
      )}
    </View>
  )
}

const box: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  minHeight: 56,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: 'transparent',
  backgroundColor: C.surfaceSecondary,
  paddingHorizontal: 16,
}

const m = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.surface },
  body: { padding: 24, gap: 16 },
  section: { ...BODY_SMALL, fontFamily: FONT.regular, color: C.textSecondary, textTransform: 'uppercase', marginTop: 8 },
  root: { gap: 8 },
  label: { ...BODY_SMALL, fontFamily: FONT.regular, color: C.text },
  labelDisabled: { color: C.textDisabled },
  box,
  boxError: { borderColor: C.error },
  field: { flex: 1 },
  ring: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderRadius: 12, borderWidth: 2, borderColor: C.brand },
  description: { ...BODY_SMALL, fontFamily: FONT.regular, color: C.textSecondary, paddingHorizontal: 8 },
  success: { ...BODY_SMALL, fontFamily: FONT.regular, color: C.success, paddingHorizontal: 8 },
  error: { ...BODY_SMALL, fontFamily: FONT.regular, color: C.error, paddingHorizontal: 8 },
})
