/**
 * M6 data layer: the GraphQL documents name the schema's fields, the view
 * mappers survive nulls, the Seaport builder splits fees the way the
 * interface does and produces typed data the firewall reads as a marketplace
 * order, farm math matches the contract, and the launchpad/Legends helpers
 * follow the binding tables.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { parseTypedData } from '@boltvault/security'
import { decodeFunctionData, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  BOLT_STAIRS,
  ElectroSwapClient,
  MARKETPLACE_FEE_BPS,
  NFT_ASSETS,
  PRESALES,
  SEAPORT_ABI,
  TOP_TOKENS,
  YIELD_FARMS,
  YIELD_FARM_ABI,
  blocksUntilMultiplier,
  buildListing,
  buildOffer,
  campaignKeys,
  campaignPhase,
  claimableIds,
  dilution,
  durationMultiplier,
  encodeCancel,
  encodeCollect,
  encodeFulfillOrder,
  fetchAsset,
  fetchCampaigns,
  fetchFarms,
  fetchTopTokens,
  listingPrice,
  nextBoltStair,
  orderHash,
  orderIntakeBody,
  orderTypedData,
  parseProtocolParameters,
  poolStatus,
  referrerFromLink,
  sellerProceeds,
  sqrtRatioAtTick,
  toParameters,
  v2Counterpart,
  v3AmountsForLiquidity,
  v3Counterpart,
  vesselLevel,
  type MarketplaceConfig,
} from '../src'

const A = ELECTRONEUM_ADDRESSES[52014]
const config: MarketplaceConfig = { chainId: 52014, seaport: A.seaport15 as Hex, conduitKey: A.seaportConduitKey as Hex, conduit: A.seaportConduit as Hex, feeReceiver: A.nftFeeReceiver as Hex, wetn: A.wetn as Hex }
const SELLER = '0x1111111111111111111111111111111111111111' as Hex
const BIDDER = '0x2222222222222222222222222222222222222222' as Hex
const LEGENDS = A.electricLegends as Hex
const CREATOR = { payoutAddress: '0x3333333333333333333333333333333333333333' as Hex, basisPoints: 500 }
const NOW = 1_757_000_000_000
const SALT = 0x1234n

function clientWith(answer: (query: string, variables: Record<string, unknown>) => unknown): ElectroSwapClient {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { query: string; variables: Record<string, unknown> }
    return new Response(JSON.stringify({ data: answer(body.query, body.variables) }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new ElectroSwapClient({ fetchImpl })
}

describe('documents and views', () => {
  it('the documents ask for the schema fields the surfaces render', () => {
    expect(TOP_TOKENS).toContain('topTokens(chain: $chain, orderBy: VOLUME')
    expect(NFT_ASSETS).toContain('nftAssets(chain: $chain, address: $address')
    expect(PRESALES).toContain('presales(chain: $chain, filter: $filter')
    expect(YIELD_FARMS).toContain('yieldFarms(chain: $chain, farmer: $farmer, active: $active)')
  })
  it('tokens: sorted by volume, nulls tolerated, native flagged', async () => {
    const client = clientWith(() => ({ topTokens: [{ address: 'NATIVE', symbol: 'ETN', name: 'Electroneum', decimals: 18, standard: 'NATIVE', market: { price: { value: 0.00296 }, volume: { value: 10 } }, project: null }, { address: A.bolt, symbol: 'BOLT', name: 'BOLT', decimals: 18, standard: 'ERC20', market: { price: { value: 0.19 }, volume: { value: 500 }, day: { value: -0.8 } }, project: { safetyLevel: 'VERIFIED', isSpam: false } }, null] }))
    const rows = await fetchTopTokens(client, 52014)
    expect(rows.map((r) => r.symbol)).toEqual(['BOLT', 'ETN'])
    expect(rows[1]).toMatchObject({ address: 'native', native: true, price: 0.00296, safety: null })
    expect(rows[0]).toMatchObject({ safety: 'VERIFIED', change24h: -0.8 })
  })
  it('an asset carries its valid listing, the best bid and the creator fee', async () => {
    const client = clientWith(() => ({
      nftAssetDetails: {
        tokenId: '12',
        name: 'Volt #12',
        image: { url: 'https://static.electroswap.io/nfts/x/12_medium.webp' },
        ownerAddress: SELLER,
        rarities: [{ rank: 7 }],
        nftContract: { address: LEGENDS, standard: 'ERC721' },
        collection: { collectionId: LEGENDS, name: 'Electric Legends', isVerified: true, listingFees: [{ payoutAddress: CREATOR.payoutAddress, basisPoints: 500 }] },
        listings: { edges: [{ node: { type: 'LISTING', status: 'EXPIRED', maker: SELLER, price: { value: 3 } } }, { node: { type: 'LISTING', status: 'VALID', maker: SELLER, price: { value: 4.2 }, signature: '0xabc', protocolParameters: '{"offerer":"0x1111111111111111111111111111111111111111"}' } }] },
        bids: { edges: [{ node: { type: 'BID', status: 'VALID', maker: BIDDER, price: { value: 3.5 } } }, { node: { type: 'BID', status: 'VALID', maker: BIDDER, price: { value: 3.9 } } }] },
      },
    }))
    const a = await fetchAsset(client, 52014, LEGENDS, '12')
    expect(a?.listing?.priceEtn).toBe(4.2)
    expect(a?.listing?.protocolParameters).toEqual({ offerer: SELLER })
    expect(a?.bestBid?.priceEtn).toBe(3.9)
    expect(a?.creatorFee).toEqual(CREATOR)
    expect(a?.rarityRank).toBe(7)
  })
  it('campaigns and farms map the wire shapes', async () => {
    const client = clientWith((q) => (q.includes('presales(') ? { presales: { edges: [{ node: { pool: '0x9999999999999999999999999999999999999999', status: 'ACTIVE', shareLink: 'abc', affiliate: { percent: 5 }, token: { name: 'Zap', symbol: 'ZAP', decimals: 18 }, campaign: { manager: A.launchpadManager, creator: SELLER, description: 'x', starts: 1, ends: 2, etnRaised: 1000, minEtnToLaunch: 5000, minEtnToList: 100, contributorCount: 3 } } }] } } : { yieldFarms: [{ id: 1, version: 3, name: 'ETN/USDC', poolAddr: '0x8888888888888888888888888888888888888888', liquidity: '10', token0: A.wetn, token1: A.usdc, tokenId: 5, fee: 3000, active: true, tvl: 12000, baseRewardApy: 41.2, farmer: { addr: SELLER, liquidity: '5', durationMultiplier: 1.2, boltMultiplier: 1.05, boltDeposited: '0', startingBlock: 100, rewards: '7', thirdPartyRewards: '0', farmOwnership: 0.5 } }] }))
    const [c] = await fetchCampaigns(client, 52014, ['ACTIVE'])
    expect(c).toMatchObject({ status: 'ACTIVE', affiliatePercent: 5, raisedEtn: 1000, token: { symbol: 'ZAP' } })
    const [f] = await fetchFarms(client, 52014, SELLER)
    expect(f).toMatchObject({ id: 1, version: 3, tokenId: 5, farmer: { rewards: '7' } })
  })
})

describe('Seaport orders as ElectroSwap builds them', () => {
  it('a listing splits the price seller / creator / 3 % platform and signs as OrderComponents', () => {
    const price = 4_200_000_000_000_000_000n
    const order = buildListing({ config, seller: SELLER, token: LEGENDS, tokenId: 12n, standard: 'ERC721', priceWei: price, creatorFee: CREATOR, endTime: 1_760_000_000n, counter: 0n, salt: SALT, now: NOW })
    const split = sellerProceeds(price, CREATOR)
    expect(split.platform).toBe((price * BigInt(MARKETPLACE_FEE_BPS)) / 10_000n)
    expect(split.seller + split.creator + split.platform).toBe(price)
    expect(order.consideration.map((c) => [c.recipient, c.startAmount])).toEqual([
      [SELLER, split.seller],
      [CREATOR.payoutAddress, split.creator],
      [config.feeReceiver, split.platform],
    ])
    expect(order.orderType).toBe(1)
    expect(listingPrice(order)).toBe(price)
    // The firewall reads the typed data as a marketplace order with the offerer paid.
    const typed = orderTypedData(config, order)
    const parsed = parseTypedData(typed)
    expect(parsed?.decoded.kind).toBe('seaport_order')
    expect(parsed?.decoded.kind === 'seaport_order' && parsed.decoded.zeroConsideration).toBe(false)
    expect(parsed?.domain.verifyingContract?.toLowerCase()).toBe(A.seaport15.toLowerCase())
    // Hash, parameters and the intake body agree.
    const hash = orderHash(order)
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    const body = orderIntakeBody({ type: 'LISTING', config, token: LEGENDS, tokenId: 12n, order, signature: '0xsig' as Hex })
    expect(body).toMatchObject({ type: 'LISTING', chainId: 52014, protocol_address: A.seaport15, tokenId: 12, order_hash: hash })
    const params = (body['parameters'] as { consideration: unknown[]; totalOriginalConsiderationItems: number })
    expect(params.consideration.length).toBe(3)
    expect(params.totalOriginalConsiderationItems).toBe(3)
    // The API's stored parameters come back as the same components.
    const back = parseProtocolParameters(body['parameters'])
    expect(back).not.toBeNull()
    expect(back && orderHash(back)).toBe(hash)
  })
  it('an offer bids WETN and asks the piece for the bidder; fulfil and cancel calldata decode', () => {
    const price = 3_900_000_000_000_000_000n
    const order = buildOffer({ config, bidder: BIDDER, owner: SELLER, token: LEGENDS, tokenId: 12n, priceWei: price, creatorFee: null, endTime: 1_760_000_000n, counter: 2n, salt: SALT, now: NOW })
    expect(order.offer[0]).toMatchObject({ itemType: 1, token: A.wetn, startAmount: price })
    expect(order.consideration.at(-1)).toMatchObject({ itemType: 2, token: LEGENDS, identifierOrCriteria: 12n, recipient: BIDDER })
    expect(order.consideration[0]).toMatchObject({ itemType: 1, token: A.wetn, recipient: SELLER, startAmount: price - (price * 300n) / 10_000n })
    expect(order.orderType).toBe(0)
    const listing = buildListing({ config, seller: SELLER, token: LEGENDS, tokenId: 12n, standard: 'ERC721', priceWei: price, creatorFee: null, endTime: 1_760_000_000n, counter: 0n, salt: SALT, now: NOW })
    const fulfil = encodeFulfillOrder(toParameters(listing), '0xdead' as Hex)
    expect(fulfil.value).toBe(price)
    const d = decodeFunctionData({ abi: SEAPORT_ABI, data: fulfil.data })
    expect(d.functionName).toBe('fulfillOrder')
    const c = decodeFunctionData({ abi: SEAPORT_ABI, data: encodeCancel([listing]) })
    expect(c.functionName).toBe('cancel')
  })
})

describe('farm math (YieldFarm.sol)', () => {
  it('duration multiplier is linear to 2.5× over a year of blocks', () => {
    expect(durationMultiplier(0n)).toBe(10_000n)
    expect(durationMultiplier(6_307_200n / 2n)).toBe(17_500n)
    expect(durationMultiplier(6_307_200n)).toBe(25_000n)
    expect(durationMultiplier(10_000_000n)).toBe(25_000n)
    expect(blocksUntilMultiplier(0n, 20_000n)).toBe(4_204_800n)
    expect(blocksUntilMultiplier(5_000_000n, 20_000n)).toBe(0n)
  })
  it('a second deposit dilutes the served blocks by the share it adds', () => {
    // Half a year served (3 153 600 blocks) → 1.75×; doubling the stake halves the served blocks → 1.375×.
    const d = dilution({ existingLiquidity: 100n, startingBlock: 1_000n, currentBlock: 3_154_600n, addedLiquidity: 100n })
    expect(d.before).toBe(17_500n)
    expect(d.blocksLost).toBe((3_153_600n * 5n) / 10n)
    expect(d.after).toBe(13_750n)
    expect(dilution({ existingLiquidity: 0n, startingBlock: 0n, currentBlock: 10n, addedLiquidity: 5n }).blocksLost).toBe(0n)
  })
  it('BOLT stairs are exact totals', () => {
    expect(BOLT_STAIRS.map((s) => s.multiplier)).toEqual([10_000n, 10_500n, 11_500n])
    expect(nextBoltStair(0n)?.more).toBe(50_000n * 10n ** 18n)
    expect(nextBoltStair(50_000n * 10n ** 18n)?.multiplier).toBe(11_500n)
    expect(nextBoltStair(100_000n * 10n ** 18n)).toBeNull()
  })
  it('collect is withdraw(id, 0, asNative)', () => {
    const d = decodeFunctionData({ abi: YIELD_FARM_ABI, data: encodeCollect(3n, true) })
    expect(d.functionName).toBe('withdraw')
    expect(d.args).toEqual([3n, 0n, true])
  })
  it('V2 counterpart from reserves; V3 amounts from the range', () => {
    expect(v2Counterpart(1_000n, 10_000n, 20_000n)).toBe(2_000n)
    // At tick 0 the price is 1:1 and sqrtRatio is 2^96.
    expect(sqrtRatioAtTick(0)).toBe(1n << 96n)
    expect(sqrtRatioAtTick(-887_272)).toBe(4_295_128_739n)
    const price = 1n << 96n
    const { amount1, liquidity } = v3Counterpart(1_000_000n, price, -6_000, 6_000)
    expect(liquidity).toBeGreaterThan(0n)
    const back = v3AmountsForLiquidity(price, -6_000, 6_000, liquidity)
    expect(back.amount0).toBeLessThanOrEqual(1_000_000n)
    expect(back.amount0).toBeGreaterThan(990_000n)
    expect(back.amount1).toBeLessThanOrEqual(amount1 + 1n)
    expect(v3Counterpart(1_000n, sqrtRatioAtTick(7_000), -6_000, 6_000).liquidity).toBe(0n)
  })
})

describe('launchpad and Legends helpers', () => {
  it('status codes and phases follow the binding table', () => {
    expect([0, 1, 2, 3, 4].map(poolStatus)).toEqual(['ACTIVE', 'LAUNCHED', 'FAILED', 'CANCELLED', 'PENDING'])
    expect(campaignPhase('ACTIVE', 150, 100, 200)).toBe('live')
    expect(campaignPhase('ACTIVE', 250, 100, 200)).toBe('awaiting_finalize')
    expect(campaignPhase('ACTIVE', 50, 100, 200)).toBe('upcoming')
    expect(campaignKeys({ phase: 'live', contributedWei: 0n, claimed: false, claimableTokens: 0n, referralClaimable: 0n })).toEqual(['contribute'])
    expect(campaignKeys({ phase: 'launched', contributedWei: 5n, claimed: false, claimableTokens: 10n, referralClaimable: 1n })).toEqual(['claim_tokens', 'claim_referral'])
    expect(campaignKeys({ phase: 'failed', contributedWei: 5n, claimed: false, claimableTokens: 0n, referralClaimable: 0n })).toEqual(['claim_refund'])
    expect(campaignKeys({ phase: 'failed', contributedWei: 5n, claimed: true, claimableTokens: 0n, referralClaimable: 0n })).toEqual([])
  })
  it('referral links parse and unknown refs are dropped', () => {
    expect(referrerFromLink('boltvault://launchpad/0x9999999999999999999999999999999999999999?ref=0x1111111111111111111111111111111111111111')).toEqual({ pool: '0x9999999999999999999999999999999999999999', referrer: SELLER })
    expect(referrerFromLink('https://wallet.electroswap.io/launchpad/0x9999999999999999999999999999999999999999?refId=nope')?.referrer).toBeNull()
    expect(referrerFromLink('https://example.com/')).toBeNull()
  })
  it('claimable ids dedupe below the 1000-slot array; the vessel level clamps', () => {
    expect(claimableIds([5n, 5n, 1_200n, 7n])).toEqual([5n, 7n])
    expect(vesselLevel(0n, 10n)).toBe(0)
    expect(vesselLevel(5n, 10n)).toBe(0.5)
    expect(vesselLevel(50n, 10n)).toBe(1)
    expect(vesselLevel(3n, 0n)).toBe(1)
  })
})
