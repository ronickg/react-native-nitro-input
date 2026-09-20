import React, { forwardRef } from 'react'
import {
  NitroInput,
  type NitroInputHandle,
  type NitroInputProps,
  type NitroInputRef,
} from './NitroInput'

/**
 * A field whose text morphs as it changes: digits roll into place, grouping
 * separators slide through the line box, other characters fade and scale. In
 * `mode="number"` every edit is formatted natively before a frame is drawn, so
 * the morph and the formatting are the same event.
 *
 * This is {@link NitroInput} with the glyph engine on and content sizing
 * inferred, which is what an amount wants — the box grows as digits arrive.
 * Reach for it where the morph is the point; for an ordinary form field use
 * `NitroInput`, which does not animate its characters and takes its width from
 * its parent the way a `TextInput` does.
 */
export type MorphInputProps = Omit<NitroInputProps, 'morph'>
export type MorphInputHandle = NitroInputHandle
export type MorphInputRef = NitroInputRef

export const MorphInput = forwardRef<MorphInputHandle, MorphInputProps>(
  function MorphInput({ autoWidth = 'auto', ...props }, ref) {
    return <NitroInput {...props} autoWidth={autoWidth} ref={ref} morph />
  }
)
