import React, { createRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { NitroInput, type NitroInputHandle } from '../NitroInput'

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

describe('NitroInput', () => {
  it('sends the defaults for every native prop', () => {
    const props = nativeProps(render(<NitroInput />))
    expect(props.text).toBe('')
    expect(props.mostRecentEventCount).toBe(0)
    expect(props.mode).toBe('text')
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
  })

  it('never sends undefined for a native prop', () => {
    const props = nativeProps(render(<NitroInput mode="number" value="1,234" />))
    for (const [key, value] of Object.entries(props)) {
      if (key === 'style' || key === 'hybridRef') continue
      expect([key, value]).not.toEqual([key, undefined])
      expect([key, value]).not.toEqual([key, null])
    }
  })

  it('picks a numeric keyboard in number mode', () => {
    expect(nativeProps(render(<NitroInput mode="number" />)).keyboardType).toBe('decimal-pad')
    expect(nativeProps(render(<NitroInput mode="number" fractionDigits={0} />)).keyboardType).toBe('number-pad')
    expect(nativeProps(render(<NitroInput mode="number" keyboardType="numeric" />)).keyboardType).toBe('numeric')
  })

  it('converts colors and font weights', () => {
    const props = nativeProps(render(<NitroInput color="#ff0000" fontWeight="bold" placeholderTextColor="#00ff00" />))
    expect(props.color).toBe(0xffff0000)
    expect(props.placeholderColor).toBe(0xff00ff00)
    expect(props.fontWeight).toBe(700)
  })

  it('keeps an uncontrolled field on its initial text', () => {
    const renderer = render(<NitroInput defaultValue="hello" />)
    expect(nativeProps(renderer).text).toBe('hello')
    act(() => {
      renderer.update(<NitroInput defaultValue="changed" />)
    })
    expect(nativeProps(renderer).text).toBe('hello')
  })

  it('maps onFocusChange to onFocus and onBlur', () => {
    const onFocus = jest.fn()
    const onBlur = jest.fn()
    const renderer = render(<NitroInput onFocus={onFocus} onBlur={onBlur} />)
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
    const renderer = render(<NitroInput value="1" onChangeText={onChangeText} />)
    const props = nativeProps(renderer)
    const callback = props.onChangeText as { f: (text: string, count: number) => void }
    act(() => {
      callback.f('12', 7)
    })
    expect(onChangeText).toHaveBeenCalledWith('12')
    expect(nativeProps(renderer).mostRecentEventCount).toBe(7)
  })

  it('keeps the callback props stable across renders', () => {
    const renderer = render(<NitroInput onChangeText={() => {}} onFocus={() => {}} />)
    const first = nativeProps(renderer)
    act(() => {
      renderer.update(<NitroInput onChangeText={() => {}} onFocus={() => {}} />)
    })
    const second = nativeProps(renderer)
    expect(second.onChangeText).toBe(first.onChangeText)
    expect(second.onFocusChange).toBe(first.onFocusChange)
    expect(second.onSubmitEditing).toBe(first.onSubmitEditing)
    expect(second.onChangeValue).toBe(first.onChangeValue)
    expect(second.onSizeChange).toBe(first.onSizeChange)
  })

  it('sizes itself from onSizeChange unless the style says otherwise', () => {
    const renderer = render(<NitroInput fontSize={40} />)
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
    const props = nativeProps(render(<NitroInput transform={transform} onChangeText={onChangeText} />))
    expect(props.transformWorklet).toBe(0)
    expect(props.onChangeTextWorklet).toBe(0)
    expect(props.onChangeValueWorklet).toBe(0)
    warn.mockRestore()
  })

  it('exposes a handle whose methods are no-ops before mount', () => {
    const ref = createRef<NitroInputHandle>()
    render(<NitroInput ref={ref} defaultValue="abc" />)
    expect(ref.current).not.toBeNull()
    expect(() => ref.current!.focus()).not.toThrow()
    expect(ref.current!.getText()).toBe('abc')
    expect(Number.isNaN(ref.current!.getValue())).toBe(true)
    expect(ref.current!.isFocused()).toBe(false)
    expect(ref.current!.native).toBeNull()
  })
})
