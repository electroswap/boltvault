/**
 * ATT-BV-003 — what the in-app browser may speak for.
 *
 * The Browser screen pulls in the whole UI and cannot be rendered in plain
 * node (see `money-screens.test.ts` for why these suites read source instead),
 * so what is pinned here is the shape of the three properties that made the
 * origin spoofable, each of which is one line that a later edit could quietly
 * drop:
 *
 *  1. the session follows COMMITTED navigation, not `onLoadStart` — a page
 *     that starts a cross-origin navigation and cancels it must not inherit
 *     the target's session;
 *  2. a message is refused unless the frame that posted it is the session's
 *     own origin — the native bridge is reachable from every iframe;
 *  3. every request carries the channel nonce, so the engine can refuse one
 *     that does not belong to the live session.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8')
const BROWSER = read('screens/Browser.tsx')

describe('the in-app browser only speaks for a committed origin', () => {
  it('opens no session while a navigation is in flight', () => {
    expect(BROWSER).toContain('const origin = navigating ? null : originOf(nav.url)')
    // A start closes the session; only a commit opens one.
    expect(BROWSER).toContain('onNavigateStart={() => setNavigating(true)}')
    expect(BROWSER).toMatch(/onNavigate=\{\(s\) => \{[\s\S]*setNavigating\(false\)/)
  })

  it('refuses a message from any frame but the session origin', () => {
    expect(BROWSER).toContain('const from = frameUrl === null ? null : originOf(frameUrl)')
    expect(BROWSER).toContain('if (from !== session.origin)')
    // …and says the same thing it says when there is no session at all.
    const refusal = BROWSER.slice(BROWSER.indexOf('if (from !== session.origin)'))
    expect(refusal.slice(0, 200)).toContain("code: 4900")
  })

  it('carries the channel nonce to the engine on open and on every request', () => {
    // Written against the calls rather than one formatting of them: prettier
    // wraps these across lines as they grow, and a regex over the whole call
    // becomes a test of the line breaks.
    const after = (needle: string): string => BROWSER.slice(BROWSER.indexOf(needle), BROWSER.indexOf(needle) + 400)
    expect(BROWSER).toContain('engine.dapps')
    expect(after('.open({')).toContain('channel: channel.current')
    expect(after('.request({')).toContain('channel: channel.current')
  })
})
