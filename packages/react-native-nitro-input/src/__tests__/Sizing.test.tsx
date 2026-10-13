/**
 * `NitroInput` lays out at the size `NitroInputMeasure` works out before the
 * view exists, and the view's own report, when it agrees, costs nothing.
 * (That the two agree on a device is `example/__tests__/nitro-input-sizing`.)
 */
import React, { Profiler } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

// `mock`-prefixed so the hoisted factory below may close over it.
const mockMeasure = jest.fn((_sizing: Record<string, unknown>) => ({ width: 87, height: 29 }))
let mockHasMeasure = true
jest.mock('react-native-nitro-modules', () => ({
  getHostComponent: (name: string) => name,
  callback: <T,>(f: T) => (typeof f === 'function' ? { f } : f),
  NitroModules: {
    createHybridObject: (name: string) =>
      name === 'NitroInputMeasure' && mockHasMeasure ? { measure: mockMeasure } : { isAvailable: false, install: () => false },
  },
}))

/* eslint-disable @typescript-eslint/no-var-requires */
const { NitroInput } = require('../NitroInput') as typeof import('../NitroInput')
/* eslint-enable @typescript-eslint/no-var-requires */

function render(element: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined
  act(() => {
    renderer = create(element)
  })
  return renderer!
}

function nativeProps(renderer: ReactTestRenderer): Record<string, unknown> {
  return renderer.root.findByType('NitroInputView' as never).props as Record<string, unknown>
}

const sizeStyle = (renderer: ReactTestRenderer) => (nativeProps(renderer).style as unknown[])[0]
const report = (renderer: ReactTestRenderer, width: number, height: number) =>
  act(() => (nativeProps(renderer).onSizeChange as { f: (w: number, h: number) => void }).f(width, height))

beforeEach(() => {
  mockMeasure.mockClear()
  mockMeasure.mockImplementation(() => ({ width: 87, height: 29 }))
  mockHasMeasure = true
})

describe('the size before the view reports', () => {
  it('is the measured one from the first render', () => {
    const renderer = render(<NitroInput autoWidth defaultValue="12" fontSize={24} />)
    expect(sizeStyle(renderer)).toEqual({ width: 87, height: 29 })
    // The measure sees what the view will: the same resolved props.
    const sizing = mockMeasure.mock.calls[0]![0]
    const native = nativeProps(renderer)
    for (const [key, value] of Object.entries(sizing)) expect([key, native[key]]).toEqual([key, value])
  })

  it('gives a field without autoWidth its height only', () => {
    expect(sizeStyle(render(<NitroInput fontSize={24} />))).toEqual({ height: 29 })
  })

  it('costs no commit when the view reports the same size, and follows it when it differs', () => {
    let commits = 0
    const renderer = render(
      <Profiler id="field" onRender={() => void commits++}>
        <NitroInput autoWidth defaultValue="12" />
      </Profiler>
    )
    const mounted = commits
    report(renderer, 87, 29)
    expect(commits).toBe(mounted)
    report(renderer, 120, 29)
    expect(commits).toBe(mounted + 1)
    expect(sizeStyle(renderer)).toEqual({ width: 120, height: 29 })
  })

  it('is measured once, not on every render', () => {
    const renderer = render(<NitroInput autoWidth defaultValue="12" />)
    act(() => renderer.update(<NitroInput autoWidth defaultValue="12" />))
    act(() => renderer.update(<NitroInput autoWidth defaultValue="12" />))
    expect(mockMeasure).toHaveBeenCalledTimes(1)
    // What it follows changing measures again, until the view has reported.
    act(() => renderer.update(<NitroInput autoWidth defaultValue="12" fontSize={40} />))
    expect(mockMeasure).toHaveBeenCalledTimes(2)
    report(renderer, 90, 50)
    act(() => renderer.update(<NitroInput autoWidth defaultValue="12" fontSize={41} />))
    expect(mockMeasure).toHaveBeenCalledTimes(2)
  })

  it("is measured with the font's tabular digits, slotted only when tabularNums asks", () => {
    // [tnum, slots] as the view and the measure get them.
    const digits = (element: React.ReactElement) => {
      const native = nativeProps(render(element))
      const sizing = mockMeasure.mock.calls.at(-1)![0]
      expect([sizing.tabularNums, sizing.slotDigits]).toEqual([native.tabularNums, native.slotDigits])
      return [native.tabularNums, native.slotDigits]
    }
    expect(digits(<NitroInput autoWidth defaultValue="12" />)).toEqual([true, false])
    expect(digits(<NitroInput autoWidth defaultValue="12" tabularNums />)).toEqual([true, true])
    expect(digits(<NitroInput autoWidth defaultValue="12" tabularNums={false} />)).toEqual([false, false])
    expect(digits(<NitroInput autoWidth defaultValue="12" style={{ fontVariant: ['proportional-nums'] }} />)).toEqual([false, false])
    // The prop wins over the style, as the typography props do.
    expect(digits(<NitroInput autoWidth defaultValue="12" tabularNums style={{ fontVariant: ['proportional-nums'] }} />)).toEqual([true, true])
  })

  it('is not measured for a wrapping field or one whose style sets both sides', () => {
    render(<NitroInput multiline />)
    render(<NitroInput style={{ width: 200, height: 40 }} />)
    expect(mockMeasure).not.toHaveBeenCalled()
  })

  it('falls back to the line guess without a native measure, or when it throws', () => {
    // A fresh module, so the measurer is made again under the case below.
    const fieldHeight = (fontSize: number) => {
      let style: unknown
      jest.isolateModules(() => {
        /* eslint-disable @typescript-eslint/no-var-requires */
        const renderer = require('react-test-renderer') as typeof import('react-test-renderer')
        const fresh = require('../NitroInput') as typeof import('../NitroInput')
        /* eslint-enable @typescript-eslint/no-var-requires */
        let tree: ReactTestRenderer | undefined
        renderer.act(() => {
          tree = renderer.create(<fresh.NitroInput fontSize={fontSize} />)
        })
        style = sizeStyle(tree!)
      })
      return style
    }
    mockHasMeasure = false
    expect(fieldHeight(20)).toEqual({ height: 25 })
    mockHasMeasure = true
    mockMeasure.mockImplementation(() => {
      throw new Error('no context')
    })
    expect(fieldHeight(20)).toEqual({ height: 25 })
  })
})
