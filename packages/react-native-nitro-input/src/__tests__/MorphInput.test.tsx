import React, { createRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MorphInput, type MorphInputHandle } from '../MorphInput'
import { NitroInput } from '../NitroInput'

function render(element: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined
  act(() => {
    renderer = create(element)
  })
  return renderer!
}

function nativeProps(renderer: ReactTestRenderer): Record<string, unknown> {
  const host = renderer.root.findByType('NitroInputView' as never)
  return host.props as Record<string, unknown>
}

describe('MorphInput', () => {
  it('sends the defaults for every native prop', () => {
    const props = nativeProps(render(<MorphInput />))
    expect(props.text).toBe('')
    expect(props.mostRecentEventCount).toBe(0)
    expect(props.mode).toBe('text')
    expect(props.mask).toBe('')
    expect(props.maskNotations).toEqual([])
    expect(props.maskAutocomplete).toBe(true)
    expect(props.maskAutoSkip).toBe(false)
    expect(props.keyboardType).toBe('default')
    expect(props.groupingSeparator).toBe(',')
    expect(props.decimalSeparator).toBe('.')
    expect(props.fractionDigits).toBe(2)
    expect(props.duration).toBe(400)
    expect(props.easing).toBe('expo')
    expect(props.effect).toBe('auto')
    expect(props.fontSize).toBe(32)
    expect(props.prefixFontSize).toBe(32)
    expect(props.affixAlign).toBe('baseline')
    expect(props.prefixAlign).toBe('baseline')
    expect(Number.isNaN(props.color)).toBe(true)
    expect(Number.isNaN(props.placeholderColor)).toBe(true)
    expect(props.fontFamily).toBe('')
    expect(props.maxLength).toBe(0)
    expect(props.editable).toBe(true)
    expect(props.submitBehavior).toBe('blurAndSubmit')
    expect(props.secureTextEntry).toBe(false)
    expect(props.keyboardAppearance).toBe('default')
    expect(props.textContentType).toBe('')
    expect(props.showSoftInputOnFocus).toBe(true)
    expect(props.spellCheck).toBe(true)
    expect(props.selectionStart).toBe(-1)
    expect(props.selectionEnd).toBe(-1)
  })

  it('maps the React Native aliases onto the native props', () => {
    // `blurOnSubmit={false}` is React Native's older spelling of 'submit'.
    expect(nativeProps(render(<MorphInput blurOnSubmit={false} />)).submitBehavior).toBe('submit')
    expect(nativeProps(render(<MorphInput submitBehavior="submit" blurOnSubmit />)).submitBehavior).toBe('submit')
    // `readOnly` is an alias of `editable={false}`.
    expect(nativeProps(render(<MorphInput readOnly />)).editable).toBe(false)
    expect(nativeProps(render(<MorphInput editable={false} />)).editable).toBe(false)
    // `autoComplete` fills in for `textContentType` when that is not given.
    expect(nativeProps(render(<MorphInput autoComplete="username" />)).textContentType).toBe('username')
    expect(
      nativeProps(render(<MorphInput autoComplete="username" textContentType="password" />)).textContentType
    ).toBe('password')
    // `spellCheck` follows `autoCorrect` unless it is set itself.
    expect(nativeProps(render(<MorphInput autoCorrect={false} />)).spellCheck).toBe(false)
    expect(nativeProps(render(<MorphInput autoCorrect={false} spellCheck />)).spellCheck).toBe(true)
  })

  it('renders the plain field with the overlay off and the morph one with it on', () => {
    expect(nativeProps(render(<MorphInput />)).plain).toBe(false)
    expect(nativeProps(render(<NitroInput />)).plain).toBe(true)
    // NitroInput is the same component underneath, so the rest still applies.
    const props = nativeProps(render(<NitroInput mode="number" placeholder="0" testID="amount" />))
    expect(props.mode).toBe('number')
    expect(props.placeholder).toBe('0')
    expect(props.fieldTestID).toBe('amount')
  })

  it('forwards the field identity so the hidden system field carries it', () => {
    const props = nativeProps(render(<MorphInput testID="amount" accessibilityLabel="Amount" />))
    expect(props.fieldTestID).toBe('amount')
    expect(props.fieldAccessibilityLabel).toBe('Amount')
    // testID stays on the host (existing tests may query it), the label does
    // not: it would otherwise be on two accessibility elements.
    expect(props.testID).toBe('amount')
    expect('accessibilityLabel' in props).toBe(false)
  })

  it('sends a controlled selection and nothing when there is none', () => {
    const none = nativeProps(render(<MorphInput />))
    expect(none.selectionStart).toBe(-1)
    expect(none.selectionEnd).toBe(-1)
    const caret = nativeProps(render(<MorphInput selection={{ start: 3 }} />))
    expect(caret.selectionStart).toBe(3)
    expect(caret.selectionEnd).toBe(3)
    const range = nativeProps(render(<MorphInput selection={{ start: 1, end: 4 }} />))
    expect(range.selectionStart).toBe(1)
    expect(range.selectionEnd).toBe(4)
  })

  it('never sends undefined for a native prop', () => {
    const props = nativeProps(render(<MorphInput mode="number" value="1,234" />))
    for (const [key, value] of Object.entries(props)) {
      if (key === 'style' || key === 'hybridRef') continue
      expect([key, value]).not.toEqual([key, undefined])
      expect([key, value]).not.toEqual([key, null])
    }
  })

  it('picks a numeric keyboard in number mode', () => {
    expect(nativeProps(render(<MorphInput mode="number" />)).keyboardType).toBe('decimal-pad')
    expect(nativeProps(render(<MorphInput mode="number" fractionDigits={0} />)).keyboardType).toBe('number-pad')
    expect(nativeProps(render(<MorphInput mode="number" keyboardType="numeric" />)).keyboardType).toBe('numeric')
  })

  it('converts colors and font weights', () => {
    const props = nativeProps(render(<MorphInput color="#ff0000" fontWeight="bold" placeholderTextColor="#00ff00" />))
    expect(props.color).toBe(0xffff0000)
    expect(props.placeholderColor).toBe(0xff00ff00)
    expect(props.fontWeight).toBe(700)
  })

  it('keeps an uncontrolled field on its initial text', () => {
    const renderer = render(<MorphInput defaultValue="hello" />)
    expect(nativeProps(renderer).text).toBe('hello')
    act(() => {
      renderer.update(<MorphInput defaultValue="changed" />)
    })
    expect(nativeProps(renderer).text).toBe('hello')
  })

  it('maps onFocusChange to onFocus and onBlur', () => {
    const onFocus = jest.fn()
    const onBlur = jest.fn()
    const renderer = render(<MorphInput onFocus={onFocus} onBlur={onBlur} />)
    const callback = nativeProps(renderer).onFocusChange as { f: (focused: boolean) => void }
    act(() => {
      callback.f(true)
      callback.f(false)
    })
    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it('reports the event count of the latest native edit back to native', () => {
    const onChangeText = jest.fn()
    const renderer = render(<MorphInput value="1" onChangeText={onChangeText} />)
    const props = nativeProps(renderer)
    const callback = props.onChangeText as { f: (text: string, count: number) => void }
    act(() => {
      callback.f('12', 7)
    })
    expect(onChangeText).toHaveBeenCalledWith('12')
    expect(nativeProps(renderer).mostRecentEventCount).toBe(7)
  })

  it('keeps the callback props stable across renders', () => {
    const renderer = render(<MorphInput onChangeText={() => {}} onFocus={() => {}} />)
    const first = nativeProps(renderer)
    act(() => {
      renderer.update(<MorphInput onChangeText={() => {}} onFocus={() => {}} />)
    })
    const second = nativeProps(renderer)
    expect(second.onChangeText).toBe(first.onChangeText)
    expect(second.onFocusChange).toBe(first.onFocusChange)
    expect(second.onSubmitEditing).toBe(first.onSubmitEditing)
    expect(second.onChangeValue).toBe(first.onChangeValue)
    expect(second.onSizeChange).toBe(first.onSizeChange)
  })

  it('sizes itself from onSizeChange unless the style says otherwise', () => {
    const renderer = render(<MorphInput fontSize={40} />)
    expect(nativeProps(renderer).style).toEqual([{ height: 50 }, undefined])
    const onSizeChange = nativeProps(renderer).onSizeChange as { f: (w: number, h: number) => void }
    act(() => {
      onSizeChange.f(120, 48)
    })
    expect(nativeProps(renderer).style).toEqual([{ width: 120, height: 48 }, undefined])
  })

  it('sends no worklet ids when worklets are unavailable', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const transform = Object.assign(() => null, { __workletHash: 1 })
    const onChangeText = Object.assign(() => {}, { __workletHash: 2 })
    const props = nativeProps(render(<MorphInput transform={transform} onChangeText={onChangeText} />))
    expect(props.transformWorklet).toBe(0)
    expect(props.onChangeTextWorklet).toBe(0)
    expect(props.onChangeValueWorklet).toBe(0)
    warn.mockRestore()
  })

  it('sends no worklet id for any of the event handlers when worklets are unavailable', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const worklet = () => Object.assign(() => {}, { __workletHash: 3 })
    const props = nativeProps(
      render(
        <MorphInput
          onFocus={worklet()}
          onBlur={worklet()}
          onSelectionChange={worklet()}
          onSubmitEditing={worklet()}
          onEndEditing={worklet()}
          onKeyPress={worklet()}
        />
      )
    )
    for (const key of [
      'onFocusChangeWorklet',
      'onSelectionChangeWorklet',
      'onSubmitEditingWorklet',
      'onEndEditingWorklet',
      'onKeyPressWorklet',
    ]) {
      expect(props[key]).toBe(0)
    }
    warn.mockRestore()
  })

  it('does not call a worklet handler on the JS thread as well', () => {
    // A worklet already ran on the UI runtime; calling it here would fire it
    // twice, and on the wrong thread.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const onSubmitEditing = Object.assign(jest.fn(), { __workletHash: 4 })
    const onKeyPress = Object.assign(jest.fn(), { __workletHash: 5 })
    const renderer = render(<MorphInput onSubmitEditing={onSubmitEditing} onKeyPress={onKeyPress} />)
    const props = nativeProps(renderer)
    act(() => {
      ;(props.onSubmitEditing as { f: (t: string) => void }).f('done')
      ;(props.onKeyPress as { f: (k: string) => void }).f('a')
    })
    expect(onSubmitEditing).not.toHaveBeenCalled()
    expect(onKeyPress).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('still calls a plain handler on the JS thread', () => {
    const onSubmitEditing = jest.fn()
    const renderer = render(<MorphInput onSubmitEditing={onSubmitEditing} />)
    const props = nativeProps(renderer)
    act(() => {
      ;(props.onSubmitEditing as { f: (t: string) => void }).f('done')
    })
    expect(onSubmitEditing).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'done', nativeEvent: expect.objectContaining({ text: 'done' }) })
    )
  })

  it('exposes a handle whose methods are no-ops before mount', () => {
    const ref = createRef<MorphInputHandle>()
    render(<MorphInput ref={ref} defaultValue="abc" />)
    expect(ref.current).not.toBeNull()
    expect(() => ref.current!.focus()).not.toThrow()
    expect(ref.current!.getText()).toBe('abc')
    expect(Number.isNaN(ref.current!.getValue())).toBe(true)
    expect(ref.current!.isFocused()).toBe(false)
    expect(ref.current!.native).toBeNull()
  })
  it('passes the mask through only in mask mode', () => {
    const notations = [
      { character: 'H', characterSet: '0123456789abcdef', isOptional: false },
    ]
    const masked = nativeProps(
      render(
        <MorphInput
          mode="mask"
          mask="+1 ([000]) [000]-[0000]"
          maskNotations={notations}
          maskAutoSkip
        />
      )
    )
    expect(masked.mode).toBe('mask')
    expect(masked.mask).toBe('+1 ([000]) [000]-[0000]')
    expect(masked.maskNotations).toEqual(notations)
    expect(masked.maskAutoSkip).toBe(true)
    expect(masked.maskAutocomplete).toBe(true)

    // A mask left on the props while the mode is something else must not reach
    // native, or the field would silently mask a plain text input.
    const text = nativeProps(render(<MorphInput mask="[000]" />))
    expect(text.mode).toBe('text')
    expect(text.mask).toBe('')
  })

  it('keeps the mask callback stable across renders', () => {
    const renderer = render(<MorphInput mode="mask" mask="[000]" onChangeMask={() => {}} />)
    const first = nativeProps(renderer).onChangeMask
    act(() => {
      renderer.update(<MorphInput mode="mask" mask="[000]" onChangeMask={() => {}} />)
    })
    expect(nativeProps(renderer).onChangeMask).toBe(first)
  })
  it('maps inputMode and enterKeyHint like React Native does', () => {
    expect(nativeProps(render(<MorphInput inputMode="decimal" />)).keyboardType).toBe('decimal-pad')
    expect(nativeProps(render(<MorphInput inputMode="tel" />)).keyboardType).toBe('phone-pad')
    expect(nativeProps(render(<MorphInput inputMode="email" />)).keyboardType).toBe('email-address')
    expect(nativeProps(render(<MorphInput enterKeyHint="go" />)).returnKeyType).toBe('go')
    expect(nativeProps(render(<MorphInput enterKeyHint="enter" />)).returnKeyType).toBe('default')

    // `inputMode="none"` focuses without a keyboard.
    const none = nativeProps(render(<MorphInput inputMode="none" />))
    expect(none.showSoftInputOnFocus).toBe(false)

    // An explicit prop always wins over the alias, as in RN.
    const explicit = nativeProps(
      render(<MorphInput inputMode="tel" keyboardType="url" enterKeyHint="go" returnKeyType="send" />)
    )
    expect(explicit.keyboardType).toBe('url')
    expect(explicit.returnKeyType).toBe('send')
  })

  it('fires onChange alongside onChangeText', () => {
    const onChange = jest.fn()
    const onChangeText = jest.fn()
    const renderer = render(<MorphInput onChange={onChange} onChangeText={onChangeText} />)
    const native = nativeProps(renderer).onChangeText as { f: (t: string, c: number) => void }
    act(() => {
      native.f('abc', 3)
    })
    expect(onChangeText).toHaveBeenCalledWith('abc')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].nativeEvent).toEqual({
      text: 'abc',
      eventCount: 3,
      target: expect.any(Number),
    })
  })
})
