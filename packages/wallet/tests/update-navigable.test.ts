/**
 * What a stale build stands in front of, and what it leaves reachable
 * (ES-BV-007).
 *
 * `UpdateRequired` used to be a non-dismissible overlay over every screen, so
 * a `minVersion` published by accident locked every install out of Backup,
 * Reveal and Export. It is an in-place plate now, shown only for the screens
 * that act on the user's behalf — but `home` is one of those, and the
 * product's only navigation to Settings is the icon on Home. So the plate's
 * own copy, "Settings, your recovery phrase, export and your activity are
 * still open", was true and unreachable at the same time: on a phone there was
 * no route to any of it, and deep links reach only home, swap, explore,
 * activity, bridge, receive and browser.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isBlockedByUpdate } from '../src/updateGate'

const source = readFileSync(new URL('../src/components/UpdateRequired.tsx', import.meta.url), 'utf8')

describe('the blocked set', () => {
  it('never covers the screens the copy promises', () => {
    for (const screen of ['settings', 'security', 'backup', 'devices', 'accounts', 'activity', 'receive']) {
      expect(isBlockedByUpdate(screen)).toBe(false)
    }
  })

  it('covers the screens that act on the user’s behalf', () => {
    for (const screen of ['home', 'swap', 'send', 'bridge', 'browser', 'approval']) {
      expect(isBlockedByUpdate(screen)).toBe(true)
    }
  })

  it('says nothing about a screen it has never heard of', () => {
    expect(isBlockedByUpdate('somewhere-else')).toBe(false)
  })
})

describe('the plate', () => {
  it('offers a way to the screens it says are open', () => {
    // A promise with no control is a promise the user cannot act on, and Home
    // — the only route to Settings in the product — is blocked.
    expect(source).toContain('update-settings')
    expect(source).toMatch(/router\.navigate\('settings'\)/)
  })

  it('still offers the update itself', () => {
    expect(source).toContain('update-key')
  })

  it('still says the recovery phrase is not behind the flag', () => {
    expect(source).toContain('update-recovery')
  })
})
