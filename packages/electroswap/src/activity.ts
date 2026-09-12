/**
 * The per-account activity feed (master plan §8.12, §9.2).
 *
 * Why it exists: the wallet's own log only knows what the wallet did. Anything
 * that happened *to* the account is invisible without this — and on Electroneum
 * a native ETN arrival emits no log at all, so the bounded `Transfer` scan can
 * never find one. Those arrivals reach Activity through here or not at all.
 *
 * Two things about the wire shape are load-bearing:
 *
 *  - DIRECTION is per-viewer. One stored row is a send to the payer and a
 *    receive to the payee, so the API decides it from the address that asked.
 *    Read it; never re-derive it from `from`/`to`, which is how you end up
 *    telling someone they sent money they received.
 *  - `quantity` is in whole units, not raw. The wallet counts in raw units
 *    everywhere else, so it is converted here, once, at the boundary.
 *
 * The body is untrusted like every other remote answer: parsing is permissive,
 * a row that cannot be understood is dropped rather than thrown on, and a
 * missing field never takes the feed down.
 */
import { z } from 'zod'
import type { ElectroSwapClient } from './client'
import { chainEnum, WALLET_ACTIVITY } from './queries'

/** What moved, as this owner sees it. */
export interface FeedAssetChange {
  readonly standard: 'ERC20' | 'ERC721' | 'ERC1155' | 'NATIVE' | null
  /** Null for the native coin. */
  readonly address: string | null
  readonly symbol: string | null
  readonly tokenId: string | null
  readonly sender: string | null
  readonly recipient: string | null
  /** Raw units as a decimal string, converted from the API's whole units. Null when it did not say. */
  readonly amountRaw: string | null
  /**
   * The token's decimal places, so `amountRaw` can be read back out (ES-BV-034).
   *
   * The conversion to raw units was one-way: Activity then printed the raw
   * integer and a feed row read "Received 5000000000000000000 ETN". Null when
   * the API did not say, which is the only case where the raw figure is all
   * there is.
   */
  readonly decimals: number | null
  readonly direction: 'IN' | 'OUT' | 'SELF' | null
}

export interface FeedRow {
  /** Stable across both parties to the same transaction. */
  readonly id: string
  readonly hash: string
  readonly blockNumber: number | null
  /** Seconds since the epoch, from the chain — not this device's clock. */
  readonly timestamp: number
  /** As the API read it for this owner: SEND to one party, RECEIVE to the other. */
  readonly type: string
  readonly status: 'PENDING' | 'CONFIRMED' | 'FAILED' | null
  readonly from: string | null
  readonly to: string | null
  readonly changes: readonly FeedAssetChange[]
}

const Str = z.string().nullable().optional()
const Num = z.number().nullable().optional()

/*
  One shape for both asset kinds rather than a union. A union would try the
  token branch first, and because every field there is optional an NFT asset
  matches it — then zod strips the keys that branch does not name, and the
  token id disappears silently.
*/
const AssetSchema = z
  .object({
    address: Str,
    symbol: Str,
    decimals: Num,
    standard: Str,
    tokenId: Str,
    name: Str,
    collection: z.object({ nftContracts: z.array(z.object({ address: Str }).nullable()).nullable().optional() }).nullable().optional(),
  })
  .nullable()
  .optional()

const ChangeSchema = z.object({
  __typename: Str,
  tokenStandard: Str,
  nftStandard: Str,
  sender: Str,
  recipient: Str,
  quantity: Str,
  direction: Str,
  asset: AssetSchema,
})

const ActivitySchema = z.object({
  id: Str,
  timestamp: Num,
  type: Str,
  chain: Str,
  transaction: z.object({ blockNumber: Num, hash: Str, from: Str, to: Str, status: Str }).nullable().optional(),
  details: z.object({ type: Str, hash: Str, transactionStatus: Str, assetChanges: z.array(ChangeSchema.nullable()).nullable().optional() }).nullable().optional(),
})

const ResponseSchema = z.object({
  portfolios: z.array(z.object({ assetActivities: z.array(ActivitySchema.nullable()).nullable().optional() }).nullable()).nullable().optional(),
})

const DIRECTIONS = new Set(['IN', 'OUT', 'SELF'])
const STATUSES = new Set(['PENDING', 'CONFIRMED', 'FAILED'])
const STANDARDS = new Set(['ERC20', 'ERC721', 'ERC1155', 'NATIVE'])

const oneOf = <T extends string>(set: ReadonlySet<string>, v: string | null | undefined): T | null => (typeof v === 'string' && set.has(v) ? (v as T) : null)

/**
 * Whole units to raw, without floating point: a token with 18 decimals and a
 * quantity like "0.1" has no exact double, and a wallet that rounds a balance
 * is a wallet that lies about money.
 */
export function toRawUnits(quantity: string, decimals: number): string | null {
  const text = quantity.trim()
  if (!/^-?\d*(\.\d*)?$/.test(text) || text === '' || text === '.' || text === '-') return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
  const negative = text.startsWith('-')
  const [whole = '', fraction = ''] = (negative ? text.slice(1) : text).split('.')
  // Truncate rather than round: the API's precision is not ours to extend.
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  const digits = `${whole || '0'}${padded}`.replace(/^0+(?=\d)/, '')
  return `${negative && digits !== '0' ? '-' : ''}${digits}`
}

function changeOf(raw: z.infer<typeof ChangeSchema>): FeedAssetChange | null {
  const asset = raw.asset
  const nft = typeof raw.nftStandard === 'string' && raw.nftStandard.length > 0
  const standard = oneOf<'ERC20' | 'ERC721' | 'ERC1155' | 'NATIVE'>(STANDARDS, nft ? raw.nftStandard : raw.tokenStandard)
  const address = asset?.address ?? asset?.collection?.nftContracts?.find((c) => c?.address)?.address ?? null
  const decimals = asset?.decimals
  const quantity = raw.quantity
  const amountRaw = typeof quantity === 'string' && typeof decimals === 'number' ? toRawUnits(quantity, decimals) : null
  const direction = oneOf<'IN' | 'OUT' | 'SELF'>(DIRECTIONS, raw.direction)
  if (!standard && !address && !amountRaw && !asset?.tokenId) return null
  return {
    standard,
    address: address ?? null,
    symbol: asset?.symbol ?? null,
    tokenId: asset?.tokenId ?? null,
    sender: raw.sender ?? null,
    recipient: raw.recipient ?? null,
    amountRaw,
    decimals: typeof decimals === 'number' ? decimals : null,
    direction,
  }
}

function rowOf(raw: z.infer<typeof ActivitySchema>): FeedRow | null {
  const hash = raw.details?.hash ?? raw.transaction?.hash ?? null
  const id = raw.id ?? hash
  // A row with no transaction hash cannot be merged against the local log, and
  // merging is the whole point — drop it rather than inventing an identity.
  if (!id || !hash) return null
  const changes = (raw.details?.assetChanges ?? []).flatMap((c) => (c ? [changeOf(c)] : [])).filter((c): c is FeedAssetChange => c !== null)
  return {
    id,
    hash,
    blockNumber: typeof raw.transaction?.blockNumber === 'number' ? raw.transaction.blockNumber : null,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : 0,
    type: raw.details?.type ?? raw.type ?? 'UNKNOWN',
    status: oneOf<'PENDING' | 'CONFIRMED' | 'FAILED'>(STATUSES, raw.details?.transactionStatus ?? raw.transaction?.status),
    from: raw.transaction?.from ?? null,
    to: raw.transaction?.to ?? null,
    changes,
  }
}

export interface WalletActivityInput {
  readonly chainId: number
  readonly owner: string
  /** 1-based, as the API counts. */
  readonly page?: number
  readonly pageSize?: number
}

/**
 * One page of the feed, newest first. Throws only if the transport does; a
 * malformed body yields an empty page, because Activity is enrichment and must
 * never be the reason the screen fails to paint.
 */
export async function fetchWalletActivity(client: ElectroSwapClient, input: WalletActivityInput): Promise<FeedRow[]> {
  const data = await client.query<unknown>(WALLET_ACTIVITY, {
    owner: input.owner,
    chains: [chainEnum(input.chainId)],
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 50,
  })
  const parsed = ResponseSchema.safeParse(data)
  if (!parsed.success) return []
  const rows = (parsed.data.portfolios ?? []).flatMap((p) => p?.assetActivities ?? [])
  return rows.flatMap((r) => (r ? [rowOf(r)] : [])).filter((r): r is FeedRow => r !== null)
}
