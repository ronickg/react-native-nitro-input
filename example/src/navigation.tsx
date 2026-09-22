import React from 'react'
import { DevSettings, I18nManager, ScrollView, Text } from 'react-native'
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useNavigation } from '@react-navigation/native'
import { Btn, Card, Row, styles } from './harness'
import { DemoScreen } from './screens/DemoScreen'
import { ParityScreen } from './screens/ParityScreen'
import { FormSheetScreen, NavAScreen, NavBScreen } from './screens/NavigationScreens'
import { StateChangeScreen } from './screens/StateChangeScreen'
import { KeyboardControllerScreen } from './screens/KeyboardControllerScreen'
import { BenchScreen } from './screens/BenchScreen'
import { ViewPropsReproScreen } from './screens/ViewPropsRepro'
import { RtlScreen } from './screens/RtlScreen'
import { RollingBenchScreen, type RollingBenchParams } from './bench/RollingBenchScreen'
import { parsePlan } from './bench/plan'
import { launchPlan } from './bench/probe'
import {
  FlowAmountScreen,
  FlowEmailScreen,
  FlowFormScreen,
  FlowSheetScreen,
  type Impl,
} from './screens/KeyboardFlow'

export type RootStackParamList = {
  Home: undefined
  Demo: undefined
  Parity: undefined
  NavA: undefined
  NavB: { kind: 'morph' | 'rn' }
  Sheet: { kind: 'morph' | 'rn'; autoFocus?: boolean }
  StateChange: undefined
  KeyboardController: undefined
  Bench: undefined
  RollingBench: RollingBenchParams
  FlowEmail: { impl: Impl }
  FlowAmount: { impl: Impl }
  FlowForm: { impl: Impl }
  FlowSheet: { impl: Impl }
  ViewPropsRepro: undefined
  Rtl: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

/**
 * The four onboarding steps share their chrome: no title (the progress rail on
 * the screen says which step you are on), a hairline-free header that blends
 * into the page, and a back chevron with no label to compete with the headline.
 */
const FLOW_STEP = {
  title: '',
  headerBackButtonDisplayMode: 'minimal' as const,
  headerShadowVisible: false,
  headerStyle: { backgroundColor: '#F7F8FA' },
  headerTintColor: '#39414E',
}

function HomeScreen() {
  const nav = useNavigation<any>()
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card title="MorphInput vs TextInput" hint="Each screen puts the two components side by side under the same conditions.">
        <Row>
          <Btn testID="home-parity" tone="primary" title="Parity / all callbacks" onPress={() => nav.navigate('Parity')} />
          <Btn testID="home-nav" tone="primary" title="Two-screen routing" onPress={() => nav.navigate('NavA')} />
          <Btn testID="home-state" tone="primary" title="In-screen state change" onPress={() => nav.navigate('StateChange')} />
          <Btn testID="home-kc" tone="primary" title="keyboard-controller" onPress={() => nav.navigate('KeyboardController')} />
          <Btn testID="home-bench" tone="primary" title="Mount / focus benchmark" onPress={() => nav.navigate('Bench')} />
        </Row>
      </Card>
      <Card
        title="Keyboard flow"
        hint="Four screens end to end — email, amount, a six-field form, then a search sheet. A run is built entirely from one component, so the keyboard behaviour you feel is that component's."
      >
        <Row>
          <Btn testID="home-repro" title="Nitro view props (Android)" onPress={() => nav.navigate('ViewPropsRepro')} />
          <Btn testID="home-flow-ours" tone="primary" title="Run flow (NitroInput)" onPress={() => nav.navigate('FlowEmail', { impl: 'ours' })} />
          <Btn testID="home-flow-rn" tone="primary" title="Run flow (RN TextInput)" onPress={() => nav.navigate('FlowEmail', { impl: 'rn' })} />
        </Row>
      </Card>
      <Card
        title="Layout direction"
        hint={`The app is ${I18nManager.isRTL ? 'right-to-left' : 'left-to-right'}. Flipping it reloads the bundle; on iOS the new direction may need the app relaunched.`}
      >
        <Row>
          <Btn testID="home-rtl" tone="primary" title="Alignment, affixes, frame" onPress={() => nav.navigate('Rtl')} />
          <Btn
            testID="home-rtl-toggle"
            title={I18nManager.isRTL ? 'Switch to left-to-right' : 'Switch to right-to-left'}
            onPress={() => {
              I18nManager.allowRTL(true)
              I18nManager.forceRTL(!I18nManager.isRTL)
              DevSettings.reload()
            }}
          />
        </Row>
      </Card>
      <Card title="Form sheets" hint="react-navigation native-stack `presentation: 'formSheet'`, with detents.">
        <Row>
          <Btn testID="home-sheet-morph" title="Sheet (morph, autoFocus)" onPress={() => nav.navigate('Sheet', { kind: 'morph', autoFocus: true })} />
          <Btn testID="home-sheet-rn" title="Sheet (rn, autoFocus)" onPress={() => nav.navigate('Sheet', { kind: 'rn', autoFocus: true })} />
        </Row>
        <Row>
          <Btn testID="home-sheet-morph-manual" title="Sheet (morph, manual)" onPress={() => nav.navigate('Sheet', { kind: 'morph', autoFocus: false })} />
          <Btn testID="home-sheet-rn-manual" title="Sheet (rn, manual)" onPress={() => nav.navigate('Sheet', { kind: 'rn', autoFocus: false })} />
        </Row>
      </Card>
      <Card title="Rolling number" hint="This library against every other animated-number library on npm that builds here: frame pacing on both threads and per-thread CPU, on this device.">
        <Row><Btn testID="home-rolling-bench" tone="primary" title="Benchmark vs other libraries" onPress={() => nav.navigate('RollingBench')} /></Row>
      </Card>
      <Card title="Original demo" hint="The rolling number and morph input showcase this example shipped with.">
        <Row><Btn testID="home-demo" title="Open demo" onPress={() => nav.navigate('Demo')} /></Row>
      </Card>
      <Text style={styles.cardHint}>Screens are driven by testID; see HANDOFF.md.</Text>
    </ScrollView>
  )
}

/**
 * Launched with a benchmark plan (scripts/bench/run.mjs passes one through the
 * probe), the app goes straight to the benchmark screen and runs it. Android
 * reports the activity's intent a beat after the bundle loads, hence the retries.
 */
function useLaunchPlan(navRef: ReturnType<typeof useNavigationContainerRef<RootStackParamList>>) {
  return React.useCallback(() => {
    let tries = 0
    const check = () => {
      const plan = parsePlan(launchPlan())
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
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Input parity' }} />
        <Stack.Screen name="Parity" component={ParityScreen} options={{ title: 'Parity' }} />
        <Stack.Screen name="NavA" component={NavAScreen} options={{ title: 'Screen A' }} />
        <Stack.Screen name="NavB" component={NavBScreen} options={{ title: 'Screen B' }} />
        <Stack.Screen name="StateChange" component={StateChangeScreen} options={{ title: 'State change' }} />
        <Stack.Screen name="KeyboardController" component={KeyboardControllerScreen} options={{ title: 'keyboard-controller' }} />
        <Stack.Screen name="Bench" component={BenchScreen} options={{ title: 'Benchmark' }} />
        <Stack.Screen name="RollingBench" component={RollingBenchScreen} options={{ title: 'Rolling number benchmark' }} />
        <Stack.Screen name="FlowEmail" component={FlowEmailScreen} options={FLOW_STEP} />
        <Stack.Screen name="FlowAmount" component={FlowAmountScreen} options={FLOW_STEP} />
        <Stack.Screen name="FlowForm" component={FlowFormScreen} options={FLOW_STEP} />
        <Stack.Screen name="Demo" component={DemoScreen} options={{ title: 'Demo' }} />
        <Stack.Screen name="ViewPropsRepro" component={ViewPropsReproScreen} options={{ title: 'View props' }} />
        <Stack.Screen name="Rtl" component={RtlScreen} options={{ title: 'Right-to-left' }} />
        <Stack.Screen
          name="FlowSheet"
          component={FlowSheetScreen}
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.6, 0.95],
            sheetGrabberVisible: true,
            sheetCornerRadius: 20,
            title: '',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="Sheet"
          component={FormSheetScreen}
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.4, 0.9],
            sheetGrabberVisible: true,
            sheetCornerRadius: 20,
            title: 'Form sheet',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
