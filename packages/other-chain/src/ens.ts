/**
 * ENS (T7.3) — ENS resolution is **Ethereum-only**. On the other 8 chains there
 * is no ENS, so the UI shows the raw address. This is the pure decision +
 * display layer; the actual `eth_call` to the ENS resolver is done by the caller
 * (a viem `ensName` / `getEnsAddress`), and the result is handed to
 * {@link identityDisplay} here.
 *
 * Design (T7.3): "ENS on Ethereum only".
 */

/** The only chain where ENS applies (Ethereum mainnet). */
export const ENS_CHAIN_ID = 1

export function isEnsEnabled(chainId: number): boolean {
  return chainId === ENS_CHAIN_ID
}

/**
 * Decide how to display a counterparty's identity.
 *
 *   - Ethereum + a resolved ENS name → show the name (primary) + shortened address.
 *   - anything else → the address (shortened by the caller or as-is).
 *
 * Pure: the caller resolves the name and passes it in.
 */
export interface Identity {
  readonly address: string
  /** Shortened display, e.g. "0x1F9…4a1c". */
  readonly short: string
  /** Present only when ENS is enabled AND a name resolved. */
  readonly ensName?: string
  readonly display: string
}

/** Truncate an address to `0x` + first 4 + `…` + last 4. */
export function shortAddress(addr: string): string {
  if (addr.length <= 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function identityDisplay(
  chainId: number,
  address: string,
  name: string | null | undefined,
): Identity {
  const short = shortAddress(address)
  const ens = isEnsEnabled(chainId) ? name?.trim() : undefined
  const ensName = ens && ens.length > 0 ? ens : undefined
  const display = ensName ? `${ensName} (${short})` : short
  return { address, short, ensName, display }
}
