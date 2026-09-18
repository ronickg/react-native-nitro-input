import React, { createRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { processColor } from 'react-native'
import { RollingNumber, type RollingNumberHandle } from '../RollingNumber'

function nativeProps(renderer: ReactTestRenderer) {
  return renderer.root.findByType('RollingNumberView' as never).props
}

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(element)
  })
  return renderer
}

describe('RollingNumber', () => {
  it('passes formatting props through and converts weight and color', () => {
    const renderer = render(
      <RollingNumber
        value={1234.5}
        fractionDigits={2}
        groupingSeparator=","
        prefix="$"
        suffix=" USD"
        fontWeight="bold"
        color="#ff0000"
        shimmerColor="#00ff00"
        textAlign="right"
      />
    )
    const props = nativeProps(renderer)
    expect(props.value).toBe(1234.5)
    expect(props.fractionDigits).toBe(2)
    expect(props.groupingSeparator).toBe(',')
    expect(props.prefix).toBe('$')
    expect(props.suffix).toBe(' USD')
    expect(props.fontWeight).toBe(700)
    expect(props.color).toBe(processColor('#ff0000'))
    expect(props.shimmerColor).toBe(processColor('#00ff00'))
    expect(props.textAlign).toBe('right')
  })

  it('maps numeric and string font weights', () => {
    expect(nativeProps(render(<RollingNumber value={1} fontWeight="600" />)).fontWeight).toBe(600)
    expect(nativeProps(render(<RollingNumber value={1} fontWeight={300} />)).fontWeight).toBe(300)
    expect(nativeProps(render(<RollingNumber value={1} fontWeight="semibold" />)).fontWeight).toBe(600)
    expect(nativeProps(render(<RollingNumber value={1} />)).fontWeight).toBeUndefined()
  })

  it('wraps hybridRef and onSizeChange as Nitro callbacks that stay referentially stable', () => {
    const renderer = render(<RollingNumber value={1} />)
    const first = nativeProps(renderer)
    expect(typeof first.hybridRef.f).toBe('function')
    expect(typeof first.onSizeChange.f).toBe('function')
    act(() => {
      renderer.update(<RollingNumber value={2} />)
    })
    const second = nativeProps(renderer)
    expect(second.hybridRef).toBe(first.hybridRef)
    expect(second.onSizeChange).toBe(first.onSizeChange)
    expect(second.value).toBe(2)
  })

  it('sizes itself from the native intrinsic size and lets style override it', () => {
    const renderer = render(<RollingNumber value={1} fontSize={40} style={{ width: 200 }} />)
    const before = nativeProps(renderer)
    expect(before.style).toEqual([{ height: 50 }, { width: 200 }])
    act(() => {
      before.onSizeChange.f(120, 48)
    })
    const after = nativeProps(renderer)
    expect(after.style).toEqual([{ width: 120, height: 48 }, { width: 200 }])
  })

  it('exposes animateTo, jumpTo and getValue on the handle once the native ref arrives', () => {
    const ref = createRef<RollingNumberHandle>()
    const onNativeRef = jest.fn()
    const renderer = render(<RollingNumber ref={ref} value={7} onNativeRef={onNativeRef} />)
    expect(ref.current?.native).toBeNull()
    ref.current?.animateTo(9) // no-op before mount, must not throw
    expect(ref.current?.getValue()).toBe(7)

    const native = { animateTo: jest.fn(), jumpTo: jest.fn(), value: 42 }
    act(() => {
      nativeProps(renderer).hybridRef.f(native)
    })
    expect(onNativeRef).toHaveBeenCalledWith(native)
    expect(ref.current?.native).toBe(native)
    ref.current?.animateTo(9)
    ref.current?.jumpTo(3.5)
    expect(native.animateTo).toHaveBeenCalledWith(9)
    expect(native.jumpTo).toHaveBeenCalledWith(3.5)
    expect(ref.current?.getValue()).toBe(42)
  })
})
