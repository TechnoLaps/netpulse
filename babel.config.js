module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    // Required by react-native-reanimated v4 (pulled in as an expo-router peer).
    // Must be the last plugin.
    plugins: ['react-native-worklets/plugin'],
  };
};
