module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // Reanimated/worklets and the Tamagui compiler plugins are added in M1
    // together with the motion work; M0 runs Tamagui at runtime.
    plugins: ['react-native-worklets/plugin'],
  }
}
