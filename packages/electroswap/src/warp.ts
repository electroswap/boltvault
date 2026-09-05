/**
 * Hyperlane warp-route table (display-only) — static warp corridors for the
 * stable-coin warps bridged to ETN (52014). Display-only: the client renders
 * the corridor chips from this table; the actual warp calldata comes from the
 * Hyperlane warp-route SDK at swap time.
 */

/** Warp corridors reachable from ETN for these warps (chain ids). */
const WARP_CORRIDORS: readonly number[] = [1, 56, 8453, 43114, 42161, 10, 137]

export const WARP_ROUTES: {
  token: string
  symbol: 'USDC' | 'USDT'
  chainId: number
  destinations: number[]
}[] = [
  {
    token: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e', // USDC warp (Hyperlane) on ETN
    symbol: 'USDC',
    chainId: 52014,
    destinations: [...WARP_CORRIDORS],
  },
  {
    // USDT warp (Hyperlane) on ETN — verify against tokenlist.
    token: '0x6483E064f87829322c8466C59412e2b06A7d2e48',
    symbol: 'USDT',
    chainId: 52014,
    destinations: [...WARP_CORRIDORS],
  },
]

/** ICA (Interchain Account) router for warp-route calldata on ETN. */
export const ICA_ROUTER = '0x9fE454AA8156E49F130aB73c6b783008f53e99a9'

/**
 * Look up a warp route by token address (case-insensitive).
 * Returns null when the address is not a known warp token.
 */
export function warpAsset(
  tokenAddress: string,
): { symbol: 'USDC' | 'USDT'; destinations: number[] } | null {
  const a = tokenAddress.toLowerCase()
  for (const r of WARP_ROUTES) {
    if (r.token.toLowerCase() === a) return { symbol: r.symbol, destinations: [...r.destinations] }
  }
  return null
}
