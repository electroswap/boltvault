/**
 * The in-app browser's navigation gate has to actually run (ES-BV-039).
 *
 * `onShouldStartLoadWithRequest` was added and `originWhitelist={['https://*']}`
 * was kept, which reads like a deny-list and is not one. The pinned
 * `react-native-webview` consults the application's callback *only* for URLs
 * that already pass the whitelist; a URL that fails it is handed straight to
 * `Linking.canOpenURL` → `Linking.openURL` with no callback at all. So the
 * gate was inert for exactly the schemes it was written for: a page setting
 * `location` to `ethereum:` or `boltvault://wc?uri=…` still round-tripped
 * through the OS into the wallet's own deep-link handler.
 *
 * This test reads the pinned library's own shared logic rather than mocking
 * it, because the finding is about what that library does, not about what the
 * component intends.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)
const component = readFileSync(require_.resolve('../src/WebView.native.tsx'), 'utf8')

describe('the whitelist the component hands the library', () => {
  it('lets every navigation reach the callback', () => {
    const whitelist = /originWhitelist=\{(\[[^\]]*\])\}/.exec(component)?.[1]
    expect(whitelist).toBeTruthy()
    // Anything narrower and the library opens the rest in the OS without ever
    // asking, which is the whole finding.
    expect(whitelist).toBe("['*']")
  })

  it('still keeps an allow decision, and keeps it in the callback', () => {
    expect(component).toContain('onShouldStartLoadWithRequest')
    // https passes on its own; everything else is the host's decision.
    expect(component).toMatch(/\/\^https:\/i\.test\(r\.url\)\) return true/)
    expect(component).toContain('onExternalNavigation')
    // And a refusal is the default when no host answered.
    expect(component).toMatch(/\?\?\s*false/)
  })

  it('does not refuse a page its own blank frame', () => {
    expect(component).toMatch(/about:blank/)
  })
})

describe('the pinned library, so this stays true if it is upgraded', () => {
  it('only calls the application callback for URLs that pass the whitelist', () => {
    const shared = readFileSync(require_.resolve('react-native-webview/lib/WebViewShared.js'), 'utf8')
    // `if (!passesWhitelist(...)) { Linking.openURL(url); shouldStart = false }
    //  else if (onShouldStartLoadWithRequest) { ... }`
    expect(shared).toContain('passesWhitelist')
    expect(shared).toMatch(/passesWhitelist[\s\S]{0,400}?openURL/)
  })
})
