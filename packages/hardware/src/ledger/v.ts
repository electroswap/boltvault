/**
 * The Ledger `v` byte (master plan §2.7 S3). The Ethereum app returns one
 * byte: for typed transactions 0/1 (older apps 27/28); for legacy EIP-155
 * transactions `(chainId × 2 + 35 + parity) mod 256` — Electroneum's 52014
 * overflows the byte, so the parity is recovered modulo 256 rather than
 * subtracted. Everything downstream works in `yParity`.
 */
import { recoverTransactionAddress, type Hex } from 'viem'

export function yParityFromLedgerV(
  v: number,
  input: { readonly chainId: number; readonly legacy: boolean },
): 0 | 1 {
  if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`bad v byte ${v}`)
  if (!input.legacy) return (v >= 27 ? v - 27 : v) & 1 ? 1 : 0
  if (input.chainId === 0) return (v - 27) & 1 ? 1 : 0
  const base = (input.chainId * 2 + 35) % 256
  return (v - base + 256) % 256 === 1 ? 1 : 0
}

/**
 * The recovery bit, decided by trying both and keeping the one that recovers
 * to this account (master plan §2.7 S3).
 *
 * `yParityFromLedgerV` interprets byte 64 by the convention the Ledger app
 * documents, and the Keystone path assumed the same convention — with a fake
 * that encodes exactly that, so the tests proved self-consistency and nothing
 * about the firmware. If the assumption is wrong for legacy transactions, half
 * of them come out with the wrong bit and `assertSignedBy` refuses them as
 * "signed by a different account": fail-closed, but half the sends on
 * Electroneum refused for no reason the user can act on.
 *
 * Trying both costs two `ecrecover`s and removes the assumption. The
 * interpreted value is tried first, so nothing changes when it is right.
 */
export async function yParityByRecovery(
  build: (yParity: 0 | 1) => Hex | Promise<Hex>,
  address: Hex,
  hint: 0 | 1,
): Promise<0 | 1> {
  const order: Array<0 | 1> = hint === 1 ? [1, 0] : [0, 1]
  for (const parity of order) {
    try {
      const raw = await build(parity)
      const got = await recoverTransactionAddress({ serializedTransaction: raw as never })
      if (got.toLowerCase() === address.toLowerCase()) return parity
    } catch {
      // That bit does not produce a recoverable signature; the other one might.
    }
  }
  throw new Error(
    'The device returned a signature that does not belong to this account. Check that the right device is connected and the right account is chosen.',
  )
}

/** The full EIP-155 `v` for a legacy transaction, as a bigint viem serialises. */
export function legacyV(chainId: number, yParity: 0 | 1): bigint {
  return BigInt(chainId) * 2n + 35n + BigInt(yParity)
}
