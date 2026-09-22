module.exports = {
  preset: '@react-native/jest-preset',
  // The on-device suites (`__tests__/*.harness.tsx`) belong to React Native
  // Harness (`jest.harness.config.mjs`), not to this Node runner.
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
};
