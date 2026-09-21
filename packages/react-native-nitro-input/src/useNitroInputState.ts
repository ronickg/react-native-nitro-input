import { useMemo } from 'react'
import type { NitroInputSelection } from './worklets'

// ---------------------------------------------------------------------------
// The field's state as shared values, so an animation can read it on the UI
// thread without a re-render.
//
// It is built out of the worklet callbacks rather than anything new: mark a
// handler `'worklet'` and it runs on the UI runtime, which is where a shared
// value must be written from. The hook just wires that up for you and hands
// back the handlers to spread onto the field.
// ---------------------------------------------------------------------------

/** The subset of Reanimated's `SharedValue` this needs; typed here so the library does not depend on it. */
export interface SharedValueLike<T> {
  value: T
}

type MakeShared = <T>(initial: T) => SharedValueLike<T>

export interface NitroInputState {
  /** The field's text, updated on the UI thread as it is typed. */
  text: SharedValueLike<string>
  /** `'number'` mode: the numeric value, `NaN` while empty. */
  value: SharedValueLike<number>
  /** Whether the field holds focus. */
  focused: SharedValueLike<boolean>
  /** The caret or selection, in code points. */
  selection: SharedValueLike<NitroInputSelection>
  /**
   * Spread onto the field. Every handler is a worklet, so none of them
   * re-renders; pass your own alongside if you also need JS.
   */
  handlers: {
    onChangeText: (text: string) => void
    onChangeValue: (value: number) => void
    onFocus: () => void
    onBlur: () => void
    onSelectionChange: (event: { start: number; end: number }) => void
  }
}

/**
 * Wires a field's state into shared values you can animate from.
 *
 * Reanimated is not a dependency of this library, so pass its `useSharedValue`
 * in — it is the only thing needed, and taking it as an argument keeps the
 * import out of the bundle of anyone who does not animate:
 *
 * ```tsx
 * import { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated'
 *
 * const field = useNitroInputState(useSharedValue)
 * const border = useAnimatedStyle(() => ({
 *   borderColor: withTiming(field.focused.value ? '#2563eb' : '#94a3b8'),
 * }))
 *
 * <Animated.View style={border}>
 *   <NitroInput {...field.handlers} />
 * </Animated.View>
 * ```
 *
 * Nothing above re-renders while you type: the handlers run on the UI runtime,
 * write to shared values there, and the style reads them there.
 */
export function useNitroInputState(useSharedValue: MakeShared): NitroInputState {
  const text = useSharedValue('')
  const value = useSharedValue(Number.NaN)
  const focused = useSharedValue(false)
  const selection = useSharedValue<NitroInputSelection>({ start: 0, end: 0 })

  // Stable for the field's lifetime: a new function identity would re-register
  // the worklet on the UI runtime every render.
  const handlers = useMemo(
    () => ({
      onChangeText: (next: string) => {
        'worklet'
        text.value = next
      },
      onChangeValue: (next: number) => {
        'worklet'
        value.value = next
      },
      onFocus: () => {
        'worklet'
        focused.value = true
      },
      onBlur: () => {
        'worklet'
        focused.value = false
      },
      onSelectionChange: (event: { start: number; end: number }) => {
        'worklet'
        selection.value = { start: event.start, end: event.end }
      },
    }),
    [text, value, focused, selection]
  )

  return { text, value, focused, selection, handlers }
}
