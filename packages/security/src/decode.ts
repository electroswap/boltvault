/**
 * Pure receipt categorizer: turn a raw transfer receipt into a user-facing
 * DecodedAction (category + chips) without any I/O or chain access.
 *
 * Heuristic (documented, intentionally simple):
 *   - `to` in KNOWN_SPENDERS + has `data`  → 'SWAP' (router call with calldata)
 *   - `to` in KNOWN_SPENDERS, no `data`    → 'APPROVAL' (plain transfer to a
 *     known contract is treated as an approval-ish contract interaction)
 *   - value > 0                            → 'SEND'
 *   - otherwise                            → 'UNKNOWN'
 */

export type DecodedAction = {
  category:
    | 'SWAP'
    | 'SEND'
    | 'BRIDGE'
    | 'FARM'
    | 'NFT_BUY'
    | 'NFT_SELL'
    | 'APPROVAL'
    | 'REVOKE'
    | 'UNKNOWN'
  to: string
  value: bigint
  tokenIn?: string
  tokenOut?: string
  note?: string
}

/**
 * Known contract "spender" addresses.
 * PLACEHOLDERS — verify against the live registry before shipping:
 *   - 0xe653...82  — farm/ve contract (placeholder)
 *   - 0x6787...cbFd — Seaport (NFT) exchange (placeholder)
 *   - 0x5E95...f732 — Uniswap Universal Router (placeholder)
 */
export const KNOWN_SPENDERS: string[] = [
  '0xe653aC16B732876F58a1722d24801230fA96bc82', // farm (placeholder)
  '0x678748317e7fD5B7699D07e666087608B401cbFd', // Seaport (placeholder)
  '0x5E95157b667f59c9dC1282D611E328721B006C6e', // Uniswap Universal Router (placeholder)
]

export function decodeReceipt(r: {
  to: string
  value?: bigint
  data?: string
  origin?: string
}): DecodedAction {
  const to = r.to.toLowerCase()
  const value = r.value ?? 0n
  const hasData = r.data != null && r.data !== '' && r.data !== '0x'
  const spender = KNOWN_SPENDERS.find((s) => s.toLowerCase() === to)
  if (spender != null) {
    if (hasData) {
      return { category: 'SWAP', to: r.to, value }
    }
    return { category: 'APPROVAL', to: r.to, value }
  }
  if (value > 0n) {
    return { category: 'SEND', to: r.to, value }
  }
  return { category: 'UNKNOWN', to: r.to, value }
}
