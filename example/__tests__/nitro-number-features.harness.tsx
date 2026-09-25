/**
 * On-device checks of what 0.4 added to `NitroNumber`, and of `NitroTime`
 * and `NitroText`: signs, native digits and grouping sizes, styled
 * fractions, compact formats, the animation events, clock wheels and the
 * morphing label, through what an app can observe (layout, callbacks, the
 * handle).
 */
import React, { createRef } from 'react'
import { View, type LayoutRectangle } from 'react-native'
import { describe, expect, it, waitFor } from 'react-native-harness'
import {
  NitroNumber,
  NitroText,
  NitroTime,
  NumberFormat,
  type NitroNumberHandle,
} from 'react-native-nitro-input'
import { expectSameLength, render, sleep } from './test-utils'

const content = { alignSelf: 'flex-start' } as const
const WAIT = { timeout: 5000 }

function layoutOf() {
  const state: { current: LayoutRectangle | null } = { current: null }
  const onLayout = (e: { nativeEvent: { layout: LayoutRectangle } }) => {
    state.current = e.nativeEvent.layout
  }
  return { state, onLayout }
}

async function widthsOf(layouts: ReturnType<typeof layoutOf>[]) {
  await waitFor(() => expect(Math.min(...layouts.map((l) => l.state.current?.width ?? 0))).toBeGreaterThan(0), WAIT)
  return layouts.map((l) => l.state.current!.width)
}

describe('NitroNumber 0.4', () => {
  it('draws a plus where signDisplay asks for one, and none on zero with exceptZero', async () => {
    const plain = layoutOf()
    const always = layoutOf()
    const except = layoutOf()
    const zero = layoutOf()
    await render(
      <View>
        <NitroNumber value={5} fontSize={24} style={content} onLayout={plain.onLayout} />
        <NitroNumber value={5} fontSize={24} signDisplay="always" style={content} onLayout={always.onLayout} />
        <NitroNumber value={5} fontSize={24} signDisplay="exceptZero" style={content} onLayout={except.onLayout} />
        <NitroNumber value={0} fontSize={24} signDisplay="exceptZero" style={content} onLayout={zero.onLayout} />
      </View>
    )
    const [p, a, e, z] = await widthsOf([plain, always, except, zero])
    // "+5" is a plus wider than "5"; zero carries no sign.
    expect(a!).toBeGreaterThan(p! + 4)
    expectSameLength(a!, e!)
    expectSameLength(z!, p!)
  })

  it('takes the sign display and the locale minus from a NumberFormat', async () => {
    const gain = layoutOf()
    const plain = layoutOf()
    const format = new NumberFormat('en-US', { signDisplay: 'always' })
    await render(
      <View>
        <NitroNumber value={5} fontSize={24} format={format} style={content} onLayout={gain.onLayout} />
        <NitroNumber value={5} fontSize={24} style={content} onLayout={plain.onLayout} />
      </View>
    )
    const [g, p] = await widthsOf([gain, plain])
    expect(g!).toBeGreaterThan(p! + 4)
  })

  it('groups digits by groupingSizes, and the format gives Indian grouping', async () => {
    const threes = layoutOf()
    const indian = layoutOf()
    const fromFormat = layoutOf()
    const common = { value: 12345678, fontSize: 24, groupingSeparator: ',', style: content } as const
    await render(
      <View>
        <NitroNumber {...common} onLayout={threes.onLayout} />
        <NitroNumber {...common} groupingSizes={[3, 2]} onLayout={indian.onLayout} />
        <NitroNumber value={12345678} fontSize={24} format={new NumberFormat('en-IN', { maximumFractionDigits: 0 })} style={content} onLayout={fromFormat.onLayout} />
      </View>
    )
    const [t, i, f] = await widthsOf([threes, indian, fromFormat])
    // "12,345,678" has two separators, "1,23,45,678" three.
    expect(i!).toBeGreaterThan(t! + 2)
    expectSameLength(f!, i!)
  })

  it('draws native digits from digitGlyphs or the format', async () => {
    const latin = layoutOf()
    const glyphs = layoutOf()
    const arabic = layoutOf()
    const ARABIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
    await render(
      <View>
        <NitroNumber value={1234} fontSize={24} style={content} onLayout={latin.onLayout} />
        <NitroNumber value={1234} fontSize={24} digitGlyphs={ARABIC} style={content} onLayout={glyphs.onLayout} />
        <NitroNumber value={1234} fontSize={24} format={new NumberFormat('ar-EG', { useGrouping: false, maximumFractionDigits: 0 })} style={content} onLayout={arabic.onLayout} />
      </View>
    )
    const [l, g, a] = await widthsOf([latin, glyphs, arabic])
    // Other glyphs, other widths; the format's are the same glyphs.
    expect(Math.abs(g! - l!)).toBeGreaterThan(0.5)
    expectSameLength(a!, g!)
  })

  it('sets smaller fraction digits in their own size', async () => {
    const full = layoutOf()
    const small = layoutOf()
    const common = { value: 12.34, fractionDigits: 2, fontSize: 32, style: content } as const
    await render(
      <View>
        <NitroNumber {...common} onLayout={full.onLayout} />
        <NitroNumber {...common} fractionFontSize={16} fractionColor="gray" fractionAlign="top" prefixColor="gray" onLayout={small.onLayout} />
      </View>
    )
    const [f, s] = await widthsOf([full, small])
    // ".34" at half the size is about half as wide.
    expect(s!).toBeLessThan(f! - 10)
  })

  it('rolls a compact figure and swaps its suffix, reporting the value itself', async () => {
    const ref = createRef<NitroNumberHandle>()
    const small = layoutOf()
    const format = new NumberFormat('en-US', { notation: 'compact' })
    const { rerender } = await render(
      <NitroNumber ref={ref} value={950} format={format} fontSize={24} duration={100} style={content} onLayout={small.onLayout} />
    )
    const [before] = await widthsOf([small])
    await rerender(<NitroNumber ref={ref} value={1_500_000} format={format} fontSize={24} duration={100} style={content} onLayout={small.onLayout} />)
    // "950" → "1.5M": the figure the digits show is 1.5, the value 1,500,000.
    await waitFor(() => expect(ref.current?.native?.value).toBe(1.5), WAIT)
    expect(ref.current?.getValue()).toBe(1_500_000)
    await waitFor(() => expect(small.state.current!.width).not.toBe(before), WAIT)
  })

  it('fires onAnimationStart and onAnimationEnd once for a run of changes, and not for a snap', async () => {
    const ref = createRef<NitroNumberHandle>()
    const events: string[] = []
    const { rerender } = await render(
      <NitroNumber
        ref={ref}
        value={1}
        duration={300}
        style={content}
        onAnimationStart={() => events.push('start')}
        onAnimationEnd={(v) => events.push(`end ${v}`)}
      />
    )
    await waitFor(() => expect(ref.current?.native).not.toBeNull(), WAIT)
    ref.current!.animateTo(2)
    await sleep(100)
    ref.current!.animateTo(3)
    await waitFor(() => expect(events).toEqual(['start', 'end 3']), WAIT)
    // animated={false}: the change snaps and fires nothing.
    await rerender(
      <NitroNumber
        ref={ref}
        value={4}
        animated={false}
        style={content}
        onAnimationStart={() => events.push('start')}
        onAnimationEnd={(v) => events.push(`end ${v}`)}
      />
    )
    await waitFor(() => expect(ref.current?.getValue()).toBe(4), WAIT)
    await sleep(200)
    expect(events).toEqual(['start', 'end 3'])
  })
})

describe('NitroNumber shimmer', () => {
  it('takes the shimmer options without moving the layout', async () => {
    const plain = layoutOf()
    const shaped = layoutOf()
    const common = { value: 1234.5, fractionDigits: 2, fontSize: 24, loading: true, style: content } as const
    await render(
      <View>
        <NitroNumber {...common} onLayout={plain.onLayout} />
        <NitroNumber
          {...common}
          shimmerAngle={-20}
          shimmerWidth={0.4}
          shimmerBaseColor="#E5E7EB"
          shimmerDirection="rtl"
          shimmerDelay={500}
          onLayout={shaped.onLayout}
        />
      </View>
    )
    const [p, s] = await widthsOf([plain, shaped])
    expectSameLength(p!, s!)
  })
})

describe('NitroTime', () => {
  it('shows seconds as a clock and lays m:ss and h:mm:ss out', async () => {
    const ref = createRef<NitroNumberHandle>()
    const short = layoutOf()
    const long = layoutOf()
    const { rerender } = await render(
      <View>
        <NitroTime ref={ref} seconds={59} fontSize={24} duration={100} style={content} onLayout={short.onLayout} />
        <NitroTime seconds={3605} timeFormat="h:mm:ss" fontSize={24} style={content} onLayout={long.onLayout} />
      </View>
    )
    const [s, l] = await widthsOf([short, long])
    // "0:59" against "1:00:05": two more digits and a separator.
    expect(l!).toBeGreaterThan(s! + 20)
    expect(ref.current?.getValue()).toBe(59)
    await rerender(
      <View>
        <NitroTime ref={ref} seconds={60} fontSize={24} duration={100} style={content} onLayout={short.onLayout} />
        <NitroTime seconds={3605} timeFormat="h:mm:ss" fontSize={24} style={content} onLayout={long.onLayout} />
      </View>
    )
    // 1:00 is the figure 100; a clock's layout keeps its width.
    await waitFor(() => expect(ref.current?.getValue()).toBe(100), WAIT)
    await sleep(300)
    expectSameLength(short.state.current!.width, s!)
  })
})

describe('NitroText', () => {
  it('lays out to its text and follows a new one', async () => {
    const label = layoutOf()
    const { rerender } = await render(
      <View style={content}>
        <NitroText fontSize={24} onLayout={label.onLayout}>
          Sign in
        </NitroText>
      </View>
    )
    const [before] = await widthsOf([label])
    await rerender(
      <View style={content}>
        <NitroText fontSize={24} onLayout={label.onLayout}>
          Signing in…
        </NitroText>
      </View>
    )
    await waitFor(() => expect(label.state.current!.width).toBeGreaterThan(before! + 20), WAIT)
  })
})
