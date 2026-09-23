/**
 * `NitroInput` against React Native's own `TextInput`, side by side.
 *
 * The aim is a drop-in: the same props mean the same thing, the same callbacks
 * fire with the same payloads, and the same imperative calls do the same work.
 * Where the two differ, the difference is deliberate, written down here with a
 * reason, and asserted - so "we are different" can never quietly become "we are
 * broken".
 *
 * Two things make this a real comparison rather than a self-portrait:
 *
 * 1. React Native's jest preset *mocks* `TextInput` - it renders to a stub host
 *    element that passes props straight through. Asserting against that would
 *    prove nothing, so this file un-mocks it and drives the real component,
 *    the one that resolves aliases, keeps the `mostRecentEventCount` protocol
 *    and registers itself with `TextInputState`.
 * 2. The prop surface is read out of React Native's own `TextInput.d.ts` rather
 *    than listed by hand, so a prop added upstream fails this file instead of
 *    going unnoticed.
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import React, { createRef, Profiler } from 'react'
import { StyleSheet } from 'react-native'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { NitroInput, type NitroInputHandle } from '../NitroInput'

jest.unmock('react-native/Libraries/Components/TextInput/TextInput')

/* eslint-disable @typescript-eslint/no-var-requires */
const TextInput = require('react-native/Libraries/Components/TextInput/TextInput').default
const textInputStateModule = require('react-native/Libraries/Components/TextInput/TextInputState')
const TextInputState = textInputStateModule.default ?? textInputStateModule
/* eslint-enable @typescript-eslint/no-var-requires */

// ---------------------------------------------------------------------------
// Rendering both, and driving them the same way
// ---------------------------------------------------------------------------

function render(element: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined
  act(() => {
    renderer = create(element)
  })
  return renderer!
}

/** The props React Native's own host view was given. */
function rnHost(renderer: ReactTestRenderer): Record<string, any> {
  return (renderer.toJSON() as { props: Record<string, any> }).props
}

/** The props our Nitro host view was given. */
function ourHost(renderer: ReactTestRenderer): Record<string, any> {
  return renderer.root.findByType('NitroInputView' as never).props as Record<string, any>
}

/**
 * One way to poke either component from "the native side". Each implementation
 * does what its own platform layer does: React Native dispatches a synthetic
 * event onto a host prop, ours calls a Nitro callback.
 */
interface Driver {
  /** Simulate the user typing, with the event count the native side would send. */
  type(text: string, eventCount: number): void
  focus(): void
  blur(): void
  submit(text: string): void
  endEditing(text: string): void
  select(start: number, end: number): void
  /** The staleness counter the native side is currently told about. */
  eventCount(): number
}

function rnDriver(renderer: ReactTestRenderer, target = 11): Driver {
  const fire = (name: string, nativeEvent: Record<string, unknown>) => {
    const handler = rnHost(renderer)[name]
    if (typeof handler === 'function') act(() => handler({ nativeEvent: { target, ...nativeEvent } }))
  }
  return {
    type: (text, eventCount) => fire('onChange', { text, eventCount }),
    focus: () => fire('onFocus', {}),
    blur: () => fire('onBlur', {}),
    submit: (text) => fire('onSubmitEditing', { text }),
    endEditing: (text) => fire('onEndEditing', { text }),
    select: (start, end) => fire('onSelectionChange', { selection: { start, end } }),
    eventCount: () => rnHost(renderer).mostRecentEventCount,
  }
}

function ourDriver(renderer: ReactTestRenderer): Driver {
  const call = (name: string, ...args: unknown[]) => {
    const callback = ourHost(renderer)[name] as { f?: (...a: unknown[]) => void } | undefined
    if (callback?.f) act(() => callback.f!(...args))
  }
  return {
    type: (text, eventCount) => call('onChangeText', text, eventCount),
    focus: () => call('onFocusChange', true),
    blur: () => call('onFocusChange', false),
    submit: (text) => call('onSubmitEditing', text),
    endEditing: (text) => call('onEndEditing', text),
    select: (start, end) => call('onSelectionChange', start, end),
    eventCount: () => ourHost(renderer).mostRecentEventCount,
  }
}

/** Renders both components with the same props and hands back a driver for each. */
function both(props: Record<string, unknown> = {}) {
  const rnRef = createRef<any>()
  const ourRef = createRef<NitroInputHandle>()
  const rn = render(<TextInput ref={rnRef} {...props} />)
  // A width, as a form field is usually given. Not needed for the comparison
  // - `NitroInput` takes its width from its parent like a `TextInput` - but it
  // keeps the `autoWidth` inference out of the picture.
  const ours = render(<NitroInput ref={ourRef} style={{ width: 200 }} {...props} />)
  return {
    rn: { renderer: rn, ref: rnRef, host: () => rnHost(rn), drive: rnDriver(rn) },
    ours: { renderer: ours, ref: ourRef, host: () => ourHost(ours), drive: ourDriver(ours) },
  }
}

// ---------------------------------------------------------------------------
// 1. Prop surface
// ---------------------------------------------------------------------------

/** Every prop name declared in an interface block of a `.d.ts` / `.tsx`. */
function propsOfInterface(source: string, name: string): string[] {
  const match = new RegExp(`^export interface ${name}[^{]*\\{(.*?)^\\}`, 'sm').exec(source)
  if (!match) return []
  return [...new Set([...match[1]!.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((m) => m[1]!))]
}

function reactNativeTextInputProps(): string[] {
  const dts = join(
    dirname(require.resolve('react-native/package.json')),
    'Libraries/Components/TextInput/TextInput.d.ts'
  )
  const source = readFileSync(dts, 'utf8')
  return [
    ...new Set([
      ...propsOfInterface(source, 'TextInputProps'),
      ...propsOfInterface(source, 'TextInputIOSProps'),
      ...propsOfInterface(source, 'TextInputAndroidProps'),
    ]),
  ].sort()
}

function ourProps(): string[] {
  return propsOfInterface(readFileSync(join(__dirname, '..', 'NitroInput.tsx'), 'utf8'), 'NitroInputProps').sort()
}

/**
 * Props that reach the host view through `ViewProps` rather than being
 * re-declared: `NitroInputProps` extends them and spreads them onto the host.
 */
const FROM_VIEW_PROPS = new Set(['style', 'testID'])

/**
 * React Native props this component does not take, each with the reason. A
 * name here must still be one of React Native's, and must *not* be one of ours
 * - so the list cannot rot in either direction.
 */
const DELIBERATE: Record<string, string> = {
  // Single-line by construction: the glyph engine lays one run out on one
  // baseline. `multiline` switches to a plain wrapping field instead, which is
  // why these have no meaning here.
  clearButtonMode: 'iOS UITextField accessory; the field is drawn by this component',
  dataDetectorTypes: 'link/phone detection is a UITextView feature of read-only text',
  inlineImageLeft: 'Android drawable inside the field; not drawn by this component',
  inlineImagePadding: 'goes with inlineImageLeft',
  verticalAlign: 'the Android alias of textAlignVertical, which is supported',
  // Platform plumbing with no cross-platform meaning worth inventing.
  disableFullscreenUI: 'Android landscape fullscreen editor; not yet wired',
  disableKeyboardShortcuts: 'iOS 17 undo/redo bar; not yet wired',
  importantForAutofill: 'Android autofill hint; autoComplete covers the common case',
  inputAccessoryViewButtonLabel: 'goes with inputAccessoryViewID',
  inputAccessoryViewID: 'iOS accessory views are not yet wired',
  lineBreakModeIOS: 'truncation of non-editable text; not yet wired',
  lineBreakStrategyIOS: 'CJK line-break strategy; not yet wired',
  passwordRules: 'iOS strong-password generation; not yet wired',
  rejectResponderTermination: 'iOS responder-chain detail; not yet wired',
  returnKeyLabel: 'Android custom return label; returnKeyType covers the enum',
  selectionHandleColor: 'Android handle tint; not yet wired',
  smartInsertDelete: 'iOS smart copy/paste spacing; not yet wired',
  textBreakStrategy: 'Android line-break strategy; not yet wired',
  underlineColorAndroid: 'the component draws its own frame; see variant/strokeColor',
  // Superseded by something of ours.
  onContentSizeChange: 'the field reports its own intrinsic size and sizes itself',
  selectionState: 'deprecated DocumentSelectionState; use selection',
  // Touch props that belong to the wrapper, not the field.
  onPress: 'press handling belongs on a Pressable around the field',
  onPressIn: 'press handling belongs on a Pressable around the field',
  onPressOut: 'press handling belongs on a Pressable around the field',
  onScroll: 'only a multiline field scrolls; not yet reported',
}

describe('prop surface', () => {
  const rnProps = reactNativeTextInputProps()
  const supported = new Set(ourProps())

  it('reads React Native’s own prop list', () => {
    // A guard on the guard: an empty list would make everything below pass.
    expect(rnProps.length).toBeGreaterThan(60)
    for (const known of ['onChangeText', 'secureTextEntry', 'multiline', 'keyboardType', 'submitBehavior']) {
      expect(rnProps).toContain(known)
    }
  })

  it('finds our own prop list', () => {
    expect(supported.size).toBeGreaterThan(60)
    expect(supported.has('onChangeText')).toBe(true)
  })

  it('accounts for every React Native prop', () => {
    const unaccounted = rnProps.filter(
      (prop) => !supported.has(prop) && !FROM_VIEW_PROPS.has(prop) && !(prop in DELIBERATE)
    )
    // A prop React Native added that we have neither implemented nor decided
    // against. Implement it, or give it a reason in DELIBERATE.
    expect(unaccounted).toEqual([])
  })

  it('keeps the deliberate list honest', () => {
    const notReactNatives = Object.keys(DELIBERATE).filter((prop) => !rnProps.includes(prop))
    expect(notReactNatives).toEqual([])
    // If we implement one later, its excuse has to go.
    const nowSupported = Object.keys(DELIBERATE).filter((prop) => supported.has(prop))
    expect(nowSupported).toEqual([])
  })

  it('covers most of the surface', () => {
    const covered = rnProps.filter((prop) => supported.has(prop) || FROM_VIEW_PROPS.has(prop))
    // Recorded so a regression in coverage is visible, not to be impressive.
    expect(covered.length / rnProps.length).toBeGreaterThan(0.6)
  })
})

// ---------------------------------------------------------------------------
// 2. The same props mean the same thing
// ---------------------------------------------------------------------------

describe('aliases resolve the same way', () => {
  it('readOnly is editable={false} on both', () => {
    const { rn, ours } = both({ readOnly: true })
    expect(rn.host().editable).toBe(false)
    expect(ours.host().editable).toBe(false)
  })

  it('editable={false} reaches the host on both', () => {
    const { rn, ours } = both({ editable: false })
    expect(rn.host().editable).toBe(false)
    expect(ours.host().editable).toBe(false)
  })

  it('blurOnSubmit={false} becomes submitBehavior="submit" on both', () => {
    const { rn, ours } = both({ blurOnSubmit: false })
    expect(rn.host().submitBehavior).toBe('submit')
    expect(ours.host().submitBehavior).toBe('submit')
  })

  it('an explicit submitBehavior wins over blurOnSubmit on both', () => {
    const { rn, ours } = both({ submitBehavior: 'submit', blurOnSubmit: true })
    expect(rn.host().submitBehavior).toBe('submit')
    expect(ours.host().submitBehavior).toBe('submit')
  })

  it('submitBehavior defaults the same way: blurAndSubmit on one line, newline on many', () => {
    const single = both()
    expect(single.rn.host().submitBehavior).toBe('blurAndSubmit')
    expect(single.ours.host().submitBehavior).toBe('blurAndSubmit')
    const multi = both({ multiline: true })
    expect(multi.rn.host().submitBehavior).toBe('newline')
    expect(multi.ours.host().submitBehavior).toBe('newline')
  })

  it('blurOnSubmit on a multiline field maps the same way on both', () => {
    // `true` is the one value that changes anything on a multiline field: the
    // return key blurs instead of inserting a line break. `false` is the default.
    const blur = both({ multiline: true, blurOnSubmit: true })
    expect(blur.rn.host().submitBehavior).toBe('blurAndSubmit')
    expect(blur.ours.host().submitBehavior).toBe('blurAndSubmit')
    const newline = both({ multiline: true, blurOnSubmit: false })
    expect(newline.rn.host().submitBehavior).toBe('newline')
    expect(newline.ours.host().submitBehavior).toBe('newline')
    const single = both({ blurOnSubmit: true })
    expect(single.rn.host().submitBehavior).toBe('blurAndSubmit')
    expect(single.ours.host().submitBehavior).toBe('blurAndSubmit')
  })

  it('inputMode maps onto keyboardType the same way', () => {
    for (const [inputMode, keyboardType] of [
      ['text', 'default'],
      ['tel', 'phone-pad'],
      ['email', 'email-address'],
      ['url', 'url'],
      ['numeric', 'number-pad'],
      ['decimal', 'decimal-pad'],
    ] as const) {
      const { rn, ours } = both({ inputMode })
      expect(rn.host().keyboardType).toBe(keyboardType)
      expect(ours.host().keyboardType).toBe(keyboardType)
    }
  })

  it('inputMode="none" keeps the keyboard from showing on both', () => {
    const { rn, ours } = both({ inputMode: 'none' })
    expect(rn.host().showSoftInputOnFocus).toBe(false)
    expect(ours.host().showSoftInputOnFocus).toBe(false)
  })

  it('enterKeyHint maps onto returnKeyType the same way', () => {
    for (const [enterKeyHint, returnKeyType] of [
      ['enter', 'default'],
      ['done', 'done'],
      ['go', 'go'],
      ['next', 'next'],
      ['search', 'search'],
      ['send', 'send'],
    ] as const) {
      const { rn, ours } = both({ enterKeyHint })
      expect(rn.host().returnKeyType).toBe(returnKeyType)
      expect(ours.host().returnKeyType).toBe(returnKeyType)
    }
  })

  it('aria-label becomes the accessibility label on both', () => {
    const { rn, ours } = both({ 'aria-label': 'Amount' })
    expect(rn.host().accessibilityLabel).toBe('Amount')
    // Ours puts the label on the hidden field rather than the host, so the two
    // do not name the same element twice; the label itself is the same.
    expect(ours.host().fieldAccessibilityLabel).toBe('Amount')
  })

  it('aria-label wins over accessibilityLabel on both', () => {
    const { rn, ours } = both({ 'aria-label': 'Amount', accessibilityLabel: 'Old' })
    expect(rn.host().accessibilityLabel).toBe('Amount')
    expect(ours.host().fieldAccessibilityLabel).toBe('Amount')
  })

  it('id becomes nativeID on both, and wins over it', () => {
    const plain = both({ id: 'amount' })
    expect(plain.rn.host().nativeID).toBe('amount')
    expect(plain.ours.host().nativeID).toBe('amount')
    const conflicting = both({ id: 'amount', nativeID: 'legacy' })
    expect(conflicting.rn.host().nativeID).toBe('amount')
    expect(conflicting.ours.host().nativeID).toBe('amount')
  })

  it('aria-* state props fold into accessibilityState on both, the aria spelling winning', () => {
    const { rn, ours } = both({
      'aria-busy': true,
      'aria-disabled': true,
      accessibilityState: { disabled: false, selected: true },
    })
    expect(ours.host().accessibilityState).toEqual(rn.host().accessibilityState)
    expect(ours.host().accessibilityState).toEqual({ busy: true, disabled: true, selected: true })
    // Nothing of the kind given: nothing sent, on both.
    const none = both()
    expect(none.ours.host().accessibilityState).toEqual(none.rn.host().accessibilityState)
    expect(none.ours.host().accessibilityState).toBeUndefined()
  })

  it('aria-hidden hides the element on both', () => {
    const { rn, ours } = both({ 'aria-hidden': true })
    expect(ours.host().accessibilityElementsHidden).toEqual(rn.host().accessibilityElementsHidden)
    expect(ours.host().accessibilityElementsHidden).toBe(true)
  })

  it('accessibilityRole and a style reach the host on both', () => {
    const { rn, ours } = both({ accessibilityRole: 'search', style: { backgroundColor: 'rebeccapurple' } })
    expect(ours.host().accessibilityRole).toEqual(rn.host().accessibilityRole)
    expect(ours.host().accessibilityRole).toBe('search')
    const flatten = (style: unknown) => StyleSheet.flatten(style as never) as { backgroundColor?: unknown }
    expect(flatten(ours.host().style).backgroundColor).toEqual(flatten(rn.host().style).backgroundColor)
    expect(flatten(ours.host().style).backgroundColor).toBe('rebeccapurple')
  })

  it('names itself for DevTools, as TextInput does', () => {
    expect(TextInput.displayName).toBe('TextInput')
    expect(NitroInput.displayName).toBe('NitroInput')
  })

  it('testID reaches the host on both', () => {
    const { rn, ours } = both({ testID: 'amount' })
    expect(rn.host().testID).toBe('amount')
    expect(ours.host().testID).toBe('amount')
  })
})

/**
 * The bulk of the surface: a prop set on both, read back off both host views.
 * Anything that lands differently shows up here as a single named failure
 * rather than being noticed on a device months later.
 */
describe('props reach the native side the same way', () => {
  const SAME: Array<[prop: string, value: unknown]> = [
    ['placeholder', 'Enter a value'],
    ['maxLength', 10],
    ['secureTextEntry', true],
    ['autoCapitalize', 'words'],
    ['autoCorrect', false],
    ['keyboardType', 'email-address'],
    ['returnKeyType', 'go'],
    ['caretHidden', true],
    ['contextMenuHidden', true],
    ['selectTextOnFocus', true],
    ['clearTextOnFocus', true],
    ['enablesReturnKeyAutomatically', true],
    ['keyboardAppearance', 'dark'],
    ['textContentType', 'emailAddress'],
    ['showSoftInputOnFocus', false],
    ['allowFontScaling', false],
    ['maxFontSizeMultiplier', 2],
    ['textAlign', 'center'],
    ['editable', false],
    ['multiline', true],
    ['numberOfLines', 3],
    ['textAlignVertical', 'top'],
    ['spellCheck', false],
    ['submitBehavior', 'submit'],
  ]

  it.each(SAME)('%s', (prop, value) => {
    const { rn, ours } = both({ [prop]: value })
    expect(ours.host()[prop]).toEqual(rn.host()[prop])
    expect(ours.host()[prop]).toEqual(value)
  })

  it('defaultValue becomes the initial text on both', () => {
    const { rn, ours } = both({ defaultValue: 'seed' })
    expect(rn.host().text).toBe('seed')
    expect(ours.host().text).toBe('seed')
  })

  it('selection is handed over as {start, end} on both', () => {
    const { rn, ours } = both({ selection: { start: 1, end: 2 } })
    expect(rn.host().selection).toEqual({ start: 1, end: 2 })
    // Ours splits it into two scalars, because a Nitro prop is a value, not an
    // object it would have to re-parse every commit.
    expect(ours.host().selectionStart).toBe(1)
    expect(ours.host().selectionEnd).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 3. The same events fire, with the same payloads
// ---------------------------------------------------------------------------

describe('callbacks', () => {
  it('onChangeText receives the text on both', () => {
    const rnSpy = jest.fn()
    const ourSpy = jest.fn()
    const rn = render(<TextInput onChangeText={rnSpy} />)
    const ours = render(<NitroInput onChangeText={ourSpy} />)
    rnDriver(rn).type('ab', 1)
    ourDriver(ours).type('ab', 1)
    expect(rnSpy).toHaveBeenCalledWith('ab')
    expect(ourSpy).toHaveBeenCalledWith('ab')
  })

  it('onChange carries text, eventCount and target on both', () => {
    const rnSpy = jest.fn()
    const ourSpy = jest.fn()
    const rn = render(<TextInput onChange={rnSpy} />)
    const ours = render(<NitroInput onChange={ourSpy} />)
    rnDriver(rn).type('ab', 3)
    ourDriver(ours).type('ab', 3)
    const rnEvent = rnSpy.mock.calls[0]![0].nativeEvent
    const ourEvent = ourSpy.mock.calls[0]![0].nativeEvent
    expect(Object.keys(rnEvent).sort()).toEqual(expect.arrayContaining(['eventCount', 'target', 'text']))
    expect(Object.keys(ourEvent).sort()).toEqual(expect.arrayContaining(['eventCount', 'target', 'text']))
    expect(ourEvent.text).toBe(rnEvent.text)
    expect(ourEvent.eventCount).toBe(rnEvent.eventCount)
  })

  it('onChange and onChangeText both fire, on both', () => {
    const rnChange = jest.fn()
    const rnText = jest.fn()
    const ourChange = jest.fn()
    const ourText = jest.fn()
    const rn = render(<TextInput onChange={rnChange} onChangeText={rnText} />)
    const ours = render(<NitroInput onChange={ourChange} onChangeText={ourText} />)
    rnDriver(rn).type('x', 1)
    ourDriver(ours).type('x', 1)
    expect(rnChange).toHaveBeenCalledTimes(1)
    expect(rnText).toHaveBeenCalledTimes(1)
    expect(ourChange).toHaveBeenCalledTimes(1)
    expect(ourText).toHaveBeenCalledTimes(1)
  })

  it('onFocus and onBlur fire once each, on both', () => {
    const rnFocus = jest.fn()
    const rnBlur = jest.fn()
    const ourFocus = jest.fn()
    const ourBlur = jest.fn()
    const rn = render(<TextInput onFocus={rnFocus} onBlur={rnBlur} />)
    const ours = render(<NitroInput onFocus={ourFocus} onBlur={ourBlur} />)
    for (const d of [rnDriver(rn), ourDriver(ours)]) {
      d.focus()
      d.blur()
    }
    expect(rnFocus).toHaveBeenCalledTimes(1)
    expect(rnBlur).toHaveBeenCalledTimes(1)
    expect(ourFocus).toHaveBeenCalledTimes(1)
    expect(ourBlur).toHaveBeenCalledTimes(1)
  })

  /**
   * A handler written against a `TextInput` reaches through `nativeEvent`.
   * Every event this component sends carries it, under the same names, so
   * swapping the component does not mean touching the handler.
   */
  it('onSubmitEditing reaches nativeEvent.text on both', () => {
    const rnSpy = jest.fn()
    const ourSpy = jest.fn()
    const rn = render(<TextInput onSubmitEditing={rnSpy} />)
    const ours = render(<NitroInput onSubmitEditing={ourSpy} />)
    rnDriver(rn).submit('done')
    ourDriver(ours).submit('done')
    expect(rnSpy.mock.calls[0]![0].nativeEvent.text).toBe('done')
    expect(ourSpy.mock.calls[0]![0].nativeEvent.text).toBe('done')
  })

  it('onEndEditing reaches nativeEvent.text on both', () => {
    const rnSpy = jest.fn()
    const ourSpy = jest.fn()
    const rn = render(<TextInput onEndEditing={rnSpy} />)
    const ours = render(<NitroInput onEndEditing={ourSpy} />)
    rnDriver(rn).endEditing('final')
    ourDriver(ours).endEditing('final')
    expect(rnSpy.mock.calls[0]![0].nativeEvent.text).toBe('final')
    expect(ourSpy.mock.calls[0]![0].nativeEvent.text).toBe('final')
  })

  it('onSelectionChange reaches nativeEvent.selection on both', () => {
    const rnSpy = jest.fn()
    const ourSpy = jest.fn()
    const rn = render(<TextInput onSelectionChange={rnSpy} />)
    const ours = render(<NitroInput onSelectionChange={ourSpy} />)
    rnDriver(rn).select(1, 3)
    ourDriver(ours).select(1, 3)
    expect(rnSpy.mock.calls[0]![0].nativeEvent.selection).toEqual({ start: 1, end: 3 })
    expect(ourSpy.mock.calls[0]![0].nativeEvent.selection).toEqual({ start: 1, end: 3 })
  })

  it('onFocus and onBlur carry an event on both', () => {
    const rnFocus = jest.fn()
    const ourFocus = jest.fn()
    const rn = render(<TextInput onFocus={rnFocus} />)
    const ours = render(<NitroInput onFocus={ourFocus} />)
    rnDriver(rn).focus()
    ourDriver(ours).focus()
    expect(rnFocus.mock.calls[0]![0].nativeEvent).toBeDefined()
    expect(ourFocus.mock.calls[0]![0].nativeEvent).toBeDefined()
    expect(typeof ourFocus.mock.calls[0]![0].nativeEvent.target).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// 4. The staleness protocol
// ---------------------------------------------------------------------------

describe('mostRecentEventCount', () => {
  it('starts at zero on both', () => {
    const { rn, ours } = both()
    expect(rn.drive.eventCount()).toBe(0)
    expect(ours.drive.eventCount()).toBe(0)
  })

  it('advances to the count the native side reported, on both', () => {
    // A controlled field: the count is what lets native tell a stale `value`
    // from a deliberate one. An uncontrolled field of ours keeps it in a ref
    // and does not render for it - see the deliberate differences.
    const { rn, ours } = both({ value: 'a', onChangeText: () => {} })
    rn.drive.type('a', 1)
    ours.drive.type('a', 1)
    expect(rn.drive.eventCount()).toBe(1)
    expect(ours.drive.eventCount()).toBe(1)
    rn.drive.type('ab', 2)
    ours.drive.type('ab', 2)
    expect(rn.drive.eventCount()).toBe(2)
    expect(ours.drive.eventCount()).toBe(2)
  })

  it('a controlled field sends the value it was given, on both', () => {
    const rn = render(<TextInput value="one" onChangeText={() => {}} />)
    const ours = render(<NitroInput value="one" onChangeText={() => {}} />)
    expect(rnHost(rn).text).toBe('one')
    expect(ourHost(ours).text).toBe('one')
    act(() => {
      rn.update(<TextInput value="two" onChangeText={() => {}} />)
      ours.update(<NitroInput value="two" onChangeText={() => {}} />)
    })
    expect(rnHost(rn).text).toBe('two')
    expect(ourHost(ours).text).toBe('two')
  })
})

// ---------------------------------------------------------------------------
// 5. The imperative API
// ---------------------------------------------------------------------------

describe('ref', () => {
  /** What React Native's ref offers that a caller is likely to reach for. */
  const CORE = ['focus', 'blur', 'clear', 'isFocused', 'setSelection'] as const

  it('React Native’s ref has the methods this compares against', () => {
    const ref = createRef<any>()
    render(<TextInput ref={ref} />)
    for (const method of CORE) expect(typeof ref.current[method]).toBe('function')
  })

  it('ours has every one of them', () => {
    const ref = createRef<NitroInputHandle>()
    render(<NitroInput ref={ref} />)
    for (const method of CORE) {
      expect(typeof (ref.current as unknown as Record<string, unknown>)[method]).toBe('function')
    }
  })

  it('isFocused() follows the native focus event on both', () => {
    // One at a time: the registry holds a single focused input, so focusing
    // both and then asserting both would only prove the second one won.
    const rnRef = createRef<any>()
    const rn = render(<TextInput ref={rnRef} />)
    expect(rnRef.current.isFocused()).toBe(false)
    rnDriver(rn).focus()
    expect(rnRef.current.isFocused()).toBe(true)
    rnDriver(rn).blur()
    expect(rnRef.current.isFocused()).toBe(false)

    const ourRef = createRef<NitroInputHandle>()
    const ours = render(<NitroInput ref={ourRef} />)
    expect(ourRef.current!.isFocused()).toBe(false)
    ourDriver(ours).focus()
    expect(ourRef.current!.isFocused()).toBe(true)
    ourDriver(ours).blur()
    expect(ourRef.current!.isFocused()).toBe(false)
  })

  it('clear(), focus(), blur() and setSelection() are callable on both', () => {
    const { rn, ours } = both()
    expect(() => {
      act(() => {
        rn.ref.current.focus()
        rn.ref.current.setSelection(0, 1)
        rn.ref.current.clear()
        rn.ref.current.blur()
      })
    }).not.toThrow()
    expect(() => {
      act(() => {
        ours.ref.current!.focus()
        ours.ref.current!.setSelection(0, 1)
        ours.ref.current!.clear()
        ours.ref.current!.blur()
      })
    }).not.toThrow()
  })
})

describe('the TextInput.State registry', () => {
  it('focusing one of ours takes focus from a TextInput, and the other way round', () => {
    // A form with both in it: whichever was focused last is the one the
    // registry names, so Keyboard.dismiss() and keyboardShouldPersistTaps act
    // on the right field. This is the property that makes them mixable.
    const rnRef = createRef<any>()
    const ourRef = createRef<NitroInputHandle>()
    const rn = render(<TextInput ref={rnRef} />)
    const ours = render(<NitroInput ref={ourRef} />)

    rnDriver(rn).focus()
    expect(rnRef.current.isFocused()).toBe(true)
    expect(ourRef.current!.isFocused()).toBe(false)

    ourDriver(ours).focus()
    expect(ourRef.current!.isFocused()).toBe(true)
    expect(rnRef.current.isFocused()).toBe(false)

    rnDriver(rn).focus()
    expect(rnRef.current.isFocused()).toBe(true)
    expect(ourRef.current!.isFocused()).toBe(false)
  })

  it('an unmounted field is focused on neither', () => {
    const rnRef = createRef<any>()
    const ourRef = createRef<NitroInputHandle>()
    const rn = render(<TextInput ref={rnRef} />)
    const ours = render(<NitroInput ref={ourRef} />)
    const rnHandle = rnRef.current
    const ourHandle = ourRef.current!
    rnDriver(rn).focus()
    ourDriver(ours).focus()
    act(() => {
      rn.unmount()
      ours.unmount()
    })
    expect(rnHandle.isFocused()).toBe(false)
    expect(ourHandle.isFocused()).toBe(false)
  })

  it('a focused field of ours is what currentlyFocusedInput() reports, as React Native’s is', () => {
    const rn = render(<TextInput />)
    rnDriver(rn).focus()
    expect(TextInputState.currentlyFocusedInput()).not.toBeNull()
    act(() => {
      rn.unmount()
    })

    const ours = render(<NitroInput />)
    ourDriver(ours).focus()
    // Keyboard.dismiss(), keyboardShouldPersistTaps and ScrollView auto-blur all
    // consult this; a field missing from it is a field they cannot dismiss.
    expect(TextInputState.currentlyFocusedInput()).not.toBeNull()
    act(() => {
      ours.unmount()
    })
  })
})

// ---------------------------------------------------------------------------
// 6. Differences that are deliberate
//
// Each of these is a place the two do not match. The test says what ours does
// instead, so the choice stays visible and cannot rot into a bug.
// ---------------------------------------------------------------------------

describe('deliberate differences', () => {
  it('sizes itself to its content only when asked, where TextInput never does', () => {
    // `TextInput` has no intrinsic width. Ours measures its text, which is what
    // makes an amount field possible, but only under `autoWidth`: `false` (the
    // default) takes no width of its own, so flexbox stretches the field like
    // a `TextInput`; `'auto'` (the default under `transition="reflow"`) infers
    // it unless `style` gives a `width` or `flex`; `true` always sizes to
    // content. The measured size is the first entry of the host's `style`,
    // ahead of the caller's.
    const measured = (renderer: ReactTestRenderer) => {
      const onSizeChange = ourHost(renderer).onSizeChange as { f: (w: number, h: number) => void }
      act(() => onSizeChange.f(120, 48))
      return (ourHost(renderer).style as unknown[])[0]
    }
    expect(measured(render(<NitroInput />))).toEqual({ height: 48 })
    expect(measured(render(<NitroInput style={{ width: 200 }} />))).toEqual({ height: 48 })
    expect(measured(render(<NitroInput autoWidth="auto" />))).toEqual({ width: 120, height: 48 })
    expect(measured(render(<NitroInput autoWidth="auto" style={{ width: 200 }} />))).toEqual({ height: 48 })
    expect(measured(render(<NitroInput autoWidth="auto" style={{ flex: 1 }} />))).toEqual({ height: 48 })
    expect(measured(render(<NitroInput autoWidth />))).toEqual({ width: 120, height: 48 })
    expect(measured(render(<NitroInput autoWidth style={{ width: 200 }} />))).toEqual({ width: 120, height: 48 })
    // A reflowing field defaults to `'auto'`, so an amount grows as digits
    // arrive; an explicit `autoWidth` still wins, and a multiline one does not reflow.
    expect(measured(render(<NitroInput transition="reflow" />))).toEqual({ width: 120, height: 48 })
    expect(measured(render(<NitroInput transition="reflow" style={{ width: 200 }} />))).toEqual({ height: 48 })
    expect(measured(render(<NitroInput transition="reflow" autoWidth={false} />))).toEqual({ height: 48 })
    expect(measured(render(<NitroInput transition="reflow" multiline />))).toEqual({ height: 48 })
    // A box pinned on both axes never takes the measurement: `style` would win
    // anyway, and the state update would be a wasted commit per field.
    expect(measured(render(<NitroInput style={{ width: 200, height: 40 }} />))).toEqual({ height: 40 })
  })

  it('does not re-render an uncontrolled field on a keystroke, where TextInput does', () => {
    // React Native's `TextInput` keeps `mostRecentEventCount` in state and sets
    // it on every change, so even an uncontrolled field re-renders per key.
    // Ours keeps the count in a ref and only takes the state update when
    // `value` is given - the one case native needs the count, since only a
    // controlled field's `text` prop can change. That is what lets a
    // worklet-driven field run nothing on the JS thread while typing.
    const rnRenders = jest.fn()
    const ourRenders = jest.fn()
    const rn = render(
      <Profiler id="rn" onRender={rnRenders}>
        <TextInput onChangeText={() => {}} />
      </Profiler>
    )
    const ours = render(
      <Profiler id="ours" onRender={ourRenders}>
        <NitroInput onChangeText={() => {}} />
      </Profiler>
    )
    expect(ourRenders).toHaveBeenCalledTimes(1)
    const rnBefore = rnRenders.mock.calls.length
    const ourPropsBefore = ourHost(ours)
    rnDriver(rn).type('a', 1)
    ourDriver(ours).type('a', 1)
    expect(rnRenders.mock.calls.length).toBeGreaterThan(rnBefore)
    expect(ourRenders).toHaveBeenCalledTimes(1)
    expect(ourHost(ours)).toBe(ourPropsBefore)

    // The count was still tracked: making the field controlled later sends
    // the fresh one, so the new `value` is not taken for a stale one.
    act(() => {
      ours.update(
        <Profiler id="ours" onRender={ourRenders}>
          <NitroInput value="a" onChangeText={() => {}} />
        </Profiler>
      )
    })
    expect(ourHost(ours).mostRecentEventCount).toBe(1)
    expect(ourHost(ours).text).toBe('a')
    ourDriver(ours).type('ab', 2)
    expect(ourHost(ours).mostRecentEventCount).toBe(2)
  })

  it('multiline turns the reflow off, because one run cannot wrap', () => {
    // The glyph engine lays a single run out on one baseline. A wrapping field
    // is drawn by the platform instead, so `plain` goes true whatever
    // `transition` asked for.
    expect(ourHost(render(<NitroInput multiline />)).plain).toBe(true)
    expect(ourHost(render(<NitroInput multiline transition="reflow" />)).plain).toBe(true)
    // The reflow is opt-in: a plain field is the drop-in.
    expect(ourHost(render(<NitroInput />)).plain).toBe(true)
    expect(ourHost(render(<NitroInput transition="none" />)).plain).toBe(true)
    expect(ourHost(render(<NitroInput transition="reflow" />)).plain).toBe(false)
  })

  it('reports a number as well as text, which TextInput has no notion of', () => {
    const onChangeValue = jest.fn()
    const ours = render(<NitroInput mode="number" onChangeValue={onChangeValue} onChangeText={() => {}} />)
    const value = ourHost(ours).onChangeValue as { f: (v: number) => void }
    act(() => value.f(1234.5))
    expect(onChangeValue).toHaveBeenCalledWith(1234.5)
  })

  /**
   * The events are supersets: React Native's `nativeEvent` is there (asserted
   * above, which is what makes the swap safe), and the same fields sit at the
   * top level so a handler can destructure instead of reaching through it.
   */
  it('repeats every event field at the top level, which TextInput does not', () => {
    const submit = jest.fn()
    const end = jest.fn()
    const select = jest.fn()
    const focus = jest.fn()
    const key = jest.fn()

    const s1 = render(<NitroInput onSubmitEditing={submit} />)
    ourDriver(s1).submit('done')
    expect(submit.mock.calls[0]![0]).toMatchObject({ text: 'done', nativeEvent: { text: 'done' } })

    const s2 = render(<NitroInput onEndEditing={end} />)
    ourDriver(s2).endEditing('final')
    expect(end.mock.calls[0]![0]).toMatchObject({ text: 'final', nativeEvent: { text: 'final' } })

    const s3 = render(<NitroInput onSelectionChange={select} />)
    ourDriver(s3).select(1, 3)
    // Both `{ start, end }` and `{ selection }` read off the same event.
    expect(select.mock.calls[0]![0]).toMatchObject({
      start: 1,
      end: 3,
      selection: { start: 1, end: 3 },
      nativeEvent: { selection: { start: 1, end: 3 } },
    })

    const s4 = render(<NitroInput onFocus={focus} />)
    ourDriver(s4).focus()
    expect(focus.mock.calls[0]![0]).toMatchObject({ text: '', eventCount: 0 })

    const s5 = render(<NitroInput onKeyPress={key} />)
    const cb = ourHost(s5).onKeyPress as { f: (k: string) => void }
    act(() => cb.f('a'))
    expect(key.mock.calls[0]![0]).toMatchObject({ key: 'a', nativeEvent: { key: 'a' } })
  })

  it('a focus event reports the text the field currently holds', () => {
    const focus = jest.fn()
    const ours = render(<NitroInput value="hello" onChangeText={() => {}} onFocus={focus} />)
    ourDriver(ours).focus()
    expect(focus.mock.calls[0]![0].text).toBe('hello')
    expect(focus.mock.calls[0]![0].nativeEvent.text).toBe('hello')
  })

  it('draws its own frame, where TextInput has underlineColorAndroid and nothing on iOS', () => {
    const framed = ourHost(render(<NitroInput variant="outlined" label="Email" />))
    expect(framed.variant).toBe('outlined')
    expect(framed.label).toBe('Email')
  })

  /**
   * Two keyboard enums are narrower than React Native's. Both fall back to the
   * default rather than failing, so a drop-in still works - it just gets a
   * different keyboard in these two cases.
   */
  it('falls back to the default for the two enum values it does not carry', () => {
    const search = both({ inputMode: 'search' })
    expect(search.rn.host().keyboardType).toBe('web-search')
    expect(search.ours.host().keyboardType).toBe('default')

    const previous = both({ enterKeyHint: 'previous' })
    expect(previous.rn.host().returnKeyType).toBe('previous')
    expect(previous.ours.host().returnKeyType).toBe('default')
  })
})
