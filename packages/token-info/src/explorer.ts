/**
 * Electroneum explorer links (design T5.5). Pure string builders over the
 * explorer base — the token info screen links token / address / tx pages.
 */
export const ETN_EXPLORER_BASE = 'https://explorer.electroneum.com'

/** Explorer URL for a token contract. */
export function tokenExplorerUrl(address: string): string {
  return `${ETN_EXPLORER_BASE}/token/${address}`
}

/** Explorer URL for an EOA / contract address. */
export function addressExplorerUrl(address: string): string {
  return `${ETN_EXPLORER_BASE}/address/${address}`
}

/** Explorer URL for a transaction hash. */
export function txExplorerUrl(hash: string): string {
  return `${ETN_EXPLORER_BASE}/tx/${hash}`
}
