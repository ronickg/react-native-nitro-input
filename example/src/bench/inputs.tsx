import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native'
import { MorphInput, NitroInput, type NitroInputHandle } from 'react-native-nitro-input'
import MaskInput, { createNumberMask } from 'react-native-mask-input'
import CurrencyInput from 'react-native-currency-input'
import { MaskedTextInput, type MaskedTextInputRef } from 'react-native-advanced-input-mask'
import { ExpoField, type ExpoFieldRef } from '../expoField'

export type InputImplKey =
  | 'rn-text'
  | 'nitro-text'
  | 'morph-text'
  | 'rn-number-js'
  | 'currency-input'
  | 'mask-input'
  | 'nitro-number'
  | 'morph-number'
  | 'advanced-mask'
  | 'nitro-mask'
  | 'expo'

export type InputImpl = {
  key: InputImplKey
  label: string
  short: string
  package: string
  how: string
  /** What the typing driver types into it. */
  keys: string
}

/** Digits only: a number field formats them, a text field just shows them. */
const DIGITS = '123456789012'
const PHONE = '1234567890'
const PHONE_MASK = '[000] [000] [0000]'

/** Every field the harness can drive, in the order the tables list them. */
export const INPUT_IMPLS: InputImpl[] = [
  { key: 'rn-text', label: 'TextInput (text)', short: 'TextInput', package: 'react-native', how: "React Native's own field, uncontrolled: the floor.", keys: DIGITS },
  { key: 'nitro-text', label: 'NitroInput (text)', short: 'NitroInput text', package: 'react-native-nitro-input', how: 'The plain field, uncontrolled: a system field inside a Nitro view.', keys: DIGITS },
  { key: 'morph-text', label: 'MorphInput (text)', short: 'MorphInput text', package: 'react-native-nitro-input', how: 'The morphing field: every keystroke animates glyphs on an overlay.', keys: DIGITS },
  { key: 'rn-number-js', label: 'TextInput + JS formatting', short: 'TextInput + JS', package: 'react-native', how: 'The usual amount field: controlled, formatted with Intl in onChangeText, the formatted text sent back as value.', keys: DIGITS },
  { key: 'currency-input', label: 'react-native-currency-input', short: 'currency-input', package: 'react-native-currency-input', how: 'A controlled TextInput formatting the amount in JS on every change.', keys: DIGITS },
  { key: 'mask-input', label: 'react-native-mask-input (number mask)', short: 'mask-input', package: 'react-native-mask-input', how: 'A controlled TextInput applying a number mask in JS on every change.', keys: DIGITS },
  { key: 'nitro-number', label: 'NitroInput (number)', short: 'NitroInput number', package: 'react-native-nitro-input', how: 'mode="number": grouping and prefix applied natively inside the edit, before a frame is drawn.', keys: DIGITS },
  { key: 'morph-number', label: 'MorphInput (number)', short: 'MorphInput number', package: 'react-native-nitro-input', how: 'The same native formatting, with the digits morphing into place.', keys: DIGITS },
  { key: 'advanced-mask', label: 'react-native-advanced-input-mask', short: 'advanced-input-mask', package: 'react-native-advanced-input-mask', how: 'A native (Fabric) masked field; the phone mask below.', keys: PHONE },
  { key: 'nitro-mask', label: 'NitroInput (mask)', short: 'NitroInput mask', package: 'react-native-nitro-input', how: 'mode="mask" with the same phone mask, applied natively.', keys: PHONE },
  { key: 'expo', label: 'Expo UI TextField', short: 'Expo UI', package: '@expo/ui', how: 'The SwiftUI / Compose field behind an Expo host view.', keys: DIGITS },
]

export type InputHandle = { focus(): void; blur(): void }

const FONT_SIZE = 20

/** The controlled amount field most apps write: format in onChangeText, hand the result back as value. */
type TextInputInstance = React.ComponentRef<typeof TextInput>
/** The third-party fields type their ref as the `TextInput` class; React Native 0.87 types the instance differently, and the object is the same. */
const asClassRef = (ref: React.RefObject<TextInputInstance | null>) => ref as unknown as React.Ref<TextInput>

const JsFormattedInput = forwardRef<TextInputInstance, { onChangeText?: (text: string) => void; onFocus?: () => void; onBlur?: () => void }>(
  ({ onChangeText, onFocus, onBlur }, ref) => {
    const [text, setText] = useState('')
    const fmt = useMemo(() => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: true }), [])
    return (
      <TextInput
        ref={ref}
        style={styles.rnField}
        value={text}
        keyboardType="number-pad"
        onChangeText={(t) => {
          const digits = t.replace(/\D/g, '')
          const next = digits ? '$' + fmt.format(Number(digits)) : ''
          setText(next)
          onChangeText?.(next)
        }}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    )
  },
)

const NUMBER_MASK = createNumberMask({ prefix: ['$'], delimiter: ',', separator: '.', precision: 0 })

/** One field of `impl`, with a uniform focus/blur handle and change/focus callbacks. */
export const InputItem = forwardRef<
  InputHandle,
  {
    impl: InputImplKey
    onChangeText?: (text: string) => void
    onFocus?: () => void
    onBlur?: () => void
    style?: StyleProp<ViewStyle>
  }
>(({ impl, onChangeText, onFocus, onBlur, style }, ref) => {
  const rn = useRef<TextInputInstance>(null)
  const nitro = useRef<NitroInputHandle>(null)
  const advanced = useRef<MaskedTextInputRef>(null)
  const expo = useRef<ExpoFieldRef>(null)
  const [currency, setCurrency] = useState<number | null>(null)
  const [masked, setMasked] = useState('')

  useImperativeHandle(ref, () => ({
    focus: () => {
      rn.current?.focus()
      nitro.current?.focus()
      advanced.current?.focus()
      void expo.current?.focus()
    },
    blur: () => {
      rn.current?.blur()
      nitro.current?.blur()
      advanced.current?.blur()
      void expo.current?.blur()
    },
  }))

  const focusProps = { onFocus, onBlur }
  switch (impl) {
    case 'rn-text':
      return <TextInput ref={rn} style={[styles.rnField, style]} onChangeText={onChangeText} {...focusProps} />
    case 'nitro-text':
      return <NitroInput ref={nitro} style={[styles.field, style]} fontSize={FONT_SIZE} onChangeText={onChangeText} {...focusProps} />
    case 'morph-text':
      return <MorphInput ref={nitro} style={[styles.field, style]} fontSize={FONT_SIZE} onChangeText={onChangeText} {...focusProps} />
    case 'rn-number-js':
      return <JsFormattedInput ref={rn} onChangeText={onChangeText} {...focusProps} />
    case 'currency-input':
      return (
        <CurrencyInput
          ref={asClassRef(rn)}
          style={[styles.rnField, style]}
          value={currency}
          onChangeValue={setCurrency}
          onChangeText={onChangeText}
          prefix="$"
          delimiter=","
          separator="."
          precision={0}
          {...focusProps}
        />
      )
    case 'mask-input':
      return (
        <MaskInput
          ref={asClassRef(rn)}
          style={[styles.rnField, style]}
          value={masked}
          mask={NUMBER_MASK}
          keyboardType="number-pad"
          onChangeText={(text) => {
            setMasked(text)
            onChangeText?.(text)
          }}
          {...focusProps}
        />
      )
    case 'nitro-number':
      return (
        <NitroInput ref={nitro} style={[styles.field, style]} mode="number" prefix="$" fractionDigits={0} fontSize={FONT_SIZE} onChangeText={onChangeText} {...focusProps} />
      )
    case 'morph-number':
      return (
        <MorphInput ref={nitro} style={[styles.field, style]} mode="number" prefix="$" fractionDigits={0} fontSize={FONT_SIZE} onChangeText={onChangeText} {...focusProps} />
      )
    case 'advanced-mask':
      return (
        <MaskedTextInput
          ref={advanced}
          style={[styles.rnField, style]}
          mask={PHONE_MASK}
          keyboardType="number-pad"
          onChangeText={(formatted) => onChangeText?.(formatted)}
          {...focusProps}
        />
      )
    case 'nitro-mask':
      return (
        <NitroInput ref={nitro} style={[styles.field, style]} mode="mask" mask={PHONE_MASK} fontSize={FONT_SIZE} onChangeText={onChangeText} {...focusProps} />
      )
    case 'expo':
      return (
        <View style={style}>
          <ExpoField fieldRef={expo} style={styles.field} placeholder="" onFocusChange={(focused) => (focused ? onFocus?.() : onBlur?.())} />
        </View>
      )
  }
})

const styles = StyleSheet.create({
  field: { height: 44, borderWidth: 1, borderColor: '#c9ccd3', borderRadius: 8, paddingHorizontal: 10, backgroundColor: '#fff' },
  rnField: { height: 44, borderWidth: 1, borderColor: '#c9ccd3', borderRadius: 8, paddingHorizontal: 10, backgroundColor: '#fff', fontSize: FONT_SIZE, color: '#111' },
})
