import React from 'react'
import { ScrollView, Text } from 'react-native'
import { NavigationContainer, useNavigation, useNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { launchPlan } from 'bench-probe'
import { Btn, Card, Row, styles } from './harness'
import { InputBenchScreen } from './bench/InputBenchScreen'
import { MarketCompareScreen, type MarketCompareParams } from './bench/MarketCompareScreen'
import { RollingBenchScreen, type RollingBenchParams } from './bench/RollingBenchScreen'
import { TextMountScreen } from './bench/TextMountScreen'
import { parsePlan } from './bench/plan'

export type RootStackParamList = {
  Home: undefined
  RollingBench: RollingBenchParams
  InputBench: undefined
  MarketCompare: MarketCompareParams
  TextMount: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

function HomeScreen() {
  const nav = useNavigation<any>()
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card title="Rolling number" hint="This library against every other animated-number library on npm that builds here: frame pacing on both threads and per-thread CPU, on this device.">
        <Row><Btn testID="home-rolling-bench" tone="primary" title="Benchmark vs other libraries" onPress={() => nav.navigate('RollingBench')} /></Row>
        <Row><Btn testID="compare-nitro-roll" title="Market: NitroNumber roll" onPress={() => nav.navigate('MarketCompare', { lib: 'nitro-roll' })} /></Row>
        <Row><Btn testID="compare-nitro-numeric" title="Market: NitroNumber numeric" onPress={() => nav.navigate('MarketCompare', { lib: 'nitro-numeric' })} /></Row>
        <Row><Btn testID="compare-rnna" title="Market: number-animation" onPress={() => nav.navigate('MarketCompare', { lib: 'rnna' })} /></Row>
      </Card>
      <Card title="Text input" hint="Mount and focus cost of NitroInput against TextInput and Expo UI's TextField.">
        <Row><Btn testID="home-bench" tone="primary" title="Mount / focus benchmark" onPress={() => nav.navigate('InputBench')} /></Row>
        <Row><Btn testID="home-text-mount" tone="primary" title="Text mount: Text / PlainText / NitroText" onPress={() => nav.navigate('TextMount')} /></Row>
      </Card>
      <Text style={styles.cardHint}>scripts/bench/run.mjs launches this app with a plan and drives it; see BENCHMARKS.md.</Text>
    </ScrollView>
  )
}

/**
 * Launched with a benchmark plan (scripts/bench/run.mjs passes one through the
 * probe), the app goes straight to the benchmark screen and runs it; launched
 * with `{"compare": lib}`, to that market comparison. Android
 * reports the activity's intent a beat after the bundle loads, hence the retries.
 */
function useLaunchPlan(navRef: ReturnType<typeof useNavigationContainerRef<RootStackParamList>>) {
  return React.useCallback(() => {
    let tries = 0
    const check = () => {
      const json = launchPlan()
      // `{"compare":"nitro-roll"}` opens a market comparison, for profiling it.
      const compare = json ? (JSON.parse(json) as { compare?: MarketCompareParams['lib'] }).compare : undefined
      if (compare) {
        navRef.navigate('MarketCompare', { lib: compare })
        return
      }
      const plan = parsePlan(json)
      if (plan) {
        navRef.navigate('RollingBench', { plan })
        return
      }
      if (++tries < 6) setTimeout(check, 500)
    }
    check()
  }, [navRef])
}

export function RootNavigator() {
  const navRef = useNavigationContainerRef<RootStackParamList>()
  const onReady = useLaunchPlan(navRef)
  return (
    <NavigationContainer ref={navRef} onReady={onReady}>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Benchmarks' }} />
        <Stack.Screen name="RollingBench" component={RollingBenchScreen} options={{ title: 'Rolling number benchmark' }} />
        <Stack.Screen name="InputBench" component={InputBenchScreen} options={{ title: 'Input benchmark' }} />
        <Stack.Screen name="MarketCompare" component={MarketCompareScreen} options={{ title: 'Market comparison' }} />
        <Stack.Screen name="TextMount" component={TextMountScreen} options={{ title: 'Text mount' }} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
