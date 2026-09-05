/**
 * M7 definition of done (master plan §11): live balances on Ethereum, Base
 * and BNB through the registry's public RPCs, for a watch-only address that
 * is never empty. Skipped with SKIP_LIVE=1 (offline CI); no key, no prod
 * infrastructure — public RPCs only, and only a public address leaves here.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, resetMulticallCache, type Engine } from '../src'

const SKIP = process.env['SKIP_LIVE'] === '1'
const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
/** vitalik.eth — holds native on every major chain. */
const WATCH = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

describe.skipIf(SKIP)('balances off Electroneum (live)', () => {
  let engine: Engine
  let accountId: string

  beforeAll(async () => {
    resetMulticallCache()
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, electroswapUrl: null, pricesUrl: null })
    await engine.ready
    await engine.engine.vault.create({ password: PASSWORD })
    const watch = await engine.engine.accounts.addWatch({ address: WATCH, label: 'vitalik' })
    accountId = watch.id
  }, 60_000)

  afterAll(() => engine.dispose())

  it('reads native balances on Ethereum, Base and BNB through public RPCs and multicall3', async () => {
    const snap = await engine.engine.portfolio.refresh({ accountId, chainIds: [1, 8453, 56] })
    expect(snap.chainIds).toEqual([1, 8453, 56])
    for (const chainId of [1, 8453, 56]) {
      const native = snap.rows.find((r) => r.chainId === chainId && r.address === 'native')
      expect(native, `native row on ${chainId}`).toBeTruthy()
      expect(BigInt(native?.raw ?? '0')).toBeGreaterThan(0n)
    }
    expect(snap.stale).toBe(false)
  }, 90_000)

  it('resolves a .eth name from a Base recipient field through Ethereum', async () => {
    const r = await engine.engine.names.resolve({ chainId: 8453, name: 'vitalik.eth' })
    expect(r.address?.toLowerCase()).toBe(WATCH.toLowerCase())
  }, 30_000)
})
