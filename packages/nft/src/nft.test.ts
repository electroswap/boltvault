import { describe, expect, it } from 'vitest'
import {
  MEDIA_GATEWAYS,
  isSvg,
  resolveMedia,
  svgSafe,
} from './media.js'
import { parseAssets, parseBids, parseCollections, parseActivity } from './parse.js'
import { fulfillOrderCall, ownerCheck, SEAPORT_15, CONDUIT_KEY } from './tx.js'
import { MARKETPLACE_FEE_BPS, feeLine } from './fee.js'

const ADDR = `0x${'ab'.repeat(20)}`

describe('nft/media', () => {
  it('maps ipfs:// URIs to the first gateway', () => {
    const out = resolveMedia('ipfs://Qmabc')
    expect(out.startsWith(MEDIA_GATEWAYS[0]!)).toBe(true)
    expect(out).toBe(MEDIA_GATEWAYS[0]! + 'Qmabc')
  })

  it('passes http(s) URIs through unchanged', () => {
    expect(resolveMedia('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
  })

  it('detects svg urls case-insensitively and svgSafe is true', () => {
    expect(isSvg('https://x/a.svg')).toBe(true)
    expect(isSvg('https://x/a.SVG?x=1')).toBe(true)
    expect(isSvg('https://x/a.png')).toBe(false)
    expect(svgSafe('https://x/a.svg')).toBe(true)
    expect(svgSafe('https://x/a.png')).toBe(true)
  })
})

describe('nft/parse', () => {
  it('parseAssets maps a top-level array of raw assets', () => {
    const assets = parseAssets([
      {
        collection: ADDR,
        tokenId: '1',
        name: 'Cat #1',
        image: 'ipfs://QmCat',
        floor: 1000000,
        owner: `0x${'cd'.repeat(20)}`,
        listed: true,
      },
      { collection: ADDR, tokenId: '2', tokenUri: 'https://x/a.svg' },
      { not: 'valid' },
    ])
    expect(assets).toHaveLength(2)
    const a0 = assets[0]!
    expect(a0).toEqual({
      collection: ADDR,
      tokenId: '1',
      name: 'Cat #1',
      mediaUri: 'ipfs://QmCat',
      floor: 1000000,
      owner: `0x${'cd'.repeat(20)}`,
      listed: true,
    })
    expect(assets[1]!.mediaUri).toBe('https://x/a.svg')
  })

  it('parseAssets accepts { assets: [...] } wrapper and coerces numeric token ids', () => {
    const assets = parseAssets({ assets: [{ collection: ADDR, token_id: 7 }] })
    expect(assets).toHaveLength(1)
    expect(assets[0]!.tokenId).toBe('7')
  })

  it('parseBids maps fixtures and coerces bigints', () => {
    const bids = parseBids({
      bids: [
        { asset: ADDR, tokenId: '1', price: '2500000000000000000', bidder: `0x${'ee'.repeat(20)}`, expiresAt: 1999999999 },
        { asset: ADDR, tokenId: '1', price: 1000n, bidder: `0x${'ee'.repeat(20)}` },
        { asset: ADDR, tokenId: '2' }, // no price → skipped
      ],
    })
    expect(bids).toHaveLength(2)
    expect(bids[0]!.price).toBe(2500000000000000000n)
    expect(bids[0]!.expiresAt).toBe(1999999999)
    expect(bids[1]!.price).toBe(1000n)
    expect(bids[1]!.expiresAt).toBeUndefined()
  })

  it('parseCollections and parseActivity map fixtures', () => {
    const collections = parseCollections([
      { id: ADDR, name: 'Bolt Cats', floor: 10 },
      { id: ADDR }, // no name → skipped
    ])
    expect(collections).toHaveLength(1)
    expect(collections[0]!.name).toBe('Bolt Cats')

    const activity = parseActivity({
      activity: [
        { asset: ADDR, tokenId: '1', kind: 'sale', price: '5', from: `0x${'11'.repeat(20)}`, to: `0x${'22'.repeat(20)}`, at: 1700000000 },
        { asset: ADDR, tokenId: '1', kind: 'warp' }, // bad kind → skipped
      ],
    })
    expect(activity).toHaveLength(1)
    expect(activity[0]!.kind).toBe('sale')
    expect(activity[0]!.price).toBe(5n)
  })

  it('returns [] for unknown shapes', () => {
    expect(parseCollections(null)).toEqual([])
    expect(parseAssets({ other: 1 })).toEqual([])
    expect(parseBids('nope')).toEqual([])
    expect(parseActivity(42)).toEqual([])
  })
})

describe('nft/tx', () => {
  it('fulfillOrderCall targets SEAPORT_15 with non-empty calldata', () => {
    const order = { order: `0x${'aa'.repeat(64)}`, conduitKey: CONDUIT_KEY }
    const call = fulfillOrderCall(order)
    expect(call.to).toBe(SEAPORT_15)
    expect(call.data).toMatch(/^0x[0-9a-f]+$/)
    expect(call.data.length).toBeGreaterThan(4)
    expect(call.value).toBe(0n)
  })

  it('throws on an unexpected conduit key', () => {
    expect(() => fulfillOrderCall({ order: `0x${'aa'.repeat(64)}`, conduitKey: `0x${'ff'.repeat(32)}` })).toThrow(/conduit/i)
    // no conduitKey → fine
    expect(fulfillOrderCall({ order: `0x${'aa'.repeat(64)}` }).to).toBe(SEAPORT_15)
  })

  it('accepts a custom builder (link-out)', () => {
    const call = fulfillOrderCall({ order: '0x' }, (o) => ({ data: '0xdeadbeef', value: 42n }))
    expect(call).toEqual({ to: SEAPORT_15, data: '0xdeadbeef', value: 42n })
  })

  it('ownerCheck resolves the owner via the injected client', async () => {
    const owner = `0x${'cd'.repeat(20)}`
    const client = {
      readContract: async () => owner,
    }
    expect(await ownerCheck(client, { address: ADDR, tokenId: '1' })).toBe(owner)
    expect(await ownerCheck(client, { address: ADDR, tokenId: '1', expectedOwner: owner.toUpperCase() })).toBe(owner)
    await expect(
      ownerCheck(client, { address: ADDR, tokenId: '1', expectedOwner: `0x${'ee'.repeat(20)}` }),
    ).rejects.toThrow(/owner mismatch/i)
  })
})

describe('nft/fee', () => {
  it('marketplace fee is 300 bps with no wallet fee', () => {
    expect(MARKETPLACE_FEE_BPS).toBe(300)
    const line = feeLine(1000n)
    expect(line).toContain('no wallet fee')
    expect(line).toContain('300 bps')
    expect(line).toContain('3.00%')
  })
})
