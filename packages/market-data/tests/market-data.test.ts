import { describe, it, expect, vi } from 'vitest'
import { NoOpMarketData, noOpMarketData } from '../src/noop'
import { GeckoTerminalMarketData, mapKey } from '../src/geckoterminal'
import type { GeckoOpts } from '../src/geckoterminal'

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
    return new Response(JSON.stringify(canned.body ?? { data: [] }), {
      status: canned.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

const USDC = '0x0000000000000000000000000000000000000001'
const WETH = '0x0000000000000000000000000000000000000002'

function tokenIds(): Record<string, string> {
  return {
    [mapKey(1, USDC)]: 'ethereum_usdc',
    [mapKey(1, WETH)]: 'ethereum_weth',
  }
}

function bodyFor(id: string, price: string, ch?: string) {
  const attrs: Record<string, string> = { price_usd: price }
  if (ch !== undefined) attrs.price_change_percentage_24h = ch
  return { data: [{ id, attributes: attrs }] }
}

function makeMd(
  fetchImpl: typeof fetch,
  overrides: Partial<GeckoOpts> = {},
): [GeckoTerminalMarketData, { t: number; set: (v: number) => void }] {
  let t = 1_000_000
  const md = new GeckoTerminalMarketData({
    fetchImpl,
    tokenIds: tokenIds(),
    cacheMs: 60_000,
    now: () => t,
    ...overrides,
  })
  return [md, { t, set: (v: number) => (t = v) }]
}

// ---- NoOpMarketData ------------------------------------------------------

describe('NoOpMarketData', () => {
  it('price() resolves null', async () => {
    expect(await noOpMarketData.price(1, USDC)).toBeNull()
  })

  it('prices() returns an all-null map keyed by lowercased address', async () => {
    const out = await noOpMarketData.prices(1, [USDC, WETH])
    expect(Object.keys(out).sort()).toEqual([USDC.toLowerCase(), WETH.toLowerCase()])
    for (const v of Object.values(out)) expect(v).toBeNull()
  })

  it('shared noOpMarketData is a NoOpMarketData instance', () => {
    expect(noOpMarketData).toBeInstanceOf(NoOpMarketData)
  })
})

// ---- GeckoTerminalMarketData: price() -------------------------------------

describe('GeckoTerminalMarketData.price', () => {
  it('returns a parsed price on 200', async () => {
    const { fetchImpl } = makeFetch({ body: bodyFor('ethereum_usdc', '1.00', '0.5') })
    const [md] = makeMd(fetchImpl)
    const p = await md.price(1, USDC)
    expect(p).not.toBeNull()
    expect(p!.usd).toBe(1)
    expect(p!.change24h).toBe(0.5)
    expect(typeof p!.at).toBe('number')
    expect(p!.at).toBe(1_000_000)
  })

  it('caches for 60s: a second call does not hit fetch again', async () => {
    const { fetchImpl, calls } = makeFetch({ body: bodyFor('ethereum_usdc', '1.00', '0.5') })
    const [md] = makeMd(fetchImpl)
    const a = await md.price(1, USDC)
    const b = await md.price(1, USDC)
    expect(calls).toHaveLength(1)
    expect(b).toEqual(a)
    expect(b!.at).toBe(1_000_000)
  })

  it('does NOT hit the network for an address with no tokenIds mapping', async () => {
    const { fetchImpl, calls } = makeFetch({ body: bodyFor('ethereum_usdc', '1.00') })
    const [md] = makeMd(fetchImpl)
    expect(await md.price(1, '0xABCDEF000000000000000000000000000000000099')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('HTTP 429 → null (unpriced), does not throw', async () => {
    const { fetchImpl, calls } = makeFetch({ status: 429, body: { errors: [{ status: '429' }] } })
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
    const { fetchImpl, calls } = makeFetch({ body: bodyFor('ethereum_usdc', '1.00', '0.5') })
    const [md, clock] = makeMd(fetchImpl)
    await md.price(1, USDC)
    expect(calls).toHaveLength(1)
    clock.set(1_000_000 + 60_001) // > 60s cacheMs
    const p = await md.price(1, USDC)
    expect(calls).toHaveLength(2)
    expect(p!.usd).toBe(1)
  })

  it('omits change24h when the attribute is missing or empty', async () => {
    const { fetchImpl } = makeFetch({ body: bodyFor('ethereum_usdc', '2.00') })
    const [md] = makeMd(fetchImpl)
    const p = await md.price(1, USDC)
    expect(p!.usd).toBe(2)
    expect(p!.change24h).toBeUndefined()
  })

  it('calls the single-token endpoint under /networks/all/tokens/{id}', async () => {
    const { fetchImpl, calls } = makeFetch({ body: bodyFor('ethereum_usdc', '1.00') })
    const [md] = makeMd(fetchImpl)
    await md.price(1, USDC)
    expect(calls[0]).toBe('https://api.geckoterminal.com/api/v2/networks/all/tokens/ethereum_usdc')
  })
})

// ---- GeckoTerminalMarketData: prices() ------------------------------------

describe('GeckoTerminalMarketData.prices', () => {
  it('dedupes: the same address twice in one array fetches once, map keyed by lowercased address', async () => {
    const { fetchImpl, calls } = makeFetch({
      body: {
        data: [
          { id: 'ethereum_usdc', attributes: { price_usd: '1.00', price_change_percentage_24h: '0.5' } },
        ],
      },
    })
    const [md] = makeMd(fetchImpl)
    const out = await md.prices(1, [USDC, USDC, WETH])
    expect(calls).toHaveLength(1) // both uncached tokens fetched in ONE batch call
    // USDC appears twice in input → one key → one gecko id in the batch.
    expect(Object.keys(out).sort()).toEqual([USDC.toLowerCase(), WETH.toLowerCase()])
    expect(out[USDC.toLowerCase()]!.usd).toBe(1)
    expect(out[USDC.toLowerCase()]!.change24h).toBe(0.5)
  })

  it('prices() batches uncached tokens in ONE comma-joined call and matches by echoed id', async () => {
    const { fetchImpl, calls } = makeFetch({
      body: {
        data: [
          // order deliberately different from the request
          { id: 'ethereum_weth', attributes: { price_usd: '3000.00' } },
          { id: 'ethereum_usdc', attributes: { price_usd: '1.00', price_change_percentage_24h: '0.5' } },
        ],
      },
    })
    const [md] = makeMd(fetchImpl)
    const out = await md.prices(1, [USDC, WETH])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe(
      'https://api.geckoterminal.com/api/v2/networks/all/tokens/ethereum_usdc,ethereum_weth',
    )
    expect(out[USDC.toLowerCase()]!.usd).toBe(1)
    expect(out[WETH.toLowerCase()]!.usd).toBe(3000)
  })

  it('serves cached entries without hitting the network for them', async () => {
    const { fetchImpl, calls } = makeFetch({
      body: {
        data: [
          { id: 'ethereum_usdc', attributes: { price_usd: '1.00', price_change_percentage_24h: '0.5' } },
          { id: 'ethereum_weth', attributes: { price_usd: '3000.00' } },
        ],
      },
    })
    const [md] = makeMd(fetchImpl)
    // prime USDC into cache
    await md.price(1, USDC)
    // now batch [USDC, WETH]: only WETH must be fetched
    const out = await md.prices(1, [USDC, WETH])
    expect(calls).toHaveLength(2)
    expect(calls[1]).toBe('https://api.geckoterminal.com/api/v2/networks/all/tokens/ethereum_weth')
    expect(out[USDC.toLowerCase()]!.usd).toBe(1)
    expect(out[WETH.toLowerCase()]!.usd).toBe(3000)
  })

  it('tokenIds mapping missing → unpriced entry, no network for that address', async () => {
    const { fetchImpl, calls } = makeFetch({ body: { data: [] } })
    const unmapped = '0xABCDEF000000000000000000000000000000000099'
    const [md] = makeMd(fetchImpl)
    const out = await md.prices(1, [unmapped])
    expect(calls).toHaveLength(0)
    expect(out[unmapped.toLowerCase()]).toBeNull()
  })

  it('429 in a batch → null entries (unpriced) for the batch, no throw', async () => {
    const { fetchImpl } = makeFetch({ status: 429, body: { errors: [] } })
    const [md] = makeMd(fetchImpl)
    const out = await md.prices(1, [USDC, WETH])
    expect(out[USDC.toLowerCase()]).toBeNull()
    expect(out[WETH.toLowerCase()]).toBeNull()
  })

  it('an id missing from a batch response is unpriced (null), no throw', async () => {
    const { fetchImpl } = makeFetch({
      body: { data: [{ id: 'ethereum_usdc', attributes: { price_usd: '1.00' } }] },
    })
    const [md] = makeMd(fetchImpl)
    const out = await md.prices(1, [USDC, WETH])
    expect(out[USDC.toLowerCase()]!.usd).toBe(1)
    expect(out[WETH.toLowerCase()]).toBeNull()
  })

  it('results are cached (incl. nulls) so a repeat batch does not refetch', async () => {
    const { fetchImpl, calls } = makeFetch({
      body: { data: [{ id: 'ethereum_usdc', attributes: { price_usd: '1.00' } }] },
    })
    const [md] = makeMd(fetchImpl)
    await md.prices(1, [USDC, WETH])
    await md.prices(1, [USDC, WETH])
    expect(calls).toHaveLength(1)
  })
})

// ---- mapKey ----------------------------------------------------------------

describe('mapKey', () => {
  it('lowercases the address and prefixes chainId', () => {
    expect(mapKey(1, '0xAbCd0000000000000000000000000000000000FF')).toBe(
      '1:0xabcd0000000000000000000000000000000000ff',
    )
  })
})

// ---- live smoke test (skipped under SKIP_LIVE=1, matching token-catalog) ----

describe.runIf(process.env.SKIP_LIVE !== '1')('live GeckoTerminal', () => {
  it('prices a known token against the real API', async () => {
    const md = new GeckoTerminalMarketData({
      fetchImpl: fetch as typeof fetch,
      tokenIds: { [mapKey(1, '0x0A0Ee7A13204A6Eeb770eebA5309d95eE52e14D4')]: 'ethereum_usdc' },
    })
    const p = await md.price(1, '0x0A0Ee7A13204A6Eeb770eebA5309d95eE52e14D4')
    expect(p).not.toBeNull()
    expect(p!.usd).toBeGreaterThan(0)
  })
})
