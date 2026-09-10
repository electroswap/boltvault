/**
 * The holder tier, from `fees.json` and the chain's balances.
 *
 * There is no schedule contract any more, so there is no degraded path and no
 * "the contract said otherwise": the ladder is in the binary and the only thing
 * read from the chain is what this account holds. A 3M-BOLT holder is a
 * Reactor, and says so at sign time with no network in the way.
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
    /*
      The service's own `fresh` flag, not `configure`.

      This used to lean on `configure({ sink: null, schedule: null })` for the
      side effect of clearing the per-block tier cache. Now that mainnet's
      addresses are pinned in the build, `configure` refuses outright — which is
      the point of it, no runtime message may move the fee — so the clear never
      happened and every case after the first read the first one's cached tier.
      Asking for a fresh read says what the test means anyway.
    */
    return engine.holder.tier(accountId, ETN, true)
  }

  it('an empty wallet is tier 0 at the base fee, with the first tier ahead of it', async () => {
    const tier = await fresh()
    expect(tier).toMatchObject({ tier: 0, name: 'Static', bips: 50, source: 'config', nextTierBips: 40, nextTierName: 'Charge' })
    expect(tier.nextTierAt).toBe((13_600n * 10n ** 18n).toString())
  })

  it('3M BOLT in the wallet is the top rung, Reactor, at the lowest fee', async () => {
    bolt = 3_074_077n * 10n ** 18n
    const tier = await fresh()
    expect(tier).toMatchObject({ tier: 4, name: 'Reactor', bips: 10, source: 'config', nextTierAt: null, nextTierBips: null, nextTierName: null })
    expect(tier.score).toBe(bolt.toString())
    expect(tier.breakdown).toEqual({ wallet: bolt.toString(), farm: '0', dyno: '0' })
  })

  it('DYNO counts at the published weight and moves the tier', async () => {
    bolt = 0n
    dyno = 200n * 10n ** 18n // 200 × 875.68 = 175,136 BOLT-eq → Magneto
    const tier = await fresh()
    expect(tier).toMatchObject({ tier: 2, name: 'Magneto', bips: 30, source: 'config', nextTierBips: 20, nextTierName: 'Turbine' })
    expect(BigInt(tier.breakdown.dyno)).toBe(175_136n * 10n ** 18n)
  })
})
