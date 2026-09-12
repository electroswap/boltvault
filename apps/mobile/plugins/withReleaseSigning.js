/* eslint-disable @typescript-eslint/no-require-imports -- an Expo config plugin is CommonJS */
/**
 * Expo config plugin: a release APK is signed with a release key, or not at all.
 *
 * The Expo template gives the `release` build type `signingConfig
 * signingConfigs.debug`, so `./gradlew assembleRelease` produced something
 * named "release" and signed with the Android debug keystore — a key that
 * ships with the SDK and that everybody has. Android treats signature identity
 * as the upgrade identity: any APK carrying this package name and that same
 * key installs over such a build as an update, inherits its UID, its files and
 * its Keystore entries (the device wrap key, the MMKV secret-store key) and
 * can then ask for biometrics and unwrap the DEK. A wallet cannot ship an
 * artefact whose update path is open to anyone who reads the docs.
 *
 * So `release` is signed from the environment:
 *
 *     BOLTVAULT_RELEASE_KEYSTORE=/abs/path/boltvault.jks \
 *     BOLTVAULT_RELEASE_KEYSTORE_PASSWORD=… \
 *     BOLTVAULT_RELEASE_KEY_ALIAS=boltvault \
 *     BOLTVAULT_RELEASE_KEY_PASSWORD=… \
 *       ./gradlew assembleRelease
 *
 * and when those are absent the build FAILS rather than quietly falling back.
 * A developer who only wants the app on their own handset builds `debug`, or
 * makes themselves a throwaway keystore and says so — either way the choice is
 * made out loud. `BOLTVAULT_ALLOW_DEBUG_SIGNED_RELEASE=1` is the escape hatch
 * for that case; it is a deliberate sentence to type, and the verifier in
 * `tools/verify-apk-signer.mjs` still refuses to let the output past a gate.
 *
 * Nothing here reads a secret from the repository: the passwords come from the
 * environment, and the keystore path is absolute so it need not live in the
 * tree. EAS supplies its own credentials and never reaches this block.
 */
const { withAppBuildGradle } = require('expo/config-plugins')

const SIGNING_BLOCK = `
    // --- BoltVault: added by plugins/withReleaseSigning.js ---
    signingConfigs {
        boltvaultRelease {
            def keystore = System.getenv('BOLTVAULT_RELEASE_KEYSTORE')
            def allowDebug = System.getenv('BOLTVAULT_ALLOW_DEBUG_SIGNED_RELEASE') == '1'
            if (keystore != null && !keystore.isEmpty()) {
                storeFile file(keystore)
                storePassword System.getenv('BOLTVAULT_RELEASE_KEYSTORE_PASSWORD')
                keyAlias System.getenv('BOLTVAULT_RELEASE_KEY_ALIAS')
                keyPassword System.getenv('BOLTVAULT_RELEASE_KEY_PASSWORD')
            } else if (!allowDebug) {
                // Evaluated lazily: configuring a debug build must not trip over
                // a release credential that is none of its business.
                storeFile null
            }
        }
    }
`

const RELEASE_GUARD = `
// --- BoltVault: added by plugins/withReleaseSigning.js ---
// A release task with no release keystore stops here, rather than producing a
// debug-signed artefact that Android will accept as an upgrade of a real one.
gradle.taskGraph.whenReady { graph ->
    def releasing = graph.allTasks.any { it.name.toLowerCase().contains('release') && (it.name.startsWith('assemble') || it.name.startsWith('bundle') || it.name.startsWith('package')) }
    def keystore = System.getenv('BOLTVAULT_RELEASE_KEYSTORE')
    def allowDebug = System.getenv('BOLTVAULT_ALLOW_DEBUG_SIGNED_RELEASE') == '1'
    if (releasing && (keystore == null || keystore.isEmpty()) && !allowDebug) {
        throw new GradleException(
            'BoltVault: a release build needs BOLTVAULT_RELEASE_KEYSTORE, ' +
            'BOLTVAULT_RELEASE_KEYSTORE_PASSWORD, BOLTVAULT_RELEASE_KEY_ALIAS and ' +
            'BOLTVAULT_RELEASE_KEY_PASSWORD. Signing a release with the public debug ' +
            'key lets anyone ship an update over it. For a build for your own device ' +
            'only, set BOLTVAULT_ALLOW_DEBUG_SIGNED_RELEASE=1 and do not distribute it.')
    }
}
`

/**
 * The whole edit as a pure function of `app/build.gradle`, so it can be tested
 * without a prebuild: `android/` is gitignored and regenerated, and a plugin
 * whose only proof is a 35-minute native build is a plugin nobody checks.
 */
function applyToBuildGradle(contents) {
  if (contents.includes('withReleaseSigning.js')) return contents
  // The signing configs have to exist before the build type names one.
  let out = contents.replace(/\nandroid \{\n/, `\nandroid {\n${SIGNING_BLOCK}`)
  // The Expo template writes `signingConfig signingConfigs.debug` in both build
  // types; only the one inside `release { … }` is ours to change.
  const release = out.indexOf('release {')
  if (release >= 0) {
    out =
      out.slice(0, release) +
      out
        .slice(release)
        .replace(
          'signingConfig signingConfigs.debug',
          'signingConfig signingConfigs.boltvaultRelease',
        )
  }
  return out + RELEASE_GUARD
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    c.modResults.contents = applyToBuildGradle(c.modResults.contents)
    return c
  })
}

module.exports.applyToBuildGradle = applyToBuildGradle
