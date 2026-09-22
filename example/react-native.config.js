module.exports = {
  project: {
    ios: {},
    android: {},
  },
  dependencies: {
    // Its bridging header imports React/RCTBaseTextInputView.h, which React
    // Native 0.87's prebuilt core framework no longer ships, so the pod does
    // not build. The benchmark compares it on Android only.
    'react-native-advanced-input-mask': {
      platforms: { ios: null },
    },
  },
  assets: ['./assets/fonts'],
};
