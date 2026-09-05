/**
 * @boltvault/nft — fee display for NFT sales.
 *
 * Marketplace fee is 300 bps (3%) on NFT; there is **no wallet fee** on NFT.
 */

export const MARKETPLACE_FEE_BPS = 300

/**
 * Human-readable fee line for a sale at `sellPrice` (wei, display-only).
 * Must always make the "no wallet fee" guarantee visible.
 */
export function feeLine(sellPrice: bigint): string {
  const pct = (MARKETPLACE_FEE_BPS / 100).toFixed(2)
  return `Marketplace ${pct}% (${MARKETPLACE_FEE_BPS} bps) — no wallet fee`
}
