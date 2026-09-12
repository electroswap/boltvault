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

function withPrivateTask(config) {
  return withAndroidManifest(config, (c) => {
    const main = c.modResults.manifest.application?.[0]?.activity?.find(
      (a) => a.$['android:name'] === '.MainActivity',
    )
    if (!main) return c
    // An empty affinity is a real value, not an absent one: it means "a task
    // of my own that nobody can join".
    main.$['android:taskAffinity'] = ''
    main.$['android:allowTaskReparenting'] = 'false'
    return c
  })
}

const GUARD = 'filterTouchesWhenObscured'

function withObscuredTouchFilter(config) {
  return withMainActivity(config, (c) => {
    const src = c.modResults.contents
    if (src.includes(GUARD)) return c
    // Anchor on the generated `super.onCreate(...)`, whatever argument Expo
    // passes it. If the shape ever changes, leave the file alone rather than
    // corrupt it — the manifest half of this plugin still applies.
    const m = /(\n(\s*)super\.onCreate\([^)]*\)\s*\n)/.exec(src)
    if (!m) {
      console.warn(
        '[withTaskIsolation] could not find super.onCreate in MainActivity; obscured-touch filtering not applied',
      )
      return c
    }
    const indent = m[2] ?? '    '
    const inject = `${m[1]}${indent}// A window drawn over the approval sheet must not be able to pass taps through to it.\n${indent}window.decorView.${GUARD} = true\n`
    c.modResults.contents = src.replace(m[1], inject)
    return c
  })
}

module.exports = function withTaskIsolation(config) {
  return withObscuredTouchFilter(withPrivateTask(config))
}
