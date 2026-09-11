/**
 * The account activity feed, merged into Activity (master plan §8.12).
 *
 * The local log is written before broadcast and knows exactly what this wallet
 * did. It cannot know what was done *to* the account, and on Electroneum a
 * native ETN arrival emits no log at all — so the bounded `Transfer` scan is
 * structurally unable to find one. Money arriving is the single most important
 * thing Activity can show, and until this existed it simply never appeared.
 *
 * §8.12 sets the merge rule: "Merge by hash; local wins. Clear = wipes local
 * rows only." That is why feed rows are not appended into the encrypted store.
 * They are cached separately and merged at read time, so clearing history
 * clears what this device did without pretending the chain forgot.
 */
import { fetchWalletActivity, type ElectroSwapClient, type FeedRow } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import type { ActivityStore } from '../activityStore'
import { cacheKey, type DocCache } from '../cache'
import type { NamespaceSpec } from '../host'
import { type ActivityCategory, type ActivityEntry } from '../schema'

/** Long enough that scrolling Activity does not re-ask; short enough that an arrival shows up. */
const TTL_MS = 45_000
const PAGE_SIZE = 50

const FeedRowSchema = z.object({
  id: z.string(),
  hash: z.string(),
  blockNumber: z.number().nullable(),
  timestamp: z.number(),
  type: z.string(),
  status: z.enum(['PENDING', 'CONFIRMED', 'FAILED']).nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  changes: z.array(
    z.object({
      standard: z.enum(['ERC20', 'ERC721', 'ERC1155', 'NATIVE']).nullable(),
      address: z.string().nullable(),
      symbol: z.string().nullable(),
      tokenId: z.string().nullable(),
      sender: z.string().nullable(),
      recipient: z.string().nullable(),
      amountRaw: z.string().nullable(),
      direction: z.enum(['IN', 'OUT', 'SELF']).nullable(),
    }),
  ),
})

const FEED_SPEC = (chainId: number, owner: string) => ({ key: cacheKey('activity', 'feed', chainId, owner), schema: z.array(FeedRowSchema) })

/** The API's activity types, mapped onto the categories Activity already draws. */
const CATEGORIES: Readonly<Record<string, ActivityCategory>> = {
  SEND: 'SEND',
  RECEIVE: 'RECEIVE',
  SWAP: 'SWAP',
  APPROVE: 'APPROVE',
  NFT: 'NFT',
  MINT: 'NFT',
  BURN: 'NFT',
  CLAIM: 'LAUNCHPAD',
  STAKE: 'FARM_DEPOSIT',
  UNSTAKE: 'FARM_WITHDRAW',
  WITHDRAW: 'FARM_WITHDRAW',
}

function categoryOf(row: FeedRow): ActivityCategory {
  const mapped = CATEGORIES[row.type.toUpperCase()]
  if (mapped) return mapped
  // An unknown kind is still a transaction this account was party to. Reading
  // the direction is honest; guessing a category is not.
  const direction = row.changes.find((c) => c.direction === 'IN' || c.direction === 'OUT')?.direction
  return direction === 'IN' ? 'RECEIVE' : direction === 'OUT' ? 'SEND' : 'DAPP'
}

function amountText(raw: string, symbol: string | null): string {
  return symbol ? `${raw} ${symbol}` : raw
}

/**
 * A plain-language line, in the same voice as the statements the firewall
 * writes at sign time (§7.10 — verbs from the closed set, no jargon).
 */
function statementOf(row: FeedRow): string {
  const moved = row.changes.find((c) => c.amountRaw && c.amountRaw !== '0') ?? row.changes[0]
  if (!moved) return 'Transaction'
  const amount = moved.amountRaw ? amountText(moved.amountRaw, moved.symbol) : (moved.symbol ?? 'an asset')
  if (moved.direction === 'IN') return `Received ${amount}${moved.sender ? ` from ${moved.sender}` : ''}`
  if (moved.direction === 'OUT') return `Sent ${amount}${moved.recipient ? ` to ${moved.recipient}` : ''}`
  return `Moved ${amount}`
}

/**
 * Feed rows carry no account id of their own — they are the chain's view, not
 * this wallet's — so the caller's account is stamped on at conversion.
 */
export function entryOf(row: FeedRow, chainId: number, accountId: string): ActivityEntry {
  const native = row.changes.find((c) => c.standard === 'NATIVE')
  const moved = row.changes.find((c) => c.amountRaw && c.amountRaw !== '0') ?? row.changes[0] ?? null
  const inbound = moved?.direction === 'IN'
  return {
    // Prefixed so a feed row can never collide with a locally written id, and
    // so it is obvious in storage which side a row came from.
    id: `feed:${row.id}`,
    hash: row.hash,
    chainId,
    accountId,
    to: row.to,
    value: native?.amountRaw ?? '0',
    nonce: null,
    // The chain's timestamp, not this device's clock: a historical arrival
    // stamped with "now" sorts to the top of Activity and reads as new money.
    submittedAt: row.timestamp > 0 ? row.timestamp * 1000 : 0,
    origin: null,
    category: categoryOf(row),
    statements: [statementOf(row)],
    riskCodes: [],
    status: row.status === 'FAILED' ? 'failed' : row.status === 'PENDING' ? 'pending' : 'confirmed',
    blockNumber: row.blockNumber,
    ...(moved?.address || native ? { token: moved?.address ?? 'native' } : {}),
    ...(inbound && moved?.sender ? { from: moved.sender } : {}),
  }
}

/**
 * Local wins, by hash. A row this wallet wrote carries the statements the user
 * was actually shown and the risk codes they were warned about; the feed's
 * version of the same transaction knows none of that, so it must never replace
 * it — only fill in what the wallet never saw.
 */
export function mergeByHash(local: readonly ActivityEntry[], feed: readonly ActivityEntry[]): ActivityEntry[] {
  const known = new Set(local.map((e) => e.hash).filter((h): h is string => typeof h === 'string' && h.length > 0))
  const extra = feed.filter((e) => typeof e.hash === 'string' && !known.has(e.hash))
  return [...local, ...extra].sort((a, b) => b.submittedAt - a.submittedAt)
}

export interface ActivityFeedDeps {
  readonly platform: Platform
  readonly electroswap: ElectroSwapClient | null
  readonly activity: ActivityStore
  readonly cache: DocCache
  /** The address of an account id, or null when it is not one of ours. */
  readonly addressOf: (accountId: string) => Promise<string | null>
  readonly isEtn: (chainId: number) => boolean
}

export class ActivityFeedService {
  constructor(private readonly deps: ActivityFeedDeps) {}

  get available(): boolean {
    return this.deps.electroswap !== null
  }

  /** One cached page of the feed. Empty, never a throw: Activity is enrichment. */
  async rows(chainId: number, owner: string): Promise<FeedRow[]> {
    const d = this.deps
    const client = d.electroswap
    if (!client || !d.isEtn(chainId)) return []
    try {
      return (await d.cache.through(FEED_SPEC(chainId, owner.toLowerCase()), TTL_MS, () => fetchWalletActivity(client, { chainId, owner, pageSize: PAGE_SIZE }))).value
    } catch {
      return []
    }
  }

  /**
   * Activity's list: the local log, plus anything the chain saw that this
   * wallet did not do itself.
   */
  async list(filter: { accountId?: string; chainId?: number; limit?: number } = {}): Promise<ActivityEntry[]> {
    const local = await this.deps.activity.list(filter)
    const { accountId, chainId } = filter
    if (!accountId || chainId === undefined) return local
    const owner = await this.deps.addressOf(accountId)
    if (!owner) return local
    const feed = (await this.rows(chainId, owner)).map((r) => entryOf(r, chainId, accountId))
    const merged = mergeByHash(local, feed)
    return filter.limit === undefined ? merged : merged.slice(0, filter.limit)
  }

  /** One row's detail, local first. */
  async detail(id: string): Promise<ActivityEntry | null> {
    const local = await this.deps.activity.list({})
    return local.find((e) => e.id === id || e.hash === id) ?? null
  }
}

export function activityFeedNamespace(feed: ActivityFeedService): NamespaceSpec {
  return {
    available: { handler: async () => ({ available: feed.available }) },
  }
}
