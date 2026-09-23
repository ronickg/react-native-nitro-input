import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { RollingNumber, type RollingNumberHandle } from 'react-native-nitro-rolling-number'
import {
  MorphInput,
  NitroInput,
  type MorphInputHandle,
  type NitroInputTransform,
} from 'react-native-nitro-input'
import { useNitroInputState } from 'react-native-nitro-input'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { AsYouType } from 'libphonenumber-js/min'

type MaskReadout = { formatted: string; extracted: string; tail: string; complete: boolean }
const EMPTY_MASK: MaskReadout = { formatted: '', extracted: '', tail: '', complete: false }
/** A custom slot character: `H` accepts one hex digit. Defined once so the prop stays stable. */
const HEX_NOTATION = [
  { character: 'H', characterSet: '0123456789abcdefABCDEF', isOptional: false },
]

function Button({
  title,
  onPress,
  selected,
  testID,
}: {
  title: string
  onPress: () => void
  selected?: boolean
  testID?: string
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && styles.buttonSelected,
        pressed && styles.buttonPressed,
      ]}
      testID={testID ?? `button-${title}`}
    >
      <Text style={[styles.buttonText, selected && styles.buttonTextSelected]}>{title}</Text>
    </Pressable>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionHint}>{hint}</Text>
      {children}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Feature demos
// ---------------------------------------------------------------------------

// A username mask: lowercase letters, digits and underscores, always led by "@".
const usernameTransform: NitroInputTransform = ({ text }) => {
  'worklet'
  const cleaned = text.replace(/[^0-9a-zA-Z_]/g, '').toLowerCase()
  return { text: cleaned ? '@' + cleaned : '' }
}

// A real library inside the worklet (worklets Bundle Mode): libphonenumber-js
// formats the number as it is typed, on the UI thread, before a frame is drawn.
const phoneTransform: NitroInputTransform = ({ text }) => {
  'worklet'
  const formatter = new AsYouType('US')
  const formatted = formatter.input(text)
  return { text: formatted }
}

/** Worklets: a shared value fed from the UI thread on every keystroke, and a JS mask applied before a frame is drawn. */
function MorphWorkletDemo() {
  const [phone, setPhone] = useState('')
  const progress = useSharedValue(0)
  const barStyle = useAnimatedStyle(() => ({ width: `${Math.min(100, progress.value)}%` }))
  const onChangeValue = (value: number) => {
    'worklet'
    progress.value = Number.isNaN(value) ? 0 : value / 10
  }
  return (
    <Section title="Worklets" hint="onChangeValue is a worklet: it writes a shared value on the UI thread, no JS in between. The username field's transform worklet masks the text before it is drawn; the phone field's transform runs libphonenumber-js inside the worklet (Bundle Mode).">
      <MorphInput
        testID="morph-worklet-amount"
        mode="number"
        prefix="$"
        placeholder="0"
        fractionDigits={0}
        fontSize={36}
        fontWeight="700"
        style={styles.morphAmount}
        onChangeValue={onChangeValue}
      />
      <View style={styles.morphBarTrack}>
        <Animated.View style={[styles.morphBar, barStyle]} />
      </View>
      <View style={styles.morphTextBox}>
        <MorphInput
          testID="morph-worklet-username"
          placeholder="@username"
          fontSize={22}
          style={styles.morphText}
          autoCapitalize="none"
          autoCorrect={false}
          transform={usernameTransform}
        />
      </View>
      <View style={styles.morphTextBox}>
        <MorphInput
          testID="morph-worklet-phone"
          placeholder="(555) 555-5555"
          fontSize={22}
          style={styles.morphText}
          keyboardType="phone-pad"
          transform={phoneTransform}
          onChangeText={setPhone}
        />
      </View>
      <Text style={styles.morphReadout} testID="morph-worklet-phone-readout">phone "{phone}"</Text>
    </Section>
  )
}

function MorphInputDemo() {
  const amountRef = useRef<MorphInputHandle>(null)
  const [amountText, setAmountText] = useState('')
  const [amountValue, setAmountValue] = useState(NaN)
  const [note, setNote] = useState('')
  const [focused, setFocused] = useState(false)
  const maskPhoneRef = useRef<MorphInputHandle>(null)
  const [maskSel, setMaskSel] = useState('-')
  const [outlinedText, setOutlinedText] = useState('')
  const [multilineText, setMultilineText] = useState('')
  const [multilineSubmit, setMultilineSubmit] = useState<'submit' | 'blurAndSubmit' | 'newline'>('submit')
  const [multilineSubmits, setMultilineSubmits] = useState(0)
  const [multilineFocused, setMultilineFocused] = useState(false)
  const [maskPhone, setMaskPhone] = useState(EMPTY_MASK)
  const [maskHex, setMaskHex] = useState(EMPTY_MASK)
  return (
    <Section title="Morph input" hint="A native input whose text morphs as you type. The amount is formatted natively, caret and all, with no JS round trip.">
      <View style={styles.morphAmountBox}>
        <MorphInput
          ref={amountRef}
          testID="morph-amount"
          mode="number"
          prefix="$"
          prefixFontSize={28}
          affixAlign="top"
          placeholder="0"
          fontSize={44}
          fontWeight="700"
          textAlign="center"
          style={styles.morphAmount}
          onChangeText={setAmountText}
          onChangeValue={setAmountValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
      <Text style={styles.morphReadout} testID="morph-amount-readout">
        text "{amountText}" · value {Number.isNaN(amountValue) ? 'NaN' : amountValue} · {focused ? 'focused' : 'blurred'}
      </Text>
      <View style={styles.row}>
        <Button title="Set 1,234.56" testID="morph-set" onPress={() => amountRef.current?.setValue(1234.56)} />
        <Button title="Set 98,765" testID="morph-set-2" onPress={() => amountRef.current?.setValue(98765)} />
        <Button title="Set -1,234.56" testID="morph-set-negative" onPress={() => amountRef.current?.setValue(-1234.56)} />
        <Button title="Clear" testID="morph-clear" onPress={() => amountRef.current?.clear()} />
        <Button title="Focus" testID="morph-focus" onPress={() => amountRef.current?.focus()} />
        <Button title="Blur" testID="morph-blur" onPress={() => amountRef.current?.blur()} />
      </View>
      <Text style={styles.morphReadout}>
        Below: NitroInput (no glyph engine, so typing is instant) with the
        outlined and filled frames. The notch is a real hole in the stroke.
      </Text>
      <View style={styles.outlineFields}>
        <NitroInput
          testID="morph-outlined"
          variant="outlined"
          label="Email address"
          placeholder="you@example.com"
          fontSize={17}
          strokeColor="#94a3b8"
          focusedStrokeColor="#2563eb"
          cornerRadius={10}
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.outlineField}
          onChangeText={setOutlinedText}
        />
        <NitroInput
          testID="morph-outlined-always"
          variant="outlined"
          label="Always floated"
          labelBehavior="always"
          prefix="$ "
          fontSize={17}
          strokeColor="#94a3b8"
          focusedStrokeColor="#16a34a"
          labelColor="#b45309"
          labelFocusedColor="#16a34a"
          labelFontSize={11}
          cornerRadius={10}
          style={styles.outlineField}
        />
        <NitroInput
          testID="morph-filled"
          variant="filled"
          label="Filled variant"
          placeholder="type here"
          fontSize={17}
          fillColor="#e2e8f0"
          strokeColor="#475569"
          focusedStrokeColor="#7c3aed"
          cornerRadius={10}
          style={styles.outlineField}
        />
      </View>
      <View style={styles.outlineFields}>
        {/* No `style` at all: a drop-in has to take its width from its parent,
            the way a TextInput does, rather than sizing to its content. */}
        <NitroInput testID="morph-stretch" placeholder="No style — should fill the row" fontSize={15} />
        {/* Wrapping. Grows with its text until `numberOfLines`, then scrolls. */}
        <NitroInput
          testID="morph-multiline"
          multiline
          numberOfLines={4}
          variant="outlined"
          label="Notes"
          placeholder="Type a few lines…"
          fontSize={15}
          strokeColor="#94a3b8"
          focusedStrokeColor="#2563eb"
          cornerRadius={10}
          onChangeText={setMultilineText}
        />
        <Text style={styles.morphReadout} testID="morph-multiline-readout">
          multiline {JSON.stringify(multilineText)}
        </Text>
        {/* The return key on a wrapping field: `submit` fires onSubmitEditing and
            keeps focus, `blurAndSubmit` also dismisses the keyboard, `newline`
            (the default) inserts a line break. */}
        <NitroInput
          testID="morph-multiline-submit"
          multiline
          numberOfLines={3}
          variant="outlined"
          label={`submitBehavior ${multilineSubmit}`}
          placeholder="Press return"
          fontSize={15}
          strokeColor="#94a3b8"
          focusedStrokeColor="#2563eb"
          cornerRadius={10}
          submitBehavior={multilineSubmit}
          onFocus={() => setMultilineFocused(true)}
          onBlur={() => setMultilineFocused(false)}
          onSubmitEditing={() => setMultilineSubmits((n) => n + 1)}
        />
        <Text style={styles.morphReadout} testID="morph-multiline-submit-readout">
          submits {multilineSubmits} · {multilineFocused ? 'focused' : 'blurred'}
        </Text>
        <Button
          title={`submitBehavior: ${multilineSubmit}`}
          testID="morph-multiline-submit-toggle"
          onPress={() =>
            setMultilineSubmit((s) => (s === 'submit' ? 'blurAndSubmit' : s === 'blurAndSubmit' ? 'newline' : 'submit'))
          }
        />
        {/* lineHeight, both directions. 34 is looser than the font's own line
            box at 15pt, 14 is tighter — the case RN's correction skips, which
            is why a compressed lineHeight rides off-centre on a TextInput. */}
        <NitroInput
          testID="morph-lineheight-loose"
          multiline
          numberOfLines={3}
          lineHeight={34}
          variant="outlined"
          label="lineHeight 34 (loose)"
          fontSize={15}
          strokeColor="#94a3b8"
          cornerRadius={10}
          defaultValue={'One line\nTwo lines\nThree lines'}
        />
        <NitroInput
          testID="morph-lineheight-tight"
          multiline
          numberOfLines={3}
          lineHeight={14}
          variant="outlined"
          label="lineHeight 14 (tight)"
          fontSize={15}
          strokeColor="#94a3b8"
          cornerRadius={10}
          defaultValue={'One line\nTwo lines\nThree lines'}
        />
        {/* The same amount without the morph: `NitroInput` is plain unless asked,
            so this is what a currency field looks like by default. */}
        <NitroInput
          testID="morph-plain-negative"
          mode="number"
          prefix="$"
          // The other placement: a symbol styled as an ornament reads better
          // with the sign against the digits.
          signPlacement="afterAffix"
          morph
          variant="outlined"
          label="signPlacement afterAffix"
          fontSize={17}
          strokeColor="#94a3b8"
          cornerRadius={10}
          defaultValue="-1234.56"
          style={styles.outlineField}
        />
        <WorkletVsJsThread />
      </View>
      <Text style={styles.morphReadout} testID="morph-outlined-readout">
        outlined "{outlinedText}"
      </Text>
      <View style={styles.morphTextBox}>
        <MorphInput
          ref={maskPhoneRef}
          testID="morph-mask-phone"
          mode="mask"
          mask="+1 ([000]) [000]-[0000]"
          placeholder="+1 (000) 000-0000"
          fontSize={22}
          maskAutoSkip
          keyboardType="number-pad"
          style={styles.morphText}
          onSelectionChange={({ start, end }) => setMaskSel(`${start}-${end}`)}
          onChangeMask={(formatted, extracted, tail, complete) =>
            setMaskPhone({ formatted, extracted, tail, complete })
          }
        />
      </View>
      <View style={styles.row}>
        <Button
          title="Select 4-7"
          testID="morph-mask-select"
          onPress={() => {
            // Tapping a button dismisses the keyboard, and a blurred field has
            // no selection to move - focus first, as a real caller would.
            maskPhoneRef.current?.focus()
            maskPhoneRef.current?.setSelection(4, 7)
          }}
        />
        <Button
          title="Caret 4"
          testID="morph-mask-caret"
          onPress={() => {
            maskPhoneRef.current?.focus()
            maskPhoneRef.current?.setSelection(4)
          }}
        />
      </View>
      <Text style={styles.morphReadout} testID="morph-mask-sel-readout">
        selection {maskSel}
      </Text>
      <Text style={styles.morphReadout} testID="morph-mask-phone-readout">
        extracted "{maskPhone.extracted}" · tail "{maskPhone.tail}" ·{' '}
        {maskPhone.complete ? 'complete' : 'incomplete'}
      </Text>
      <View style={styles.morphTextBox}>
        <MorphInput
          testID="morph-mask-hex"
          mode="mask"
          mask="#[HHHHHH]"
          maskNotations={HEX_NOTATION}
          placeholder="#HHHHHH"
          fontSize={22}
          autoCapitalize="none"
          style={styles.morphText}
          onChangeMask={(formatted, extracted, tail, complete) =>
            setMaskHex({ formatted, extracted, tail, complete })
          }
        />
      </View>
      <Text style={styles.morphReadout} testID="morph-mask-hex-readout">
        extracted "{maskHex.extracted}" · tail "{maskHex.tail}" ·{' '}
        {maskHex.complete ? 'complete' : 'incomplete'}
      </Text>
      <View style={styles.morphTextBox}>
        <MorphInput
          testID="morph-text"
          placeholder="Type something"
          fontSize={22}
          style={styles.morphText}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onChangeText={setNote}
        />
      </View>
      <Text style={styles.morphReadout} testID="morph-text-readout">text "{note}"</Text>
    </Section>
  )
}

function ReactDrivenDemo() {
  const [value, setValue] = useState(1234.5)
  const [mounted, setMounted] = useState(true)
  const [numeric, setNumeric] = useState(false)
  return (
    <Section title="React prop" hint="Change `value`, the digits roll natively. Fits the card: full size until it would overflow, then it shrinks. Numeric: each changed glyph swaps in place instead (SwiftUI's numericText).">
      <View style={styles.display}>
        {mounted ? (
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          prefix="$"
          fontSize={52}
          fontWeight="700"
          color="#0A84FF"
          transition={numeric ? 'numeric' : 'roll'}
          easing="spring"
          bounce={0.2}
          duration={numeric ? 450 : 700}
          stagger={40}
          adjustsFontSizeToFit
          minimumFontScale={0.35}
          style={styles.fitCard}
          testID="react-driven"
        />
        ) : (
          <Text style={styles.sectionHint}>unmounted</Text>
        )}
      </View>
      <View style={styles.row}>
        <Button title="+1" onPress={() => setValue((v) => v + 1)} />
        <Button title="+123.45" onPress={() => setValue((v) => v + 123.45)} />
        <Button title="×10" onPress={() => setValue((v) => v * 10)} />
        <Button title="−1" onPress={() => setValue((v) => v - 1)} />
        <Button title="÷10" onPress={() => setValue((v) => v / 10)} />
        <Button title="Random" onPress={() => setValue(Math.round(Math.random() * 1_000_000_00) / 100)} />
        <Button title="Negate" onPress={() => setValue((v) => -v)} />
        <Button title="Reset" onPress={() => setValue(1234.5)} />
        <Button title={mounted ? 'Unmount' : 'Remount'} onPress={() => setMounted((m) => !m)} />
        <Button title={numeric ? 'Transition: numeric' : 'Transition: roll'} onPress={() => setNumeric((n) => !n)} testID="react-driven-transition" />
      </View>
    </Section>
  )
}

function CurrencyDemo() {
  const [value, setValue] = useState(4280.5)
  const [loading, setLoading] = useState(false)
  return (
    <Section title="Currency layouts" hint="Smaller prefix/suffix, shrink-to-fit inside a fixed width, loading shimmer.">
      <View style={styles.display}>
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          prefix="$"
          prefixFontSize={22}
          affixAlign="top"
          fontSize={44}
          fontFamily="OpenRunde-Semibold"
          loading={loading}
          testID="currency-prefix"
        />
      </View>
      <View style={styles.display}>
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          suffix=" USD"
          suffixFontSize={16}
          suffixAlign="bottom"
          fontSize={44}
          fontWeight="600"
          color="#5E5CE6"
          testID="currency-suffix"
        />
      </View>
      <Text style={styles.sectionHint}>Fixed 180×64pt box with adjustsFontSizeToFit (box never resizes):</Text>
      <View style={styles.fitBox}>
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          prefix="$"
          fontSize={44}
          fontWeight="700"
          adjustsFontSizeToFit
          minimumFontScale={0.3}
          textAlign="center"
          style={styles.fitNumber}
          testID="currency-fit"
        />
      </View>
      <View style={styles.row}>
        <Button title="×100" onPress={() => setValue((v) => v * 100)} />
        <Button title="÷100" onPress={() => setValue((v) => v / 100)} />
        <Button title="+0.99" onPress={() => setValue((v) => v + 0.99)} />
        <Button title="Reset" onPress={() => setValue(4280.5)} />
        <Button title={loading ? 'Loaded' : 'Loading…'} onPress={() => setLoading((l) => !l)} />
      </View>
    </Section>
  )
}

function CenteredDemo() {
  const [value, setValue] = useState(875.4)
  return (
    <Section title="Centered in a fixed box" hint={'OpenRunde-Bold (bundled font), textAlign="center", top-pinned prefix and bottom-pinned suffix; watch them slide as digits appear.'}>
      <View style={styles.centerBox}>
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          prefix="$"
          prefixFontSize={20}
          prefixAlign="top"
          suffix=" USD"
          suffixFontSize={14}
          suffixAlign="bottom"
          fontSize={40}
          fontFamily="OpenRunde-Bold"
          textAlign="center"
          stagger={30}
          style={styles.centerNumber}
          testID="centered"
        />
      </View>
      <View style={styles.row}>
        <Button title="×10" onPress={() => setValue((v) => v * 10)} />
        <Button title="÷10" onPress={() => setValue((v) => v / 10)} />
        <Button title="+1" onPress={() => setValue((v) => v + 1)} />
        <Button title="Random" onPress={() => setValue(Math.round(Math.random() * 10_000_000) / 100)} />
        <Button title="Reset" onPress={() => setValue(875.4)} />
      </View>
    </Section>
  )
}

function ImperativeDemo() {
  const ref = useRef<RollingNumberHandle>(null)
  return (
    <Section title="Imperative handle" hint="`animateTo` rolls, `jumpTo` positions the wheels continuously.">
      <View style={styles.display}>
        <RollingNumber
          ref={ref}
          value={42}
          fractionDigits={1}
          minimumIntegerDigits={4}
          fontSize={44}
          fontFamily="Menlo"
          color="#30D158"
          duration={400}
          easing="easeOut"
          testID="imperative"
        />
      </View>
      <View style={styles.row}>
        <Button title="animateTo(7)" onPress={() => ref.current?.animateTo(7)} />
        <Button title="animateTo(9999)" onPress={() => ref.current?.animateTo(9999)} />
        <Button title="jumpTo(1234.5)" onPress={() => ref.current?.jumpTo(1234.5)} />
        <Button title="jumpTo(999.75)" onPress={() => ref.current?.jumpTo(999.75)} />
        <Button title="jumpTo(−3.5)" onPress={() => ref.current?.jumpTo(-3.5)} />
      </View>
      <Text style={styles.sectionHint}>Scroll the strip to scrub with jumpTo:</Text>
      <ScrollView
        horizontal
        onScroll={(e) => ref.current?.jumpTo(e.nativeEvent.contentOffset.x / 4)}
        scrollEventThrottle={16}
        style={styles.scrubber}
        contentContainerStyle={styles.scrubberContent}
        showsHorizontalScrollIndicator={false}
        testID="scrubber"
      >
        {Array.from({ length: 40 }, (_, i) => (
          <View key={i} style={styles.tick}>
            <Text style={styles.tickLabel}>{i * 100}</Text>
          </View>
        ))}
      </ScrollView>
    </Section>
  )
}

/** The win tiers of the demo rollup: the count lands on each, punches, holds, then runs on. */
const REVEAL_MILESTONES = [1000, 10000, 25000]

function RevealDemo() {
  const [amount, setAmount] = useState(50000)
  const [spin, setSpin] = useState(false)
  const [landed, setLanded] = useState(false)
  const [style, setStyle] = useState<'count' | 'spin'>('count')
  const [tiers, setTiers] = useState(true)
  const ref = useRef<RollingNumberHandle>(null)
  const status = landed ? 'Credit unlocked' : spin ? (style === 'spin' ? 'Spinning…' : 'Counting…') : 'Ready when you are'
  const rearm = () => setLanded(false)
  return (
    <Section
      title="Jackpot reveal"
      hint="`reveal={false}` holds the opening frame; flip it and the figure plays the casino win-meter rollup (count) or the jackpot reels (spin), then lands with a pop. With tiers, the count runs tier by tier: it lands on each milestone, punches, holds, then accelerates again. Tap the number to skip."
    >
      <View style={styles.row}>
        <Button title="Count" selected={style === 'count'} testID="reveal-style-count" onPress={() => { setSpin(false); rearm(); setStyle('count') }} />
        <Button title="Spin" selected={style === 'spin'} testID="reveal-style-spin" onPress={() => { setSpin(false); rearm(); setStyle('spin') }} />
        <Button title={tiers ? 'Tiers: 1k / 10k / 25k' : 'Tiers: off'} testID="reveal-tiers" onPress={() => { setSpin(false); rearm(); setTiers((t) => !t) }} />
      </View>
      <Pressable style={styles.revealCard} onPress={() => spin && !landed && ref.current?.jumpTo(amount)}>
        <Text style={styles.revealTitle}>Congrats!</Text>
        <RollingNumber
          ref={ref}
          value={amount}
          reveal={spin}
          revealStyle={style}
          revealMilestones={tiers ? REVEAL_MILESTONES : undefined}
          revealMilestoneHold={400}
          revealDuration={tiers && style === 'count' ? 4800 : 2200}
          onRevealEnd={() => setLanded(true)}
          prefix="$"
          fractionDigits={2}
          groupingSeparator=","
          fontSize={52}
          fontWeight="800"
          color="#fff"
          textAlign="center"
          style={styles.revealNumber}
          testID="reveal"
        />
        <Text style={styles.revealSubtitle} testID="reveal-status">{status}</Text>
      </Pressable>
      <View style={styles.row}>
        <Button
          title={spin ? 'Reset' : 'Reveal'}
          testID="reveal-toggle"
          onPress={() => {
            rearm()
            setSpin((s) => !s)
          }}
        />
        <Button
          title="Random amount"
          onPress={() => {
            rearm()
            setSpin(false)
            setAmount(Math.round(Math.random() * 9_999_999) / 100)
          }}
        />
        <Button
          title="revealTo(1,234.56)"
          onPress={() => {
            rearm()
            ref.current?.revealTo(1234.56)
          }}
        />
      </View>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Showcase: button-free, auto-playing screens for the docs recordings. Tap the
// invisible top-right corner to leave.
// ---------------------------------------------------------------------------

type Showcase = 'balance' | 'reveal' | 'morph' | null

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places

/** The market list of the balance showcase: fixed holdings, prices that tick like a live feed. */
const COINS = [
  { name: 'Bitcoin', ticker: 'BTC', tint: '#F7931A', price: 64_210.9, holding: 0.4821 },
  { name: 'Ethereum', ticker: 'ETH', tint: '#627EEA', price: 3_412.75, holding: 3.2041 },
  { name: 'Solana', ticker: 'SOL', tint: '#9945FF', price: 148.32, holding: 41.5 },
  { name: 'XRP', ticker: 'XRP', tint: '#00AAE4', price: 0.6123, holding: 5_200 },
  { name: 'Cardano', ticker: 'ADA', tint: '#0033AD', price: 0.4521, holding: 8_400 },
  { name: 'Avalanche', ticker: 'AVAX', tint: '#E84142', price: 36.8, holding: 72 },
  { name: 'Dogecoin', ticker: 'DOGE', tint: '#C2A633', price: 0.1587, holding: 21_000 },
  { name: 'Polkadot', ticker: 'DOT', tint: '#E6007A', price: 7.12, holding: 310 },
  { name: 'Chainlink', ticker: 'LINK', tint: '#2A5ADA', price: 14.55, holding: 180 },
  { name: 'Polygon', ticker: 'MATIC', tint: '#8247E5', price: 0.7241, holding: 3_900 },
  { name: 'Litecoin', ticker: 'LTC', tint: '#345D9D', price: 84.1, holding: 24 },
  { name: 'Uniswap', ticker: 'UNI', tint: '#FF007A', price: 9.87, holding: 260 },
  { name: 'Cosmos', ticker: 'ATOM', tint: '#5C6CFF', price: 8.34, holding: 300 },
  { name: 'NEAR', ticker: 'NEAR', tint: '#00C08B', price: 5.42, holding: 450 },
]
type Coin = (typeof COINS)[number]
type Quote = { price: number; change: number }

const CoinRow = React.memo(function CoinRow({ coin, quote }: { coin: Coin; quote: Quote }) {
  const up = quote.change >= 0
  return (
    <View style={showcase.card}>
      <View style={[showcase.coin, { backgroundColor: coin.tint }]}>
        <Text style={showcase.coinText}>{coin.ticker[0]}</Text>
      </View>
      <View>
        <Text style={showcase.cardName}>{coin.name}</Text>
        <Text style={showcase.cardSub}>{coin.ticker}</Text>
      </View>
      <View style={showcase.cardRight}>
        <RollingNumber
          value={quote.price}
          prefix="$"
          fractionDigits={quote.price < 1 ? 4 : 2}
          groupingSeparator=","
          fontSize={17}
          fontWeight="700"
          color="#fff"
          textAlign="right"
          duration={450}
          easing="easeOut"
          style={showcase.cardAmount}
        />
        <RollingNumber
          value={Math.abs(quote.change)}
          prefix={up ? '+' : '−'}
          suffix="%"
          fractionDigits={2}
          fontSize={13}
          fontWeight="600"
          color={up ? '#34D399' : '#F87171'}
          textAlign="right"
          duration={450}
          easing="easeOut"
          style={showcase.cardAmount}
        />
      </View>
    </View>
  )
})

function BalanceShowcase({ onExit }: { onExit: () => void }) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>(() =>
    Object.fromEntries(COINS.map((c, i) => [c.ticker, { price: c.price, change: round(((i * 7) % 11) - 4.3, 2) }]))
  )
  const opening = useRef(COINS.reduce((sum, c) => sum + c.price * c.holding, 0)).current
  useEffect(() => {
    // A live feed: a few coins tick every 200 ms, so at any moment about a
    // third of the list, plus the balance derived from it, is rolling.
    const feed = setInterval(() => {
      setQuotes((previous) => {
        const next = { ...previous }
        for (let n = 0; n < 5; n++) {
          const coin = COINS[Math.floor(Math.random() * COINS.length)]
          const q = previous[coin.ticker]
          const drift = (Math.random() - 0.5) * 0.006
          next[coin.ticker] = {
            price: round(q.price * (1 + drift), q.price < 1 ? 4 : 2),
            change: round(q.change + drift * 60, 2),
          }
        }
        return next
      })
    }, 200)
    return () => clearInterval(feed)
  }, [])
  const balance = round(COINS.reduce((sum, c) => sum + quotes[c.ticker].price * c.holding, 0), 2)
  const today = round(balance - opening, 2)
  const up = today >= 0
  return (
    <View style={[showcase.root, showcase.rootTop]}>
      <StatusBar hidden />
      <View style={showcase.glowA} />
      <View style={showcase.glowB} />
      <Pressable style={showcase.exit} onPress={onExit} testID="showcase-exit" />
      <Text style={showcase.eyebrow}>Total balance</Text>
      <RollingNumber
        value={balance}
        prefix="$"
        prefixFontSize={30}
        affixAlign="top"
        fractionDigits={2}
        groupingSeparator=","
        fontSize={58}
        fontWeight="800"
        color="#fff"
        easing="spring"
        bounce={0.12}
        stagger={25}
        duration={700}
        textAlign="center"
        style={showcase.hero}
      />
      <View style={showcase.pill}>
        <RollingNumber
          value={Math.abs(today)}
          prefix={up ? '+$' : '−$'}
          fractionDigits={2}
          groupingSeparator=","
          fontSize={16}
          fontWeight="700"
          color={up ? '#34D399' : '#F87171'}
          duration={600}
          easing="easeOut"
        />
        <Text style={showcase.pillText}>today</Text>
      </View>
      <Text style={[showcase.eyebrow, showcase.listLabel]}>Markets</Text>
      <FlatList
        data={COINS}
        keyExtractor={(c) => c.ticker}
        renderItem={({ item }) => <CoinRow coin={item} quote={quotes[item.ticker]} />}
        style={showcase.list}
        contentContainerStyle={showcase.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={COINS.length}
      />
    </View>
  )
}

function RevealShowcase({ onExit }: { onExit: () => void }) {
  const [style, setStyle] = useState<'count' | 'spin'>('count')
  const [amount, setAmount] = useState(50_000)
  const [reveal, setReveal] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms))
  }
  useEffect(() => {
    later(900, () => setReveal(true))
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])
  // Count with tiers → hold → reels → hold → again.
  const onRevealEnd = () => {
    later(1800, () => {
      setReveal(false)
      later(700, () => {
        setStyle((s) => (s === 'count' ? 'spin' : 'count'))
        setAmount((a) => (a === 50_000 ? 25_750 : 50_000))
        later(400, () => setReveal(true))
      })
    })
  }
  return (
    <View style={[showcase.root, showcase.rootBrand]}>
      <StatusBar hidden />
      <View style={[showcase.glowA, showcase.glowBrand]} />
      <Pressable style={showcase.exit} onPress={onExit} testID="showcase-exit" />
      <View style={showcase.badge}>
        <Text style={showcase.badgeText}>🎉</Text>
      </View>
      <Text style={showcase.revealTitle}>Congratulations!</Text>
      <Text style={showcase.revealSub}>You've unlocked</Text>
      <RollingNumber
        value={amount}
        reveal={reveal}
        revealStyle={style}
        revealMilestones={[1000, 10000, 25000]}
        revealMilestoneHold={400}
        revealDuration={style === 'count' ? 4800 : 2400}
        onRevealEnd={onRevealEnd}
        prefix="$"
        fractionDigits={2}
        groupingSeparator=","
        fontSize={62}
        fontWeight="800"
        color="#fff"
        textAlign="center"
        style={showcase.hero}
      />
      <Text style={showcase.revealSub}>in credit</Text>
      <View style={showcase.cta}>
        <Text style={showcase.ctaText}>Claim credit</Text>
      </View>
    </View>
  )
}

/** The morph input, typed for you: digits arrive, commas reflow, the figure is swapped. */
function MorphShowcase({ onExit }: { onExit: () => void }) {
  const field = useRef<MorphInputHandle>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [caption, setCaption] = useState('Type an amount')

  useEffect(() => {
    const at = (ms: number, fn: () => void) => {
      timers.current.push(setTimeout(fn, ms))
    }
    const run = () => {
      let t = 0
      const type = (text: string, step = 230) => {
        at(t, () => field.current?.setText(text))
        t += step
      }
      // Digits arrive from above; every comma that has to move a group drops
      // out and a new one rises, rather than sliding through the digits.
      at(0, () => setCaption('Type an amount'))
      for (const text of ['1', '12', '123', '1234', '12345', '123456', '1234567']) type(text)
      t += 900
      // ...and back down again.
      at(t, () => setCaption('Backspace'))
      for (const text of ['123456', '12345', '1234']) type(text)
      t += 900
      // A value set from code: the columns reshape.
      at(t, () => { setCaption('Set from code'); field.current?.setValue(9876543) })
      t += 1600
      // Nothing survives a swap this size, so the whole run recedes as one shape.
      at(t, () => { setCaption('Replaced'); field.current?.setValue(42) })
      t += 1600
      at(t, () => { setCaption('Cleared'); field.current?.clear() })
      t += 1500
      at(t, run)
    }
    run()
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return (
    <View style={[showcase.root, showcase.rootMorph]}>
      <StatusBar hidden />
      <View style={[showcase.glowA, showcase.glowMorphA]} />
      <View style={[showcase.glowB, showcase.glowMorphB]} />
      <Pressable style={showcase.exit} onPress={onExit} testID="showcase-exit" />
      <Text style={showcase.eyebrow}>Send money</Text>
      <MorphInput
        ref={field}
        mode="number"
        prefix="$"
        prefixFontSize={30}
        affixAlign="top"
        placeholder="0"
        fontSize={62}
        fontWeight="800"
        color="#fff"
        placeholderTextColor="rgba(255,255,255,0.35)"
        textAlign="center"
        editable={false}
        adjustsFontSizeToFit
        minimumFontScale={0.4}
        style={showcase.morphField}
      />
      <View style={showcase.pill}>
        <Text style={showcase.pillText}>{caption}</Text>
      </View>
      <View style={[showcase.cta, showcase.ctaMorph]}>
        <Text style={showcase.ctaTextMorph}>Continue</Text>
      </View>
    </View>
  )
}

const showcase = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F19', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, overflow: 'hidden' },
  rootBrand: { backgroundColor: '#1D4ED8' },
  rootMorph: { backgroundColor: '#140A24' },
  glowMorphA: { backgroundColor: '#7C3AED', opacity: 0.38 },
  glowMorphB: { backgroundColor: '#DB2777', opacity: 0.24 },
  morphField: { width: '100%', marginTop: 6 },
  ctaMorph: { backgroundColor: 'rgba(255,255,255,0.14)' },
  ctaTextMorph: { color: '#fff', fontWeight: '700', fontSize: 16 },
  rootTop: { justifyContent: 'flex-start', paddingTop: 84, paddingHorizontal: 0 },
  listLabel: { marginTop: 28, marginBottom: 8, alignSelf: 'flex-start', marginLeft: 28 },
  list: { alignSelf: 'stretch' },
  listContent: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
  glowA: { position: 'absolute', width: 460, height: 460, borderRadius: 230, backgroundColor: '#2563EB', opacity: 0.3, top: -160, left: -140 },
  glowB: { position: 'absolute', width: 380, height: 380, borderRadius: 190, backgroundColor: '#0EA5E9', opacity: 0.18, bottom: -140, right: -120 },
  glowBrand: { backgroundColor: '#60A5FA', opacity: 0.35 },
  exit: { position: 'absolute', top: 0, right: 0, width: 72, height: 72 },
  eyebrow: { color: 'rgba(255,255,255,0.65)', fontSize: 13, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: '600', marginBottom: 10 },
  hero: { width: '100%' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 14 },
  pillText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 18, padding: 16, gap: 14 },
  coin: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  coinText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  cardName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cardSub: { color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 2 },
  cardRight: { marginLeft: 'auto', alignItems: 'flex-end', gap: 2 },
  cardAmount: { width: 150 },
  badge: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  badgeText: { fontSize: 36 },
  revealTitle: { color: '#fff', fontSize: 28, fontWeight: '800' },
  revealSub: { color: 'rgba(255,255,255,0.8)', fontSize: 16, marginVertical: 10 },
  cta: { position: 'absolute', bottom: 132, left: 24, right: 24, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#1D4ED8', fontWeight: '700', fontSize: 16 },
})

export function DemoScreen() {
  const dark = useColorScheme() === 'dark'
  const [showing, setShowing] = useState<Showcase>(null)
  if (showing === 'balance') return <BalanceShowcase onExit={() => setShowing(null)} />
  if (showing === 'reveal') return <RevealShowcase onExit={() => setShowing(null)} />
  if (showing === 'morph') return <MorphShowcase onExit={() => setShowing(null)} />
  return (
      <SafeAreaView style={[styles.root, dark && styles.rootDark]} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.title, dark && styles.titleDark]}>Nitro Rolling Number</Text>
          <View style={styles.row}>
            <Button title="Showcase: Balance" testID="showcase-balance" onPress={() => setShowing('balance')} />
            <Button title="Showcase: Reveal" testID="showcase-reveal" onPress={() => setShowing('reveal')} />
            <Button title="Showcase: Morph" testID="showcase-morph" onPress={() => setShowing('morph')} />
          </View>
          <MorphInputDemo />
          <MorphWorkletDemo />
          <RevealDemo />
          <ReactDrivenDemo />
          <CurrencyDemo />
          <CenteredDemo />
          <ImperativeDemo />
        </ScrollView>
      </SafeAreaView>
  )
}

/**
 * The claim is that a worklet handler runs on the UI thread. A green ring on
 * focus does not show that - a JS handler would look the same. Blocking the JS
 * thread does: while it is wedged, the worklet field still rings and the JS
 * one cannot, because the render that would colour it never runs.
 *
 * Both fields are otherwise identical. The only difference is which thread
 * their `onFocus` lands on.
 */
function WorkletVsJsThread() {
  const field = useNitroInputState(useSharedValue)
  const workletRing = useAnimatedStyle(() => ({
    borderColor: field.focused.value ? '#16a34a' : 'transparent',
  }))
  const [jsFocused, setJsFocused] = useState(false)

  // A busy loop, not a sleep: the JS thread has to be unable to run a render,
  // which an await would not prevent.
  const freeze = useCallback(() => {
    const until = Date.now() + 4000
    // eslint-disable-next-line no-empty
    while (Date.now() < until) {}
  }, [])

  return (
    <View style={styles.threadProbe}>
      <Button testID="worklet-freeze-js" title="Freeze JS 4s" onPress={freeze} />
      <Animated.View testID="worklet-ring" style={[styles.workletRing, workletRing]}>
        <NitroInput
          testID="morph-worklet"
          variant="outlined"
          label="Worklet onFocus"
          placeholder="rings while JS is frozen"
          // No keyboard: it would cover the rings this probe exists to show.
          showSoftInputOnFocus={false}
          fontSize={15}
          strokeColor="#94a3b8"
          // Deliberately the same focused and unfocused: the field's own frame
          // must not change colour, or there is no telling the native stroke
          // from the ring the shared value drives.
          focusedStrokeColor="#94a3b8"
          cornerRadius={10}
          {...field.handlers}
        />
      </Animated.View>
      <View
        testID="js-ring"
        style={[styles.workletRing, { borderColor: jsFocused ? '#dc2626' : 'transparent' }]}>
        <NitroInput
          testID="morph-jsthread"
          variant="outlined"
          label="JS onFocus"
          placeholder="cannot ring while JS is frozen"
          showSoftInputOnFocus={false}
          fontSize={15}
          strokeColor="#94a3b8"
          focusedStrokeColor="#94a3b8"
          cornerRadius={10}
          onFocus={() => setJsFocused(true)}
          onBlur={() => setJsFocused(false)}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  outlineFields: { marginTop: 8, paddingVertical: 8, gap: 18 },
  outlineField: { width: '100%', height: 52 },
  workletRing: { width: '100%', borderWidth: 2, borderRadius: 14, borderColor: 'transparent', padding: 4 },
  threadProbe: { width: '100%', gap: 10 },

  root: { flex: 1, backgroundColor: '#F2F2F7' },
  rootDark: { backgroundColor: '#000' },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#111' },
  titleDark: { color: '#fff' },
  section: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  sectionHint: { fontSize: 13, color: '#666' },
  display: {
    minHeight: 72,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  fitBox: {
    width: 180,
    height: 64,
    borderWidth: 1,
    borderColor: '#C7C7CC',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fitNumber: { width: 164 },
  fitCard: { maxWidth: '100%' },
  centerBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C7C7CC',
    borderRadius: 10,
    paddingVertical: 10,
  },
  centerNumber: { width: '100%' },
  revealCard: {
    backgroundColor: '#1D4ED8',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 6,
  },
  revealTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  revealNumber: { width: '100%' },
  revealSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  morphAmountBox: { paddingVertical: 12, alignItems: 'center' },
  morphAmount: { width: '100%' },
  morphTextBox: { backgroundColor: '#F2F2F7', borderRadius: 10, paddingHorizontal: 12, height: 44, justifyContent: 'center' },
  morphText: { width: '100%' },
  morphBarTrack: { height: 8, borderRadius: 4, backgroundColor: '#E5E5EA', overflow: 'hidden' },
  morphBar: { height: 8, backgroundColor: '#0A84FF', borderRadius: 4 },
  morphReadout: { fontSize: 12, color: '#666', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    backgroundColor: '#E5E5EA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  buttonSelected: { backgroundColor: '#0A84FF' },
  buttonPressed: { opacity: 0.6 },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#111' },
  buttonTextSelected: { color: '#fff' },
  scrubber: { height: 44, backgroundColor: '#F2F2F7', borderRadius: 10 },
  scrubberContent: { alignItems: 'center' },
  tick: { width: 400, height: 44, justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: '#C7C7CC', paddingLeft: 6 },
  tickLabel: { fontSize: 12, color: '#8E8E93' },
})

