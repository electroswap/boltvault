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

  /*
    This used to assert the opposite — that a change with no decimals printed
    the raw figure — and that assertion was the bug, held in place. A beta
    tester found it from the other end: "Transactions are showing in the 'Your
    activity' section of the token details formatted in wei."

    "5000000000000000000 ETN" is not a rough version of five ETN. It is a
    different number, and a row that states an amount is read as stating that
    amount. Dropping the figure loses information; printing that one asserts
    something false.
  */
  it('says no amount at all when the API did not say how many places', () => {
    const line = entryOf(row({ decimals: null }), 52014, 'acct').statements[0]
    // The counterparty address is forty hex characters, so the raw figure is
    // what to look for rather than "a long run of digits".
    expect(line).not.toContain('5000000000000000000')
    expect(line).toBe('Received ETN from 0x1111111111111111111111111111111111111111')
  })

  it('says nothing false when there is neither a scale nor a symbol', () => {
    const line = entryOf(row({ decimals: null, symbol: null }), 52014, 'acct').statements[0]
    expect(line).not.toContain('5000000000000000000')
    expect(line).toContain('an asset')
  })

  it('still prints the figure whenever the scale is known, including zero places', () => {
    // `decimals: 0` is a real answer, not a missing one — the guard must test
    // for null rather than for falsiness.
    expect(entryOf(row({ amountRaw: '42', decimals: 0, symbol: 'TICK' }), 52014, 'acct').statements[0]).toContain('42 TICK')
  })

  it('strips characters that would reorder the sentence around them', () => {
    const hostile = entryOf(row({ symbol: 'ET\u202eN', sender: 'Al\u200bice' }), 52014, 'acct').statements[0]
    expect(hostile).not.toMatch(/[\u202e\u200b]/u)
    expect(hostile).toBe('Received 5 ETN from Alice')
  })

  it('says what moved out, to whom', () => {
    const out = entryOf(row({ direction: 'OUT', recipient: '0x3333333333333333333333333333333333333333' }), 52014, 'acct')
    expect(out.statements[0]).toBe('Sent 5 ETN to 0x3333333333333333333333333333333333333333')
  })
})
