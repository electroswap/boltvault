/**
 * What a feed row says (ES-BV-034).
 *
 * The API answers in whole units and the wallet converts to raw at the
 * boundary, which is right — but the conversion was one-way, so Activity then
 * printed the raw integer and a row read "Received 5000000000000000000 ETN".
 * The symbol and the counterparty come from the same remote answer and reached
 * the screen without the sanitiser the firewall's statements use.
 */
import type { FeedRow } from '@boltvault/electroswap'
import { describe, expect, it } from 'vitest'
import { entryOf } from '../src/namespaces/activityFeed'

const base = {
  id: 'a1',
  hash: `0x${'11'.repeat(32)}`,
  blockNumber: 100,
  timestamp: 1_757_000_000,
  type: 'RECEIVE',
  status: 'CONFIRMED' as const,
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
}

const row = (change: Partial<FeedRow['changes'][number]>): FeedRow => ({
  ...base,
  changes: [
    {
      standard: 'NATIVE',
      address: null,
      symbol: 'ETN',
      tokenId: null,
      sender: '0x1111111111111111111111111111111111111111',
      recipient: null,
      amountRaw: '5000000000000000000',
      decimals: 18,
      direction: 'IN',
      ...change,
    },
  ],
})

describe('a feed row in words', () => {
  it('prints the amount in the units a person uses', () => {
    expect(entryOf(row({}), 52014, 'acct').statements[0]).toBe(
      'Received 5 ETN from 0x1111111111111111111111111111111111111111',
    )
  })

  it('trims the zeros a conversion adds, and keeps real precision', () => {
    expect(entryOf(row({ amountRaw: '1500000', decimals: 6, symbol: 'USDC' }), 52014, 'acct').statements[0]).toContain('1.5 USDC')
    expect(entryOf(row({ amountRaw: '1', decimals: 6, symbol: 'USDC' }), 52014, 'acct').statements[0]).toContain('0.000001 USDC')
  })

  it('falls back to the raw figure only when the API did not say how many places', () => {
    expect(entryOf(row({ decimals: null }), 52014, 'acct').statements[0]).toContain('5000000000000000000 ETN')
  })

  it('strips characters that would reorder the sentence around them', () => {
    const hostile = entryOf(row({ symbol: 'ET‮N', sender: 'Al​ice' }), 52014, 'acct').statements[0]
    expect(hostile).not.toMatch(/[‮​]/u)
    expect(hostile).toBe('Received 5 ETN from Alice')
  })

  it('says what moved out, to whom', () => {
    const out = entryOf(row({ direction: 'OUT', recipient: '0x3333333333333333333333333333333333333333' }), 52014, 'acct')
    expect(out.statements[0]).toBe('Sent 5 ETN to 0x3333333333333333333333333333333333333333')
  })
})
