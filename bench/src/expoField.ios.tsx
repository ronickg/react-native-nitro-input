import React from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { Host, TextField, type TextFieldRef } from '@expo/ui/swift-ui'

/** Expo UI's native field, normalised across the two platform APIs. */
export type ExpoFieldRef = TextFieldRef

export function ExpoField({
  fieldRef,
  placeholder,
  style,
  onFocusChange,
}: {
  fieldRef?: React.Ref<ExpoFieldRef>
  placeholder?: string
  style?: StyleProp<ViewStyle>
  onFocusChange?: (focused: boolean) => void
}) {
  return (
    <Host style={style} matchContents>
      <TextField ref={fieldRef} placeholder={placeholder} onFocusChange={onFocusChange} />
    </Host>
  )
}
