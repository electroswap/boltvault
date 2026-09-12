/**
 * The NFT marketplace (master plan §8.10) on ElectroSwap's Seaport 1.5:
 * inventory and collections from the API with the chain as the owner of
 * record, and the flows — List (approve the conduit once → sign the order
 * → hand it to the API), Offer (wrap → approve WETN → sign → API), Buy and
 * Accept (`fulfillOrder` after an `ownerOf` check), Cancel, Transfer, Mint.
 * Every signature and transaction goes through the same firewall and sheet.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import {
  ItemType,
  LEGENDS_ABI,
  SEAPORT_ABI,
  buildListing,
  buildOffer,
  encodeCancel,
  encodeFulfillOrder,
  fetchAsset,
  fetchAssets,
  fetchBidObligation,
  fetchBids,
  fetchCollectionBalances,
  fetchCollections,
  fetchNftActivity,
  fetchOwnedAssets,
  listingPrice,
  offerPrice,
  orderHash,
  orderIntakeBody,
  orderTypedData,
  parseProtocolParameters,
  proceedsRecipient,
  saltFrom,
  toParameters,
  type AssetView as EsAsset,
  type ElectroSwapClient,
  type MarketplaceConfig,
  type OrderComponents,
  type OrderView as EsOrder,
} from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { encodeFunctionData, parseAbi, parseUnits, type Hex } from 'viem'
import { z } from 'zod'
import { amountOrThrow } from '../amount'
import { EngineError } from '../errors'
import { cacheKey, type Cached, type DocCache } from '../cache'
import type { NamespaceSpec } from '../host'
import type { NotificationsService } from './notifications'
import type { CustomCollectionsService } from './nftCustom'
import { readMany } from '../multicall'
import {
  InventorySchema,
  AccountIdSchema,
  type AssetView,
  type Inventory,
  type NftActivityView,
  type OffersInbox,
  type OrderView,
} from '../schema'
import type { ChainsService } from './chains'
import type { ExploreService } from './explore'
import type { FlowStepRun, FlowStore } from './flows'
import type { LegendsService } from './legends'
import type { ProviderService } from './provider'
import type { VaultManager } from './vault'

const ERC721 = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
])
const ERC20 = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])
const WETH = parseAbi(['function deposit() payable'])

export interface NftDeps {
  /** Signed kill-switches (§3.7); absent in hosts that serve no statics. */
  readonly statics?: { isDisabled(feature: 'nft'): boolean }
  readonly platform: Platform
  readonly chains: ChainsService
  readonly vault: VaultManager
  readonly provider: ProviderService
  readonly flows: FlowStore
  readonly electroswap: ElectroSwapClient | null
  readonly explore: ExploreService
  readonly legends: LegendsService
  readonly cache: DocCache
  readonly notifications?: NotificationsService
  readonly custom?: CustomCollectionsService
}

/** The Rack embedded on Home and the Rack page mount back to back; within this window the second read is the first. */
const INVENTORY_TTL_MS = 20_000
const inventorySpec = (chainId: number, accountId: string) => ({
  key: cacheKey('nft', 'inventory', chainId, accountId),
  schema: InventorySchema,
})

const isEtn = (chainId: number): chainId is 52014 | 5201420 =>
  chainId === 52014 || chainId === 5201420
const hex = (n: bigint): Hex => `0x${n.toString(16)}`
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export function marketplaceConfig(chainId: 52014 | 5201420): MarketplaceConfig {
  const A = ELECTRONEUM_ADDRESSES[chainId]
  return {
    chainId,
    seaport: A.seaport15 as Hex,
    conduitKey: A.seaportConduitKey as Hex,
    conduit: A.seaportConduit as Hex,
    feeReceiver: A.nftFeeReceiver as Hex,
    wetn: A.wetn as Hex,
  }
}

function orderView(
  o: EsOrder,
  components: OrderComponents | null,
  owner: string | null = null,
): OrderView {
  const raw = components
    ? o.type === 'LISTING'
      ? listingPrice(components)
      : offerPrice(components)
    : null
  /*
    Who the money goes to, which is not always who is holding the piece
    (ES-BV-001). A bid names the owner-at-bid-time as the seller recipient and
    stays valid across a resale, so a bid in the new owner's inbox can pay the
    old one. Carried on the view so the inbox can say so and the accept path
    can refuse.
  */
  const proceedsTo = components ? proceedsRecipient(components) : null
  return {
    type: o.type,
    status: o.status,
    priceEtn: o.priceEtn,
    priceRaw: raw === null ? null : raw.toString(),
    orderHash: o.orderHash,
    maker: o.maker,
    createdAt: o.createdAt,
    endAt: o.endAt,
    actionable: components !== null && !!o.signature,
    proceedsTo,
    paysPreviousOwner:
      o.type !== 'LISTING' && owner !== null && proceedsTo !== null && !same(proceedsTo, owner),
  }
}

export class NftService {
  /**
   * The signed kill-switch for this surface (§3.7, docs/security.md).
   *
   * `statics.isDisabled` accepted six features and only `swap` and `bridge` ever
   * called it, so four of the six documented emergency controls did nothing: ops
   * could publish `limit: disabled` during an incident and the wallet would keep
   * placing orders. Hiding a screen is not the control either — every namespace
   * is callable from any UI page — so the check lives at the top of each verb
   * that starts a flow.
   */
  private assertEnabled(): void {
    if (this.deps.statics?.isDisabled('nft'))
      throw new EngineError(
        'invalid_argument',
        'The marketplace is switched off right now by a signed flag from ElectroSwap.',
      )
  }

  constructor(private readonly deps: NftDeps) {}

  private client(chainId: number): {
    client: ElectroSwapClient
    config: MarketplaceConfig
    chainId: 52014 | 5201420
  } {
    if (!this.deps.electroswap)
      throw new EngineError(
        'not_implemented',
        'The marketplace needs the ElectroSwap API, which is not reachable in this build.',
      )
    if (!isEtn(chainId))
      throw new EngineError('invalid_argument', 'The marketplace lives on Electroneum.')
    return { client: this.deps.electroswap, config: marketplaceConfig(chainId), chainId }
  }

  private async account(accountId: string): Promise<{ id: string; address: Hex; kind: string }> {
    const a = (await this.deps.vault.accounts()).find((x) => x.id === accountId)
    if (!a) throw new EngineError('not_found', 'no such account')
    return { id: a.id, address: a.address as Hex, kind: a.kind }
  }

  private async toView(
    chainId: 52014 | 5201420,
    a: EsAsset,
    me: Hex | null,
    dividends: bigint | null,
  ): Promise<AssetView> {
    const legends = ELECTRONEUM_ADDRESSES[chainId].electricLegends
    const listingComponents = a.listing
      ? parseProtocolParameters(a.listing.protocolParameters)
      : null
    const bids = a.bids.map((b) =>
      orderView(b, parseProtocolParameters(b.protocolParameters), a.owner),
    )
    return {
      chainId,
      address: a.address,
      tokenId: a.tokenId,
      name: a.name,
      description: a.description,
      imageUrl: a.imageUrl,
      smallImageUrl: a.smallImageUrl,
      animationUrl: a.animationUrl,
      mediaType: a.mediaType,
      owner: a.owner,
      mine: me !== null && a.owner !== null && same(a.owner, me),
      standard: a.standard,
      collectionName: a.collectionName,
      collectionVerified: a.collectionVerified,
      collectionImageUrl: a.collectionImageUrl,
      creatorFee: a.creatorFee,
      suspicious: a.suspicious,
      rarityRank: a.rarityRank,
      traits: a.traits.map((t) => ({ name: t.name, value: t.value, rarity: t.rarity })),
      lastPriceEtn: a.lastPriceEtn,
      listing: a.listing ? orderView(a.listing, listingComponents) : null,
      // The headline bid has to be one the owner could actually take (ES-BV-001).
      bestBid: bids.find((b) => !b.paysPreviousOwner) ?? null,
      bids,
      dividendsWei: dividends === null ? null : dividends.toString(),
      paysDividends: same(a.address, legends),
    }
  }

  /** The Rack: every piece the account holds, with floors, listings and offers (§8.10). Last-good within 20 s; persisted for the next popup open. */
  async inventory(accountId: string, chainId: number): Promise<Inventory> {
    const { chainId: cid } = this.client(chainId)
    const inv = (
      await this.deps.cache.through(inventorySpec(cid, accountId), INVENTORY_TTL_MS, () =>
        this.buildInventory(accountId, chainId),
      )
    ).value
    void this.noteOffers(inv)
    return inv
  }

  async cachedInventory(accountId: string, chainId: number): Promise<Cached<Inventory> | null> {
    return this.deps.cache.read(inventorySpec(chainId, accountId))
  }

  /** Every open bid on a piece is one inbox entry, once per order hash (plan A6). */
  private async noteOffers(inv: Inventory): Promise<void> {
    const n = this.deps.notifications
    if (!n) return
    for (const a of inv.assets) {
      for (const b of a.bids) {
        if (!b.orderHash) continue
        await n
          .push({
            id: `offer:${b.orderHash.toLowerCase()}`,
            kind: 'offer',
            title: `Offer on ${a.name}`,
            body: b.priceEtn !== null ? `${b.priceEtn} WETN` : 'A new offer',
            target: 'offers',
          })
          .catch(() => undefined)
      }
    }
  }

  private async buildInventory(accountId: string, chainId: number): Promise<Inventory> {
    const { client, chainId: cid } = this.client(chainId)
    const account = await this.account(accountId)
    const [owned, fetchedBalances] = await Promise.all([
      fetchOwnedAssets(client, cid, account.address),
      fetchCollectionBalances(client, cid, account.address).catch(() => []),
    ])
    const balances: Array<{
      address: string
      name: string
      logoUrl: string | null
      balance: number
    }> = fetchedBalances.map((b) => ({
      address: b.address,
      name: b.name,
      logoUrl: b.logoUrl,
      balance: b.balance,
    }))
    const addresses = [...new Set(balances.map((b) => b.address.toLowerCase()))]
    const collections = addresses.length
      ? await fetchCollections(client, cid, { addresses }).catch(() => [])
      : []
    const floors = new Map(collections.map((c) => [c.address.toLowerCase(), c.floorEtn]))
    const legendsAddr = ELECTRONEUM_ADDRESSES[cid].electricLegends
    const assets: AssetView[] = []
    let customAddresses = new Set<string>()
    for (const a of owned) {
      const dividends = same(a.address, legendsAddr)
        ? await this.deps.legends.claimableFor(cid, BigInt(a.tokenId)).catch(() => 0n)
        : null
      assets.push(await this.toView(cid, a, account.address, dividends))
    }
    // Custom collections (plan A3): the chain's own pieces, marked so the Piece view hides the marketplace verbs.
    if (this.deps.custom) {
      try {
        const mine = await this.deps.custom.ownedPieces(cid, account.address)
        for (const p of mine.pieces) {
          assets.push({
            chainId: cid,
            address: p.address,
            tokenId: p.tokenId,
            name: p.name,
            description: p.description,
            imageUrl: p.imageUrl,
            smallImageUrl: p.imageUrl,
            animationUrl: null,
            mediaType: p.imageUrl ? 'IMAGE' : null,
            owner: account.address,
            mine: true,
            standard: p.standard,
            collectionName:
              mine.collections.find((c) => same(c.address, p.address))?.name ??
              p.address.slice(0, 10),
            collectionVerified: false,
            collectionImageUrl: null,
            creatorFee: null,
            suspicious: false,
            rarityRank: null,
            traits: p.traits.map((t) => ({ name: t.name, value: t.value, rarity: null })),
            lastPriceEtn: null,
            listing: null,
            bestBid: null,
            bids: [],
            dividendsWei: null,
            paysDividends: false,
            custom: true,
          })
        }
        for (const c of mine.collections)
          if (c.balance > 0 && !balances.some((b) => same(b.address, c.address)))
            balances.push({ address: c.address, name: c.name, logoUrl: null, balance: c.balance })
        customAddresses = new Set(mine.collections.map((c) => c.address.toLowerCase()))
      } catch {
        // A custom collection that cannot be read is simply absent this time.
      }
    }
    let floorValue = 0
    let priced = false
    for (const b of balances) {
      const f = floors.get(b.address.toLowerCase())
      if (f !== null && f !== undefined) {
        floorValue += f * b.balance
        priced = true
      }
    }
    return {
      accountId,
      chainId: cid,
      assets,
      collections: balances.map((b) => ({
        address: b.address,
        name: b.name,
        logoUrl: b.logoUrl,
        balance: b.balance,
        floorEtn: floors.get(b.address.toLowerCase()) ?? null,
        ...(customAddresses.has(b.address.toLowerCase()) ? { custom: true } : {}),
      })),
      floorValueEtn: priced ? floorValue : null,
      listedCount: assets.filter((a) => a.listing !== null).length,
      withOffersCount: assets.filter((a) => a.bids.length > 0).length,
      observedAt: this.deps.platform.now(),
    }
  }

  /** A collection's pieces, paged and filtered (§8.10 Collections). */
  async assets(
    chainId: number,
    address: string,
    opts: {
      orderBy?: 'PRICE' | 'RARITY'
      asc?: boolean
      listed?: boolean
      traits?: Array<{ name: string; values: string[] }>
      query?: string
      after?: string
      accountId?: string
    },
  ): Promise<{ assets: AssetView[]; total: number | null; next: string | null }> {
    const { client, chainId: cid } = this.client(chainId)
    const me = opts.accountId ? (await this.account(opts.accountId)).address : null
    const page = await fetchAssets(client, cid, address, {
      ...(opts.orderBy ? { orderBy: opts.orderBy } : {}),
      ...(opts.asc !== undefined ? { asc: opts.asc } : {}),
      ...(opts.listed !== undefined ? { listed: opts.listed } : {}),
      ...(opts.traits ? { traits: opts.traits } : {}),
      ...(opts.query ? { query: opts.query } : {}),
      ...(opts.after ? { after: opts.after } : {}),
    })
    const assets: AssetView[] = []
    for (const a of page.assets) assets.push(await this.toView(cid, a, me, null))
    return { assets, total: page.total, next: page.next }
  }

  /** One piece, with the chain's owner as the truth and the Legend's unclaimed dividends. */
  async asset(
    chainId: number,
    address: string,
    tokenId: string,
    accountId?: string,
  ): Promise<AssetView | null> {
    const { client, chainId: cid } = this.client(chainId)
    const a = await fetchAsset(client, cid, address, tokenId)
    if (!a) return null
    const [ownerRead] = await readMany(this.deps.chains, cid, [
      { address: address as Hex, abi: ERC721, functionName: 'ownerOf', args: [BigInt(tokenId)] },
    ])
    const chainOwner = ownerRead?.ok && typeof ownerRead.value === 'string' ? ownerRead.value : null
    const me = accountId ? (await this.account(accountId)).address : null
    const dividends = same(address, ELECTRONEUM_ADDRESSES[cid].electricLegends)
      ? await this.deps.legends.claimableFor(cid, BigInt(tokenId)).catch(() => 0n)
      : null
    const view = await this.toView(cid, { ...a, owner: chainOwner ?? a.owner }, me, dividends)
    // A listing whose maker no longer owns the piece is dead, whatever the index says (§8.10 Buy).
    if (view.listing && chainOwner && !same(view.listing.maker, chainOwner))
      return { ...view, listing: null }
    return view
  }

  async activity(chainId: number, address: string, tokenId?: string): Promise<NftActivityView[]> {
    const { client, chainId: cid } = this.client(chainId)
    return fetchNftActivity(client, cid, { address, ...(tokenId ? { tokenId } : {}) })
  }

  /** Offers inbox: on my pieces, and the ones I made, with the WETN they commit (§8.10). */
  async offers(accountId: string, chainId: number): Promise<OffersInbox> {
    const { client, chainId: cid, config } = this.client(chainId)
    const account = await this.account(accountId)
    const inv = await this.inventory(accountId, chainId)
    const received = inv.assets.flatMap((asset) => asset.bids.map((offer) => ({ asset, offer })))
    received.sort((a, b) => (b.offer.priceEtn ?? 0) - (a.offer.priceEtn ?? 0))
    const made = (await fetchBids(client, cid, account.address).catch(() => [])).map((b) => ({
      address: b.address,
      tokenId: b.tokenId,
      name: b.name,
      imageUrl: b.imageUrl,
      collectionName: b.collectionName,
      offer: orderView(b.order, parseProtocolParameters(b.order.protocolParameters)),
      expiresAt: b.expiresAt,
    }))
    const obligation = await fetchBidObligation(client, cid, account.address).catch(() => 0n)
    const [bal] = await readMany(this.deps.chains, cid, [
      { address: config.wetn, abi: ERC20, functionName: 'balanceOf', args: [account.address] },
    ])
    return {
      received,
      made,
      obligationWei: obligation.toString(),
      wetnBalanceWei: (bal?.ok && typeof bal.value === 'bigint' ? bal.value : 0n).toString(),
    }
  }

  // ---- flows ---------------------------------------------------------------------------------

  private async counter(
    chainId: 52014 | 5201420,
    config: MarketplaceConfig,
    offerer: Hex,
  ): Promise<bigint> {
    const [r] = await readMany(this.deps.chains, chainId, [
      { address: config.seaport, abi: SEAPORT_ABI, functionName: 'getCounter', args: [offerer] },
    ])
    return r?.ok && typeof r.value === 'bigint' ? r.value : 0n
  }

  private approveCollectionStep(
    chainId: number,
    accountId: string,
    owner: Hex,
    collection: Hex,
    conduit: Hex,
  ): FlowStepRun {
    return {
      step: 'approve_collection',
      waitReceipt: true,
      run: () =>
        this.deps.provider.runInternal({
          kind: 'send_transaction',
          origin: 'internal:nft:approve',
          chainId,
          accountId,
          tx: {
            from: owner,
            to: collection,
            value: '0x0',
            data: encodeFunctionData({
              abi: ERC721,
              functionName: 'setApprovalForAll',
              args: [conduit, true],
            }),
          },
          clientRequestId: `nft:approve:${collection}:${this.deps.platform.now()}`,
        }),
    }
  }

  private async needsCollectionApproval(
    chainId: 52014 | 5201420,
    owner: Hex,
    collection: Hex,
    conduit: Hex,
  ): Promise<boolean> {
    const [r] = await readMany(this.deps.chains, chainId, [
      {
        address: collection,
        abi: ERC721,
        functionName: 'isApprovedForAll',
        args: [owner, conduit],
      },
    ])
    return !(r?.ok && r.value === true)
  }

  /** List a piece: approve the conduit once for the collection → sign the order → the API stores it (§8.10 List). */
  async list(input: {
    accountId: string
    chainId: number
    address: string
    tokenId: string
    priceEtn: string
    days: number
  }): Promise<{ flowId: string; requestId: string | null }> {
    this.assertEnabled()
    const { client, chainId, config } = this.client(input.chainId)
    const account = await this.account(input.accountId)
    if (account.kind === 'watch')
      throw new EngineError(
        'invalid_argument',
        'Watch-only — import a key or pair a device to list.',
      )
    const price = amountOrThrow(input.priceEtn, 18)
    if (price <= 0n) throw new EngineError('invalid_argument', 'Enter a price above zero.')
    if (!Number.isFinite(input.days) || input.days < 1 || input.days > 180)
      throw new EngineError('invalid_argument', 'Choose between 1 and 180 days.')
    const asset = await this.asset(input.chainId, input.address, input.tokenId, input.accountId)
    if (!asset)
      throw new EngineError('not_found', 'That piece is not in the marketplace index yet.')
    if (!asset.mine) throw new EngineError('invalid_argument', 'You do not own this piece.')
    if (asset.listing && asset.listing.priceRaw && BigInt(asset.listing.priceRaw) < price)
      throw new EngineError(
        'invalid_argument',
        'A new listing cannot raise the price — cancel the current one first.',
      )
    const collection = input.address as Hex
    const steps: FlowStepRun[] = []
    if (await this.needsCollectionApproval(chainId, account.address, collection, config.conduit))
      steps.push(
        this.approveCollectionStep(
          chainId,
          input.accountId,
          account.address,
          collection,
          config.conduit,
        ),
      )
    const counter = await this.counter(chainId, config, account.address)
    const endTime = BigInt(
      Math.floor(this.deps.platform.now() / 1000) + Math.round(input.days * 86_400),
    )
    const order = buildListing({
      config,
      seller: account.address,
      token: collection,
      tokenId: BigInt(input.tokenId),
      standard: asset.standard === 'ERC1155' ? 'ERC1155' : 'ERC721',
      priceWei: price,
      creatorFee: asset.creatorFee
        ? {
            payoutAddress: asset.creatorFee.payoutAddress as Hex,
            basisPoints: asset.creatorFee.basisPoints,
          }
        : null,
      endTime,
      counter,
      salt: saltFrom(this.deps.platform.random(32)),
      now: this.deps.platform.now(),
    })
    let signature: Hex | null = null
    steps.push({
      step: 'sign_order',
      run: async () => {
        const r = await this.deps.provider.runInternal({
          kind: 'sign_typed_data',
          origin: 'internal:nft:list',
          chainId,
          accountId: input.accountId,
          from: account.address,
          typedData: orderTypedData(config, order),
          version: 'v4',
          clientRequestId: `nft:list:${collection}:${input.tokenId}:${this.deps.platform.now()}`,
        })
        const settled = r.result.then((sig) => {
          signature = sig as Hex
          return sig
        })
        settled.catch(() => undefined)
        return { requestId: r.requestId, result: settled }
      },
    })
    steps.push({
      step: 'post_order',
      run: async () => {
        if (!signature) throw new EngineError('internal', 'no signature')
        const res = await client.postOrder(
          orderIntakeBody({
            type: 'LISTING',
            config,
            token: collection,
            tokenId: BigInt(input.tokenId),
            order,
            signature,
          }),
        )
        if (!res.ok)
          throw new EngineError('internal', res.message ?? 'The marketplace refused the listing.')
        return { requestId: null, result: Promise.resolve(orderHash(order)) }
      },
    })
    const flow = await this.deps.flows.start({
      kind: 'nft',
      accountId: input.accountId,
      chainId,
      quote: null,
      steps,
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  /** Offer WETN for a piece: wrap what is short → approve the conduit → sign → the API stores it (§8.10 Offer). */
  async offer(input: {
    accountId: string
    chainId: number
    address: string
    tokenId: string
    priceEtn: string
    days: number
  }): Promise<{ flowId: string; requestId: string | null }> {
    this.assertEnabled()
    const { client, chainId, config } = this.client(input.chainId)
    const account = await this.account(input.accountId)
    if (account.kind === 'watch')
      throw new EngineError(
        'invalid_argument',
        'Watch-only — import a key or pair a device to make offers.',
      )
    const price = amountOrThrow(input.priceEtn, 18)
    if (price <= 0n) throw new EngineError('invalid_argument', 'Enter an offer above zero.')
    if (!Number.isFinite(input.days) || input.days < 1 || input.days > 180)
      throw new EngineError('invalid_argument', 'Choose between 1 and 180 days.')
    const asset = await this.asset(input.chainId, input.address, input.tokenId, input.accountId)
    if (!asset || !asset.owner)
      throw new EngineError('not_found', 'That piece is not in the marketplace index yet.')
    if (asset.mine) throw new EngineError('invalid_argument', 'You already own this piece.')
    const [wetnBal, native] = await Promise.all([
      readMany(this.deps.chains, chainId, [
        { address: config.wetn, abi: ERC20, functionName: 'balanceOf', args: [account.address] },
        {
          address: config.wetn,
          abi: ERC20,
          functionName: 'allowance',
          args: [account.address, config.conduit],
        },
      ]),
      this.deps.chains
        .rpc(chainId, 'eth_getBalance', [account.address, 'latest'])
        .catch(() => '0x0'),
    ])
    const held = wetnBal[0]?.ok && typeof wetnBal[0].value === 'bigint' ? wetnBal[0].value : 0n
    const allowance = wetnBal[1]?.ok && typeof wetnBal[1].value === 'bigint' ? wetnBal[1].value : 0n
    const obligation = await fetchBidObligation(client, chainId, account.address).catch(() => 0n)
    const needed = price + obligation
    const shortfall = needed > held ? needed - held : 0n
    if (shortfall > BigInt(String(native)))
      throw new EngineError(
        'invalid_argument',
        'Not enough ETN to back this offer alongside your open ones.',
      )
    const steps: FlowStepRun[] = []
    if (shortfall > 0n)
      steps.push({
        step: 'wrap',
        waitReceipt: true,
        run: () =>
          this.deps.provider.runInternal({
            kind: 'send_transaction',
            origin: 'internal:nft:wrap',
            chainId,
            accountId: input.accountId,
            tx: {
              from: account.address,
              to: config.wetn,
              value: hex(shortfall),
              data: encodeFunctionData({ abi: WETH, functionName: 'deposit' }),
            },
            clientRequestId: `nft:wrap:${this.deps.platform.now()}`,
          }),
      })
    if (allowance < needed)
      steps.push({
        step: 'approve',
        waitReceipt: true,
        run: () =>
          this.deps.provider.runInternal({
            kind: 'send_transaction',
            origin: 'internal:nft:approve',
            chainId,
            accountId: input.accountId,
            tx: {
              from: account.address,
              to: config.wetn,
              value: '0x0',
              data: encodeFunctionData({
                abi: ERC20,
                functionName: 'approve',
                args: [config.conduit, needed],
              }),
            },
            clientRequestId: `nft:approve-wetn:${this.deps.platform.now()}`,
          }),
      })
    const counter = await this.counter(chainId, config, account.address)
    const endTime = BigInt(
      Math.floor(this.deps.platform.now() / 1000) + Math.round(input.days * 86_400),
    )
    const order = buildOffer({
      config,
      bidder: account.address,
      owner: asset.owner as Hex,
      token: input.address as Hex,
      tokenId: BigInt(input.tokenId),
      priceWei: price,
      creatorFee: asset.creatorFee
        ? {
            payoutAddress: asset.creatorFee.payoutAddress as Hex,
            basisPoints: asset.creatorFee.basisPoints,
          }
        : null,
      endTime,
      counter,
      salt: saltFrom(this.deps.platform.random(32)),
      now: this.deps.platform.now(),
    })
    let signature: Hex | null = null
    steps.push({
      step: 'sign_order',
      run: async () => {
        const r = await this.deps.provider.runInternal({
          kind: 'sign_typed_data',
          origin: 'internal:nft:offer',
          chainId,
          accountId: input.accountId,
          from: account.address,
          typedData: orderTypedData(config, order),
          version: 'v4',
          clientRequestId: `nft:offer:${input.address}:${input.tokenId}:${this.deps.platform.now()}`,
        })
        const settled = r.result.then((sig) => {
          signature = sig as Hex
          return sig
        })
        settled.catch(() => undefined)
        return { requestId: r.requestId, result: settled }
      },
    })
    steps.push({
      step: 'post_order',
      run: async () => {
        if (!signature) throw new EngineError('internal', 'no signature')
        const res = await client.postOrder(
          orderIntakeBody({
            type: 'BID',
            config,
            token: input.address as Hex,
            tokenId: BigInt(input.tokenId),
            order,
            signature,
          }),
        )
        if (!res.ok)
          throw new EngineError('internal', res.message ?? 'The marketplace refused the offer.')
        return { requestId: null, result: Promise.resolve(orderHash(order)) }
      },
    })
    const flow = await this.deps.flows.start({
      kind: 'nft',
      accountId: input.accountId,
      chainId,
      quote: null,
      steps,
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  private async liveOrder(
    chainId: 52014 | 5201420,
    config: MarketplaceConfig,
    address: string,
    tokenId: string,
    which: 'listing' | { orderHash: string },
  ): Promise<{ components: OrderComponents; signature: Hex; view: EsOrder }> {
    const { client } = this.client(chainId)
    const a = await fetchAsset(client, chainId, address, tokenId)
    if (!a) throw new EngineError('not_found', 'That piece is not in the marketplace index.')
    const view =
      which === 'listing'
        ? a.listing
        : (a.bids.find((b) => b.orderHash && same(b.orderHash, which.orderHash)) ?? null)
    if (!view || !view.signature)
      throw new EngineError(
        'not_found',
        which === 'listing' ? 'This piece is not listed right now.' : 'That offer is gone.',
      )
    const counter = await this.counter(chainId, config, view.maker as Hex)
    const components = parseProtocolParameters(view.protocolParameters, counter)
    if (!components) throw new EngineError('internal', 'The order could not be read.')
    return { components, signature: view.signature as Hex, view }
  }

  /** Buy a listed piece: the chain's owner must be the listing's maker, then `fulfillOrder` with the ETN (§8.10 Buy). */
  async buy(input: {
    accountId: string
    chainId: number
    address: string
    tokenId: string
  }): Promise<{ flowId: string; requestId: string | null }> {
    this.assertEnabled()
    const { chainId, config } = this.client(input.chainId)
    const account = await this.account(input.accountId)
    const { components, signature } = await this.liveOrder(
      chainId,
      config,
      input.address,
      input.tokenId,
      'listing',
    )
    const [ownerRead] = await readMany(this.deps.chains, chainId, [
      {
        address: input.address as Hex,
        abi: ERC721,
        functionName: 'ownerOf',
        args: [BigInt(input.tokenId)],
      },
    ])
    const owner = ownerRead?.ok && typeof ownerRead.value === 'string' ? ownerRead.value : null
    if (!owner || !same(owner, components.offerer))
      throw new EngineError(
        'invalid_argument',
        'The seller no longer owns this piece; the listing is stale.',
      )
    if (same(owner, account.address))
      throw new EngineError('invalid_argument', 'You already own this piece.')
    const { data, value } = encodeFulfillOrder(toParameters(components), signature)
    const flow = await this.deps.flows.start({
      kind: 'nft',
      accountId: input.accountId,
      chainId,
      quote: null,
      steps: [
        {
          step: 'buy',
          waitReceipt: true,
          run: () =>
            this.deps.provider.runInternal({
              kind: 'send_transaction',
              origin: 'internal:nft:buy',
              chainId,
              accountId: input.accountId,
              tx: { from: account.address, to: config.seaport, value: hex(value), data },
              clientRequestId: `nft:buy:${input.address}:${input.tokenId}:${this.deps.platform.now()}`,
            }),
        },
      ],
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  /** Accept an offer on my piece: approve the conduit if needed, then fulfil the bid (§8.10 Accept). */
  async accept(input: {
    accountId: string
    chainId: number
    address: string
    tokenId: string
    orderHash: string
  }): Promise<{ flowId: string; requestId: string | null }> {
    this.assertEnabled()
    const { chainId, config } = this.client(input.chainId)
    const account = await this.account(input.accountId)
    const { components, signature } = await this.liveOrder(
      chainId,
      config,
      input.address,
      input.tokenId,
      { orderHash: input.orderHash },
    )
    const piece = components.consideration.find(
      (c) => c.itemType === ItemType.ERC721 || c.itemType === ItemType.ERC1155,
    )
    if (
      !piece ||
      !same(piece.token, input.address) ||
      piece.identifierOrCriteria !== BigInt(input.tokenId)
    )
      throw new EngineError('invalid_argument', 'That offer is for a different piece.')
    /*
      The proceeds have to reach the person giving up the piece (ES-BV-001).

      A bid fixes the seller's WETN recipient to whoever owned the piece when
      the bid was made and stays valid after the piece changes hands, so a
      stale — or deliberately planted — bid in the new owner's inbox transfers
      the piece to the bidder and the money to the previous owner. Matching the
      piece is not enough; the only field that says who gets paid is the
      recipient of the largest fungible consideration item.
    */
    const proceeds = proceedsRecipient(components)
    if (!proceeds)
      throw new EngineError('invalid_argument', 'This offer pays nothing for the piece.')
    if (!same(proceeds, account.address))
      throw new EngineError('invalid_argument', 'This offer pays a previous owner, not you.')
    const steps: FlowStepRun[] = []
    if (
      await this.needsCollectionApproval(
        chainId,
        account.address,
        input.address as Hex,
        config.conduit,
      )
    )
      steps.push(
        this.approveCollectionStep(
          chainId,
          input.accountId,
          account.address,
          input.address as Hex,
          config.conduit,
        ),
      )
    const { data } = encodeFulfillOrder(toParameters(components), signature, config.conduitKey)
    steps.push({
      step: 'accept',
      waitReceipt: true,
      run: () =>
        this.deps.provider.runInternal({
          kind: 'send_transaction',
          origin: 'internal:nft:accept',
          chainId,
          accountId: input.accountId,
          tx: { from: account.address, to: config.seaport, value: '0x0', data },
          clientRequestId: `nft:accept:${input.orderHash}:${this.deps.platform.now()}`,
        }),
    })
    const flow = await this.deps.flows.start({
      kind: 'nft',
      accountId: input.accountId,
      chainId,
      quote: null,
      steps,
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  /** Cancel my listing or my offer on chain (§8.10 Cancel). */
  async cancel(input: {
    accountId: string
    chainId: number
    address: string
    tokenId: string
    orderHash: string
  }): Promise<{ flowId: string; requestId: string | null }> {
    const { chainId, config } = this.client(input.chainId)
    const account = await this.account(input.accountId)
    const listing = await this.liveOrder(
      chainId,
      config,
      input.address,
      input.tokenId,
      'listing',
    ).catch(() => null)
    const target =
      listing && listing.view.orderHash && same(listing.view.orderHash, input.orderHash)
        ? listing
        : await this.liveOrder(chainId, config, input.address, input.tokenId, {
            orderHash: input.orderHash,
          })
    if (!same(target.components.offerer, account.address))
      throw new EngineError('invalid_argument', 'Only the maker can cancel an order.')
    const flow = await this.deps.flows.start({
      kind: 'nft',
      accountId: input.accountId,
      chainId,
      quote: null,
      steps: [
        {
          step: 'cancel_order',
          waitReceipt: true,
          run: () =>
            this.deps.provider.runInternal({
              kind: 'send_transaction',
              origin: 'internal:nft:cancel',
              chainId,
              accountId: input.accountId,
              tx: {
                from: account.address,
                to: config.seaport,
                value: '0x0',
                data: encodeCancel([target.components]),
              },
              clientRequestId: `nft:cancel:${input.orderHash}:${this.deps.platform.now()}`,
            }),
        },
      ],
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  /** Transfer a piece (`safeTransferFrom`) — the recipient goes through the same poison checks as a send. */
  async transfer(input: {
    accountId: string
    chainId: number
    address: string
    tokenId: string
    to: string
  }): Promise<{ flowId: string; requestId: string | null }> {
    const { chainId } = this.client(input.chainId)
    const account = await this.account(input.accountId)
    if (!/^0x[0-9a-fA-F]{40}$/.test(input.to))
      throw new EngineError('invalid_argument', 'Enter a full address.')
    const flow = await this.deps.flows.start({
      kind: 'nft',
      accountId: input.accountId,
      chainId,
      quote: null,
      steps: [
        {
          step: 'transfer',
          waitReceipt: true,
          run: () =>
            this.deps.provider.runInternal({
              kind: 'send_transaction',
              origin: 'internal:nft:transfer',
              chainId,
              accountId: input.accountId,
              tx: {
                from: account.address,
                to: input.address as Hex,
                value: '0x0',
                data: encodeFunctionData({
                  abi: ERC721,
                  functionName: 'safeTransferFrom',
                  args: [account.address, input.to as Hex, BigInt(input.tokenId)],
                }),
              },
              clientRequestId: `nft:transfer:${input.address}:${input.tokenId}:${this.deps.platform.now()}`,
            }),
        },
      ],
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  /** Mint from a collection through the marketplace minter; Electric Legends is the collection that pays dividends. */
  async mint(input: {
    accountId: string
    chainId: number
    count: number
    address?: string
  }): Promise<{ flowId: string; requestId: string | null }> {
    this.assertEnabled()
    return this.deps.legends.mint(input.accountId, input.chainId, input.count, input.address)
  }

  /** Whether the collection is approved for the conduit (the "one-time" step the sheet explains). */
  async collectionApproved(accountId: string, chainId: number, address: string): Promise<boolean> {
    const { chainId: cid, config } = this.client(chainId)
    const account = await this.account(accountId)
    return !(await this.needsCollectionApproval(
      cid,
      account.address,
      address as Hex,
      config.conduit,
    ))
  }

  /** The Legends collection view helper for screens that need the address. */
  legendsAddress(chainId: number): string | null {
    return isEtn(chainId) ? ELECTRONEUM_ADDRESSES[chainId].electricLegends : null
  }

  /** ownerOf for a quick "is it mine" without the API. */
  async ownerOf(chainId: number, address: string, tokenId: string): Promise<string | null> {
    if (!isEtn(chainId)) return null
    const [r] = await readMany(this.deps.chains, chainId, [
      {
        address: address as Hex,
        abi: LEGENDS_ABI,
        functionName: 'ownerOf',
        args: [BigInt(tokenId)],
      },
    ])
    return r?.ok && typeof r.value === 'string' ? r.value : null
  }
}

const Chain = z.object({ chainId: z.number().int().positive() })
const Piece = Chain.extend({ address: z.string(), tokenId: z.string().regex(/^\d+$/) })
const AccountPiece = Piece.extend({ accountId: AccountIdSchema })
const OrderInput = AccountPiece.extend({
  priceEtn: z.string().max(40),
  days: z.number().min(1).max(180),
})

export function nftNamespace(nft: NftService): NamespaceSpec {
  return {
    inventory: {
      input: Chain.extend({ accountId: AccountIdSchema }),
      handler: (arg) =>
        nft.inventory(
          (arg as { accountId: string }).accountId,
          (arg as { chainId: number }).chainId,
        ),
    },
    cachedInventory: {
      input: Chain.extend({ accountId: AccountIdSchema }),
      handler: (arg) =>
        nft.cachedInventory(
          (arg as { accountId: string }).accountId,
          (arg as { chainId: number }).chainId,
        ),
    },
    assets: {
      input: Chain.extend({
        address: z.string(),
        orderBy: z.enum(['PRICE', 'RARITY']).optional(),
        asc: z.boolean().optional(),
        listed: z.boolean().optional(),
        traits: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).optional(),
        query: z.string().max(80).optional(),
        after: z.string().optional(),
        accountId: AccountIdSchema.optional(),
      }),
      handler: (arg) => {
        const a = arg as {
          chainId: number
          address: string
          orderBy?: 'PRICE' | 'RARITY'
          asc?: boolean
          listed?: boolean
          traits?: Array<{ name: string; values: string[] }>
          query?: string
          after?: string
          accountId?: string
        }
        return nft.assets(a.chainId, a.address, a)
      },
    },
    asset: {
      input: Piece.extend({ accountId: AccountIdSchema.optional() }),
      handler: (arg) =>
        nft.asset(
          (arg as { chainId: number }).chainId,
          (arg as { address: string }).address,
          (arg as { tokenId: string }).tokenId,
          (arg as { accountId?: string }).accountId,
        ),
    },
    activity: {
      input: Chain.extend({ address: z.string(), tokenId: z.string().optional() }),
      handler: (arg) =>
        nft.activity(
          (arg as { chainId: number }).chainId,
          (arg as { address: string }).address,
          (arg as { tokenId?: string }).tokenId,
        ),
    },
    offers: {
      input: Chain.extend({ accountId: AccountIdSchema }),
      handler: (arg) =>
        nft.offers((arg as { accountId: string }).accountId, (arg as { chainId: number }).chainId),
    },
    list: {
      input: OrderInput,
      handler: (arg) =>
        nft.list(
          arg as {
            accountId: string
            chainId: number
            address: string
            tokenId: string
            priceEtn: string
            days: number
          },
        ),
    },
    offer: {
      input: OrderInput,
      handler: (arg) =>
        nft.offer(
          arg as {
            accountId: string
            chainId: number
            address: string
            tokenId: string
            priceEtn: string
            days: number
          },
        ),
    },
    buy: {
      input: AccountPiece,
      handler: (arg) =>
        nft.buy(arg as { accountId: string; chainId: number; address: string; tokenId: string }),
    },
    accept: {
      input: AccountPiece.extend({ orderHash: z.string() }),
      handler: (arg) =>
        nft.accept(
          arg as {
            accountId: string
            chainId: number
            address: string
            tokenId: string
            orderHash: string
          },
        ),
    },
    cancel: {
      input: AccountPiece.extend({ orderHash: z.string() }),
      handler: (arg) =>
        nft.cancel(
          arg as {
            accountId: string
            chainId: number
            address: string
            tokenId: string
            orderHash: string
          },
        ),
    },
    transfer: {
      input: AccountPiece.extend({ to: z.string() }),
      handler: (arg) =>
        nft.transfer(
          arg as {
            accountId: string
            chainId: number
            address: string
            tokenId: string
            to: string
          },
        ),
    },
    mint: {
      input: Chain.extend({
        accountId: AccountIdSchema,
        count: z.number().int().min(1).max(20),
        address: z.string().optional(),
      }),
      handler: (arg) =>
        nft.mint(arg as { accountId: string; chainId: number; count: number; address?: string }),
    },
    collectionApproved: {
      input: Chain.extend({ accountId: AccountIdSchema, address: z.string() }),
      handler: (arg) =>
        nft.collectionApproved(
          (arg as { accountId: string }).accountId,
          (arg as { chainId: number }).chainId,
          (arg as { address: string }).address,
        ),
    },
  }
}
