import React from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { Host, Text, TextField, type TextFieldRef } from '@expo/ui/jetpack-compose'

/**
 * Expo UI's native field on Android — a Jetpack Compose `TextField`, where iOS
 * gets a SwiftUI one. The focus callback is spelled differently on each side,
 * so this shim gives the benchmark one shape to call.
 */
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
      <TextField ref={fieldRef} onFocusChanged={onFocusChange}>
        {placeholder ? (
          <TextField.Placeholder>
            <Text>{placeholder}</Text>
          </TextField.Placeholder>
        ) : null}
      </TextField>
    </Host>
  )
}
