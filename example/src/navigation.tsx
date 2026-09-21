import React from 'react'
import { ScrollView, Text } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
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
  FlowEmail: { impl: Impl }
  FlowAmount: { impl: Impl }
  FlowForm: { impl: Impl }
  FlowSheet: { impl: Impl }
  ViewPropsRepro: undefined
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
      <Card title="Original demo" hint="The rolling number and morph input showcase this example shipped with.">
        <Row><Btn testID="home-demo" title="Open demo" onPress={() => nav.navigate('Demo')} /></Row>
      </Card>
      <Text style={styles.cardHint}>Screens are driven by testID; see HANDOFF.md.</Text>
    </ScrollView>
  )
}

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Input parity' }} />
        <Stack.Screen name="Parity" component={ParityScreen} options={{ title: 'Parity' }} />
        <Stack.Screen name="NavA" component={NavAScreen} options={{ title: 'Screen A' }} />
        <Stack.Screen name="NavB" component={NavBScreen} options={{ title: 'Screen B' }} />
        <Stack.Screen name="StateChange" component={StateChangeScreen} options={{ title: 'State change' }} />
        <Stack.Screen name="KeyboardController" component={KeyboardControllerScreen} options={{ title: 'keyboard-controller' }} />
        <Stack.Screen name="Bench" component={BenchScreen} options={{ title: 'Benchmark' }} />
        <Stack.Screen name="FlowEmail" component={FlowEmailScreen} options={FLOW_STEP} />
        <Stack.Screen name="FlowAmount" component={FlowAmountScreen} options={FLOW_STEP} />
        <Stack.Screen name="FlowForm" component={FlowFormScreen} options={FLOW_STEP} />
        <Stack.Screen name="Demo" component={DemoScreen} options={{ title: 'Demo' }} />
        <Stack.Screen name="ViewPropsRepro" component={ViewPropsReproScreen} options={{ title: 'View props' }} />
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
