/**
 * Reverse names, the two properties that make them safe to print (§8.1, §3.6).
 *
 * A name is the one piece of a screen that a stranger writes: it is read off
 * their resolver and then shown in the slot an address occupies, on Home's
 * seat, in the accounts rail, in an activity row, and inside the statements the
 * approval sheet makes. So two things are pinned here and nothing else matters
 * as much:
 *
 *  1. what `displayName` refuses. A name that reads as an address, a name long
 *     enough to be clipped into something else, a name carrying bidi overrides
 *     — none of those reach a screen, and the shortened address stands instead.
 *  2. that a name is asked for once. The popup is a page that dies on every
 *     close, so the in-memory map alone meant a resolver round trip per address
 *     per open; the sealed document cache is what makes a reopened popup free,
 *     and a second service over the same cache is exactly what a reopened popup
 *     is.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { describe, expect, it } from 'vitest'
import { CacheShards, DocCache } from '../src/cache'
import { EventBus } from '../src/host'
import { NamesService, displayName, type NamesDeps } from '../src/namespaces/names'
import type { ChainsService } from '../src/namespaces/chains'
import type { ProviderService } from '../src/namespaces/provider'
import type { VaultManager } from '../src/namespaces/vault'

const ETN = 52014
const TESTNET = 5201420
const ADDRESS = '0x1F90fA8c1c3d6a0d8A5E0A1bF7b3E4C5d6E7f8A9'

describe('displayName', () => {
  it('passes an ordinary name through, lowercased', () => {
    expect(displayName(ETN, 'bolt.etn')).toBe('bolt.etn')
    expect(displayName(ETN, '  Bolt.ETN  ')).toBe('bolt.etn')
    expect(displayName(1, 'vitalik.eth')).toBe('vitalik.eth')
  })

  it('refuses a name that reads as an address', () => {
    // `0xYou…` in the slot `0x1F90…7B63` occupies is the whole impersonation
    // the short form invites; there is nothing to salvage from it.
    expect(displayName(ETN, '0xyou.etn')).toBeNull()
    expect(displayName(ETN, '0X1f90fa8c.etn')).toBeNull()
  })

  it('refuses a name long enough to be clipped, rather than showing the clipping', () => {
    const long = `${'a'.repeat(64)}.etn`
    expect(displayName(ETN, long)).toBeNull()
    // Thirty-two characters including the suffix still fits and is still a name.
    expect(displayName(ETN, `${'a'.repeat(28)}.etn`)).toBe(`${'a'.repeat(28)}.etn`)
  })

  /*
    ES-BV-036. Stripping the character and showing what is left was the wrong
    answer: the name that reaches the screen would then be a different string
    from the one the resolver holds and every other client shows, which is its
    own impersonation. ENSIP-15 says such a name is not a name; it is refused,
    and the address stands instead.
  */
  it('refuses a name that is not in its own normal form, rather than rewriting it', () => {
    // A right-to-left override before the suffix reverses what the reader sees.
    expect(displayName(ETN, 'bo‮lt.etn')).toBeNull()
    expect(displayName(ETN, '​​')).toBeNull()
    expect(displayName(ETN, 'BOLT.etn')).toBe('bolt.etn')
  })

  it('refuses a name that does not end in the suffix it resolved on', () => {
    expect(displayName(ETN, 'bolt.eth')).toBeNull()
    expect(displayName(ETN, 'bolt')).toBeNull()
    expect(displayName(ETN, null)).toBeNull()
  })

  it('leaves a chain with no suffix of its own alone, bar the same bounds', () => {
    expect(displayName(999, 'anything')).toBe('anything')
    expect(displayName(999, '0xdead')).toBeNull()
  })
})

/**
 * `forward` is what the name resolves back to: `'self'` for the address that
 * claimed it, an address for somebody else's, or null for no forward record.
 * A reverse record is set by whoever owns the address, so it is only worth
 * printing once the name agrees (ES-BV-036).
 */
function boot(answer: string | null, now = 1_700_000_000_000, forward: 'self' | string | null = 'self') {
  const platform = createMemoryPlatform({ now })
  const bus = new EventBus()
  const shards = new CacheShards(platform, async () => new Uint8Array(32).fill(7))
  const cache = new DocCache(shards, bus, () => platform.now())
  const calls: string[] = []
  const chains = {
    client: async () => ({
      getEnsName: async ({ address }: { address: string }) => {
        calls.push(address)
        return answer
      },
      getEnsAddress: async () => (forward === 'self' ? ADDRESS : forward),
    }),
  } as unknown as ChainsService
  const deps: NamesDeps = {
    platform,
    chains,
    cache,
    vault: {} as unknown as VaultManager,
    provider: {} as unknown as ProviderService,
  }
  return { deps, cache, calls, platform }
}

describe('names.lookup', () => {
  it('asks the resolver once, then answers from the session map', async () => {
    const { deps, calls } = boot('bolt.etn')
    const names = new NamesService(deps)
    expect(await names.lookup(ETN, [ADDRESS])).toEqual([{ address: ADDRESS, name: 'bolt.etn', verified: true }])
    expect(await names.lookup(ETN, [ADDRESS])).toEqual([{ address: ADDRESS, name: 'bolt.etn', verified: true }])
    expect(calls).toHaveLength(1)
  })

  it('answers a reopened popup from the sealed cache without asking the chain at all', async () => {
    const { deps, calls } = boot('bolt.etn')
    await new NamesService(deps).lookup(ETN, [ADDRESS])
    expect(calls).toHaveLength(1)
    // A second service over the same cache is what the next popup open is: a
    // fresh process, the same disk.
    const reopened = new NamesService(deps)
    expect(await reopened.lookup(ETN, [ADDRESS])).toEqual([{ address: ADDRESS, name: 'bolt.etn', verified: true }])
    expect(calls).toHaveLength(1)
  })

  it('will not call a name verified when it resolves forward to somebody else', async () => {
    // The attack: point your own address's reverse record at a name you do not
    // own, and the wallet prints it in the slot the address occupies.
    const stranger = boot('bolt.etn', 1_700_000_000_000, '0x9999999999999999999999999999999999999999')
    expect(await new NamesService(stranger.deps).lookup(ETN, [ADDRESS])).toEqual([{ address: ADDRESS, name: 'bolt.etn', verified: false }])
    const missing = boot('bolt.etn', 1_700_000_000_000, null)
    expect(await new NamesService(missing.deps).lookup(ETN, [ADDRESS])).toEqual([{ address: ADDRESS, name: 'bolt.etn', verified: false }])
  })

  it('sanitises what the resolver says, and an unsafe name is simply no name', async () => {
    const { deps } = boot('0xyou.etn')
    expect(await new NamesService(deps).lookup(ETN, [ADDRESS])).toEqual([{ address: ADDRESS, name: null, verified: false }])
  })

  it('answers a chain with no resolver without building a client', async () => {
    const { deps, calls } = boot('bolt.etn')
    expect(await new NamesService(deps).lookup(TESTNET, [ADDRESS])).toEqual([{ address: ADDRESS, name: null, verified: false }])
    expect(calls).toEqual([])
  })
})
