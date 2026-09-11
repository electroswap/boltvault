/**
 * The portfolio history series (master plan §8.2 "History chart").
 *
 * Home showed a total and one "since you last looked" comparison because the
 * portfolio kept exactly one earlier point. The snapshot now carries a series
 * of the totals this wallet has actually seen — and the two things that must
 * be true of it are that it is bounded (it lives in a sealed blob that is
 * rewritten on every refresh) and that it is per scope (a total for "All
 * chains" is not a total for Electroneum, and one line cannot be both).
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { encodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendPoint } from '../src/namespaces/portfolio'
import { createEngine, resetMulticallCache, CANONICAL_MULTICALL3, type Engine, type PortfolioPoint } from '../src'

const HOUR = 3_600_000
const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420
const OTHER = 52014
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])

describe('appendPoint', () => {
  it('keeps one reading per hour, and the newest wins inside the hour', () => {
    let s: PortfolioPoint[] = []
    s = appendPoint(s, 0, 100)
    s = appendPoint(s, 60_000, 110)
    s = appendPoint(s, 120_000, 120)
    // The wallet rebuilds every few seconds; a point per rebuild would be a
    // log of repaints, and every one of them is paid for again on each write.
    expect(s).toEqual([{ at: 120_000, total: 120 }])
    s = appendPoint(s, HOUR + 1, 130)
    expect(s.map((p) => p.total)).toEqual([120, 130])
  })

  it('ends on the latest reading, so the line never lags the total above it', () => {
    let s: PortfolioPoint[] = []
    for (let i = 0; i < 5; i++) s = appendPoint(s, i * HOUR, i)
    s = appendPoint(s, 4 * HOUR + 30_000, 99)
    expect(s[s.length - 1]).toEqual({ at: 4 * HOUR + 30_000, total: 99 })
  })

  it('is bounded: a wallet left open for a month does not grow it without end', () => {
    let s: PortfolioPoint[] = []
    for (let i = 0; i < 1_000; i++) s = appendPoint(s, i * HOUR, i)
    expect(s.length).toBe(120)
    // The oldest go, not the newest.
    expect(s[s.length - 1]?.total).toBe(999)
    expect(s[0]?.total).toBe(880)
  })

  it('records an unpriced moment as unpriced rather than as zero', () => {
    // A moment when no price source answered is not a moment the portfolio was
    // worth nothing, and the chart must never be able to draw it as a cliff.
    const s = appendPoint([], 0, null)
    expect(s).toEqual([{ at: 0, total: null }])
  })
})

describe('the series on the snapshot', () => {
  let rpc: MockRpc
  let engine: Engine
  let accountId: string

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: TESTNET })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    rpc.state.calls.set(CANONICAL_MULTICALL3.toLowerCase(), () => u(0n))
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, electroswapUrl: null })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    accountId = created.accounts[0]?.id ?? ''
    await engine.chains.setRpc(TESTNET, rpc.url)
    rpc.state.balances.set((created.accounts[0]?.address ?? '').toLowerCase(), 5n * 10n ** 18n)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('a refresh leaves a reading behind, and the snapshot carries it', async () => {
    const fresh = await engine.engine.portfolio.refresh({ accountId, chainIds: [TESTNET] })
    expect(fresh.history).toHaveLength(1)
    expect(fresh.history?.[0]?.at).toBe(fresh.observedAt)
    const again = await engine.engine.portfolio.snapshot({ accountId, chainIds: [TESTNET] })
    expect(again.history).toHaveLength(1)
  })

  it('belongs to the scope it was read for, never to another', async () => {
    // "All chains" and one chain are different questions; one line cannot
    // answer both, which is the same reason the snapshot itself is keyed by
    // the chains it was built from.
    const unseen = await engine.engine.portfolio.snapshot({ accountId, chainIds: [OTHER] })
    expect(unseen.history).toEqual([])
  })
})
