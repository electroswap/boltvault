import { describe, expect, it } from 'vitest'
import {
  ElectroSwapClient,
  ElectroSwapError,
  ELECTRONEUM_MAINNET,
  ELECTRONEUM_TESTNET,
  DEFAULT_GRAPHQL_URL,
  nativeAddress,
} from '../src'

const SKIP = process.env.SKIP_LIVE === '1'
const OWNER = '0x' + 'ab'.repeat(20)
const TOKEN = '0x' + 'cd'.repeat(20)

// Build a fake fetch that records the last request and returns a canned
// GraphQL *envelope* ({ data, errors }).
function mockFetch(data: unknown, opts: { status?: number; errors?: { message?: string }[] } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init as RequestInit })
    return {
      ok: opts.status ? opts.status < 500 : true,
      status: opts.status ?? 200,
      json: async () => ({ data, ...(opts.errors ? { errors: opts.errors } : {}) }),
    } as Response
  }
  return { fn: fn as unknown as typeof fetch, calls }
}

describe('ElectroSwapClient headers (T4.1)', () => {
  it('defaults to the ElectroSwap graphql endpoint', () => {
    expect(DEFAULT_GRAPHQL_URL).toBe('https://electroswap.io/graphql')
    expect(nativeAddress()).toBe('NATIVE')
  })

  it('sends Content-Type + interface Referer, and whatever the signer returns', async () => {
    const { fn, calls } = mockFetch({ token: null })
    // The client no longer holds a key: it is handed a per-request signer, and
    // what that signs is the method, the URL and the exact body about to be sent.
    const seen: Array<[string, string, string]> = []
    const client = new ElectroSwapClient({
      fetchImpl: fn,
      authHeaders: (method, url, body) => {
        seen.push([method, url, body])
        return { 'X-BoltVault-Auth': 'v1.deadbeef.1.n.m' }
      },
    })
    await client.tokenMarket(ELECTRONEUM_MAINNET, TOKEN)
    const init = calls[0]?.init as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Referer']).toBe('https://app.electroswap.io/')
    expect(headers['X-BoltVault-Auth']).toBe('v1.deadbeef.1.n.m')
    expect(headers['X-BoltVault-Key']).toBeUndefined()
    expect(seen[0]?.[0]).toBe('POST')
    expect(seen[0]?.[2]).toBe(init.body)
  })

  it('sends no credential at all when there is no signer', async () => {
    const { fn, calls } = mockFetch({ token: null })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    await client.tokenMarket(ELECTRONEUM_MAINNET, TOKEN)
    const headers = (calls[0]?.init as RequestInit).headers as Record<string, string>
    expect(headers['X-BoltVault-Key']).toBeUndefined()
    expect(headers['X-BoltVault-Auth']).toBeUndefined()
  })

  it('maps a non-2xx HTTP response to ElectroSwapError with status', async () => {
    const { fn } = mockFetch({}, { status: 500 })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    let caught: unknown
    try {
      await client.tokenMarket(ELECTRONEUM_MAINNET, TOKEN)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ElectroSwapError)
    expect((caught as ElectroSwapError).status).toBe(500)
  })

  it('throws on GraphQL body.errors', async () => {
    const { fn } = mockFetch(null, { errors: [{ message: 'Bad variable' }] })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    let caught: unknown
    try {
      await client.tokenMarket(ELECTRONEUM_MAINNET, TOKEN)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ElectroSwapError)
    expect((caught as Error).message).toBe('Bad variable')
  })
})

describe('ElectroSwapClient token market (T4.1)', () => {
  it('returns the token price + metadata, with chain resolved', async () => {
    const { fn } = mockFetch({
      token: {
        address: TOKEN,
        symbol: 'BOLT',
        name: 'Bolt',
        decimals: 18,
        market: { price: { value: 0.0231, currency: 'USD' } },
      },
    })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    const m = await client.tokenMarket(ELECTRONEUM_MAINNET, TOKEN)
    expect(m.symbol).toBe('BOLT')
    expect(m.price).toEqual({ value: 0.0231, currency: 'USD' })
    expect(m.chain).toBe('ELECTRONEUM')
  })

  it('testnet resolves to ELECTRONEUM_TEST', async () => {
    const { fn } = mockFetch({ token: { address: TOKEN, symbol: 'X', name: 'X', decimals: 18, market: null } })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    const m = await client.tokenMarket(ELECTRONEUM_TESTNET, TOKEN)
    expect(m.chain).toBe('ELECTRONEUM_TEST')
  })

  it('a non-ETN chainId throws (assertElectroneum)', async () => {
    const { fn } = mockFetch({ token: null })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    await expect(client.tokenMarket(8453, TOKEN)).rejects.toThrow()
  })

  it('native ETN address is sent as the NATIVE sentinel', async () => {
    const { fn, calls } = mockFetch({ token: null })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    await client.tokenMarket(ELECTRONEUM_MAINNET, 'NATIVE')
    const sent = JSON.parse(String((calls[0]?.init as RequestInit).body)).variables
    expect(sent.address).toBe('NATIVE')
  })
})

describe('ElectroSwapClient portfolio (T4.1)', () => {
  it('returns the portfolio with token balances + totals', async () => {
    const { fn } = mockFetch({
      portfolios: [
        {
          id: '1',
          tokensTotalDenominatedValue: { id: 'x', value: 1234.56 },
          tokensTotalDenominatedValueChange: {
            absolute: { id: 'a', value: 10 },
            percentage: { id: 'p', value: 0.02 },
          },
          tokenBalances: [
            {
              id: 't1',
              quantity: '12345',
              denominatedValue: { id: 'd', currency: 'USD', value: 100 },
              tokenProjectMarket: {
                pricePercentChange: { id: 'c', value: 0.01 },
                tokenProject: { id: 'lp', logoUrl: 'https://x/logo.svg', isSpam: false },
              },
              token: { id: 'tok', chain: 'ELECTRONEUM', address: TOKEN, name: 'Bolt', symbol: 'BOLT', standard: 'ERC20', decimals: 18 },
            },
          ],
        },
      ],
    })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    const p = await client.portfolio(ELECTRONEUM_MAINNET, OWNER)
    expect(p.tokensTotalDenominatedValue.value).toBe(1234.56)
    expect(p.tokenBalances[0]?.token.symbol).toBe('BOLT')
    expect(p.tokenBalances[0]?.tokenProjectMarket?.pricePercentChange?.value).toBe(0.01)
  })

  it('returns an empty portfolio when the owner has none', async () => {
    const { fn } = mockFetch({ portfolios: [] })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    const p = await client.portfolio(ELECTRONEUM_MAINNET, OWNER)
    expect(p.tokenBalances).toEqual([])
  })
})

describe('ElectroSwapClient liquidity locks (T4.1)', () => {
  it('filters to active locks and sums the locked %', async () => {
    const { fn } = mockFetch({
      liquidityLocksByToken: [
        { lockId: 1, pair: 'P', owner: OWNER, token0: TOKEN, token1: '0x1', amountToken0: '10', amountToken1: '0', percentSupply: 30, active: true, version: 'v3' },
        { lockId: 2, pair: 'P', owner: OWNER, token0: TOKEN, token1: '0x1', amountToken0: '5', amountToken1: '0', percentSupply: 20, active: true, version: 'v3' },
        { lockId: 3, pair: 'P', owner: OWNER, token0: TOKEN, token1: '0x1', amountToken0: '9', amountToken1: '0', percentSupply: 50, active: false, version: 'v3' },
      ],
    })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    const { locks, totalPercent } = await client.liquidityLocks(ELECTRONEUM_MAINNET, TOKEN)
    expect(locks).toHaveLength(2)
    expect(totalPercent).toBe(50)
  })
})

describe.skipIf(SKIP)('ElectroSwapClient live (SKIP_LIVE)', () => {
  it('fetches a real token market from the live endpoint', async () => {
    const client = new ElectroSwapClient()
    // WETN (Wrapped Electroneum) — a real listed ETN token from the public tokenlist.
    const m = await client.tokenMarket(ELECTRONEUM_MAINNET, '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77')
    expect(m.symbol).toBe('WETN')
    expect(m.decimals).toBe(18)
  })
})
