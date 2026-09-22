export default {
  preset: 'react-native-harness',
  // Only the on-device suites; `App.test.tsx` and the helpers next to them are not tests for this runner.
  testMatch: ['<rootDir>/__tests__/**/*.harness.[jt]s?(x)'],
}
