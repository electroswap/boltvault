/**
 * "On leaving" has to survive being stored, and must not lock on arrival
 * (ES-BV-067, ES-BV-041).
 *
 * The value existed in the engine's schema, in the vault's timer table and in
 * the mobile picker, but `normalizeSettings` clamped every write of it back to
 * fifteen minutes — so the phone the user had told to lock on leaving stayed
 * unlocked for a quarter of an hour, and the picker's highlight quietly moved
 * to fifteen minutes. A second defect hid behind the first: the timer table
 * gave it zero milliseconds, which `arm()` reads as a deadline of *now*, so
 * had it ever reached the vault it would have locked the wallet immediately
 * after every unlock.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { normalizeSettings } from '@boltvault/settings'
import { describe, expect, it } from 'vitest'
import { createEngine } from '../src/create'

const heads = { blockNumber: async () => 15_100_000n }
const FAST = { m: 1024, t: 1, p: 1 }
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function boot(body: 'extension' | 'mobile') {
  const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
  return { platform, ...createEngine({ platform, heads, kdf: FAST, body }) }
}

describe('the settings normaliser', () => {
  it('keeps "on leaving" instead of clamping it to fifteen minutes', () => {
    expect(normalizeSettings({ autoLock: 'background' }).autoLock).toBe('background')
  })

  it('still refuses a value that is not an auto-lock at all', () => {
    expect(normalizeSettings({ autoLock: 'whenever' }).autoLock).toBe('15min')
  })

  it('defaults a phone to "on leaving" and a browser to the idle timer', () => {
    expect(normalizeSettings(null, { reducedMotion: false, body: 'mobile' }).autoLock).toBe('background')
    expect(normalizeSettings(null, { reducedMotion: false, body: 'extension' }).autoLock).toBe('15min')
  })

  it('keeps an explicit choice on a phone', () => {
    expect(normalizeSettings({ autoLock: '5min' }, { reducedMotion: false, body: 'mobile' }).autoLock).toBe('5min')
  })
})

describe('a phone told to lock on leaving', () => {
  it('round-trips the setting and does not lock itself on the way back', async () => {
    const { engine, platform, ready } = boot('mobile')
    await ready
    await engine.vault.import({ mnemonic: PHRASE, password: 'correct horse battery' })
    await engine.vault.setAutoLock({ autoLock: 'background' })
    expect((await engine.settings.get()).autoLock).toBe('background')

    // No idle deadline at all: the app's own foreground transition locks.
    const status = await engine.vault.status()
    expect(status.unlocked).toBe(true)
    expect(status.lockAt).toBeNull()

    // `status()` is where `expireIfDue` runs, and a deadline of "now" would
    // have locked the wallet right here.
    await platform.clock.advance(1_000)
    expect((await engine.vault.status()).unlocked).toBe(true)
    await platform.clock.advance(3 * 3_600_000)
    expect((await engine.vault.status()).unlocked).toBe(true)
  })

  it('is never told to stop locking altogether', async () => {
    const { engine, ready } = boot('mobile')
    await ready
    await engine.vault.import({ mnemonic: PHRASE, password: 'correct horse battery' })
    await engine.vault.setAutoLock({ autoLock: 'never' })
    // A desktop peer, an older build or a hand-edited document cannot leave a
    // phone unlocked for the life of the app.
    expect((await engine.settings.get()).autoLock).toBe('background')
  })

  it('starts on "on leaving" with nothing stored', async () => {
    const { engine, ready } = boot('mobile')
    await ready
    expect((await engine.settings.get()).autoLock).toBe('background')
  })
})

describe('the same choice in a browser', () => {
  it('falls back to the shortest real timer rather than to never', async () => {
    const { engine, platform, ready } = boot('extension')
    await ready
    await engine.vault.import({ mnemonic: PHRASE, password: 'correct horse battery' })
    await engine.vault.setAutoLock({ autoLock: 'background' })
    // There is no foreground to leave here, so a deadline is the only control.
    expect((await engine.vault.status()).lockAt).toBe(platform.now() + 300_000)
    await platform.clock.advance(301_000)
    expect((await engine.vault.status()).unlocked).toBe(false)
  })

  it('still honours never, where a closing popup is not the user walking away', async () => {
    const { engine, ready } = boot('extension')
    await ready
    await engine.vault.import({ mnemonic: PHRASE, password: 'correct horse battery' })
    await engine.vault.setAutoLock({ autoLock: 'never' })
    expect((await engine.settings.get()).autoLock).toBe('never')
    expect((await engine.vault.status()).lockAt).toBeNull()
  })
})
