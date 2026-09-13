/**
 * Token details › Transactions, through the engine (§8.3).
 *
 * The owner's requirement is one sentence with two halves, and both are pinned
 * here: the tab is not fetched until it is asked for, and a token nobody has
 * traded must not look like an API we could not reach. Those are `rows: []`
 * and `null` respectively, and the screen says something different for each.
 *
 * There is deliberately no on-chain fallback to test: when the API cannot
 * answer, the answer is that we cannot answer.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cacheKey, createEngine, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const CHAIN = 52014
const BOLT = '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1'
const USDC = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e'
const EMPTY_TOKEN = '0x5555555555555555555555555555555555555555'
const BROKEN_TOKEN = '0x6666666666666666666666666666666666666666'
const TRADER = '0x4e420Ec6B6303817Bf6fC3f4485473AA83Ce7A72'
const WETN = ELECTRONEUM_ADDRESSES[CHAIN].wetn

/** Every `TokenTransactions` request the engine made, in order. */
let asked: Array<Record<string, unknown>> = []

const trade = (hash: string, timestamp: number, subject: string) => ({
  hash,
  timestamp,
  account: TRADER,
  ensName: null,
  token0: { address: subject, symbol: 'SUB' },
  token1: { address: USDC, symbol: 'USDC' },
  token0Quantity: '100.0',
  token1Quantity: '19.0',
  usdValue: { value: 19 },
  usdPrice: { value: 0.19 },
})

/*
  Two pages, so Load more has something to load, and page two repeats one of
  page one's hashes so the dedupe is exercised. Built around whichever token
  was asked for, because the API orients its rows around the subject and the
  fetcher drops any row belonging to neither side.
*/
const pageOne = (subject: string) => ({ cursor: 15_824_911, transactions: [trade('0xaa', 1_789_325_184, subject), trade('0xbb', 1_789_325_000, subject)] })
const pageTwo = (subject: string) => ({ cursor: 15_760_142, transactions: [trade('0xbb', 1_789_325_000, subject), trade('0xcc', 1_789_324_000, subject)] })

function answer(variables: Record<string, unknown>): unknown {
  asked.push(variables)
  const address = String(variables['address'] ?? '').toLowerCase()
  if (address === BROKEN_TOKEN.toLowerCase()) throw new Error('indexer down')
  if (address === EMPTY_TOKEN.toLowerCase()) return { transactions: { cursor: null, transactions: [] } }
  // Native ETN is asked for as WETN, so that address answers a feed too.
  if (address === BOLT.toLowerCase() || address === WETN.toLowerCase()) {
    const subject = String(variables['address'])
    const first = variables['blockCursor'] === null || variables['blockCursor'] === undefined
    return { transactions: first ? pageOne(subject) : pageTwo(subject) }
  }
  return { transactions: { cursor: null, transactions: [] } }
}

const fetchImpl: typeof fetch = async (input, init) => {
  const url = String(input)
  if (url.includes('tokenlist.json')) return new Response(JSON.stringify({ name: 'fixture', tokens: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/graphql')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { query: string; variables: Record<string, unknown> }
    if (!body.query.startsWith('query TokenTransactions')) return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } })
    try {
      return new Response(JSON.stringify({ data: answer(body.variables) }), { status: 200, headers: { 'content-type': 'application/json' } })
    } catch (err) {
      return new Response(JSON.stringify({ errors: [{ message: (err as Error).message }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  }
  return new Response('not found', { status: 404 })
}

let engine: Engine

describe("a token's recent trades", () => {
  beforeAll(async () => {
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, fetch: fetchImpl, electroswapUrl: 'https://electroswap.test/graphql' })
    await engine.ready
    await engine.engine.vault.create({ password: PASSWORD })
  })

  afterAll(() => {
    engine.dispose()
  })

  it('has fetched nothing before the tab asks — the cached read is empty and no request was made', async () => {
    asked = []
    await expect(engine.engine.explore.cachedTokenTransactions({ chainId: CHAIN, address: BOLT })).resolves.toBeNull()
    expect(asked).toHaveLength(0)
  })

  it('answers with the rows once asked, and serves the second ask from the cache', async () => {
    asked = []
    const first = await engine.engine.explore.tokenTransactions({ chainId: CHAIN, address: BOLT })
    expect(first?.rows.map((r) => r.hash)).toEqual(['0xaa', '0xbb'])
    expect(asked).toHaveLength(1)
    // Inside the TTL, so flipping back to this tab costs no request at all.
    const again = await engine.engine.explore.tokenTransactions({ chainId: CHAIN, address: BOLT })
    expect(again?.rows).toHaveLength(2)
    expect(asked).toHaveLength(1)
  })

  it('files the document under the key the screen builds, so cache.changed reaches it', async () => {
    const hit = await engine.engine.explore.cachedTokenTransactions({ chainId: CHAIN, address: BOLT })
    expect(hit).not.toBeNull()
    // The screen writes exactly this expression; if either side moves, the
    // live re-read on `cache.changed` silently stops arriving.
    expect(cacheKey('explore', 'tokentx', CHAIN, BOLT)).toBe('explore.tokentx.52014.0x043faa1b5c5fc9a7dc35171f290c29ecde0ccff1')
  })

  it('reads a token nobody has traded as an empty list, NOT as a failure', async () => {
    const view = await engine.engine.explore.tokenTransactions({ chainId: CHAIN, address: EMPTY_TOKEN })
    expect(view).not.toBeNull()
    expect(view?.rows).toEqual([])
  })

  it('reads an API that cannot answer as null, so the screen can say so', async () => {
    await expect(engine.engine.explore.tokenTransactions({ chainId: CHAIN, address: BROKEN_TOKEN })).resolves.toBeNull()
  })

  it('asks for WETN on behalf of native ETN, and still answers as native', async () => {
    asked = []
    const view = await engine.engine.explore.tokenTransactions({ chainId: CHAIN, address: 'native' })
    expect(asked[0]?.['address']).toBe(WETN)
    // The screen asked about `native` and is answered about `native`.
    expect(view?.address).toBe('native')
    expect(view?.subject).toBe(WETN)
    expect(view?.rows.length).toBeGreaterThan(0)
  })

  it('loads a further page, dedupes it by hash and keeps the list newest first', async () => {
    const before = await engine.engine.explore.cachedTokenTransactions({ chainId: CHAIN, address: BOLT })
    expect(before?.value.rows).toHaveLength(2)
    const after = await engine.engine.explore.moreTokenTransactions({ chainId: CHAIN, address: BOLT })
    // '0xbb' was in both pages and appears once.
    expect(after?.rows.map((r) => r.hash)).toEqual(['0xaa', '0xbb', '0xcc'])
    expect(after?.rows.map((r) => r.timestamp)).toEqual([...(after?.rows.map((r) => r.timestamp) ?? [])].sort((a, b) => b - a))
    // The merge went through the cache, which is what tells open pages to re-read.
    const stored = await engine.engine.explore.cachedTokenTransactions({ chainId: CHAIN, address: BOLT })
    expect(stored?.value.rows).toHaveLength(3)
  })

  it('stops offering more once a page adds nothing, however the cursor reads', async () => {
    // PAGE_TWO answers every cursored request, so the next one is all duplicates.
    const done = await engine.engine.explore.moreTokenTransactions({ chainId: CHAIN, address: BOLT })
    expect(done?.rows).toHaveLength(3)
    expect(done?.complete).toBe(true)
    // And a complete list asks for nothing further.
    asked = []
    await engine.engine.explore.moreTokenTransactions({ chainId: CHAIN, address: BOLT })
    expect(asked).toHaveLength(0)
  })

  it('will not extend a list it never loaded', async () => {
    asked = []
    await expect(engine.engine.explore.moreTokenTransactions({ chainId: CHAIN, address: USDC })).resolves.toBeNull()
    expect(asked).toHaveLength(0)
  })

  it('answers null off Electroneum without asking the indexer at all', async () => {
    asked = []
    await expect(engine.engine.explore.tokenTransactions({ chainId: 1, address: BOLT })).resolves.toBeNull()
    expect(asked).toHaveLength(0)
  })
})
