/**
 * The wrapper's own resolution rules: what it sends native for the props it
 * reshapes, and what it does not do per render. `MorphInput.test.tsx` covers
 * the defaults and the callback plumbing; `TextInputParity.test.tsx` compares
 * against React Native's `TextInput`.
 */
import React, { createRef } from 'react'
import { I18nManager } from 'react-native'
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
  return renderer.root.findByType('NitroInputView' as never).props as Record<string, unknown>
}

describe('right-to-left', () => {
  it('follows the app direction by default', () => {
    expect(nativeProps(render(<NitroInput />)).rightToLeft).toBe(false)
    const replaced = jest.replaceProperty(I18nManager, 'isRTL', true)
    expect(nativeProps(render(<NitroInput />)).rightToLeft).toBe(true)
    replaced.restore()
    expect(nativeProps(render(<NitroInput />)).rightToLeft).toBe(false)
  })

  it('lets style.direction override the app direction either way', () => {
    // The way React Native resolves it for its own views: the view's own
    // `direction` wins, and only an unset one falls back to `I18nManager`.
    expect(nativeProps(render(<NitroInput style={{ direction: 'rtl' }} />)).rightToLeft).toBe(true)
    const replaced = jest.replaceProperty(I18nManager, 'isRTL', true)
    expect(nativeProps(render(<NitroInput style={{ direction: 'ltr' }} />)).rightToLeft).toBe(false)
    expect(nativeProps(render(<NitroInput style={{ direction: 'rtl' }} />)).rightToLeft).toBe(true)
    // Through an array style too, since that is what `StyleSheet.flatten` is for.
    expect(
      nativeProps(render(<NitroInput style={[{ width: 100 }, { direction: 'ltr' }]} />)).rightToLeft
    ).toBe(false)
    replaced.restore()
  })

  it('aligns to the start edge unless told otherwise', () => {
    // `'auto'` is the start edge of the layout direction, as `TextInput` with
    // no `textAlign`; `'left'` and `'right'` are absolute.
    expect(nativeProps(render(<NitroInput />)).textAlign).toBe('auto')
    expect(nativeProps(render(<NitroInput textAlign="left" />)).textAlign).toBe('left')
    expect(nativeProps(render(<NitroInput textAlign="right" />)).textAlign).toBe('right')
    expect(nativeProps(render(<NitroInput textAlign="center" />)).textAlign).toBe('center')
  })
})

describe('multiline', () => {
  it('forces text mode and drops the mask and the affixes, warning once each', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const number = nativeProps(render(<NitroInput multiline mode="number" prefix="$" suffix=" USD" />))
    expect(number.multiline).toBe(true)
    expect(number.mode).toBe('text')
    expect(number.prefix).toBe('')
    expect(number.suffix).toBe('')
    expect(number.plain).toBe(true)
    const masked = nativeProps(render(<NitroInput multiline mode="mask" mask="[000]" />))
    expect(masked.mode).toBe('text')
    expect(masked.mask).toBe('')
    for (const what of ['mode="number"', 'mode="mask"', 'prefix', 'suffix']) {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`\`${what}\` is ignored on a multiline field`))
    }
    // Once per offending prop, not once per render or per field.
    const before = warn.mock.calls.length
    render(<NitroInput multiline mode="number" prefix="$" />)
    expect(warn.mock.calls.length).toBe(before)
    warn.mockRestore()
  })

  it('keeps the affixes on a single-line field', () => {
    const props = nativeProps(render(<NitroInput mode="number" prefix="$" suffix=" USD" />))
    expect(props.prefix).toBe('$')
    expect(props.suffix).toBe(' USD')
  })

  it('takes numberOfLines or its TextInput spelling, rows', () => {
    expect(nativeProps(render(<NitroInput multiline />)).numberOfLines).toBe(0)
    expect(nativeProps(render(<NitroInput multiline numberOfLines={4} />)).numberOfLines).toBe(4)
    expect(nativeProps(render(<NitroInput multiline rows={3} />)).numberOfLines).toBe(3)
    expect(nativeProps(render(<NitroInput multiline numberOfLines={4} rows={3} />)).numberOfLines).toBe(4)
    expect(nativeProps(render(<NitroInput multiline textAlignVertical="bottom" />)).textAlignVertical).toBe('bottom')
  })
})

describe('submitBehavior', () => {
  it('defaults like TextInput: blurAndSubmit on one line, newline on many', () => {
    expect(nativeProps(render(<NitroInput />)).submitBehavior).toBe('blurAndSubmit')
    expect(nativeProps(render(<NitroInput multiline />)).submitBehavior).toBe('newline')
  })

  it('resolves the legacy blurOnSubmit the way TextInput does', () => {
    expect(nativeProps(render(<NitroInput blurOnSubmit={false} />)).submitBehavior).toBe('submit')
    expect(nativeProps(render(<NitroInput blurOnSubmit />)).submitBehavior).toBe('blurAndSubmit')
    expect(nativeProps(render(<NitroInput multiline blurOnSubmit />)).submitBehavior).toBe('blurAndSubmit')
    expect(nativeProps(render(<NitroInput multiline blurOnSubmit={false} />)).submitBehavior).toBe('newline')
  })

  it('lets an explicit submitBehavior win, including newline', () => {
    expect(nativeProps(render(<NitroInput multiline submitBehavior="submit" blurOnSubmit />)).submitBehavior).toBe(
      'submit'
    )
    expect(nativeProps(render(<NitroInput submitBehavior="newline" blurOnSubmit={false} />)).submitBehavior).toBe(
      'newline'
    )
  })
})

describe('autoWidth', () => {
  const measured = (renderer: ReactTestRenderer) => {
    const onSizeChange = nativeProps(renderer).onSizeChange as { f: (w: number, h: number) => void }
    act(() => onSizeChange.f(120, 48))
    return (nativeProps(renderer).style as unknown[])[0]
  }

  it('is off by default, so the field takes its width from its parent', () => {
    expect(measured(render(<NitroInput />))).toEqual({ height: 48 })
  })

  it("'auto' infers content sizing unless the style gives a width or flex", () => {
    expect(measured(render(<NitroInput autoWidth="auto" />))).toEqual({ width: 120, height: 48 })
    expect(measured(render(<NitroInput autoWidth="auto" style={{ width: 200 }} />))).toEqual({ height: 48 })
    expect(measured(render(<NitroInput autoWidth="auto" style={{ flex: 1 }} />))).toEqual({ height: 48 })
    expect(measured(render(<NitroInput autoWidth="auto" style={[{ padding: 4 }, { width: '100%' }]} />))).toEqual({
      height: 48,
    })
  })

  it('true always sizes to content', () => {
    expect(measured(render(<NitroInput autoWidth style={{ width: 200 }} />))).toEqual({ width: 120, height: 48 })
  })
})

describe('per-render stability', () => {
  it('keeps maskNotations by contents, so a fresh but equal literal does not re-set the prop', () => {
    const notation = (character: string) => ({ character, characterSet: '0123456789abcdef', isOptional: false })
    const renderer = render(<NitroInput mode="mask" mask="#[HHHHHH]" maskNotations={[notation('H')]} />)
    const first = nativeProps(renderer).maskNotations
    expect(first).toEqual([notation('H')])
    act(() => {
      renderer.update(<NitroInput mode="mask" mask="#[HHHHHH]" maskNotations={[notation('H')]} />)
    })
    expect(nativeProps(renderer).maskNotations).toBe(first)
    // A real change does go through.
    act(() => {
      renderer.update(<NitroInput mode="mask" mask="#[HHHHHH]" maskNotations={[notation('H'), notation('X')]} />)
    })
    expect(nativeProps(renderer).maskNotations).toEqual([notation('H'), notation('X')])
    // And removing them sends an (always the same) empty array, never `null`.
    act(() => {
      renderer.update(<NitroInput mode="mask" mask="#[HHHHHH]" />)
    })
    const empty = nativeProps(renderer).maskNotations
    expect(empty).toEqual([])
    act(() => {
      renderer.update(<NitroInput mode="mask" mask="#[HHHHHH]" maskNotations={[]} />)
    })
    expect(nativeProps(renderer).maskNotations).toBe(empty)
  })

  it('replays commands sent before the native view attached, in order', () => {
    const ref = createRef<NitroInputHandle>()
    const renderer = render(<NitroInput ref={ref} />)
    // Nothing is attached yet: the calls must not be lost.
    ref.current!.setText('queued')
    ref.current!.setSelection(1, 3)
    ref.current!.focus()
    const calls: string[] = []
    const native = {
      replaceText: (text: string) => calls.push(`setText ${text}`),
      setSelection: (start: number, end: number) => calls.push(`setSelection ${start} ${end}`),
      focus: () => calls.push('focus'),
      currentText: () => 'queued',
    }
    act(() => {
      ;(nativeProps(renderer).hybridRef as { f: (instance: unknown) => void }).f(native)
    })
    expect(calls).toEqual(['setText queued', 'setSelection 1 3', 'focus'])
    // Once attached, a call goes straight through.
    ref.current!.focus()
    expect(calls).toEqual(['setText queued', 'setSelection 1 3', 'focus', 'focus'])
  })

  it('hands the parent one handle for the field’s lifetime', () => {
    const ref = createRef<NitroInputHandle>()
    const renderer = render(<NitroInput ref={ref} value="one" onChangeText={() => {}} />)
    const handle = ref.current
    expect(handle).not.toBeNull()
    expect(handle!.getText()).toBe('one')
    act(() => {
      renderer.update(<NitroInput ref={ref} value="two" onChangeText={() => {}} />)
    })
    expect(ref.current).toBe(handle)
    // ...and it still reads the latest value before the native view attaches.
    expect(handle!.getText()).toBe('two')
  })

  it('an uncontrolled handle reads the initial text, then what native reported', () => {
    const ref = createRef<NitroInputHandle>()
    const renderer = render(<NitroInput ref={ref} defaultValue="seed" />)
    expect(ref.current!.getText()).toBe('seed')
    const onChangeText = nativeProps(renderer).onChangeText as { f: (t: string, c: number) => void }
    act(() => onChangeText.f('seeded', 1))
    expect(ref.current!.getText()).toBe('seeded')
  })
})

describe('colours', () => {
  const FRAME_COLOURS = [
    'labelColor',
    'labelFocusedColor',
    'strokeColor',
    'focusedStrokeColor',
    'fillColor',
    'caretColor',
    'selectionColor',
  ] as const

  it('converts the label, frame, caret and selection colours to ARGB integers', () => {
    const props = nativeProps(
      render(
        <NitroInput
          labelColor="#112233"
          labelFocusedColor="rgb(0, 0, 255)"
          strokeColor="black"
          focusedStrokeColor="#ff000080"
          fillColor="white"
          cursorColor="#00ff00"
          selectionColor="red"
        />
      )
    )
    expect(props.labelColor).toBe(0xff112233)
    expect(props.labelFocusedColor).toBe(0xff0000ff)
    expect(props.strokeColor).toBe(0xff000000)
    expect(props.focusedStrokeColor).toBe(0x80ff0000)
    expect(props.fillColor).toBe(0xffffffff)
    expect(props.caretColor).toBe(0xff00ff00)
    expect(props.selectionColor).toBe(0xffff0000)
  })

  it('sends NaN for an unset colour, which native reads as the platform default', () => {
    const props = nativeProps(render(<NitroInput />))
    for (const key of FRAME_COLOURS) expect(Number.isNaN(props[key])).toBe(true)
  })

  it('sends NaN for a colour it cannot process, rather than undefined', () => {
    const props = nativeProps(render(<NitroInput strokeColor="not a colour" fillColor={undefined} />))
    expect(Number.isNaN(props.strokeColor)).toBe(true)
    expect(Number.isNaN(props.fillColor)).toBe(true)
  })
})
