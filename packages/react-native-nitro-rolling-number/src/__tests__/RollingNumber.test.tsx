import React, { createRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { I18nManager, processColor } from 'react-native'
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
    expect(nativeProps(render(<RollingNumber value={1} />)).fontWeight).toBe(400)
  })

  it('never sends undefined for a native prop (a removed prop reaches native as null, which Nitro rejects)', () => {
    const renderer = render(
      <RollingNumber value={1} prefix="$" suffix=" USD" color="#ff0000" fontFamily="Menlo" prefixFontSize={20} loading reveal />
    )
    act(() => {
      renderer.update(<RollingNumber value={1} />)
    })
    const props = nativeProps(renderer)
    for (const [key, val] of Object.entries(props)) {
      if (key === 'style' || key === 'children') continue
      expect([key, val === undefined]).toEqual([key, false])
    }
    expect(props.prefix).toBe('')
    expect(props.suffix).toBe('')
    expect(props.fontFamily).toBe('')
    expect(Number.isNaN(props.color)).toBe(true)
    expect(Number.isNaN(props.shimmerColor)).toBe(true)
    expect(props.prefixFontSize).toBe(32)
    expect(props.loading).toBe(false)
    expect(props.revealState).toBe(0)
    expect(props.revealMilestones).toEqual([])
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

  it('passes the jackpot reveal props through with stable callbacks and milestones', () => {
    const onRevealEnd = jest.fn()
    const onRevealMilestone = jest.fn()
    const renderer = render(
      <RollingNumber
        value={50000}
        reveal={false}
        revealStyle="spin"
        revealDuration={1800}
        revealBounce={0.1}
        revealStagger={150}
        revealMilestones={[1000, 10000]}
        revealMilestoneHold={350}
        onRevealEnd={onRevealEnd}
        onRevealMilestone={onRevealMilestone}
      />
    )
    const first = nativeProps(renderer)
    expect(first.revealState).toBe(1) // reveal={false}: hold the opening frame
    expect(first.revealStyle).toBe('spin')
    expect(first.revealDuration).toBe(1800)
    expect(first.revealBounce).toBe(0.1)
    expect(first.revealStagger).toBe(150)
    expect(first.revealMilestones).toEqual([1000, 10000])
    expect(first.revealMilestoneHold).toBe(350)
    expect(typeof first.onRevealEnd.f).toBe('function')
    expect(typeof first.onRevealMilestone.f).toBe('function')

    // A new inline handler or a fresh array literal must not re-set the native props.
    const laterEnd = jest.fn()
    act(() => {
      renderer.update(
        <RollingNumber
          value={50000}
          reveal
          revealStyle="spin"
          revealMilestones={[1000, 10000]}
          onRevealEnd={laterEnd}
          onRevealMilestone={onRevealMilestone}
        />
      )
    })
    const second = nativeProps(renderer)
    expect(second.revealState).toBe(2) // reveal: play
    expect(second.onRevealEnd).toBe(first.onRevealEnd)
    expect(second.revealMilestones).toBe(first.revealMilestones)
    second.onRevealEnd.f()
    expect(laterEnd).toHaveBeenCalledTimes(1)
    expect(onRevealEnd).not.toHaveBeenCalled()
    second.onRevealMilestone.f(1, 10000)
    expect(onRevealMilestone).toHaveBeenCalledWith(1, 10000)

    // Without handlers the stable native callbacks stay in place and no-op.
    act(() => {
      renderer.update(<RollingNumber value={50000} />)
    })
    const third = nativeProps(renderer)
    expect(third.onRevealEnd).toBe(first.onRevealEnd)
    expect(() => third.onRevealEnd.f()).not.toThrow()
    expect(laterEnd).toHaveBeenCalledTimes(1)
    expect(third.revealState).toBe(0)
    // Never undefined: removing the array would reach native as null, which Nitro rejects.
    expect(third.revealMilestones).toEqual([])
    expect(nativeProps(render(<RollingNumber value={1} />)).revealMilestones).toEqual([])
  })

  it('keeps one handle for the component\'s lifetime and reads the latest value through it', () => {
    const ref = createRef<RollingNumberHandle>()
    const renderer = render(<RollingNumber ref={ref} value={1} />)
    const handle = ref.current
    expect(handle?.getValue()).toBe(1)
    act(() => {
      renderer.update(<RollingNumber ref={ref} value={2} />)
    })
    expect(ref.current).toBe(handle)
    expect(handle?.getValue()).toBe(2)
  })

  it('resolves the layout direction the way React Native does and aligns to the start edge by default', () => {
    expect(nativeProps(render(<RollingNumber value={1} />)).textAlign).toBe('auto')
    expect(nativeProps(render(<RollingNumber value={1} />)).rightToLeft).toBe(false)
    // The view's own `direction` wins over the app's.
    expect(nativeProps(render(<RollingNumber value={1} style={{ direction: 'rtl' }} />)).rightToLeft).toBe(true)
    expect(nativeProps(render(<RollingNumber value={1} style={[{ width: 10 }, { direction: 'rtl' }]} />)).rightToLeft).toBe(true)

    const restore = jest.replaceProperty(I18nManager, 'isRTL', true)
    try {
      expect(nativeProps(render(<RollingNumber value={1} />)).rightToLeft).toBe(true)
      expect(nativeProps(render(<RollingNumber value={1} style={{ direction: 'ltr' }} />)).rightToLeft).toBe(false)
    } finally {
      restore.restore()
    }
  })

  it('exposes revealTo on the handle', () => {
    const ref = createRef<RollingNumberHandle>()
    const renderer = render(<RollingNumber ref={ref} value={7} />)
    ref.current?.revealTo(1234.5) // no-op before mount
    const native = { animateTo: jest.fn(), jumpTo: jest.fn(), revealTo: jest.fn(), value: 7 }
    act(() => {
      nativeProps(renderer).hybridRef.f(native)
    })
    ref.current?.revealTo(1234.5)
    expect(native.revealTo).toHaveBeenCalledWith(1234.5)
  })
})
