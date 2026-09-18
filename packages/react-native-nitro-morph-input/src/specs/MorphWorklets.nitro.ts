import type { HybridObject } from 'react-native-nitro-modules'

/**
 * Bridge to `react-native-worklets`, so the native input can run a worklet
 * synchronously on the UI thread while it handles an edit. The native object
 * also exposes a raw JSI method `install(runtimeHolder)` (not declared here:
 * the holder is an opaque JSI object) that takes the result of
 * `getUIRuntimeHolder()` from `react-native-worklets`.
 */
export interface MorphWorklets extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  /** True when `react-native-worklets` was available when the native code was built. */
  readonly isAvailable: boolean
}
