/* eslint-disable @typescript-eslint/no-require-imports -- an Expo config plugin is CommonJS */
/**
 * Expo config plugin: keep the wallet's task to itself, and ignore touches
 * that arrive through something drawn on top of it.
 *
 * Two Android affordances that are convenient for ordinary apps and wrong for
 * a wallet:
 *
 *   - **Task affinity.** By default an activity's affinity is the package
 *     name, and another app that declares the same affinity can have its own
 *     activity placed into — or in front of — this one's task. The user
 *     returns to what looks like BoltVault and is typing a password into
 *     something else. An empty affinity puts MainActivity in a task no other
 *     app can name, and `allowTaskReparenting=false` stops it being moved.
 *
 *   - **Obscured touches.** An app holding SYSTEM_ALERT_WINDOW can draw over
 *     the approval sheet and let taps fall through to the button underneath,
 *     so a tap the user believes lands on a harmless overlay actually signs.
 *     `filterTouchesWhenObscured` makes the framework drop any touch that
 *     passed through another window. React Native does not surface this as a
 *     View prop, so it is set once on the decor view.
 *
 * This lives here rather than in android/ because android/ is gitignored and
 * rewritten by every `expo prebuild` — an edit there would silently vanish.
 */
const { withAndroidManifest, withMainActivity } = require('expo/config-plugins')

/**
 * Apply the task-affinity half to a parsed manifest. Exported so the test
 * drives the plugin's own code rather than its own copy of the rule
 * (ES-BV-043).
 */
function applyPrivateTask(manifest) {
  const main = manifest.manifest?.application?.[0]?.activity?.find((a) => a.$['android:name'] === '.MainActivity')
  if (!main) {
    /*
      Fail closed, like the other half (ES-BV-043).

      This returned the config unchanged when `.MainActivity` was not found,
      so a template rename would ship the wallet with the default task
      affinity — which is the package name, which another app may declare,
      which is how a user returns to what looks like BoltVault and types a
      password into something else.
    */
    throw new Error(
      '[withTaskIsolation] no .MainActivity in the Android manifest, so task isolation was not applied. The Expo template has changed; update plugins/withTaskIsolation.js before shipping.',
    )
  }
  // An empty affinity is a real value, not an absent one: it means "a task
  // of my own that nobody can join".
  main.$['android:taskAffinity'] = ''
  main.$['android:allowTaskReparenting'] = 'false'
  return manifest
}

function withPrivateTask(config) {
  return withAndroidManifest(config, (c) => {
    applyPrivateTask(c.modResults)
    return c
  })
}

const GUARD = 'filterTouchesWhenObscured'

/**
 * Apply the obscured-touch half to MainActivity source. Exported for the same
 * reason `applyPrivateTask` is: a test that re-implements the anchor tests
 * nothing (ES-BV-043).
 */
function applyObscuredTouchFilter(src) {
  if (src.includes(GUARD)) return src
    // Anchor on the generated `super.onCreate(...)`, whatever argument Expo
    // passes it. If the shape ever changes, leave the file alone rather than
    // corrupt it — the manifest half of this plugin still applies.
  const m = /(\n(\s*)super\.onCreate\([^)]*\)\s*\n)/.exec(src)
  if (!m) {
      /*
        Fail closed (ES-BV-043).

        This warned and returned the config unchanged, so a build whose
        MainActivity template had shifted shipped without
        `filterTouchesWhenObscured` — silently, in a log line nobody reads, on
        the guard that stops an overlay drawn over the approval sheet passing
        taps through to it. A prebuild that cannot apply a security control is
        a prebuild that should stop.
      */
    throw new Error(
      '[withTaskIsolation] could not find super.onCreate in MainActivity, so obscured-touch filtering was not applied. The Expo template has changed; update the anchor in plugins/withTaskIsolation.js before shipping.',
    )
  }
  const indent = m[2] ?? '    '
  const inject = `${m[1]}${indent}// A window drawn over the approval sheet must not be able to pass taps through to it.\n${indent}window.decorView.${GUARD} = true\n`
  return src.replace(m[1], inject)
}

function withObscuredTouchFilter(config) {
  return withMainActivity(config, (c) => {
    c.modResults.contents = applyObscuredTouchFilter(c.modResults.contents)
    return c
  })
}

module.exports = function withTaskIsolation(config) {
  return withObscuredTouchFilter(withPrivateTask(config))
}
module.exports.applyObscuredTouchFilter = applyObscuredTouchFilter
module.exports.applyPrivateTask = applyPrivateTask
module.exports.GUARD = GUARD
