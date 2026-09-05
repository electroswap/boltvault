/**
 * The Ledger `v` byte (master plan §2.7 S3). The Ethereum app returns one
 * byte: for typed transactions 0/1 (older apps 27/28); for legacy EIP-155
 * transactions `(chainId × 2 + 35 + parity) mod 256` — Electroneum's 52014
 * overflows the byte, so the parity is recovered modulo 256 rather than
 * subtracted. Everything downstream works in `yParity`.
 */

export function yParityFromLedgerV(v: number, input: { readonly chainId: number; readonly legacy: boolean }): 0 | 1 {
  if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`bad v byte ${v}`)
  if (!input.legacy) return (v >= 27 ? v - 27 : v) & 1 ? 1 : 0
  if (input.chainId === 0) return (v - 27) & 1 ? 1 : 0
  const base = (input.chainId * 2 + 35) % 256
  return (v - base + 256) % 256 === 1 ? 1 : 0
}

/** The full EIP-155 `v` for a legacy transaction, as a bigint viem serialises. */
export function legacyV(chainId: number, yParity: 0 | 1): bigint {
  return BigInt(chainId) * 2n + 35n + BigInt(yParity)
}
