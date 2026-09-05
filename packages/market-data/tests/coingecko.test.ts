import { describe, it, expect, vi } from 'vitest'
import { CoinGeckoMarketData } from '../src/coingecko'
import { DefiLlamaMarketData } from '../src/defillama'
import { mapKey } from '../src/geckoterminal'
import type { CoinGeckoOpts } from '../src/coingecko'
import type { MarketData, TokenPriceMap } from '../src/types'

// ---- helpers -------------------------------------------------------------

interface Canned {
  status?: number
  body?: unknown
  /** if set, fetch rejects with it instead of resolving */
  reject?: unknown
}

function makeFetch(canned: Canned, calls: string[] = []) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    calls.push(String(input))
    if (canned.reject) throw canned.reject
    return new Response(JSON.stringify(canned.body ?? {}), {
      status: canned.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

const USDC = '0x0000000000000000000000000000000000000001'
const WETH = '0x0000000000000000000000000000000000000002'
const WALLET = '0xAbCd000000000000000000000000000000000000FF'

function tokenIds(): Record<string, string> {
  return {
    [mapKey(1, USDC)]: 'usd-coin',
    [mapKey(1, WETH)]: 'weth',
    // the privacy test prices an address shaped like a wallet; only its id
    // may reach the API.
    [mapKey(1, WALLET)]: 'usd-coin',
  }
}

function bodyFor(id: string, price: number, ch?: number) {
  const out: Record<string, unknown> = { [id]: { usd: price } }
  if (ch !== undefined) out[id] = { usd: price, usd_24h_change: ch }
  return out
}

function makeMd(
  fetchImpl: typeof fetch,
  overrides: Partial<CoinGeckoOpts> = {},
): [CoinGeckoMarketData, { t: number; set: (v: number) => void }] {
  let t = 1_000_000
  const md = new CoinGeckoMarketData({
    fetchImpl,
    tokenIds: tokenIds(),
    cacheMs: 60_000,
    now: () => t,
    ...overrides,
  })
  return [md, { t, set: (v: number) => (t = v) }]
}

// ---- CoinGeckoMarketData: price() ----------------------------------------

describe('CoinGeckoMarketData.price', () => {
  it('implements the MarketData interface (price + prices)', () => {
    const { fetchImpl } = makeFetch({ body: bodyFor('usd-coin', 1) })
    const md: MarketData = makeMd(fetchImpl)[0]
    expect(typeof md.price).toBe('function')
    expect(typeof md.prices).toBe('function')
  })

  it('returns a parsed price on 200', async () => {
    const { fetchImpl } = makeFetch({ body: bodyFor('usd-coin', 1.02, 0.5) })
    const [md] = makeMd(fetchImpl)
    const p = await md.price(1, USDC)
    expect(p).not.toBeNull()
    expect(p!.usd).toBe(1.02)
    expect(p!.change24h).toBe(0.5)
    expect(typeof p!.at).toBe('number')
    expect(p!.at).toBe(1_000_000)
  })

  it('caches for 60s: a second call does not hit fetch again', async () => {
    const { fetchImpl, calls } = makeFetch({ body: bodyFor('usd-coin', 1.0, 0.5) })
    const [md] = makeMd(fetchImpl)
    const a = await md.price(1, USDC)
    const b = await md.price(1, USDC)
    expect(calls).toHaveLength(1)
    expect(b).toEqual(a)
  })

  it('does NOT hit the network for an address with no tokenIds mapping', async () => {
    const { fetchImpl, calls } = makeFetch({ body: bodyFor('usd-coin', 1.0) })
    const [md] = makeMd(fetchImpl)
    expect(await md.price(1, '0xABCDEF000000000000000000000000000000000099')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('HTTP 429 → null (unpriced), does not throw', async () => {
    const { fetchImpl, calls } = makeFetch({ status: 429, body: { errors: [{ code: 429 }] } })
    const [md] = makeMd(fetchImpl)
    expect(await md.price(1, USDC)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('caches the null from a 429 for the cache window', async () => {
    const { fetchImpl, calls } = makeFetch({ status: 429 })
    const [md] = makeMd(fetchImpl)
    await md.price(1, USDC)
    await md.price(1, USDC)
    expect(calls).toHaveLength(1)
  })

  it('network throw (fetch rejects) → null, does not throw', async () => {
    const { fetchImpl } = makeFetch({ reject: new TypeError('fetch failed') })
    const [md] = makeMd(fetchImpl)
    expect(await md.price(1, USDC)).toBeNull()
  })

  it('a stale cache entry (now advanced past cacheMs) is refetched', async () => {
    const { fetchImpl, calls } = makeFetch({ body: bodyFor('usd-coin', 1.0, 0.5) })
    const [md, clock] = makeMd(fetchImpl)
    await md.price(1, USDC)
    expect(calls).toHaveLength(1)
    clock.set(1_000_000 + 60_001) // > 60s cacheMs
    const p = await md.price(1, USDC)
    expect(calls).toHaveLength(2)
    expect(p!.usd).toBe(1)
  })

  it('omits change24h when the response has no change field', async () => {
    const { fetchImpl } = makeFetch({ body: bodyFor('usd-coin', 2.0) })
    const [md] = makeMd(fetchImpl)
    const p = await md.price(1, USDC)
    expect(p!.usd).toBe(2)
    expect(p!.change24h).toBeUndefined()
  })

  it('an id missing from the response is unpriced (null), no throw', async () => {
    const { fetchImpl } = makeFetch({ body: { other: { usd: 9 } } })
    const [md] = makeMd(fetchImpl)
    expect(await md.price(1, USDC)).toBeNull()
  })
})

// ---- CoinGeckoMarketData: privacy ----------------------------------------

describe('CoinGeckoMarketData privacy (ids only, never the wallet address)', () => {
  it('does NOT send the user address when only a token id is passed', async () => {
    const { fetchImpl, calls } = makeFetch({ body: bodyFor('usd-coin', 1.0) })
    const [md] = makeMd(fetchImpl)
    // pass an address that looks like a wallet: only the id may reach the API
    await md.price(1, WALLET.toLowerCase())
    expect(calls).toHaveLength(1)
    // URL contains the token id ...
    expect(calls[0]).toContain('usd-coin')
    // ... but NOT the wallet address (any case)
    for (const variant of [WALLET, WALLET.toLowerCase(), WALLET.toUpperCase()]) {
      expect(calls[0]?.includes(variant)).toBe(false)
    }
  })

  it('fetches the /simple/price endpoint with the ids param', async () => {
    const { fetchImpl, calls } = makeFetch({ body: bodyFor('usd-coin', 1.0) })
    const [md] = makeMd(fetchImpl)
    await md.price(1, USDC)
    expect(calls[0]).toBe(
      'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=usd&include_24hr_change=true',
    )
  })
})

// ---- CoinGeckoMarketData: prices() ---------------------------------------

describe('CoinGeckoMarketData.prices', () => {
  it('batches uncached tokens in ONE comma-joined call and matches by id', async () => {
    const { fetchImpl, calls } = makeFetch({
      body: {
        // order deliberately different from the request
        weth: { usd: 3000, usd_24h_change: -1.2 },
        'usd-coin': { usd: 1.0, usd_24h_change: 0.5 },
      },
    })
    const [md] = makeMd(fetchImpl)
    const out: TokenPriceMap = await md.prices(1, [USDC, WETH])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe(
      'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin,weth&vs_currencies=usd&include_24hr_change=true',
    )
    expect(out[USDC.toLowerCase()]!.usd).toBe(1)
    expect(out[WETH.toLowerCase()]!.usd).toBe(3000)
  })

  it('429 in a batch → null entries (unpriced) for the batch, no throw', async () => {
    const { fetchImpl } = makeFetch({ status: 429, body: { errors: [] } })
    const [md] = makeMd(fetchImpl)
    const out = await md.prices(1, [USDC, WETH])
    expect(out[USDC.toLowerCase()]).toBeNull()
    expect(out[WETH.toLowerCase()]).toBeNull()
  })

  it('an id missing from a batch response is unpriced (null), no throw', async () => {
    const { fetchImpl } = makeFetch({ body: { 'usd-coin': { usd: 1.0 } } })
    const [md] = makeMd(fetchImpl)
    const out = await md.prices(1, [USDC, WETH])
    expect(out[USDC.toLowerCase()]!.usd).toBe(1)
    expect(out[WETH.toLowerCase()]).toBeNull()
  })

  it('results are cached (incl. nulls) so a repeat batch does not refetch', async () => {
    const { fetchImpl, calls } = makeFetch({ body: { 'usd-coin': { usd: 1.0 } } })
    const [md] = makeMd(fetchImpl)
    await md.prices(1, [USDC, WETH])
    await md.prices(1, [USDC, WETH])
    expect(calls).toHaveLength(1)
  })
})

// ---- DefiLlamaMarketData ---------------------------------------------------

function makeLlama(
  fetchImpl: typeof fetch,
  overrides: { cacheMs?: number; now?: () => number; apiBase?: string } = {},
): [DefiLlamaMarketData, { t: number; set: (v: number) => void }] {
  let t = 1_000_000
  const md = new DefiLlamaMarketData({
    fetchImpl,
    cacheMs: 60_000,
    now: () => t,
    ...overrides,
  })
  return [md, { t, set: (v: number) => (t = v) }]
}

describe('DefiLlamaMarketData', () => {
  it('returns parsed TVL on 200', async () => {
    const { fetchImpl } = makeFetch({ body: { name: 'Aave', tvl: 1_500_000_000 } })
    const [md] = makeLlama(fetchImpl)
    const d = await md.protocol('aave')
    expect(d).not.toBeNull()
    expect(d!.slug).toBe('aave')
    expect(d!.name).toBe('Aave')
    expect(d!.tvl).toBe(1_500_000_000)
    expect(d!.at).toBe(1_000_000)
  })

  it('does NOT send the user address — only the slug reaches the API', async () => {
    const { fetchImpl, calls } = makeFetch({ body: { name: 'Aave', tvl: 1 } })
    const [md] = makeLlama(fetchImpl)
    await md.protocol('aave')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe('https://api.llama.fi/protocol/aave')
    for (const variant of [WALLET, WALLET.toLowerCase(), WALLET.toUpperCase()]) {
      expect(calls[0]?.includes(variant)).toBe(false)
    }
  })

  it('HTTP 429 → null (unpriced), does not throw', async () => {
    const { fetchImpl, calls } = makeFetch({ status: 429, body: { error: 'rate limit' } })
    const [md] = makeLlama(fetchImpl)
    expect(await md.protocol('aave')).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('caches: a second call within the 60s window does not re-fetch', async () => {
    const { fetchImpl, calls } = makeFetch({ body: { name: 'Aave', tvl: 1 } })
    const [md] = makeLlama(fetchImpl)
    const a = await md.protocol('aave')
    const b = await md.protocol('aave')
    expect(calls).toHaveLength(1)
    expect(b).toEqual(a)
  })

  it('a stale cache entry (now advanced past cacheMs) is refetched', async () => {
    const { fetchImpl, calls } = makeFetch({ body: { name: 'Aave', tvl: 1 } })
    const [md, clock] = makeLlama(fetchImpl)
    await md.protocol('aave')
    expect(calls).toHaveLength(1)
    clock.set(1_000_000 + 60_001)
    await md.protocol('aave')
    expect(calls).toHaveLength(2)
  })

  it('missing/invalid tvl → null, no throw', async () => {
    const { fetchImpl } = makeFetch({ body: { name: 'Aave' } })
    const [md] = makeLlama(fetchImpl)
    expect(await md.protocol('aave')).toBeNull()
  })

  it('network throw (fetch rejects) → null, does not throw', async () => {
    const { fetchImpl } = makeFetch({ reject: new TypeError('fetch failed') })
    const [md] = makeLlama(fetchImpl)
    expect(await md.protocol('aave')).toBeNull()
  })
})
