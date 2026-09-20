import React, { forwardRef } from 'react'
import {
  MorphInput,
  type MorphInputHandle,
  type MorphInputProps,
} from './MorphInput'

/**
 * A native text field, and nothing more: the system field draws its own text,
 * so there is no glyph engine, no per-glyph layers and no custom caret, and the
 * view costs no more to mount than a plain `UITextField` / `EditText`.
 *
 * This is the general-purpose input. It keeps everything the wrapper is
 * actually for — native formatting in `'number'` mode, the direct focus path,
 * React Native's text-input registry (so `Keyboard.dismiss()`,
 * `currentlyFocusedInput()` and `keyboardShouldPersistTaps` work) and
 * keyboard-controller support — and leaves out only the animation.
 *
 * Reach for {@link MorphInput} where the morph is the point, which in practice
 * means amounts.
 */
export type NitroInputProps = Omit<
  MorphInputProps,
  'plain' | 'duration' | 'easing' | 'bounce' | 'effect'
>

export type NitroInputHandle = MorphInputHandle

export const NitroInput = forwardRef<NitroInputHandle, NitroInputProps>(
  function NitroInput(props, ref) {
    // `autoWidth` off by default: a `TextInput` takes its width from its
    // parent, and a drop-in has to do the same. Pass `autoWidth` explicitly to
    // get the content-sizing behaviour back.
    return <MorphInput autoWidth={false} {...props} ref={ref} plain />
  }
)
