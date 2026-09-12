/**
 * The tapjacking guard and the task isolation are injected, or the build stops
 * (ES-BV-043).
 *
 * Both halves used to give up quietly when their anchor was missing. The
 * obscured-touch half logged a warning and returned the config unchanged, so a
 * build whose Expo template had shifted shipped without
 * `filterTouchesWhenObscured` — the guard that stops a window drawn over the
 * approval sheet passing taps through to it. The task-affinity half returned
 * silently when `.MainActivity` was not found, which ships the wallet with the
 * default affinity: the package name, which another app may declare, which is
 * how a user returns to what looks like BoltVault and types a password into
 * something else.
 *
 * This drives the plugin's own exported modifiers. The previous version
 * asserted against its own copy of the regex, which tests the copy.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const plugin = createRequire(import.meta.url)('../plugins/withTaskIsolation.js') as {
  applyObscuredTouchFilter(src: string): string
  applyPrivateTask(manifest: unknown): unknown
  GUARD: string
}

const MAIN_ACTIVITY = `package io.electroswap.boltvault

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    setTheme(R.style.AppTheme)
  }
}
`

const manifestWith = (name: string): Record<string, unknown> => ({
  manifest: { application: [{ activity: [{ $: { 'android:name': name } }] }] },
})

describe('the obscured-touch half', () => {
  it('injects the guard after super.onCreate', () => {
    const out = plugin.applyObscuredTouchFilter(MAIN_ACTIVITY)
    expect(out).toContain(`window.decorView.${plugin.GUARD} = true`)
    // After the call, not before it: the decor view does not exist until then.
    expect(out.indexOf('super.onCreate')).toBeLessThan(out.indexOf(plugin.GUARD))
  })

  it('is idempotent, because a prebuild may run twice', () => {
    const once = plugin.applyObscuredTouchFilter(MAIN_ACTIVITY)
    expect(plugin.applyObscuredTouchFilter(once)).toBe(once)
  })

  it('stops the build when the anchor is gone', () => {
    expect(() => plugin.applyObscuredTouchFilter('class MainActivity {}')).toThrow(/super\.onCreate/)
  })

  it('handles the Kotlin template’s argument, whatever Expo passes', () => {
    const other = MAIN_ACTIVITY.replace('super.onCreate(null)', 'super.onCreate(savedInstanceState)')
    expect(plugin.applyObscuredTouchFilter(other)).toContain(plugin.GUARD)
  })
})

describe('the task-affinity half', () => {
  it('gives MainActivity a task no other app can name', () => {
    const manifest = manifestWith('.MainActivity') as {
      manifest: { application: Array<{ activity: Array<{ $: Record<string, string> }> }> }
    }
    plugin.applyPrivateTask(manifest)
    const attrs = manifest.manifest.application[0]?.activity[0]?.$ ?? {}
    // An empty affinity is a real value, not an absent one.
    expect(attrs['android:taskAffinity']).toBe('')
    expect(attrs['android:allowTaskReparenting']).toBe('false')
  })

  it('stops the build when the activity is not there', () => {
    expect(() => plugin.applyPrivateTask(manifestWith('.SomethingElse'))).toThrow(/MainActivity/)
    expect(() => plugin.applyPrivateTask({ manifest: {} })).toThrow(/MainActivity/)
  })
})
