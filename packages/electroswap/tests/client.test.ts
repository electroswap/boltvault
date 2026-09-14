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
  const LOCKS = [
    { lockId: 1, pair: 'P', owner: OWNER, token0: TOKEN, token1: '0x1', amountToken0: '10', amountToken1: '0', percentSupply: 30, active: true, version: 'v3' },
    { lockId: 2, pair: 'Q', owner: OWNER, token0: TOKEN, token1: '0x1', amountToken0: '5', amountToken1: '0', percentSupply: 20, active: true, version: 'v3' },
    { lockId: 3, pair: 'P', owner: OWNER, token0: TOKEN, token1: '0x1', amountToken0: '9', amountToken1: '0', percentSupply: 50, active: false, version: 'v3' },
  ]

  it('filters to active locks and reports the API\'s locked share', async () => {
    const { fn } = mockFetch({ liquidityLocksByToken: LOCKS, token: { market: { percentLiquidityLocked: 41.5 } } })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    const { locks, totalPercent } = await client.liquidityLocks(ELECTRONEUM_MAINNET, TOKEN)
    expect(locks).toHaveLength(2)
    // Not 30 + 20: those are shares of pool P and pool Q, and adding them adds different denominators.
    expect(totalPercent).toBe(41.5)
  })

  it('never sums per-pool shares, so a token cannot read as more than fully locked', async () => {
    // The shape that made CLUB read 100%: nine locks over two pools summing to 102.86%.
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...LOCKS[0], lockId: i + 1, pair: i < 4 ? 'P' : 'Q', percentSupply: [0.35, 0.55, 2.22, 0.56, 94.35, 0.64, 2.5, 1.46, 0.23][i] }))
    const { fn } = mockFetch({ liquidityLocksByToken: nine, token: { market: { percentLiquidityLocked: 64.26 } } })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    const { totalPercent } = await client.liquidityLocks(ELECTRONEUM_MAINNET, TOKEN)
    expect(totalPercent).toBe(64.26)
  })

  it('falls back to the largest single pool share, never the sum, when the API omits the field', async () => {
    const { fn } = mockFetch({ liquidityLocksByToken: LOCKS, token: { market: { percentLiquidityLocked: null } } })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    const { totalPercent } = await client.liquidityLocks(ELECTRONEUM_MAINNET, TOKEN)
    expect(totalPercent).toBe(30)
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

/**
 * Batched token markets.
 *
 * The addresses used to be pasted into the query text, which made the document
 * different for every wallet — unlistable by the API's operation allow-list, and
 * a copy of someone's holdings in every log line. They are variables now, so the
 * document is constant and the request carries the addresses.
 */
describe('ElectroSwapClient.tokenMarkets', () => {
  const A = '0x' + '11'.repeat(20)
  const B = '0x' + '22'.repeat(20)

  function marketRow(address: string, symbol: string) {
    return { address, symbol, name: symbol, decimals: 18, market: { price: { value: 1.5, currency: 'USD' } } }
  }

  it('sends one constant document, with the addresses as variables', async () => {
    const { fn, calls } = mockFetch({ tokens: [marketRow(A, 'AAA'), marketRow(B, 'BBB')] })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    await client.tokenMarkets(ELECTRONEUM_MAINNET, [A, B])

    const body = JSON.parse(String(calls[0]?.init.body)) as { query: string; variables: Record<string, unknown> }
    expect(body.query).toContain('query BoltBatch($contracts: [ContractInput!]!)')
    // The addresses must not appear in the document itself — that is the whole change.
    expect(body.query).not.toContain(A)
    expect(body.query).not.toContain(B)
    expect(body.variables['contracts']).toEqual([
      { chain: 'ELECTRONEUM', address: A },
      { chain: 'ELECTRONEUM', address: B },
    ])
  })

  it('sends the same document whatever is being asked for', async () => {
    const { fn, calls } = mockFetch({ tokens: [marketRow(A, 'AAA')] })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    await client.tokenMarkets(ELECTRONEUM_MAINNET, [A])
    await client.tokenMarkets(ELECTRONEUM_MAINNET, [B])
    const [first, second] = calls.map((call) => (JSON.parse(String(call.init.body)) as { query: string }).query)
    expect(first).toBe(second)
  })

  it('lines answers up with the addresses it asked for, and fills a gap with an empty token', async () => {
    // A null in the middle is "we do not know this one", not a shortened list.
    const { fn } = mockFetch({ tokens: [marketRow(A, 'AAA'), null] })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    const out = await client.tokenMarkets(ELECTRONEUM_MAINNET, [A, B])
    expect(out.get(A.toLowerCase())?.symbol).toBe('AAA')
    expect(out.get(B.toLowerCase())).toBeDefined()
    expect(out.get(B.toLowerCase())?.price).toBeNull()
  })

  it('chunks at twelve, so no single request approaches the server cap', async () => {
    const many = Array.from({ length: 25 }, (_, i) => '0x' + String(i).padStart(2, '0').repeat(20))
    const { fn, calls } = mockFetch({ tokens: [] })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    await client.tokenMarkets(ELECTRONEUM_MAINNET, many)
    expect(calls).toHaveLength(3)
    for (const call of calls) {
      const body = JSON.parse(String(call.init.body)) as { variables: { contracts: unknown[] } }
      expect(body.variables.contracts.length).toBeLessThanOrEqual(12)
    }
  })

  it('maps the native sentinel through unchanged', async () => {
    const { fn, calls } = mockFetch({ tokens: [marketRow('NATIVE', 'ETN')] })
    const client = new ElectroSwapClient({ fetchImpl: fn })
    await client.tokenMarkets(ELECTRONEUM_MAINNET, [nativeAddress()])
    const body = JSON.parse(String(calls[0]?.init.body)) as { variables: { contracts: { address: string }[] } }
    expect(body.variables.contracts[0]?.address).toBe('NATIVE')
  })
})
