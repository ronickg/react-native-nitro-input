module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}'],
  moduleNameMapper: {
    '^react-native-nitro-modules$': '<rootDir>/src/__tests__/__mocks__/react-native-nitro-modules.ts',
  },
};
