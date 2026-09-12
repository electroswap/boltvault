/**
 * The owned-pieces walk goes to the end of the cursor.
 *
 * It used to stop after five pages and return what it had as if that were the
 * whole wallet. The page size is a request the indexer is free to cap, so the
 * real ceiling was five of *its* pages, and a tester with a genuine collection
 * counted the shortfall for us: "At collectibles, just part of my collection is
 * shown. I believe in total around 150, but I have 300+."
 *
 * Two properties: the walk follows `hasNextPage` however far it goes, and when
 * the runaway guard is what ends it, the caller is told rather than handed a
 * short answer dressed as a complete one.
 */
import { describe, expect, it } from 'vitest'
import { ElectroSwapClient, fetchOwnedAssets } from '../src'

const OWNER = '0x' + 'ab'.repeat(20)
const CONTRACT = '0x' + 'cd'.repeat(20)

/** A GraphQL endpoint that serves `pages` pages of `per` pieces each. */
function indexerWith(pages: number, per: number): { client: ElectroSwapClient; calls: () => number } {
  let calls = 0
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { variables: Record<string, unknown> }
    calls++
    // The cursor is the page index; `after: null` is the first page.
    const page = body.variables['after'] === null ? 0 : Number(body.variables['after'])
    const edges = Array.from({ length: per }, (_, i) => ({
      node: {
        quantity: 1,
        listedMarketplaces: [],
        ownedAsset: { tokenId: String(page * per + i), name: `Piece ${page * per + i}`, nftContract: { address: CONTRACT, standard: 'ERC721' } },
      },
    }))
    const hasNextPage = page + 1 < pages
    return new Response(
      JSON.stringify({ data: { nftBalances: { pageInfo: { hasNextPage, endCursor: String(page + 1) }, edges } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  return { client: new ElectroSwapClient({ fetchImpl }), calls: () => calls }
}

describe('fetchOwnedAssets', () => {
  it('walks past the old five-page ceiling to the end of the collection', async () => {
    // Twelve pages of thirty — 360 pieces, the shape of the report. The old
    // loop stopped at five and answered 150.
    const { client, calls } = indexerWith(12, 30)
    const page = await fetchOwnedAssets(client, 52014, OWNER)
    expect(page.assets).toHaveLength(360)
    expect(page.truncated).toBe(false)
    expect(calls()).toBe(12)
  })

  it('stops at the last page without asking for one more', async () => {
    const { client, calls } = indexerWith(1, 4)
    const page = await fetchOwnedAssets(client, 52014, OWNER)
    expect(page.assets).toHaveLength(4)
    expect(page.truncated).toBe(false)
    expect(calls()).toBe(1)
  })

  it('says so when the runaway guard is what ended the walk', async () => {
    // An indexer that answers `hasNextPage` for ever must not hold the call
    // open for ever — but a short answer that knows it is short says so.
    const { client } = indexerWith(10_000, 2)
    const page = await fetchOwnedAssets(client, 52014, OWNER)
    expect(page.truncated).toBe(true)
    expect(page.assets.length).toBeGreaterThan(0)
  })
})
