/**
 * Seaport 1.5 orders the way ElectroSwap's marketplace builds them (master
 * plan §8.10, mirroring apps/interface/src/nft/utils/{listNfts,bidNfts}.ts):
 * a listing offers the ERC-721 and asks native ETN split seller / creator /
 * platform (3 % to the marketplace fee receiver — the Electric Legends
 * dividend distributor on mainnet); an offer bids WETN and asks the piece
 * for the bidder. We only build the order and its typed data; the wallet's
 * own signer signs and the wallet's own path broadcasts the fulfilment.
 */
import { encodeFunctionData, hashStruct, parseAbi, toHex, type Hex } from 'viem'
import { z } from 'zod'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
export const ZERO_BYTES32 = `0x${'00'.repeat(32)}` as Hex
/** ElectroSwap's marketplace fee (apps/interface ListingMarkets: 3 %). The API rejects anything lower. */
export const MARKETPLACE_FEE_BPS = 300

export const ItemType = { NATIVE: 0, ERC20: 1, ERC721: 2, ERC1155: 3 } as const
export const OrderType = { FULL_OPEN: 0, PARTIAL_OPEN: 1 } as const

export interface OfferItem {
  readonly itemType: number
  readonly token: Hex
  readonly identifierOrCriteria: bigint
  readonly startAmount: bigint
  readonly endAmount: bigint
}

export interface ConsiderationItem extends OfferItem {
  readonly recipient: Hex
}

export interface OrderComponents {
  readonly offerer: Hex
  readonly zone: Hex
  readonly offer: readonly OfferItem[]
  readonly consideration: readonly ConsiderationItem[]
  readonly orderType: number
  readonly startTime: bigint
  readonly endTime: bigint
  readonly zoneHash: Hex
  readonly salt: bigint
  readonly conduitKey: Hex
  readonly counter: bigint
}

export const EIP712_ORDER_TYPES = {
  OrderComponents: [
    { name: 'offerer', type: 'address' },
    { name: 'zone', type: 'address' },
    { name: 'offer', type: 'OfferItem[]' },
    { name: 'consideration', type: 'ConsiderationItem[]' },
    { name: 'orderType', type: 'uint8' },
    { name: 'startTime', type: 'uint256' },
    { name: 'endTime', type: 'uint256' },
    { name: 'zoneHash', type: 'bytes32' },
    { name: 'salt', type: 'uint256' },
    { name: 'conduitKey', type: 'bytes32' },
    { name: 'counter', type: 'uint256' },
  ],
  OfferItem: [
    { name: 'itemType', type: 'uint8' },
    { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' },
  ],
  ConsiderationItem: [
    { name: 'itemType', type: 'uint8' },
    { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' },
    { name: 'recipient', type: 'address' },
  ],
} as const

export const SEAPORT_ABI = parseAbi([
  'struct OfferItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; }',
  'struct ConsiderationItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; address recipient; }',
  'struct OrderParameters { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 totalOriginalConsiderationItems; }',
  'struct OrderComponents { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 counter; }',
  'struct Order { OrderParameters parameters; bytes signature; }',
  'function fulfillOrder(Order order, bytes32 fulfillerConduitKey) payable returns (bool fulfilled)',
  'function cancel(OrderComponents[] orders) returns (bool cancelled)',
  'function getCounter(address offerer) view returns (uint256 counter)',
  'function getOrderHash(OrderComponents order) view returns (bytes32 orderHash)',
  'function getOrderStatus(bytes32 orderHash) view returns (bool isValidated, bool isCancelled, uint256 totalFilled, uint256 totalSize)',
])

export interface MarketplaceConfig {
  readonly chainId: number
  readonly seaport: Hex
  readonly conduitKey: Hex
  readonly conduit: Hex
  readonly feeReceiver: Hex
  readonly wetn: Hex
}

export interface CreatorFee {
  readonly payoutAddress: Hex
  readonly basisPoints: number
}

/** price × bps / 10 000, the interface's exact rounding (floor). */
export function feePortion(price: bigint, bps: number): bigint {
  return (price * BigInt(bps)) / 10_000n
}

/** What a seller actually receives from a listing or an accepted offer at `price`. */
export function sellerProceeds(
  price: bigint,
  creatorFee: CreatorFee | null,
): { seller: bigint; creator: bigint; platform: bigint } {
  const creator =
    creatorFee && creatorFee.basisPoints > 0 ? feePortion(price, creatorFee.basisPoints) : 0n
  const platform = feePortion(price, MARKETPLACE_FEE_BPS)
  return { seller: price - creator - platform, creator, platform }
}

function nowSeconds(now: number): bigint {
  return BigInt(Math.floor(now / 1000))
}

/** A random 256-bit salt from the platform's entropy (never Math.random). */
export function saltFrom(random: Uint8Array): bigint {
  if (random.length < 32) throw new Error('salt needs 32 random bytes')
  return BigInt(toHex(random.subarray(0, 32)))
}

export interface ListingInput {
  readonly config: MarketplaceConfig
  readonly seller: Hex
  readonly token: Hex
  readonly tokenId: bigint
  readonly standard: 'ERC721' | 'ERC1155'
  readonly priceWei: bigint
  readonly creatorFee: CreatorFee | null
  readonly endTime: bigint
  readonly counter: bigint
  readonly salt: bigint
  readonly now: number
}

/** List a piece for native ETN: [seller, creator?, platform] (§8.10 List). */
export function buildListing(input: ListingInput): OrderComponents {
  if (input.priceWei <= 0n) throw new Error('price must be positive')
  const split = sellerProceeds(input.priceWei, input.creatorFee)
  const native = (amount: bigint, recipient: Hex): ConsiderationItem => ({
    itemType: ItemType.NATIVE,
    token: ZERO_ADDRESS,
    identifierOrCriteria: 0n,
    startAmount: amount,
    endAmount: amount,
    recipient,
  })
  const consideration: ConsiderationItem[] = [native(split.seller, input.seller)]
  if (split.creator > 0n && input.creatorFee)
    consideration.push(native(split.creator, input.creatorFee.payoutAddress))
  if (split.platform > 0n) consideration.push(native(split.platform, input.config.feeReceiver))
  return {
    offerer: input.seller,
    zone: ZERO_ADDRESS,
    offer: [
      {
        itemType: input.standard === 'ERC1155' ? ItemType.ERC1155 : ItemType.ERC721,
        token: input.token,
        identifierOrCriteria: input.tokenId,
        startAmount: 1n,
        endAmount: 1n,
      },
    ],
    consideration,
    orderType: OrderType.PARTIAL_OPEN,
    startTime: nowSeconds(input.now),
    endTime: input.endTime,
    zoneHash: ZERO_BYTES32,
    salt: input.salt,
    conduitKey: input.config.conduitKey,
    counter: input.counter,
  }
}

export interface OfferInput {
  readonly config: MarketplaceConfig
  readonly bidder: Hex
  readonly owner: Hex
  readonly token: Hex
  readonly tokenId: bigint
  readonly priceWei: bigint
  readonly creatorFee: CreatorFee | null
  readonly endTime: bigint
  readonly counter: bigint
  readonly salt: bigint
  readonly now: number
}

/** Offer WETN for a piece: [owner, creator?, platform, the piece → bidder] (§8.10 Offer). */
export function buildOffer(input: OfferInput): OrderComponents {
  if (input.priceWei <= 0n) throw new Error('price must be positive')
  const split = sellerProceeds(input.priceWei, input.creatorFee)
  const wetn = (amount: bigint, recipient: Hex): ConsiderationItem => ({
    itemType: ItemType.ERC20,
    token: input.config.wetn,
    identifierOrCriteria: 0n,
    startAmount: amount,
    endAmount: amount,
    recipient,
  })
  const consideration: ConsiderationItem[] = [wetn(split.seller, input.owner)]
  if (split.creator > 0n && input.creatorFee)
    consideration.push(wetn(split.creator, input.creatorFee.payoutAddress))
  if (split.platform > 0n) consideration.push(wetn(split.platform, input.config.feeReceiver))
  consideration.push({
    itemType: ItemType.ERC721,
    token: input.token,
    identifierOrCriteria: input.tokenId,
    startAmount: 1n,
    endAmount: 1n,
    recipient: input.bidder,
  })
  return {
    offerer: input.bidder,
    zone: ZERO_ADDRESS,
    offer: [
      {
        itemType: ItemType.ERC20,
        token: input.config.wetn,
        identifierOrCriteria: 0n,
        startAmount: input.priceWei,
        endAmount: input.priceWei,
      },
    ],
    consideration,
    orderType: OrderType.FULL_OPEN,
    startTime: nowSeconds(input.now),
    endTime: input.endTime,
    zoneHash: ZERO_BYTES32,
    salt: input.salt,
    conduitKey: input.config.conduitKey,
    counter: input.counter,
  }
}

/** The typed data the signer signs — JSON-safe (uints as decimal strings), the shape dApps send. */
export function orderTypedData(
  config: MarketplaceConfig,
  order: OrderComponents,
): {
  domain: { name: 'Seaport'; version: '1.5'; chainId: number; verifyingContract: Hex }
  types: typeof EIP712_ORDER_TYPES
  primaryType: 'OrderComponents'
  message: Record<string, unknown>
} {
  const item = (i: OfferItem | ConsiderationItem): Record<string, unknown> => ({
    itemType: i.itemType,
    token: i.token,
    identifierOrCriteria: i.identifierOrCriteria.toString(),
    startAmount: i.startAmount.toString(),
    endAmount: i.endAmount.toString(),
    ...('recipient' in i ? { recipient: i.recipient } : {}),
  })
  return {
    domain: {
      name: 'Seaport',
      version: '1.5',
      chainId: config.chainId,
      verifyingContract: config.seaport,
    },
    types: EIP712_ORDER_TYPES,
    primaryType: 'OrderComponents',
    message: {
      offerer: order.offerer,
      zone: order.zone,
      offer: order.offer.map(item),
      consideration: order.consideration.map(item),
      orderType: order.orderType,
      startTime: order.startTime.toString(),
      endTime: order.endTime.toString(),
      zoneHash: order.zoneHash,
      salt: order.salt.toString(),
      conduitKey: order.conduitKey,
      counter: order.counter.toString(),
    },
  }
}

/** Seaport's order hash is the EIP-712 struct hash of the components (what `getOrderHash` returns). */
export function orderHash(order: OrderComponents): Hex {
  return hashStruct({
    data: { ...order, offer: [...order.offer], consideration: [...order.consideration] },
    primaryType: 'OrderComponents',
    types: EIP712_ORDER_TYPES,
  })
}

export function toParameters(order: OrderComponents): {
  offerer: Hex
  zone: Hex
  offer: OfferItem[]
  consideration: ConsiderationItem[]
  orderType: number
  startTime: bigint
  endTime: bigint
  zoneHash: Hex
  salt: bigint
  conduitKey: Hex
  totalOriginalConsiderationItems: bigint
} {
  return {
    offerer: order.offerer,
    zone: order.zone,
    offer: [...order.offer],
    consideration: [...order.consideration],
    orderType: order.orderType,
    startTime: order.startTime,
    endTime: order.endTime,
    zoneHash: order.zoneHash,
    salt: order.salt,
    conduitKey: order.conduitKey,
    totalOriginalConsiderationItems: BigInt(order.consideration.length),
  }
}

/** `fulfillOrder(order, fulfillerConduitKey)`; native listings need `value` = the ETN consideration total. */
export function encodeFulfillOrder(
  parameters: ReturnType<typeof toParameters>,
  signature: Hex,
  fulfillerConduitKey: Hex = ZERO_BYTES32,
): { data: Hex; value: bigint } {
  const value = parameters.consideration
    .filter((c) => c.itemType === ItemType.NATIVE)
    .reduce((s, c) => s + c.startAmount, 0n)
  return {
    data: encodeFunctionData({
      abi: SEAPORT_ABI,
      functionName: 'fulfillOrder',
      args: [{ parameters, signature }, fulfillerConduitKey],
    }),
    value,
  }
}

export function encodeCancel(orders: readonly OrderComponents[]): Hex {
  return encodeFunctionData({
    abi: SEAPORT_ABI,
    functionName: 'cancel',
    args: [orders.map((o) => ({ ...o, offer: [...o.offer], consideration: [...o.consideration] }))],
  })
}

/** The body `POST /api/nfts/order` validates (services/api NftMarketService.orderBodySchema). */
export function orderIntakeBody(input: {
  type: 'LISTING' | 'BID'
  config: MarketplaceConfig
  token: Hex
  tokenId: bigint
  order: OrderComponents
  signature: Hex
}): Record<string, unknown> {
  const item = (i: OfferItem | ConsiderationItem): Record<string, unknown> => ({
    itemType: i.itemType,
    token: i.token,
    identifierOrCriteria: i.identifierOrCriteria.toString(),
    startAmount: i.startAmount.toString(),
    endAmount: i.endAmount.toString(),
    ...('recipient' in i ? { recipient: i.recipient } : {}),
  })
  return {
    type: input.type,
    chainId: input.config.chainId,
    protocol_address: input.config.seaport,
    address: input.token,
    tokenId: Number(input.tokenId),
    order_hash: orderHash(input.order),
    signature: input.signature,
    parameters: {
      offerer: input.order.offerer,
      zone: input.order.zone,
      zoneHash: input.order.zoneHash,
      startTime: input.order.startTime.toString(),
      endTime: input.order.endTime.toString(),
      orderType: input.order.orderType,
      offer: input.order.offer.map(item),
      consideration: input.order.consideration.map(item),
      totalOriginalConsiderationItems: input.order.consideration.length,
      salt: input.order.salt.toString(),
      conduitKey: input.order.conduitKey,
      counter: input.order.counter.toString(),
    },
  }
}

const HexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/)
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const Uint = z
  .union([z.string(), z.number()])
  .transform((v) => BigInt(typeof v === 'number' ? Math.trunc(v) : v))
const ItemSchema = z.object({
  itemType: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  token: AddressSchema,
  identifierOrCriteria: Uint,
  startAmount: Uint,
  endAmount: Uint,
})
const ParametersSchema = z.object({
  offerer: AddressSchema,
  zone: AddressSchema.optional().default(ZERO_ADDRESS),
  offer: z.array(ItemSchema),
  consideration: z.array(ItemSchema.extend({ recipient: AddressSchema })),
  orderType: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .optional()
    .default(0),
  startTime: Uint,
  endTime: Uint,
  zoneHash: HexSchema.optional().default(ZERO_BYTES32),
  salt: Uint.optional().default('0'),
  conduitKey: HexSchema,
  counter: Uint.optional(),
  totalOriginalConsiderationItems: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .optional(),
})

/** The API's `protocolParameters` (as stored from the intake) back into components; null when unparseable. */
export function parseProtocolParameters(raw: unknown, counter?: bigint): OrderComponents | null {
  const parsed = ParametersSchema.safeParse(raw)
  if (!parsed.success) return null
  const p = parsed.data
  const c = p.counter ?? counter
  if (c === undefined) return null
  return {
    offerer: p.offerer as Hex,
    zone: p.zone as Hex,
    offer: p.offer.map((i) => ({
      itemType: i.itemType,
      token: i.token as Hex,
      identifierOrCriteria: i.identifierOrCriteria,
      startAmount: i.startAmount,
      endAmount: i.endAmount,
    })),
    consideration: p.consideration.map((i) => ({
      itemType: i.itemType,
      token: i.token as Hex,
      identifierOrCriteria: i.identifierOrCriteria,
      startAmount: i.startAmount,
      endAmount: i.endAmount,
      recipient: i.recipient as Hex,
    })),
    orderType: p.orderType,
    startTime: p.startTime,
    endTime: p.endTime,
    zoneHash: p.zoneHash as Hex,
    salt: p.salt,
    conduitKey: p.conduitKey as Hex,
    counter: c,
  }
}

/** The ETN a buyer pays for a listing (the consideration total), or null for a non-native order. */
export function listingPrice(order: OrderComponents): bigint | null {
  if (order.consideration.some((c) => c.itemType !== ItemType.NATIVE)) return null
  return order.consideration.reduce((s, c) => s + c.startAmount, 0n)
}

/** The WETN an offer pays. */
export function offerPrice(order: OrderComponents): bigint | null {
  const o = order.offer[0]
  return o && o.itemType === ItemType.ERC20 ? o.startAmount : null
}
