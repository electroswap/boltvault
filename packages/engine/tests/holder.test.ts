/**
 * The holder tier without a schedule contract (owner's walk, 2026-09-05):
 * the published schedule is applied to what the chain does show — wallet
 * BOLT and DYNO — so a 3M-BOLT holder reads as the top tier, not tier 0.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { encodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, resetMulticallCache, CANONICAL_MULTICALL3, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const ETN = 52014
const BOLT = ELECTRONEUM_ADDRESSES[ETN].bolt as Hex
const DYNO = ELECTRONEUM_ADDRESSES[ETN].dyno as Hex
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])

describe('holder tier on the published schedule', () => {
  let rpc: MockRpc
  let engine: Engine
  let accountId: string
  let bolt = 0n
  let dyno = 0n

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: ETN })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    for (const a of [BOLT, DYNO]) rpc.state.code.set(a.toLowerCase(), '0x6080')
    rpc.state.calls.set(BOLT.toLowerCase(), ({ data }) => (data.slice(0, 10) === '0x70a08231' ? u(bolt) : '0x'))
    rpc.state.calls.set(DYNO.toLowerCase(), ({ data }) => (data.slice(0, 10) === '0x70a08231' ? u(dyno) : '0x'))
    const fetchImpl: typeof fetch = async () => new Response('not found', { status: 404 })
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, fetch: fetchImpl, electroswapUrl: null })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    accountId = created.accounts[0]?.id ?? ''
    await engine.chains.setRpc(ETN, rpc.url)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  const fresh = async (): Promise<Awaited<ReturnType<Engine['engine']['holder']['tier']>>> => {
    // `configure` with nothing clears the per-block tier cache without pinning anything.
    await engine.engine.holder.configure({ chainId: ETN, sink: null, schedule: null }).catch(() => undefined)
    return engine.engine.holder.tier({ accountId, chainId: ETN })
  }

  it('an empty wallet is tier 0 at the base fee, with the first tier ahead of it', async () => {
    const tier = await fresh()
    expect(tier).toMatchObject({ tier: 0, bips: 50, source: 'fallback', nextTierBips: 40 })
    expect(tier.nextTierAt).toBe((13_600n * 10n ** 18n).toString())
  })

  it('3M BOLT in the wallet is the top tier at the lowest fee', async () => {
    bolt = 3_074_077n * 10n ** 18n
    const tier = await fresh()
    expect(tier).toMatchObject({ tier: 4, bips: 10, source: 'fallback', nextTierAt: null, nextTierBips: null })
    expect(tier.score).toBe(bolt.toString())
    expect(tier.breakdown).toEqual({ wallet: bolt.toString(), farm: '0', dyno: '0' })
  })

  it('DYNO counts at the published weight and moves the tier', async () => {
    bolt = 0n
    dyno = 200n * 10n ** 18n // 200 × 875.68 = 175,136 BOLT-eq → tier 2
    const tier = await fresh()
    expect(tier).toMatchObject({ tier: 2, bips: 30, source: 'fallback', nextTierBips: 20 })
    expect(BigInt(tier.breakdown.dyno)).toBe(175_136n * 10n ** 18n)
  })
})
