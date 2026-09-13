/**
 * One token's trade feed (§8.3 › Transactions).
 *
 * Two properties carry the whole feature. ORIENTATION is positional — the API
 * sends `token0` sold and `token1` bought and no direction field — so the same
 * row read against two different subjects must come out Buy one way and Sell
 * the other, with the amounts swapping to match. And an unreadable BODY must
 * throw rather than become an empty list, because "nobody trades this" and "we
 * could not ask" are different sentences and the screen says different things.
 */
import { describe, expect, it } from 'vitest'
import { ElectroSwapClient, fetchTokenTransactions } from '../src'

const BOLT = '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1'
const USDC = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e'
const TRADER = '0x4e420Ec6B6303817Bf6fC3f4485473AA83Ce7A72'
const HASH = `0x${'a1'.repeat(32)}`
const ETN = 52014

function clientWith(answer: (variables: Record<string, unknown>) => unknown): ElectroSwapClient {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { variables: Record<string, unknown> }
    return new Response(JSON.stringify({ data: answer(body.variables) }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new ElectroSwapClient({ fetchImpl })
}

/** BOLT sold for USDC: BOLT is `token0`, so a BOLT page must read this as a Sell. */
const row = (over: Record<string, unknown> = {}) => ({
  hash: HASH,
  timestamp: 1_789_325_184,
  account: TRADER,
  ensName: null,
  token0: { address: BOLT, symbol: 'BOLT' },
  token1: { address: USDC, symbol: 'USDC' },
  token0Quantity: '4788.176787801483820858',
  token1Quantity: '745.614583294848584673',
  usdValue: { value: 909.75 },
  usdPrice: { value: 0.19 },
  ...over,
})

const page = (rows: unknown[], cursor: number | null = null) => ({ transactions: { cursor, transactions: rows } })

describe('fetchTokenTransactions', () => {
  it('reads the subject as token0 as a sell, and keeps the subject side as the subject', async () => {
    const client = clientWith(() => page([row()]))
    const { rows } = await fetchTokenTransactions(client, ETN, BOLT)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.direction).toBe('sell')
    expect(rows[0]?.subjectSymbol).toBe('BOLT')
    expect(rows[0]?.subjectAmount).toBe('4788.176787801483820858')
    expect(rows[0]?.counterSymbol).toBe('USDC')
    expect(rows[0]?.counterAmount).toBe('745.614583294848584673')
  })

  it('reads the SAME row as a buy when the subject is the other side, swapping the amounts with it', async () => {
    const client = clientWith(() => page([row()]))
    const { rows } = await fetchTokenTransactions(client, ETN, USDC)
    expect(rows[0]?.direction).toBe('buy')
    expect(rows[0]?.subjectSymbol).toBe('USDC')
    expect(rows[0]?.subjectAmount).toBe('745.614583294848584673')
    expect(rows[0]?.counterSymbol).toBe('BOLT')
    expect(rows[0]?.counterAmount).toBe('4788.176787801483820858')
  })

  it('matches the subject case-insensitively — a route param is checksummed and the API row need not be', async () => {
    const client = clientWith(() => page([row({ token0: { address: BOLT.toLowerCase(), symbol: 'BOLT' } })]))
    const { rows } = await fetchTokenTransactions(client, ETN, BOLT.toUpperCase())
    expect(rows).toHaveLength(1)
    expect(rows[0]?.direction).toBe('sell')
  })

  it('carries the amounts through as strings, digit for digit, never via Number', async () => {
    const client = clientWith(() => page([row()]))
    const { rows } = await fetchTokenTransactions(client, ETN, BOLT)
    // The eighteenth decimal survives, which it would not through a float.
    expect(rows[0]?.subjectAmount).toBe('4788.176787801483820858')
    expect(String(Number(rows[0]?.subjectAmount))).not.toBe(rows[0]?.subjectAmount)
  })

  it('takes the `.etn` name from the same payload, with no second lookup', async () => {
    const client = clientWith(() => page([row({ ensName: 'og2017.etn' })]))
    const { rows } = await fetchTokenTransactions(client, ETN, BOLT)
    expect(rows[0]?.accountName).toBe('og2017.etn')
    const plain = await fetchTokenTransactions(clientWith(() => page([row()])), ETN, BOLT)
    expect(plain.rows[0]?.accountName).toBeNull()
  })

  it('drops a row belonging to neither side rather than guessing a direction', async () => {
    const other = row({ token0: { address: USDC, symbol: 'USDC' }, token1: { address: TRADER, symbol: 'XYZ' } })
    const client = clientWith(() => page([other, row()]))
    const { rows } = await fetchTokenTransactions(client, ETN, BOLT)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.direction).toBe('sell')
  })

  it('drops an unreadable row without taking the page down with it', async () => {
    const client = clientWith(() => page([null, row({ hash: null }), row({ token0Quantity: null }), row()]))
    const { rows } = await fetchTokenTransactions(client, ETN, BOLT)
    expect(rows).toHaveLength(1)
  })

  it('sends the subject, the chain enum and the SWAP filter, and no cursor on the first page', async () => {
    let seen: Record<string, unknown> = {}
    const client = clientWith((v) => {
      seen = v
      return page([])
    })
    await fetchTokenTransactions(client, ETN, BOLT)
    expect(seen['address']).toBe(BOLT)
    expect(seen['chain']).toBe('ELECTRONEUM')
    expect(seen['typeFilter']).toEqual(['SWAP'])
    expect(seen['blockCursor']).toBeNull()
    // Meaningless without a cursor, so it is not sent as a direction either.
    expect(seen['transactionSearch']).toBeNull()
  })

  it('walks backwards from a cursor when given one', async () => {
    let seen: Record<string, unknown> = {}
    const client = clientWith((v) => {
      seen = v
      return page([], 15_760_142)
    })
    const out = await fetchTokenTransactions(client, ETN, BOLT, 15_824_911)
    expect(seen['blockCursor']).toBe(15_824_911)
    expect(seen['transactionSearch']).toBe('BEFORE')
    expect(out.cursor).toBe(15_760_142)
  })

  it('reads a token with no pool as an empty page, not as a failure', async () => {
    const client = clientWith(() => ({ transactions: null }))
    await expect(fetchTokenTransactions(client, ETN, BOLT)).resolves.toEqual({ rows: [], cursor: null })
  })

  it('THROWS on a body it cannot read, rather than passing an empty list off as an answer', async () => {
    const client = clientWith(() => ({ transactions: { transactions: 'not a list' } }))
    await expect(fetchTokenTransactions(client, ETN, BOLT)).rejects.toThrow()
  })

  it('throws when the API reports an error', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    const client = new ElectroSwapClient({ fetchImpl })
    await expect(fetchTokenTransactions(client, ETN, BOLT)).rejects.toThrow(/boom/)
  })
})
