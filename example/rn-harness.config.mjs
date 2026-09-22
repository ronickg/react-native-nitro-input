// React Native Harness: on-device tests for both packages, run inside this
// example app on a simulator or an emulator (`bun run test:harness:ios` /
// `:android`). The tests live in `__tests__/*.harness.tsx` and use the
// components the way an app does; Harness renders each test's tree as an
// overlay in the running app and reports through a Metro bridge.
import { androidEmulator, androidPlatform } from '@react-native-harness/platform-android'
import { applePlatform, appleSimulator } from '@react-native-harness/platform-apple'

const isCI = process.env.CI === 'true'

// Local defaults match a stock Android Studio AVD and a stock Xcode simulator;
// override with the HARNESS_* variables (CI sets them to what its images have).
const androidEmulatorName = process.env.HARNESS_ANDROID_EMULATOR ?? 'Pixel_9_API36'
const androidApiLevel = Number.parseInt(process.env.HARNESS_ANDROID_API_LEVEL ?? '36', 10)
const iosSimulatorName = process.env.HARNESS_IOS_SIMULATOR ?? 'iPhone 17'
const iosSimulatorVersion = process.env.HARNESS_IOS_SIMULATOR_VERSION ?? '26.5'

const config = {
  entryPoint: './index.js',
  appRegistryComponentName: 'RollingNumberExample',
  runners: [
    applePlatform({
      name: 'ios',
      device: appleSimulator(iosSimulatorName, iosSimulatorVersion),
      bundleId: 'org.reactjs.native.example.RollingNumberExample',
    }),
    androidPlatform({
      name: 'android',
      // The options let CI create the emulator when the image has none by that
      // name; the CI loader reads every one of them, so none may be left out.
      device: androidEmulator(androidEmulatorName, {
        apiLevel: androidApiLevel,
        profile: 'pixel',
        diskSize: '2G',
        heapSize: '1G',
      }),
      bundleId: 'com.rollingnumberexample',
    }),
  ],
  defaultRunner: 'ios',
  // A jackpot reveal runs for seconds; a roll for half a second.
  testTimeout: 20_000,
  // A CI runner boots a simulator or emulator far slower than a warm machine.
  platformReadyTimeout: isCI ? 900_000 : 300_000,
  bundleStartTimeout: isCI ? 120_000 : 60_000,
  bridgeTimeout: isCI ? 120_000 : 60_000,
  maxAppRestarts: isCI ? 4 : 2,
  detectNativeCrashes: true,
  forwardClientLogs: true,
}

export default config
