import React, { forwardRef } from 'react'
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { NitroInput, type NitroInputHandle, type NitroInputProps } from './NitroInput'

/** What a {@link NitroText} takes: the text, its typography and the reflow's timing. */
export interface NitroTextProps
  extends Pick<
    NitroInputProps,
    | 'fontSize'
    | 'lineHeight'
    | 'fontWeight'
    | 'fontFamily'
    | 'color'
    | 'textAlign'
    | 'letterSpacing'
    | 'duration'
    | 'easing'
    | 'bounce'
    | 'effect'
    | 'allowFontScaling'
    | 'maxFontSizeMultiplier'
    | 'adjustsFontSizeToFit'
    | 'minimumFontScale'
    | 'testID'
    | 'onLayout'
    | 'nativeID'
  > {
  /** The text. A change moves every character that stays to where the new text puts it. */
  children: string | number
  style?: StyleProp<ViewStyle | TextStyle>
  /** What a screen reader reads. Default: the text. */
  accessibilityLabel?: string
}

/**
 * A label that morphs from one text to the next, as Torph does on the web:
 * the characters the two texts share keep their shapes and move to where
 * the new text puts them, the rest fade out and in ("Sign in" → "Signing
 * in…", "$1,204" → "$1,318"). It is the reflowing `NitroInput`, read-only:
 * not focusable, no caret, sized to its text.
 */
export const NitroText = forwardRef<NitroInputHandle, NitroTextProps>(function NitroText(
  { children, style, accessibilityLabel, testID, onLayout, nativeID, ...props },
  ref
) {
  const text = String(children)
  // One text element for a screen reader: the field inside would read as a
  // dimmed text field.
  return (
    <View
      style={[{ alignSelf: 'flex-start' }, style as StyleProp<ViewStyle>]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? text}
      testID={testID}
      nativeID={nativeID}
      onLayout={onLayout}
      pointerEvents="none"
    >
      <NitroInput
        ref={ref}
        transition="reflow"
        value={text}
        editable={false}
        caretHidden
        contextMenuHidden
        showSoftInputOnFocus={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        {...props}
      />
    </View>
  )
})
