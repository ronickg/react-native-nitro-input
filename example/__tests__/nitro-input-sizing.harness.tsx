/**
 * A field lays out at its real size in the commit that mounts it.
 *
 * `NitroInput` measures a single-line field on the JS thread before its view
 * exists (`NitroInputMeasure`), with the code the view then sizes itself with,
 * as React Native's `TextInput` measures in its shadow node. Before that the
 * first layout had no width: a field took its parent's width (or none) until
 * the view's first `onSizeChange` came back a commit later, and every field
 * without a fixed height moved by a pixel or two as the real line box arrived.
 *
 * Each case mounts one field in a box that hugs it and reads the box's layout
 * in the commit that mounted it, synchronously (`useLayoutEffect`, as the New
 * Architecture allows): that is the size the first frame is drawn at. It must
 * equal the size once the view has reported its own. `onLayout` cannot tell:
 * layout events are coalesced, so a size that lasted one commit is often never
 * delivered.
 */
import React, { createRef, useLayoutEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { describe, expect, it } from 'react-native-harness'
import { NitroInput, NumberFormat, type NitroInputHandle, type NitroInputProps } from 'react-native-nitro-input'
import { render, sleep, waitFor } from './test-utils'

const usd = new NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Long enough for the view to have mounted and reported its own size. */
const SETTLE_MS = 600

const CASES: [string, NitroInputProps][] = [
  ['plain text', { defaultValue: 'hello world', autoWidth: true, fontSize: 20 }],
  ['a placeholder', { placeholder: 'Email address', autoWidth: true, fontSize: 18 }],
  ['a number with affixes', { mode: 'number', defaultValue: '1234567.5', prefix: '$', suffix: ' USD', fractionDigits: 2, autoWidth: true, fontSize: 24 }],
  ['a reflowing amount with letter spacing', { transition: 'reflow', mode: 'number', defaultValue: '1234', prefix: '$', fractionDigits: 0, fontSize: 32, letterSpacing: 1 }],
  ['a reflowing NumberFormat, negative', { transition: 'reflow', format: usd, defaultValue: '-1234.5', fontSize: 28 }],
  ['affixes in their own sizes and seams', { transition: 'reflow', mode: 'number', defaultValue: '42', prefix: '€', suffix: '/mo', prefixFontSize: 16, suffixFontSize: 14, prefixSpacing: 4, suffixSpacing: 6, fontSize: 30 }],
  ['a mask keeping its placeholder', { mode: 'mask', mask: '[0000] [0000] [0000] [0000] [00]', keepPlaceholder: true, placeholder: '0123 4567 8901 2345 67', defaultValue: '0123456', autoWidth: true, fontSize: 16 }],
  ['a reflowing mask showing itself', { transition: 'reflow', mode: 'mask', mask: '+1 ([000]) [000]-[0000]', keepPlaceholder: true, defaultValue: '555', fontSize: 20 }],
  ['secure text', { secureTextEntry: true, defaultValue: 'hunter22', autoWidth: true, fontSize: 20 }],
  ['a resting label hiding the placeholder', { variant: 'outlined', label: 'Amount', placeholder: '0.00', autoWidth: true, fontSize: 18 }],
  ['maxLength', { defaultValue: 'abcdefghij', maxLength: 4, autoWidth: true, fontSize: 20 }],
  ['a line height and a weight', { defaultValue: 'Tall', lineHeight: 40, fontWeight: '600', autoWidth: true, fontSize: 22 }],
  ['a custom font', { fontFamily: 'OpenRunde-Semibold', defaultValue: '$1,250.50', autoWidth: true, fontSize: 16 }],
]

type Rect = { width: number; height: number }
type Host = React.ComponentRef<typeof View>

function rectOf(view: Host): Rect {
  const r = view.getBoundingClientRect()
  return { width: r.width, height: r.height }
}

/**
 * Holds the field in a box sized by it (or, `stretch`, by its parent's width)
 * and hands out the box's size in the commit that mounted it.
 */
function boxed(stretch = false) {
  const state: { mounted: Rect | null; view: Host | null } = { mounted: null, view: null }
  function Box({ children }: { children: React.ReactNode }) {
    const ref = useRef<Host>(null)
    useLayoutEffect(() => {
      state.view = ref.current
      state.mounted = rectOf(ref.current!)
    }, [])
    return (
      <View ref={ref} style={stretch ? undefined : { alignSelf: 'flex-start' }}>
        {children}
      </View>
    )
  }
  return { state, Box }
}

async function expectFinalAtMount(state: { mounted: Rect | null; view: Host | null }) {
  await waitFor(() => expect(state.mounted).not.toBeNull())
  // By now the view has mounted and reported its own size.
  await sleep(SETTLE_MS)
  expect(state.mounted).toEqual(rectOf(state.view!))
}

describe('NitroInput first layout', () => {
  for (const [name, props] of CASES) {
    it(`is final for ${name}`, async () => {
      const { state, Box } = boxed()
      await render(
        <Box>
          <NitroInput {...props} />
        </Box>
      )
      await expectFinalAtMount(state)
    })
  }

  it('is final for a field that takes its parent’s width', async () => {
    // Not autoWidth: only its height comes from the measure.
    const { state, Box } = boxed(true)
    await render(
      <Box>
        <NitroInput defaultValue="stretch" fontSize={19} />
      </Box>
    )
    await expectFinalAtMount(state)
  })

  it('is final for a controlled field', async () => {
    const { state, Box } = boxed()
    function Controlled() {
      const [value, setValue] = useState('8,450')
      return <NitroInput value={value} onChangeText={setValue} mode="number" prefix="$" autoWidth fontSize={26} />
    }
    await render(
      <Box>
        <Controlled />
      </Box>
    )
    await expectFinalAtMount(state)
  })

  it('still follows the view once it reports a change', async () => {
    // The seed is only the start: an edit the measure never saw still resizes it.
    const ref = createRef<NitroInputHandle>()
    const { state, Box } = boxed()
    await render(
      <Box>
        <NitroInput ref={ref} defaultValue="12" mode="number" autoWidth fontSize={24} />
      </Box>
    )
    await waitFor(() => expect(state.mounted).not.toBeNull())
    await sleep(SETTLE_MS)
    const before = rectOf(state.view!).width
    ref.current!.setText('1234567')
    await waitFor(() => expect(rectOf(state.view!).width).toBeGreaterThan(before + 20))
  })
})
