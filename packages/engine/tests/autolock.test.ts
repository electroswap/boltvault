/**
 * Auto-lock (plan A1): 15 idle minutes by default, a touch re-arms but is
 * debounced, "never" cancels, and a v1 settings document migrates one
 * notch up with the old seven-chain default collapsing to ETN + three.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { DEFAULT_SETTINGS } from '@boltvault/core'
import { z } from 'zod'
import { createEngine } from '../src/create'
import { writeDoc, type DocSpec } from '../src/storage'

const heads = { blockNumber: async () => 15_100_000n }
const FAST = { m: 1024, t: 1, p: 1 }
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const V1_DOC: DocSpec<Record<string, unknown>> = { key: 'settings', version: 1, schema: z.record(z.unknown()), defaultValue: () => ({}) }

function boot(now = 1_700_000_000_000, platform = createMemoryPlatform({ now })) {
  return { platform, ...createEngine({ platform, heads, kdf: FAST }) }
}

describe('auto-lock', () => {
  it('a touch inside the debounce window keeps the deadline; outside it moves the deadline; never cancels it', async () => {
    const { engine, platform, ready } = boot()
    await ready
    await engine.vault.import({ mnemonic: PHRASE, password: 'correct horse' })
    const t0 = platform.now()
    expect((await engine.vault.status()).lockAt).toBe(t0 + 900_000)
    await platform.clock.advance(10_000)
    expect((await engine.vault.touch()).lockAt).toBe(t0 + 900_000)
    await platform.clock.advance(25_000)
    expect((await engine.vault.touch()).lockAt).toBe(platform.now() + 900_000)
    await engine.vault.setAutoLock({ autoLock: 'never' })
    expect((await engine.vault.status()).lockAt).toBeNull()
    await platform.clock.advance(3 * 3_600_000)
    expect((await engine.vault.status()).unlocked).toBe(true)
    await engine.vault.setAutoLock({ autoLock: '5min' })
    expect((await engine.vault.status()).lockAt).toBe(platform.now() + 300_000)
    await platform.clock.advance(301_000)
    expect((await engine.vault.status()).unlocked).toBe(false)
  })

  it('migrates a v1 settings document: autoLock one notch up, the old chain default collapses, reducedMotion is re-derived', async () => {
    const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
    await writeDoc(platform.storage.local, V1_DOC, { ...DEFAULT_SETTINGS, autoLock: '30min', enabledChains: [1, 56, 8453, 42161, 10, 137, 43114], reducedMotion: true })
    const { engine, ready } = boot(1_700_000_000_000, platform)
    await ready
    const s = await engine.settings.get()
    expect(s.autoLock).toBe('60min')
    expect(s.enabledChains).toEqual([1, 56, 8453])
    expect(s.reducedMotion).toBe(false)
  })

  it('a v1 document with a custom chain set keeps it, and "immediately" becomes 5 minutes', async () => {
    const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
    await writeDoc(platform.storage.local, V1_DOC, { ...DEFAULT_SETTINGS, autoLock: 'immediately', enabledChains: [1, 42161] })
    const { engine, ready } = boot(1_700_000_000_000, platform)
    await ready
    const s = await engine.settings.get()
    expect(s.autoLock).toBe('5min')
    expect(s.enabledChains).toEqual([1, 42161])
  })
})
