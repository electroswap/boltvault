/* eslint-disable @typescript-eslint/no-require-imports -- an Expo config plugin is CommonJS */
/**
 * Expo config plugin: the native window colours, so nothing white ever flashes.
 *
 * Android shows `splashscreen_background` for the frames between the launcher
 * icon and the first React frame. The prebuild template sets it to #FFFFFF, so
 * a wallet whose darkest value is #070A1F opened on a white flash — the one
 * frame of the app a user cannot help but see. The rest of the names here are
 * the same palette (packages/ui/src/tokens.ts); they were the superseded
 * #060913 / #5FD8FF.
 *
 * This is a plugin rather than an edit to android/res/values/colors.xml for the
 * reason `withUsbHost` gives: android/ is gitignored and rewritten by every
 * `expo prebuild`, so an edit there vanishes the next time anyone regenerates
 * the project — which is exactly what happened to the first attempt at this.
 */
const { withAndroidColors, AndroidConfig } = require('expo/config-plugins')

/** paint.void, paint.arc — packages/ui/src/tokens.ts. */
const VOID = '#070A1F'
const ARC = '#4FC3FF'

const COLORS = {
  splashscreen_background: VOID,
  iconBackground: VOID,
  activityBackground: VOID,
  colorPrimary: ARC,
  // `notification_icon_color` is expo-notifications' own — its `color` in
  // app.json is the single source for it, and its plugin wins here anyway.
}

module.exports = function withSplashColors(config) {
  return withAndroidColors(config, (c) => {
    for (const [name, value] of Object.entries(COLORS)) {
      c.modResults = AndroidConfig.Colors.assignColorValue(c.modResults, { name, value })
    }
    return c
  })
}
