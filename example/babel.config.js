module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Bundle Mode: worklets can use what the bundle imports. Imports a worklet
    // uses from a library must be forwarded by exact module name, otherwise
    // they are captured as (uncallable) remote functions.
    [
      'react-native-worklets/plugin',
      {
        bundleMode: true,
        importForwarding: { moduleNames: ['libphonenumber-js/min'] },
      },
    ],
  ],
};
