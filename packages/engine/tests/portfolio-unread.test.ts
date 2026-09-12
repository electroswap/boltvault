/**
 * A balance the wallet could not read is not a balance of zero (ES-BV-045).
 *
 * Multicall and single-call failures used to be omitted from the balance map,
 * the row builder read `?? 0n`, and the snapshot was persisted with
 * `stale: false` — so during an endpoint outage Home said "$0.00 · Add funds
 * to get started" and the last good snapshot was replaced by the zeros. The
 * user checking whether a deposit landed was told, confidently, that it had
 * not.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { encodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, resetMulticallCache, CANONICAL_MULTICALL3, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])

describe('a portfolio built while the endpoint is down', () => {
  let rpc: MockRpc
  let engine: Engine
  let accountId: string
  let address: string

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: TESTNET })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    rpc.state.calls.set(CANONICAL_MULTICALL3.toLowerCase(), () => u(0n))
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, electroswapUrl: null, pricesUrl: null, staticsUrl: null })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    accountId = created.accounts[0]?.id ?? ''
    address = created.accounts[0]?.address ?? ''
    await engine.chains.setRpc(TESTNET, rpc.url)
    rpc.state.balances.set(address.toLowerCase(), 5n * 10n ** 18n)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('keeps the last good snapshot, marks the build stale and never claims a zero', async () => {
    const good = await engine.engine.portfolio.refresh({ accountId, chainIds: [TESTNET] })
    expect(good.stale).toBe(false)
    expect(good.errors).toBeUndefined()
    const nativeBefore = good.rows.find((r) => r.address === 'native')
    expect(BigInt(nativeBefore?.raw ?? '0')).toBe(5n * 10n ** 18n)

    // The endpoint starts answering 500, the way a rate-limited one does.
    rpc.fail({ times: 50, status: 500 })
    const outage = await engine.engine.portfolio.refresh({ accountId, chainIds: [TESTNET] })
    // It says which chain it could not read, and it is not a fresh answer.
    expect(outage.stale).toBe(true)
    expect(outage.errors?.[0]).toMatchObject({ chainId: TESTNET })
    const nativeDuring = outage.rows.find((r) => r.address === 'native')
    expect(nativeDuring?.unread).toBe(true)
    // The figure carried forward is the last one seen, never an invented zero,
    // and it states no value.
    expect(BigInt(nativeDuring?.raw ?? '0')).toBe(5n * 10n ** 18n)
    expect(nativeDuring?.fiat).toBe(null)

    // And the stored snapshot is untouched: the complete figure survives.
    const stored = await engine.engine.portfolio.snapshot({ accountId, chainIds: [TESTNET] })
    expect(stored.errors).toBeUndefined()
    expect(BigInt(stored.rows.find((r) => r.address === 'native')?.raw ?? '0')).toBe(5n * 10n ** 18n)
  })
})
