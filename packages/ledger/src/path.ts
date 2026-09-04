/**
 * BIP-44 path handling for Electroneum (ETN).
 *
 * Electroneum's SLIP-44 coin type is 60 (same as Bitcoin, like most ETH-fork
 * chains that reuse the BTC coin type for legacy reasons).
 *
 * There are TWO derivation trees in play for a "logical account index" i:
 *   - BIP-44 wallet tree (BoltVault default):  m/44'/60'/0'/0/i   (index is the LAST slot)
 *   - Ledger Live tree:                        m/44'/60'/i'/0/0   (index is the ACCOUNT slot, hardened)
 *
 * This module is PURE: no WebHID, no device.
 */

/** Electroneum's SLIP-44 coin type. */
export const ETN_COIN_TYPE = 60

/** Canonical BIP-44 path segments. */
export interface Bip44Path {
  readonly purpose: number
  readonly coinType: number
  readonly account: number
  readonly change: number
  readonly index: number
}

/** Hardening suffix used in BIP-44 path strings. */
const HARDENED = "'"

/**
 * Build a BIP-44 path for the given account and index.
 *
 * Convention for THIS model (the S3 caveat): purpose, coinType and account are
 * treated as hardened slots (trailing `'`), while change and index are normal
 * (non-hardened) slots. So `bip44Path(0, 3)` → `m/44'/60'/0'/0/3`.
 *
 * @throws if account or index is negative or not an integer.
 */
export function bip44Path(
  account: number,
  index: number,
  opts?: { readonly coinType?: number },
): Bip44Path {
  assertNonNegativeInt('account', account)
  assertNonNegativeInt('index', index)
  const coinType = opts?.coinType ?? ETN_COIN_TYPE
  assertNonNegativeInt('coinType', coinType)
  return { purpose: 44, coinType, account, change: 0, index }
}

/**
 * The Ledger Live derivation tree for account `account`.
 *
 * Ledger Live puts the account index in the HARDENED account slot and uses
 * change=0, index=0 — so `ledgerLivePath(2)` → `m/44'/60'/2'/0/0`.
 *
 * @throws if account is negative or not an integer.
 */
export function ledgerLivePath(account: number): Bip44Path {
  assertNonNegativeInt('account', account)
  return { purpose: 44, coinType: ETN_COIN_TYPE, account, change: 0, index: 0 }
}

/**
 * Render a {@link Bip44Path} as its canonical BIP-44 string.
 *
 * Hardened slots (purpose, coinType, account) get a trailing `'`;
 * normal slots (change, index) do not.
 *   bip44Path(0,3)   → m/44'/60'/0'/0/3
 *   bip44Path(2,0)   → m/44'/60'/2'/0/0
 *   ledgerLivePath(2) → m/44'/60'/2'/0/0
 */
export function pathToBipString(p: Bip44Path): string {
  return (
    'm' +
    `/${hardened(p.purpose)}` +
    `/${hardened(p.coinType)}` +
    `/${hardened(p.account)}` +
    `/${p.change}` +
    `/${p.index}`
  )
}

/**
 * Parse a canonical BIP-44 string back into a {@link Bip44Path}.
 *
 * Exact inverse of {@link pathToBipString} for the shapes this module
 * produces: strips the leading `m/`, splits on `/`, reads the five numeric
 * segments (trailing `'` markers are stripped).
 *
 * @throws on malformed input (missing `m/` prefix, wrong segment count,
 * non-integer segments).
 */
export function parseBipString(s: string): Bip44Path {
  const trimmed = s.trim()
  if (!trimmed.startsWith('m/')) {
    throw new Error(`BIP-44 path must start with "m/", got: ${s}`)
  }
  const segments = trimmed.slice(2).split('/')
  if (segments.length !== 5) {
    throw new Error(
      `BIP-44 path must have exactly 5 segments (purpose/coinType/account/change/index), got ${segments.length}: ${s}`,
    )
  }
  const nums: number[] = []
  for (const seg of segments) {
    const cleaned = seg.endsWith(HARDENED) ? seg.slice(0, -1) : seg
    if (!/^\d+$/.test(cleaned)) {
      throw new Error(`Non-integer BIP-44 segment: "${seg}" in ${s}`)
    }
    nums.push(Number(cleaned))
  }
  const [purpose, coinType, account, change, index] = nums
  return {
    purpose: purpose as number,
    coinType: coinType as number,
    account: account as number,
    change: change as number,
    index: index as number,
  }
}

function hardened(n: number): string {
  return `${n}${HARDENED}`
}

function assertNonNegativeInt(name: string, v: number): void {
  if (!Number.isInteger(v)) {
    throw new Error(`${name} must be an integer, got: ${v}`)
  }
  if (v < 0) {
    throw new Error(`${name} must be >= 0, got: ${v}`)
  }
}
