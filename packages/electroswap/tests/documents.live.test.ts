/**
 * Every GraphQL document we ship, validated against the deployed schema.
 *
 * This exists because `TOP_COLLECTIONS` declared `$listed: Boolean` into a
 * `Boolean!` argument position for months. That is a *validation* error, so the
 * server rejected the whole document before executing it, ExploreService
 * swallowed the throw into `[]`, and Explore > Collectibles was silently empty
 * — while every unit test passed, because the engine tests stub GraphQL by
 * string-matching the query text and never check it against a schema.
 *
 * A validation error is distinguishable from a resolver error: it arrives with
 * no `path` and a well-known message shape. Resolver-level nulls are fine here;
 * we only assert the documents are *legal*.
 *
 *   pnpm --filter @boltvault/electroswap test        # runs live
 *   SKIP_LIVE=1 pnpm --filter @boltvault/electroswap test
 */
import { describe, expect, it } from 'vitest'
import {
  NFT_ACTIVITY,
  NFT_ASSET_DETAILS,
  NFT_ASSETS,
  NFT_BID_OBLIGATION,
  NFT_BIDS,
  NFT_BALANCES,
  NFT_COLLECTION_BALANCES,
  NFT_COLLECTIONS,
  PRESALE,
  PRESALES,
  PRICE_HISTORY,
  TOKEN_DETAIL,
  TOKEN_TRANSACTIONS,
  TOP_COLLECTIONS,
  TOP_TOKENS,
  YIELD_FARMS,
} from '../src/queries'

const SKIP = process.env.SKIP_LIVE === '1'
const URL = process.env.ELECTROSWAP_URL ?? 'https://electroswap.io/graphql'

const CHAIN = 'ELECTRONEUM'
const WETN = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'
const LEGENDS = '0x31cbb613D14cc85Cf3A8889007562E4B5cE9518b'
const OWNER = '0x0000000000000000000000000000000000000001'

/** Well-typed variables for each document — validation runs before execution. */
const DOCUMENTS: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ['TopTokens', TOP_TOKENS, { chain: CHAIN }],
  ['PriceHistory', PRICE_HISTORY, { address: WETN, chain: CHAIN, duration: 'DAY' }],
  ['TokenDetail', TOKEN_DETAIL, { address: WETN, chain: CHAIN }],
  ['TokenTransactions', TOKEN_TRANSACTIONS, { chain: CHAIN, address: WETN, typeFilter: ['SWAP'], blockCursor: null, transactionSearch: null }],
  ['TopCollections', TOP_COLLECTIONS, { chains: [CHAIN], first: 5, listed: true, duration: 'DAY' }],
  ['NftCollections', NFT_COLLECTIONS, { chain: CHAIN, filter: { addresses: [LEGENDS] }, first: 1 }],
  ['NftAssets', NFT_ASSETS, { chain: CHAIN, address: LEGENDS, orderBy: 'PRICE', asc: true, first: 1 }],
  ['NftAssetDetails', NFT_ASSET_DETAILS, { chain: CHAIN, address: LEGENDS, tokenId: '1' }],
  ['NftBalances', NFT_BALANCES, { chain: CHAIN, owner: OWNER, first: 1 }],
  ['NftCollectionBalances', NFT_COLLECTION_BALANCES, { chain: CHAIN, address: OWNER }],
  ['NftActivity', NFT_ACTIVITY, { chain: CHAIN, filter: { address: LEGENDS }, first: 1 }],
  ['NftBids', NFT_BIDS, { chain: CHAIN, address: LEGENDS, first: 1 }],
  ['NftBidObligation', NFT_BID_OBLIGATION, { chain: CHAIN, address: OWNER }],
  ['Presales', PRESALES, { chain: CHAIN, first: 1 }],
  ['Presale', PRESALE, { pool: LEGENDS, chain: CHAIN }],
  ['YieldFarms', YIELD_FARMS, { chain: CHAIN }],
]

/** Messages GraphQL emits when a document is illegal against the schema. */
const VALIDATION = /^(Variable |Cannot query field|Unknown argument|Unknown type|Field ".*" argument|Expected type|Syntax Error|Unknown directive)/

interface GraphQLError {
  readonly message?: string
  readonly path?: readonly unknown[]
}

async function post(query: string, variables: Record<string, unknown>): Promise<GraphQLError[]> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://app.electroswap.io/' },
    body: JSON.stringify({ query, variables }),
  })
  const body: unknown = await res.json()
  if (typeof body !== 'object' || body === null) throw new Error(`bad envelope: ${res.status}`)
  const errors = (body as { errors?: unknown }).errors
  return Array.isArray(errors) ? (errors as GraphQLError[]) : []
}

describe.skipIf(SKIP)('shipped GraphQL documents validate against the deployed schema (SKIP_LIVE)', () => {
  for (const [name, query, variables] of DOCUMENTS) {
    it(`${name} is legal`, async () => {
      const errors = await post(query, variables)
      // A validation error has no `path` — it never reached a resolver.
      const invalid = errors.filter((e) => e.path === undefined && VALIDATION.test(e.message ?? ''))
      expect(invalid.map((e) => e.message)).toEqual([])
    }, 30_000)
  }

  it('TopCollections returns the verified set for listed: true', async () => {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://app.electroswap.io/' },
      body: JSON.stringify({
        query: 'query T($chains:[Chain!]!,$listed:Boolean!){topCollections(chains:$chains,listed:$listed,first:50){edges{node{name isVerified}}}}',
        variables: { chains: [CHAIN], listed: true },
      }),
    })
    const body = (await res.json()) as { data?: { topCollections?: { edges?: ReadonlyArray<{ node: { isVerified?: boolean } }> } } }
    const edges = body.data?.topCollections?.edges ?? []
    expect(edges.length).toBeGreaterThan(0)
    // `listed` and `isVerified` are aligned in this API; the wallet relies on it
    // to ask for the verified set in one query, with no client-side filter.
    expect(edges.every((e) => e.node.isVerified === true)).toBe(true)
  }, 30_000)
})
