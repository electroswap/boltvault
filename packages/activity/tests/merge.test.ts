import { describe, expect, it } from 'vitest'
import { mergeActivity, decodeReceipt, txExplorerUrl, type EnrichedTx } from '../src'
import type { HistoryEntry } from '@boltvault/core'

const H1 = '0x' + '11'.repeat(32)
const H2 = '0x' + '22'.repeat(32)
const H3 = '0x' + '33'.repeat(32)
const ACC = 'acc-0'
const TO = '0x' + 'aa'.repeat(20)
const FROM = '0x' + 'bb'.repeat(20)
const UR = '0x' + 'cc'.repeat(20)

function localEntry(hash: string, over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    hash,
    chainId: 52014,
    account: ACC,
    to: TO,
    data: '0x',
    value: '0',
    nonce: 1,
    submittedAt: 1_000_000,
    category: 'SWAP',
    ...over,
  }
}

function en(hash: string, over: Partial<EnrichedTx> = {}): EnrichedTx {
  return {
    hash,
    chainId: 52014,
    from: FROM,
    to: TO,
    value: '1000',
    blockNumber: 12345,
    status: 'confirmed',
    timestamp: 2_000_000,
    symbol: 'USDC',
    ...over,
  }
}

describe('mergeActivity (T6.1, merge-by-hash local-wins)', () => {
  it('local entry wins; enrichment fills missing block/status/symbol', () => {
    const rows = mergeActivity([localEntry(H1, { status: undefined, blockNumber: undefined, to: undefined })], [en(H1)])
    expect(rows).toHaveLength(1)
    const r = rows[0]!
    expect(r.local).toBe(true)
    expect(r.category).toBe('SWAP')
    expect(r.account).toBe(ACC)
    // enrichment filled the missing pieces
    expect(r.blockNumber).toBe(12345)
    expect(r.status).toBe('confirmed')
    expect(r.symbol).toBe('USDC')
    expect(r.enriched).toBe(true)
  })

  it('local fields are NOT overwritten by enrichment (local-wins)', () => {
    const local = localEntry(H1, { to: '0x' + 'dd'.repeat(20), blockNumber: 999, status: 'confirmed' })
    const rows = mergeActivity([local], [en(H1, { to: TO, blockNumber: 12345 })])
    const r = rows[0]!
    // local to + block survive
    expect(r.to).toBe('0x' + 'dd'.repeat(20))
    expect(r.blockNumber).toBe(999)
    expect(r.enriched).toBe(false) // nothing missing to fill
  })

  it('enrichment-only txs surface as enriched rows with the fallback category', () => {
    const rows = mergeActivity([], [en(H2)])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.local).toBe(false)
    expect(rows[0]!.enriched).toBe(true)
    expect(rows[0]!.category).toBe('RECEIVE')
  })

  it('no duplicates when the same hash is both local and enriched', () => {
    const rows = mergeActivity([localEntry(H1)], [en(H1)])
    expect(rows).toHaveLength(1)
  })

  it('sorts newest-first by timestamp then block', () => {
    const rows = mergeActivity(
      [],
      [
        en(H1, { timestamp: 1_000, blockNumber: 10 }),
        en(H2, { timestamp: 5_000, blockNumber: 90 }),
        en(H3, { timestamp: 3_000, blockNumber: 50 }),
      ],
    )
    const hashes = rows.map((r) => r.hash)
    expect(hashes).toEqual([H2, H3, H1])
  })

  it('returns empty for no inputs', () => {
    expect(mergeActivity([], [])).toEqual([])
  })
})

describe('decodeReceipt (T6.1)', () => {
  const addrs = { universalRouter: UR, seaport15: '0x' + 'ee'.repeat(20), yieldFarm: '0x' + 'ff'.repeat(20) }

  it('recognizes the Universal Router as a swap', () => {
    const d = decodeReceipt({ to: UR, data: '0xdeadbeef', valueWei: '0' }, addrs, { tokenIn: 'ETN', tokenOut: 'USDC' })
    expect(d.kind).toBe('swap')
    expect(d.summary).toContain('ETN')
  })

  it('recognizes Seaport + farm by address', () => {
    expect(decodeReceipt({ to: '0x' + 'ee'.repeat(20), data: '0x', valueWei: '0' }, addrs, {}).kind).toBe('seaport')
    expect(decodeReceipt({ to: '0x' + 'ff'.repeat(20), data: '0x', valueWei: '0' }, addrs, {}).kind).toBe('farm')
  })

  it('classifies approve/transfer selectors and plain sends', () => {
    expect(decodeReceipt({ to: FROM, data: '0x095ea7b3', valueWei: '0' }, addrs, {}).kind).toBe('approve')
    expect(decodeReceipt({ to: FROM, data: '0xa9059cbb', valueWei: '0' }, addrs, {}).kind).toBe('send')
    expect(decodeReceipt({ to: FROM, data: '0x', valueWei: '5' }, addrs, {}).kind).toBe('send')
    expect(decodeReceipt({ to: FROM, data: '0x', valueWei: '0' }, addrs, {}).kind).toBe('unknown')
  })
})

describe('explorer links', () => {
  it('builds a tx explorer url', () => {
    expect(txExplorerUrl(H1)).toBe(`https://explorer.electroneum.com/tx/${H1}`)
  })
})
