import React from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RootNavigator } from './src/navigation'

export default function App() {
  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  )
}
