import { describe, expect, it } from 'vitest'
import {
  nftActivityQuery,
  nftAssetsQuery,
  nftBidsQuery,
  nftBalancesQuery,
  nftCollectionsQuery,
  presalesQuery,
  yieldFarmsQuery,
} from '../src'

const OWNER = '0xAbCd000000000000000000000000000000000000FF'
const POOL = '0x1111111111111111111111111111111111111111'
const COLLECTION = '0x2222222222222222222222222222222222222222'
const ASSET = '0x3333333333333333333333333333333333333333#1'

describe('query builders — non-empty, contain operation name', () => {
  it('yieldFarms', () => {
    const q = yieldFarmsQuery()
    expect(q.length).toBeGreaterThan(0)
    expect(q).toContain('yieldFarms')
  })

  it('presales', () => {
    const q = presalesQuery()
    expect(q.length).toBeGreaterThan(0)
    expect(q).toContain('presales')
  })

  it('nftBalances', () => {
    const q = nftBalancesQuery(OWNER)
    expect(q.length).toBeGreaterThan(0)
    expect(q).toContain('nftBalances')
  })

  it('nftCollections', () => {
    const q = nftCollectionsQuery()
    expect(q.length).toBeGreaterThan(0)
    expect(q).toContain('nftCollections')
  })

  it('nftAssets', () => {
    const q = nftAssetsQuery()
    expect(q.length).toBeGreaterThan(0)
    expect(q).toContain('nftAssets')
  })

  it('nftBids', () => {
    const q = nftBidsQuery()
    expect(q.length).toBeGreaterThan(0)
    expect(q).toContain('nftBids')
  })

  it('nftActivity', () => {
    const q = nftActivityQuery()
    expect(q.length).toBeGreaterThan(0)
    expect(q).toContain('nftActivity')
  })
})

describe('query builders — parameter embedding', () => {
  it('yieldFarmsQuery(farmer) embeds the farmer address', () => {
    const q = yieldFarmsQuery(OWNER)
    expect(q).toContain(OWNER.toLowerCase())
    // unparameterized variant must not embed it
    expect(yieldFarmsQuery()).not.toContain(OWNER.toLowerCase())
  })

  it('presalesQuery(pool) embeds the pool address', () => {
    const q = presalesQuery(POOL)
    expect(q).toContain(POOL.toLowerCase())
    expect(presalesQuery()).not.toContain(POOL.toLowerCase())
  })

  it('nftBalancesQuery(owner) embeds the owner address', () => {
    const q = nftBalancesQuery(OWNER)
    expect(q).toContain(OWNER.toLowerCase())
    // checksummed input is lowercased to the canonical query form
    expect(q).not.toContain(OWNER)
  })

  it('nftAssetsQuery(collection) embeds the collection address', () => {
    const q = nftAssetsQuery(COLLECTION)
    expect(q).toContain(COLLECTION.toLowerCase())
    expect(nftAssetsQuery()).not.toContain(COLLECTION.toLowerCase())
  })

  it('nftBidsQuery(asset) embeds the asset id', () => {
    const q = nftBidsQuery(ASSET)
    expect(q).toContain(ASSET.toLowerCase())
    expect(nftBidsQuery()).not.toContain(ASSET.toLowerCase())
  })

  it('nftActivityQuery(asset) embeds the asset id', () => {
    const q = nftActivityQuery(ASSET)
    expect(q).toContain(ASSET.toLowerCase())
    expect(nftActivityQuery()).not.toContain(ASSET.toLowerCase())
  })
})

describe('query builders — shape sanity', () => {
  it('each query is a single balanced GraphQL operation (braces balanced)', () => {
    const queries = [
      yieldFarmsQuery(),
      yieldFarmsQuery(OWNER),
      presalesQuery(),
      presalesQuery(POOL),
      nftBalancesQuery(OWNER),
      nftCollectionsQuery(),
      nftAssetsQuery(),
      nftAssetsQuery(COLLECTION),
      nftBidsQuery(),
      nftBidsQuery(ASSET),
      nftActivityQuery(),
      nftActivityQuery(ASSET),
    ]
    for (const q of queries) {
      expect(q).toMatch(/^query \w+\s*\{/)
      const open = (q.match(/\{/g) ?? []).length
      const close = (q.match(/\}/g) ?? []).length
      expect(open).toBe(close)
      expect(q.startsWith('query ')).toBe(true)
    }
  })
})
