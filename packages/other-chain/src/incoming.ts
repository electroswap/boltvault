/**
 * Incoming discovery (T7.3) — on other chains there is NO indexer, so we find
 * incoming transfers via **bounded** `eth_getLogs`: ERC-20 Transfer events where
 * the account is the recipient (`topic[1] = to = account`). The range is bounded
 * (we don't scan genesis→head) and paginated backwards in fixed block windows so
 * a deep backlog can't blow up memory or the RPC.
 *
 * This is the pure param-builder; the caller issues `eth_getLogs` (viem
 * `client.getLogs`) with these params and feeds the logs back.
 */

/** ERC-20 Transfer(address from, address to, uint256 value) topic. */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a9df543270f'

/** A 40-char address padded into a 32-byte log topic. */
export function toTopic32(address: string): string {
  const a = address.toLowerCase().replace(/^0x/, '')
  return '0x' + '0'.repeat(64 - a.length) + a
}

/**
 * The `from`/`to` block params for one bounded window, paginating backwards.
 * `head` is the current block number; we scan `window`-wide windows from
 * `cursor` downwards, one window per call.
 */
export interface IncomingWindow {
  readonly fromBlock: number
  readonly toBlock: number
  /** true when this window reaches the start (below the bound). */
  readonly first: boolean
}

export interface BoundedRange {
  /** Do not scan below this block (the "bound"). */
  readonly fromBlock: number
  readonly head: number
  readonly window: number
}

/**
 * Build the bounded getLogs params for one window of incoming ERC-20 transfers
 * to `account`.
 */
export function incomingLogsParams(
  range: BoundedRange,
  account: string,
  tokenAddress: string | null,
): {
  readonly address?: string
  readonly topics: (string | string[] | null)[]
  readonly fromBlock: number
  readonly toBlock: number
} {
  const to = toTopic32(account)
  const topics: (string | string[] | null)[] = [TRANSFER_TOPIC, null, to]
  return {
    address: tokenAddress ?? undefined,
    topics,
    fromBlock: range.fromBlock,
    toBlock: range.head,
  }
}

/**
 * Plan the bounded windows to scan, newest first, stopping at the bound.
 * Returns at most `maxWindows` windows (so a huge backlog is bounded).
 */
export function planIncomingWindows(
  range: BoundedRange,
  maxWindows: number,
): IncomingWindow[] {
  const windows: IncomingWindow[] = []
  let cursor = range.head
  for (let i = 0; i < maxWindows; i++) {
    const toBlock = cursor
    const fromBlock = Math.max(range.fromBlock, toBlock - range.window + 1)
    const first = fromBlock <= range.fromBlock
    windows.push({ fromBlock, toBlock, first })
    if (first) break
    cursor = fromBlock - 1
  }
  return windows
}

/** True when the caller should stop paginating (reached the bound). */
export function reachedBound(range: BoundedRange, window: IncomingWindow): boolean {
  return window.first
}
