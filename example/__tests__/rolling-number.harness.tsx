/**
 * On-device checks of `RollingNumber`: what an app can observe through the
 * public API (the handle, the reveal callbacks, the measured layout) while the
 * native engine rolls, reveals and lays digits out.
 */
import React, { createRef } from 'react'
import { View, type LayoutRectangle } from 'react-native'
import { describe, expect, it, render, waitFor } from 'react-native-harness'
import { RollingNumber, type RollingNumberHandle } from 'react-native-nitro-rolling-number'
import { deferred, sleep, withTimeout } from './test-utils'
import { forceGc, trackNativeViews, trackedLiveCount } from '../src/bench/probe'

/**
 * The most recent `onLayout` rectangle of one view, kept by reference. Pair it
 * with `content`: until the native intrinsic size arrives (a frame later on
 * Android) a rolling number has no width of its own, and a stretched child
 * would report its parent's width for that frame.
 */
const content = { alignSelf: 'flex-start' } as const

function layoutOf() {
  const state: { current: LayoutRectangle | null } = { current: null }
  const onLayout = (e: { nativeEvent: { layout: LayoutRectangle } }) => {
    state.current = e.nativeEvent.layout
  }
  return { state, onLayout }
}

describe('RollingNumber', () => {
  it('mounts, hands out its native ref and lays out to its content', async () => {
    const ref = createRef<RollingNumberHandle>()
    const { state, onLayout } = layoutOf()
    await render(<RollingNumber ref={ref} value={1234.5} fractionDigits={2} style={content} onLayout={onLayout} />)
    await waitFor(() => expect(ref.current?.native).not.toBeNull())
    expect(ref.current?.getValue()).toBe(1234.5)
    await waitFor(() => expect(state.current?.width ?? 0).toBeGreaterThan(0))
    expect(state.current?.height ?? 0).toBeGreaterThan(0)
  })

  it('widens as soon as a digit appears and narrows only once the roll has finished', async () => {
    const ref = createRef<RollingNumberHandle>()
    const { state, onLayout } = layoutOf()
    const { rerender } = await render(<RollingNumber ref={ref} value={999} duration={200} style={content} onLayout={onLayout} />)
    await waitFor(() => expect(state.current?.width ?? 0).toBeGreaterThan(0))
    const threeDigits = state.current!.width

    await rerender(<RollingNumber ref={ref} value={1000000} duration={200} style={content} onLayout={onLayout} />)
    await waitFor(() => expect(ref.current?.getValue()).toBe(1000000))
    // Growing reports at once, so the box is wide before the new digits have fully appeared.
    await waitFor(() => expect(state.current!.width).toBeGreaterThan(threeDigits))
    const sevenDigits = state.current!.width

    await rerender(<RollingNumber ref={ref} value={5} duration={200} style={content} onLayout={onLayout} />)
    await waitFor(() => expect(ref.current?.getValue()).toBe(5))
    // Shrinking waits for the roll (200 ms) so the digits on their way out are not squeezed.
    await waitFor(() => expect(state.current!.width).toBeLessThan(threeDigits), { timeout: 3000 })
    expect(state.current!.width).toBeLessThan(sevenDigits)
  })

  it('plays the numeric transition and settles on the value, columns included', async () => {
    const ref = createRef<RollingNumberHandle>()
    const { state, onLayout } = layoutOf()
    const props = { transition: 'numeric' as const, duration: 150, stagger: 20, style: content, onLayout }
    const { rerender } = await render(<RollingNumber ref={ref} value={99} {...props} />)
    await waitFor(() => expect(state.current?.width ?? 0).toBeGreaterThan(0))
    const twoDigits = state.current!.width

    // A change that grows a column: the box widens as the new glyph arrives.
    await rerender(<RollingNumber ref={ref} value={100} {...props} />)
    await waitFor(() => expect(ref.current?.getValue()).toBe(100))
    await waitFor(() => expect(state.current!.width).toBeGreaterThan(twoDigits))
    const threeDigits = state.current!.width

    // Rapid changes re-target the swap; the last one wins and the view settles.
    for (const v of [105, 118, 123, 131]) {
      await rerender(<RollingNumber ref={ref} value={v} {...props} />)
      await sleep(40)
    }
    await waitFor(() => expect(ref.current?.getValue()).toBe(131))
    await sleep(400)
    expect(state.current!.width).toBe(threeDigits)

    // Back down: the column closes once its glyph has left.
    await rerender(<RollingNumber ref={ref} value={7} {...props} />)
    await waitFor(() => expect(ref.current?.getValue()).toBe(7))
    await waitFor(() => expect(state.current!.width).toBeLessThan(twoDigits), { timeout: 3000 })

    // The imperative path plays it too, and switching back to the roll mid-way is fine.
    ref.current!.animateTo(42)
    await waitFor(() => expect(ref.current?.getValue()).toBe(42))
    await rerender(<RollingNumber ref={ref} value={43} transition="roll" duration={150} style={content} onLayout={onLayout} />)
    await waitFor(() => expect(ref.current?.getValue()).toBe(43))
  })

  it('plays the scramble and settles on the value', async () => {
    for (const transition of ['scramble'] as const) {
      const ref = createRef<RollingNumberHandle>()
      const { state, onLayout } = layoutOf()
      const props = { transition, duration: 150, stagger: 20, style: content, onLayout }
      const { rerender, unmount } = await render(<RollingNumber ref={ref} value={95} {...props} />)
      await waitFor(() => expect(state.current?.width ?? 0).toBeGreaterThan(0))
      const twoDigits = state.current!.width

      // Up through the wrap and into a new column, then back down.
      await rerender(<RollingNumber ref={ref} value={108} {...props} />)
      await waitFor(() => expect(ref.current?.getValue()).toBe(108))
      await waitFor(() => expect(state.current!.width).toBeGreaterThan(twoDigits))
      await sleep(400)
      await rerender(<RollingNumber ref={ref} value={7} {...props} />)
      await waitFor(() => expect(ref.current?.getValue()).toBe(7))
      await waitFor(() => expect(state.current!.width).toBeLessThan(twoDigits), { timeout: 3000 })

      // Rapid re-targets settle on the last value.
      for (const v of [12, 23, 31, 48]) {
        ref.current!.animateTo(v)
        await sleep(30)
      }
      await waitFor(() => expect(ref.current?.getValue()).toBe(48))
      await sleep(400)
      await unmount()
    }
  })

  it('flashes and pops on a change without disturbing the value or the layout', async () => {
    const ref = createRef<RollingNumberHandle>()
    const { state, onLayout } = layoutOf()
    const props = { flashUpColor: '#16a34a', flashDownColor: '#dc2626', flashDuration: 200, popOnChange: 0.1, duration: 100, style: content, onLayout }
    const { rerender } = await render(<RollingNumber ref={ref} value={500} {...props} />)
    await waitFor(() => expect(state.current?.width ?? 0).toBeGreaterThan(0))
    const width = state.current!.width
    await rerender(<RollingNumber ref={ref} value={501} {...props} />)
    await waitFor(() => expect(ref.current?.getValue()).toBe(501))
    await rerender(<RollingNumber ref={ref} value={499} {...props} />)
    await waitFor(() => expect(ref.current?.getValue()).toBe(499))
    // The pop scales about the centre without changing the measured box; the flash is paint only.
    await sleep(500)
    expect(state.current!.width).toBe(width)
    ref.current!.jumpTo(1234)
    await waitFor(() => expect(ref.current?.getValue()).toBe(1234))
  })

  it('takes imperative values through the handle', async () => {
    const ref = createRef<RollingNumberHandle>()
    await render(<RollingNumber ref={ref} value={1} fractionDigits={1} duration={100} />)
    await waitFor(() => expect(ref.current?.native).not.toBeNull())

    ref.current!.animateTo(42)
    await waitFor(() => expect(ref.current?.getValue()).toBe(42))

    ref.current!.jumpTo(7.5)
    await waitFor(() => expect(ref.current?.getValue()).toBe(7.5))

    // A value that arrives every frame is coalesced, never queued: the last one wins.
    for (let i = 0; i < 120; i++) ref.current!.jumpTo(i)
    await waitFor(() => expect(ref.current?.getValue()).toBe(119))
  })

  it('plays a count reveal through its milestones and reports the landing', async () => {
    const milestones: Array<[number, number]> = []
    const ended = deferred()
    const props = {
      value: 1000,
      revealStyle: 'count' as const,
      revealDuration: 600,
      revealMilestones: [100, 500],
      revealMilestoneHold: 50,
      revealBounce: 0.1,
      onRevealMilestone: (index: number, at: number) => milestones.push([index, at]),
      onRevealEnd: () => ended.resolve(),
    }
    const { rerender } = await render(<RollingNumber {...props} reveal={false} />)
    // Held at the opening frame: nothing has fired.
    await sleep(300)
    expect(milestones).toEqual([])

    await rerender(<RollingNumber {...props} reveal />)
    await withTimeout(ended.promise, 5000, 'onRevealEnd')
    expect(milestones).toEqual([
      [0, 100],
      [1, 500],
    ])
  })

  it('reveals through the handle in the spin style and lands once', async () => {
    const ref = createRef<RollingNumberHandle>()
    let ends = 0
    await render(
      <RollingNumber
        ref={ref}
        value={0}
        revealStyle="spin"
        revealDuration={500}
        revealStagger={50}
        onRevealEnd={() => {
          ends += 1
        }}
      />,
    )
    await waitFor(() => expect(ref.current?.native).not.toBeNull())
    ref.current!.revealTo(4321)
    await waitFor(() => expect(ref.current?.getValue()).toBe(4321))
    await waitFor(() => expect(ends).toBe(1), { timeout: 5000 })
    // The pop has rung out; nothing fires again.
    await sleep(500)
    expect(ends).toBe(1)
  })

  it('sizes with the font and with the affixes, and keeps its size while loading', async () => {
    const { state, onLayout } = layoutOf()
    const { rerender } = await render(<RollingNumber value={1234567} fontSize={20} style={content} onLayout={onLayout} />)
    await waitFor(() => expect(state.current?.width ?? 0).toBeGreaterThan(0))
    const small = { ...state.current! }

    await rerender(<RollingNumber value={1234567} fontSize={40} style={content} onLayout={onLayout} />)
    // A relayout has to travel native -> onLayout -> React on a loaded CI
    // simulator mid-morph; the default wait was cutting it fine there.
    await waitFor(() => expect(state.current!.height).toBeGreaterThan(small.height), { timeout: 3000 })
    expect(state.current!.width).toBeGreaterThan(small.width)
    const large = { ...state.current! }

    await rerender(<RollingNumber value={1234567} fontSize={40} groupingSeparator="," prefix="$" suffix=" USD" style={content} onLayout={onLayout} />)
    await waitFor(() => expect(state.current!.width).toBeGreaterThan(large.width), { timeout: 3000 })
    const affixed = { ...state.current! }

    // The glint recolours the ink; the box does not move.
    await rerender(<RollingNumber value={1234567} fontSize={40} groupingSeparator="," prefix="$" suffix=" USD" loading style={content} onLayout={onLayout} />)
    await sleep(400)
    expect(state.current!.width).toBeCloseTo(affixed.width, 0)
    expect(state.current!.height).toBeCloseTo(affixed.height, 0)
  })

  it('mirrors under a right-to-left layout without changing its size', async () => {
    const ltr = layoutOf()
    const rtl = layoutOf()
    await render(
      <View>
        <RollingNumber value={1234.5} fractionDigits={2} prefix="$" suffix=" USD" groupingSeparator="," style={content} onLayout={ltr.onLayout} />
        <RollingNumber
          value={1234.5}
          fractionDigits={2}
          prefix="$"
          suffix=" USD"
          groupingSeparator=","
          style={[content, { direction: 'rtl' }]}
          onLayout={rtl.onLayout}
        />
      </View>,
    )
    await waitFor(() => expect(rtl.state.current?.width ?? 0).toBeGreaterThan(0))
    await waitFor(() => expect(ltr.state.current?.width ?? 0).toBeGreaterThan(0))
    // The run is laid out block by block in mirror order: same blocks, same width.
    expect(rtl.state.current!.width).toBeCloseTo(ltr.state.current!.width, 0)
    expect(rtl.state.current!.height).toBeCloseTo(ltr.state.current!.height, 0)
  })

  it('keeps a fixed box while shrinking the figure to fit', async () => {
    const { state, onLayout } = layoutOf()
    const { rerender } = await render(
      <RollingNumber value={1} adjustsFontSizeToFit minimumFontScale={0.3} style={{ width: 80 }} onLayout={onLayout} />,
    )
    await waitFor(() => expect(state.current?.width ?? 0).toBeGreaterThan(0))
    expect(state.current!.width).toBeCloseTo(80, 0)
    await rerender(
      <RollingNumber value={123456789} adjustsFontSizeToFit minimumFontScale={0.3} style={{ width: 80 }} onLayout={onLayout} />,
    )
    await sleep(700)
    expect(state.current!.width).toBeCloseTo(80, 0)
  })

  it('drives thirty figures at once', async () => {
    const refs = Array.from({ length: 30 }, () => createRef<RollingNumberHandle>())
    const tree = (scale: number) => (
      <View>
        {refs.map((ref, i) => (
          <RollingNumber key={i} ref={ref} value={i * scale} fractionDigits={2} groupingSeparator="," prefix="$" duration={150} />
        ))}
      </View>
    )
    const { rerender } = await render(tree(1))
    await waitFor(() => expect(refs.every((ref) => ref.current?.native != null)).toBe(true))
    await rerender(tree(1234.5))
    await waitFor(() => expect(refs.map((ref) => ref.current!.getValue())).toEqual(refs.map((_, i) => i * 1234.5)))
    // Let every roll finish with the whole set on screen.
    await sleep(400)
    expect(refs.every((ref) => ref.current?.native != null)).toBe(true)
  })
})

describe('RollingNumber lifetime', () => {
  // A Nitro view's Kotlin or Swift object lives until Hermes collects the JS
  // handle to it, which a quiet screen never triggers; on Android the hybrid
  // used to hold its platform view, so every unmounted copy stayed alive (24
  // more live Views a cycle, linear). 24 copies mounted and unmounted 30
  // times, then a forced collection: the live View count (Android; what
  // `dumpsys meminfo` calls Views, read through the example's probe) must be
  // where it started, and the copies mounted after the churn must work.
  it('frees its views on unmount and mounts working copies after the churn', async () => {
    const copies = 24
    const cycles = 30
    const refs = Array.from({ length: copies }, () => createRef<RollingNumberHandle>())
    const tree = (base: number) => (
      <View>
        {refs.map((ref, i) => (
          <RollingNumber key={i} ref={ref} value={base + i} duration={100} style={content} />
        ))}
      </View>
    )
    const { rerender } = await render(<View />)
    let tracked: number | null = 0
    for (let cycle = 1; cycle <= cycles; cycle++) {
      await rerender(tree(1000 * cycle))
      await waitFor(() => expect(refs[copies - 1].current?.native).not.toBeNull(), { timeout: 5000 })
      // Remember this cycle's native views (weakly) while they are mounted.
      tracked = trackNativeViews()
      await rerender(<View />)
    }
    forceGc()
    await sleep(500)
    forceGc()
    await sleep(300)
    const alive = trackedLiveCount()
    if (tracked != null && alive != null) {
      // Every cycle's copies were tracked; after the collection none of them
      // should be alive. A leak is a cycle's worth or more.
      expect(tracked).toBeGreaterThanOrEqual(copies)
      expect(alive).toBeLessThan(copies)
    }
    await rerender(tree(5000))
    await waitFor(() => expect(refs.map((ref) => ref.current?.getValue())).toEqual(refs.map((_, i) => 5000 + i)), { timeout: 5000 })
  })
})
