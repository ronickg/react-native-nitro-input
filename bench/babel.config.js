module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Bundle Mode, as in the example app.
    ['react-native-worklets/plugin', { bundleMode: true }],
  ],
};
