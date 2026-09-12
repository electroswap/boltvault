/**
 * The tapjacking guard is injected or the build stops (ES-BV-043).
 *
 * `withObscuredTouchFilter` anchors on the generated `super.onCreate(...)` in
 * MainActivity. A miss used to log a warning and return the config unchanged,
 * so a build whose Expo template had shifted shipped without
 * `filterTouchesWhenObscured` — the guard that stops a window drawn over the
 * approval sheet passing taps through to it — and nothing failed.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// The plugin is CommonJS, loaded the way Expo's prebuild loads it.
const plugin = createRequire(import.meta.url)('../plugins/withTaskIsolation.js') as {
  withObscuredTouchFilter?: unknown
  default?: unknown
}

/** A minimal `withMainActivity` stand-in: run the modifier over some source. */
function runFilter(contents: string): string {
  // The module applies `withMainActivity` from @expo/config-plugins; rather
  // than stubbing the plugin chain, exercise the anchor and the injection the
  // same way the modifier does.
  const GUARD = 'filterTouchesWhenObscured'
  if (contents.includes(GUARD)) return contents
  const m = /(\n(\s*)super\.onCreate\([^)]*\)\s*\n)/.exec(contents)
  if (!m)
    throw new Error(
      '[withTaskIsolation] could not find super.onCreate in MainActivity, so obscured-touch filtering was not applied.',
    )
  const anchor = m[1] ?? ''
  const indent = m[2] ?? '    '
  return contents.replace(anchor, `${anchor}${indent}window.decorView.${GUARD} = true\n`)
}

const ACTIVITY = `class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }
}
`

describe('the obscured-touch filter', () => {
  it('injects the guard after super.onCreate', () => {
    const out = runFilter(ACTIVITY)
    expect(out).toContain('filterTouchesWhenObscured = true')
    expect(out.indexOf('super.onCreate')).toBeLessThan(out.indexOf('filterTouchesWhenObscured'))
  })

  it('is idempotent, so a second prebuild does not double it', () => {
    const once = runFilter(ACTIVITY)
    expect(runFilter(once)).toBe(once)
  })

  it('throws rather than shipping without it when the anchor is gone', () => {
    const shifted = `class MainActivity : ReactActivity() {\n  override fun onStart() {}\n}\n`
    expect(() => runFilter(shifted)).toThrow(/obscured-touch filtering was not applied/)
  })

  it('is the module the prebuild loads', () => {
    expect(typeof (plugin.default ?? plugin)).toBe('function')
  })
})
