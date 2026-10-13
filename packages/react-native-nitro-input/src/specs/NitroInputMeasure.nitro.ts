import type { HybridObject } from 'react-native-nitro-modules'
import type {
  NitroInputCharacterMapping,
  NitroInputLabelBehavior,
  NitroInputMaskAffinity,
  NitroInputMode,
  NitroInputNotation,
  NitroInputSignPlacement,
  NitroInputTextCase,
  NitroInputVariant,
} from './NitroInput.nitro'

/**
 * What a field's size follows: the subset of `NitroInputProps` the
 * native views read when they report `onSizeChange`, under the same names and
 * already resolved the same way by `NitroInput`.
 */
export interface NitroInputSizing {
  text: string
  mode: NitroInputMode
  plain: boolean
  multiline: boolean
  secureTextEntry: boolean
  maxLength: number
  fractionDigits: number
  maxIntegerDigits: number
  groupingSeparator: string
  decimalSeparator: string
  prefix: string
  suffix: string
  signPlacement: NitroInputSignPlacement
  placeholder: string
  mask: string
  maskNotations: NitroInputNotation[]
  maskAutocomplete: boolean
  maskAutoSkip: boolean
  maskAffinityFormats: string[]
  maskAffinityStrategy: NitroInputMaskAffinity
  maskTextCase: NitroInputTextCase
  maskCharacterMap: NitroInputCharacterMapping[]
  maskSlotPlaceholder: string
  keepPlaceholder: boolean
  textSize: number
  textLineHeight: number
  prefixFontSize: number
  suffixFontSize: number
  textWeight: number
  textFamily: string
  textLetterSpacing: number
  tabularNums: boolean
  slotDigits: boolean
  prefixSpacing: number
  suffixSpacing: number
  allowFontScaling: boolean
  maxFontSizeMultiplier: number
  variant: NitroInputVariant
  label: string
  labelBehavior: NitroInputLabelBehavior
  labelFontSize: number
  cornerRadius: number
}

/** A size in points (iOS) or dp (Android). */
export interface NitroInputSize {
  width: number
  height: number
}

/**
 * Measures a single-line field on the JS thread, before its view exists, with
 * the code the view sizes itself with: `NitroInput` lays out at its real size
 * in the commit that mounts it, as React Native's `TextInput` does, instead of
 * at its parent's width until the view's first `onSizeChange` arrives.
 */
export interface NitroInputMeasure extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** What the field reports through `onSizeChange` once mounted, unfocused. */
  measure(sizing: NitroInputSizing): NitroInputSize
}
