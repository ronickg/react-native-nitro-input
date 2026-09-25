module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Bundle Mode: worklets can use what the bundle imports. Imports a worklet
    // uses from a library must be forwarded by exact module name, otherwise
    // they are captured as (uncallable) remote functions. strictGlobal: a name
    // a worklet does not bind is read from the UI runtime's globals, never
    // captured from the JS thread (the strictest setting, which apps use too).
    [
      'react-native-worklets/plugin',
      {
        bundleMode: true,
        strictGlobal: true,
        importForwarding: { moduleNames: ['libphonenumber-js/min'] },
      },
    ],
  ],
};
