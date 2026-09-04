/**
 * Activity merge (T6.1) — local log + ETN GraphQL enrich, merged by hash.
 *
 * Design: the local `HistoryEntry` is the *source of truth* for what the wallet
 * did (category, account, origin, intent). The ElectroSwap indexer enriches
 * with on-chain fields (block, status, counterparty, value). On a hash match the
 * LOCAL entry wins for local-only fields; enrichment only FILLS what the local
 * entry lacks. New on-chain txs the user didn't initiate appear as enriched-only
 * rows (e.g. an incoming transfer). Sorted newest-first.
 */
import type { HistoryCategory, HistoryEntry } from '@boltvault/core'

/** A row from the ElectroSwap indexer (the enrich side). */
export interface EnrichedTx {
  readonly hash: string
  readonly chainId: number
  readonly from: string
  readonly to: string
  /** wei, hex or decimal string. */
  readonly value: string
  readonly blockNumber?: number
  readonly status?: 'pending' | 'confirmed' | 'failed'
  readonly timestamp?: number
  readonly symbol?: string
  readonly counterparty?: string
}

export interface ActivityRow {
  readonly hash: string
  readonly chainId: number
  readonly category: HistoryCategory
  readonly status: 'pending' | 'confirmed' | 'failed' | 'replaced'
  readonly from: string | null
  readonly to: string | null
  readonly valueWei: string
  readonly blockNumber?: number
  readonly timestamp?: number
  readonly account?: string
  readonly origin?: string
  readonly symbol?: string
  readonly counterparty?: string
  /** true when the row came from the local log (the wallet initiated it). */
  readonly local: boolean
  /** true when enrichment added fields the local entry lacked. */
  readonly enriched: boolean
}

function normHash(h: string): string {
  return h.toLowerCase()
}

/**
 * Merge the local log with on-chain enrichment. Keyed by (chainId, hash).
 * - local present → local fields win; enrichment fills missing to/from/value/block/status.
 * - enrichment only → surfaced as an enriched row (category defaults to RECEIVE for
 *   an incoming transfer, or the provided `fallbackCategory`).
 */
export function mergeActivity(
  local: readonly HistoryEntry[],
  enriched: readonly EnrichedTx[],
  fallbackCategory: HistoryCategory = 'RECEIVE',
): ActivityRow[] {
  const byHash = new Map<string, EnrichedTx>()
  for (const e of enriched) byHash.set(`${e.chainId}:${normHash(e.hash)}`, e)

  const rows: ActivityRow[] = []
  const seen = new Set<string>()

  for (const entry of local) {
    const key = `${entry.chainId}:${normHash(entry.hash)}`
    const en = byHash.get(key)
    const localTo = entry.to ?? undefined
    const localBlock = entry.blockNumber
    const localStatus = entry.status ?? en?.status ?? 'pending'
    rows.push({
      hash: entry.hash,
      chainId: entry.chainId,
      category: entry.category,
      status: localStatus,
      from: en?.from ?? null,
      to: localTo ?? en?.to ?? null,
      valueWei: entry.value,
      blockNumber: localBlock ?? en?.blockNumber,
      timestamp: en?.timestamp,
      account: entry.account,
      origin: entry.origin,
      symbol: en?.symbol,
      counterparty: en?.counterparty,
      local: true,
      enriched: en != null && (localTo == null || localBlock == null || entry.status == null),
    })
    seen.add(key)
  }

  // Enrichment-only rows (on-chain txs the wallet didn't log).
  for (const e of enriched) {
    const key = `${e.chainId}:${normHash(e.hash)}`
    if (seen.has(key)) continue
    rows.push({
      hash: e.hash,
      chainId: e.chainId,
      category: fallbackCategory,
      status: e.status ?? 'confirmed',
      from: e.from,
      to: e.to,
      valueWei: e.value,
      blockNumber: e.blockNumber,
      timestamp: e.timestamp,
      symbol: e.symbol,
      counterparty: e.counterparty,
      local: false,
      enriched: true,
    })
  }

  return rows.sort(byTimestampDesc)
}

function byTimestampDesc(a: ActivityRow, b: ActivityRow): number {
  const at = a.timestamp ?? a.blockNumber ?? 0
  const bt = b.timestamp ?? b.blockNumber ?? 0
  return bt - at
}

// --- receipt decode (T6.1: UR / Seaport / farm recognition) ------------------

export type ReceiptKind = 'swap' | 'seaport' | 'farm' | 'send' | 'receive' | 'approve' | 'unknown'

export interface DecodedReceipt {
  readonly kind: ReceiptKind
  /** Human summary line for the Activity row. */
  readonly summary: string
}

/**
 * Best-effort receipt decode from `to` + `data` selectors. Recognizes the
 * ElectroSwap Universal Router (swap), Seaport 1.5 (NFT), and the yield-farm
 * contract (farm) by their known addresses; otherwise send/receive/approve by
 * shape. Pure — no RPC.
 */
export function decodeReceipt(
  tx: { to: string; data: string; valueWei: string },
  addrs: { universalRouter: string; seaport15: string; yieldFarm: string },
  symbols: { tokenIn?: string; tokenOut?: string },
): DecodedReceipt {
  const to = tx.to.toLowerCase()
  if (to === addrs.universalRouter.toLowerCase()) {
    return { kind: 'swap', summary: `Swap ${symbols.tokenIn ?? ''} → ${symbols.tokenOut ?? ''}`.trim() }
  }
  if (to === addrs.seaport15.toLowerCase()) {
    return { kind: 'seaport', summary: 'Seaport NFT' }
  }
  if (to === addrs.yieldFarm.toLowerCase()) {
    return { kind: 'farm', summary: 'Yield farm' }
  }
  const selector = tx.data.slice(0, 10).toLowerCase()
  // approve(address,uint256)
  if (selector === '0x095ea7b3') return { kind: 'approve', summary: 'Approve' }
  // transfer(address,uint256)
  if (selector === '0xa9059cbb') return { kind: 'send', summary: 'Transfer' }
  if (tx.valueWei !== '0' && tx.valueWei !== '0x0') return { kind: 'send', summary: 'Send' }
  return { kind: 'unknown', summary: 'Transaction' }
}

// --- explorer links ----------------------------------------------------------

export const ETN_EXPLORER_BASE = 'https://explorer.electroneum.com'

export function txExplorerUrl(hash: string): string {
  return `${ETN_EXPLORER_BASE}/tx/${hash}`
}
export function addressExplorerUrl(address: string): string {
  return `${ETN_EXPLORER_BASE}/address/${address}`
}
