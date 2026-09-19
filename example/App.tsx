import React from 'react'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RootNavigator } from './src/navigation'

export default function App() {
  return (
    <KeyboardProvider>
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    </KeyboardProvider>
  )
}
