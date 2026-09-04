/**
 * v-offset / tree normalization — the S3 caveat, made concrete.
 *
 * The SAME logical "Account #i" means two different derivation paths depending
 * on which tree is used:
 *
 *   - BIP-44 wallet address for "account i"  = bip44Path(0, i)   → m/44'/60'/0'/0/i
 *     (account slot is fixed at 0, i is the LAST slot)
 *
 *   - Ledger Live "account i"                = ledgerLivePath(i) → m/44'/60'/i'/0/0
 *     (i is the HARDENED account slot, last two slots are 0/0)
 *
 * For i = 0 both trees happen to agree (m/44'/60'/0'/0/0). For every i > 0
 * they disagree — a user's "Account #1" in BoltVault (BIP-44) is a DIFFERENT
 * address than what Ledger Live shows for "Account 1". The design's answer:
 * the import UI shows 3 preview addresses from each tree, not a footnote.
 *
 * {@link previewAddresses} returns both path strings for one index; the caller
 * loops 0, 1, 2 to get the "3 preview addresses from each tree".
 */

import { bip44Path, ledgerLivePath, pathToBipString } from './path'

/** A logical account rendered in BOTH derivation trees. */
export interface NormalizedAccount {
  /** The logical account index. */
  readonly index: number
  /** BIP-44 wallet path string: m/44'/60'/0'/0/i (i is the last slot). */
  readonly bip44: string
  /** Ledger Live path string: m/44'/60'/i'/0/0 (i is the hardened account slot). */
  readonly ledgerLive: string
  /** True only if the two strings are identical (true iff index === 0). */
  readonly treesAgree: boolean
}

/**
 * Build both path strings for the same logical account index and flag whether
 * the trees agree.
 *
 * With this model's conventions the trees agree ONLY for index === 0:
 *   normalizeAccount(0).bip44 === normalizeAccount(0).ledgerLive === "m/44'/60'/0'/0/0"
 *   normalizeAccount(1).bip44   = "m/44'/60'/0'/0/1"
 *   normalizeAccount(1).ledgerLive = "m/44'/60'/1'/0/0"   (≠, treesAgree=false)
 */
export function normalizeAccount(index: number): NormalizedAccount {
  const bip44 = pathToBipString(bip44Path(0, index))
  const ledgerLive = pathToBipString(ledgerLivePath(index))
  return {
    index,
    bip44,
    ledgerLive,
    treesAgree: bip44 === ledgerLive,
  }
}

/**
 * The "3 preview addresses from each tree" (the caller loops 0, 1, 2).
 * Returns the BIP-44 and Ledger Live path strings for one index.
 */
export function previewAddresses(index: number): {
  readonly bip44: string
  readonly ledgerLive: string
} {
  return {
    bip44: pathToBipString(bip44Path(0, index)),
    ledgerLive: pathToBipString(ledgerLivePath(index)),
  }
}

/** True when the two trees produce DIFFERENT paths for this index (always true for index > 0). */
export function treesDisagree(index: number): boolean {
  return normalizeAccount(index).treesAgree === false
}
