import React, { useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import {
  RollingNumber,
  type RollingNumberHandle,
} from 'react-native-nitro-rolling-number'

function Button({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      testID={`button-${title}`}
    >
      <Text style={styles.buttonText}>{title}</Text>
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

function ReactDrivenDemo() {
  const [value, setValue] = useState(1234.5)
  const [mounted, setMounted] = useState(true)
  return (
    <Section title="React prop" hint="Change `value`, the digits roll natively. Fits the card: full size until it would overflow, then it shrinks.">
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
          easing="spring"
          bounce={0.2}
          duration={700}
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

function App() {
  const dark = useColorScheme() === 'dark'
  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, dark && styles.rootDark]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.title, dark && styles.titleDark]}>Nitro Rolling Number</Text>
          <ReactDrivenDemo />
          <CurrencyDemo />
          <CenteredDemo />
          <ImperativeDemo />
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    backgroundColor: '#E5E5EA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  buttonPressed: { opacity: 0.6 },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#111' },
  scrubber: { height: 44, backgroundColor: '#F2F2F7', borderRadius: 10 },
  scrubberContent: { alignItems: 'center' },
  tick: { width: 400, height: 44, justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: '#C7C7CC', paddingLeft: 6 },
  tickLabel: { fontSize: 12, color: '#8E8E93' },
})

export default App
