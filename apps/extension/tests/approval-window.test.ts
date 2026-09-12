/**
 * ATT-BV-010 — a background tab does not get to throw a signing window over
 * whatever the person is doing.
 *
 * §3.5 says an approval-class request from a hidden tab is held. The hold was
 * written in the MAIN-world provider (`untilVisible`), which is page code: a
 * page skips it by posting an `InpageRequest` straight at the bridge, and the
 * worker then opened `sign.html` with `focused: true` for anything that
 * arrived. The worker is the only place the check can live, and the service
 * worker is not something this suite can instantiate — so what is pinned is
 * that the check is there, in the entrypoint, in the shape that makes it work.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BACKGROUND = readFileSync(fileURLToPath(new URL('../entrypoints/background.ts', import.meta.url)), 'utf8')

describe('the approval window', () => {
  it('asks whether the requesting tab is the one in front', () => {
    expect(BACKGROUND).toContain('browser.tabs.get(tabId)')
    expect(BACKGROUND).toContain('if (!tab.active) return false')
    expect(BACKGROUND).toContain('return w.focused === true')
  })

  it('holds the request instead of creating a window, and says so on the badge', () => {
    expect(BACKGROUND).toMatch(/if \(tabId !== undefined && !\(await inFront\(tabId\)\)\) \{\s*\n\s*waiting\.set/)
    expect(BACKGROUND).toContain('browser.action.setBadgeText')
  })

  it('opens it when that tab comes back, by activation or by window focus', () => {
    expect(BACKGROUND).toContain('browser.tabs.onActivated.addListener')
    expect(BACKGROUND).toContain('browser.windows.onFocusChanged.addListener')
    expect(BACKGROUND).toContain('openApproval(held.request)')
  })

  it('stops holding a request that has been decided', () => {
    const decided = BACKGROUND.slice(BACKGROUND.indexOf("if (e.type !== 'approvals.changed') return"))
    expect(decided.slice(0, 700)).toContain('waiting.delete(id)')
  })
})
