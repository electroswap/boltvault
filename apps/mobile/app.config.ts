/* eslint-disable @typescript-eslint/no-require-imports -- an Expo config is CommonJS */
/**
 * The version, laid over `app.json` (the release checklist).
 *
 * Expo reads `app.json` first and hands it to this file as `config`, so
 * everything else stays declarative JSON where it is easy to read and to diff
 * — the permissions, the intent filters, the plugin list. Only the two numbers
 * that must agree with the extension and with each other come from code.
 *
 * They come from `version.json` at the repo root, which is the single source:
 * `apps/extension/wxt.config.ts` reads the same file for the Chrome and Firefox
 * manifests, and `App.tsx` reads it for Settings › About and for the
 * `clientVersion` the API sees. `node tools/version.mjs <x.y.z>` changes it,
 * and `pnpm version:check` (part of `pnpm check`) fails when a copy drifts.
 *
 * `versionCode` is Android's integer upgrade ordinal and is only consulted by a
 * local gradle build: `eas.json` sets `appVersionSource: "remote"`, so an EAS
 * build takes its own count from the server and ignores this. It still has to
 * be right here, because the Android build script is a local gradle build and the
 * APK it signs is the one that installs over a previous one.
 *
 * iOS `buildNumber` is deliberately not set: nothing local builds it, and EAS
 * owns it remotely. Setting it here would be a second opinion about a number
 * only one of us is counting.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config'

const { version, androidVersionCode } = require('../../version.json') as {
  version: string
  androidVersionCode: number
}

export default ({ config }: ConfigContext): Partial<ExpoConfig> => ({
  ...config,
  version,
  android: { ...config.android, versionCode: androidVersionCode },
})
