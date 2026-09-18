const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { getBundleModeMetroConfig } = require('react-native-worklets/bundleMode');
const path = require('path');

const root = path.resolve(__dirname, '..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(root, 'node_modules'),
    ],
  },
};

// Worklets Bundle Mode wraps the final config (module ids, resolver shims, inline requires).
module.exports = getBundleModeMetroConfig(mergeConfig(getDefaultConfig(__dirname), config));
