import React from 'react'
import { Text, type TextStyle } from 'react-native'
import { RollingNumber, type RollingNumberHandle } from 'react-native-nitro-rolling-number'
import { NumberFlow } from 'number-flow-react-native'
import { SkiaNumberFlow } from 'number-flow-react-native/skia'
import { Canvas, type SkFont } from '@shopify/react-native-skia'
import AnimatedNumbers from 'react-native-animated-numbers'
import { AnimatedRollingNumber } from 'react-native-animated-rolling-numbers'
import { AnimatedNumber } from 'react-native-number-animation'
import { NumberBloom } from 'react-native-number-bloom'
import Ticker from 'react-native-ticker'
import AnimateableText from 'react-native-animateable-text'
import { Easing, useAnimatedProps, type SharedValue } from 'react-native-reanimated'

export type ImplKey =
  | 'text'
  | 'atext'
  | 'nitro-prop'
  | 'nitro-jump'
  | 'rnna'
  | 'arn'
  | 'nf-view'
  | 'nf-skia'
  | 'nf-skia-sv'
  | 'bloom'
  | 'ticker'
  | 'anim-numbers'

export type Impl = { key: ImplKey; label: string; short: string; package: string; how: string }

/** Every implementation the harness can drive, in the order the tables list them. */
export const IMPLS: Impl[] = [
  {
    key: 'text',
    label: 'Text (no animation)',
    short: 'Text',
    package: 'react-native',
    how: 'A plain <Text> re-rendered with the formatted value: the floor, what the harness itself costs.',
  },
  {
    key: 'atext',
    label: 'AnimateableText (shared value)',
    short: 'AnimateableText',
    package: 'react-native-animateable-text',
    how: 'A Text whose string is a Reanimated shared value: the JS side writes the value, nothing re-renders.',
  },
  {
    key: 'nitro-prop',
    label: 'Nitro value prop',
    short: 'Nitro prop',
    package: 'react-native-nitro-rolling-number',
    how: 'RollingNumber driven by its value prop: a React render per update, then one JSI call.',
  },
  {
    key: 'nitro-jump',
    label: 'Nitro jumpTo',
    short: 'Nitro jumpTo',
    package: 'react-native-nitro-rolling-number',
    how: 'ref.jumpTo(value): one JSI call per update, no React render.',
  },
  {
    key: 'rnna',
    label: 'number-animation (native)',
    short: 'number-animation',
    package: 'react-native-number-animation',
    how: 'A Fabric view with Core Animation / Canvas wheels; React formats the value and sends the string.',
  },
  {
    key: 'arn',
    label: 'animated-rolling-numbers',
    short: 'animated-rolling-numbers',
    package: 'react-native-animated-rolling-numbers',
    how: 'Reanimated: an Animated.View per digit, translated with withTiming.',
  },
  {
    key: 'nf-view',
    label: 'NumberFlow View',
    short: 'NumberFlow View',
    package: 'number-flow-react-native',
    how: 'The View renderer: Reanimated-driven digit views.',
  },
  {
    key: 'nf-skia',
    label: 'NumberFlow Skia',
    short: 'NumberFlow Skia',
    package: 'number-flow-react-native/skia',
    how: 'The Skia renderer fed by the value prop.',
  },
  {
    key: 'nf-skia-sv',
    label: 'NumberFlow Skia sharedValue',
    short: 'NumberFlow Skia SV',
    package: 'number-flow-react-native/skia',
    how: 'The Skia renderer fed a shared value, no React render.',
  },
  {
    key: 'bloom',
    label: 'NumberBloom (Skia)',
    short: 'NumberBloom',
    package: 'react-native-number-bloom',
    how: 'A Skia canvas driven by Reanimated worklets; digits snap and bloom rather than roll.',
  },
  {
    key: 'ticker',
    label: 'react-native-ticker',
    short: 'Ticker',
    package: 'react-native-ticker',
    how: 'Reanimated: a column of ten Texts per digit, translated with withTiming.',
  },
  {
    key: 'anim-numbers',
    label: 'AnimatedNumbers',
    short: 'AnimatedNumbers',
    package: 'react-native-animated-numbers',
    how: 'The Animated API with the native driver; integer-only, so it is fed cents.',
  },
]

export const BENCH_START = 4321.09
export const BENCH_FORMAT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
}
/** Every library that takes a duration gets the same one. */
export const DURATION = 500

/** ~7 changing digits every frame: cents tick each frame, thousands drift. */
export function benchValue(seconds: number) {
  return 5000 + Math.sin(seconds * 0.7) * 4999 + seconds * 137.9
}

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] }

function SharedText({ sv, style }: { sv: SharedValue<string>; style: TextStyle }) {
  const animatedProps = useAnimatedProps(() => ({ text: sv.value }))
  return <AnimateableText animatedProps={animatedProps} style={style} />
}

export function BenchItem({
  impl,
  value,
  fontSize,
  fmt,
  sv,
  font,
  nitroRef,
}: {
  impl: ImplKey
  value: number
  fontSize: number
  fmt: Intl.NumberFormat
  sv: SharedValue<string>
  font: SkFont | null
  nitroRef: (h: RollingNumberHandle | null) => void
}) {
  const textStyle: TextStyle = { fontSize, fontWeight: '700', color: '#111' }
  const canvasStyle = { width: '100%' as const, height: fontSize * 1.45 }
  switch (impl) {
    case 'text':
      return (
        <Text style={[textStyle, TABULAR]} testID="bench-text">
          {fmt.format(value)}
        </Text>
      )
    case 'atext':
      return <SharedText sv={sv} style={{ ...textStyle, ...TABULAR }} />
    case 'nitro-prop':
      return (
        <RollingNumber
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          fontSize={fontSize}
          fontWeight="700"
          color="#111"
          duration={DURATION}
          direction="up"
          testID="bench-nitro"
        />
      )
    case 'nitro-jump':
      return (
        <RollingNumber
          ref={nitroRef}
          value={BENCH_START}
          fractionDigits={2}
          groupingSeparator=","
          fontSize={fontSize}
          fontWeight="700"
          color="#111"
          testID="bench-nitro"
        />
      )
    case 'rnna':
      return (
        <AnimatedNumber
          value={value}
          locales="en-US"
          format={BENCH_FORMAT}
          style={textStyle}
          animation={{ digit: { duration: DURATION } }}
        />
      )
    case 'arn':
      return (
        <AnimatedRollingNumber
          value={value}
          useGrouping
          toFixed={2}
          textStyle={textStyle}
          spinningAnimationConfig={{ duration: DURATION }}
        />
      )
    case 'nf-view':
      return <NumberFlow value={value} format={BENCH_FORMAT} style={textStyle} />
    case 'nf-skia':
      return (
        <Canvas style={canvasStyle}>
          <SkiaNumberFlow value={value} format={BENCH_FORMAT} font={font} color="#111" y={fontSize} tabularNums />
        </Canvas>
      )
    case 'nf-skia-sv':
      return (
        <Canvas style={canvasStyle}>
          <SkiaNumberFlow sharedValue={sv} font={font} color="#111" y={fontSize} tabularNums />
        </Canvas>
      )
    case 'bloom':
      return (
        <NumberBloom
          value={value}
          format={BENCH_FORMAT}
          fontSize={fontSize}
          color="#111"
          maxIntegerDigits={5}
          valueTiming={{ duration: DURATION, easing: Easing.out(Easing.cubic) }}
        />
      )
    case 'ticker':
      return (
        <Ticker textStyle={textStyle} duration={DURATION}>
          {fmt.format(value)}
        </Ticker>
      )
    case 'anim-numbers':
      return (
        <AnimatedNumbers
          animateToNumber={Math.round(value * 100)}
          includeComma
          animationDuration={DURATION}
          fontStyle={textStyle}
        />
      )
  }
}

/** A library that throws while rendering fails its own scenario, not the whole plan. */
export class ImplBoundary extends React.Component<
  { onError: (error: Error) => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    this.props.onError(error)
  }

  render() {
    return this.state.failed ? <Text style={{ color: '#c00' }}>render failed</Text> : this.props.children
  }
}
