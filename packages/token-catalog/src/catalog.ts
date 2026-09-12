/**
 * Per-chain token catalog — the single source for "which tokens exist on a chain".
 *
 * Universe for a chain:
 *   tokens(chain) =
 *       native
 *     ∪ publicList(chain)        // pinned Uniswap-format JSON, filtered by token.chainId
 *     ∪ customTokens[chain]      // user / wallet_watchAsset
 *     ∪ historyDiscovered[chain] // ERC-20 Transfer to/from this account (local)
 *
 * See the design spec §"Token catalog (all supported chains)".
 */

import { getAddress, isAddress } from 'viem'

export interface TokenEntry {
  readonly chainId: number
  readonly address: string
  readonly name: string
  readonly symbol: string
  readonly decimals: number
  readonly logoURI?: string
  readonly tags?: readonly string[]
  /** Present on custom tokens: 'user' (manual) or 'dapp' (wallet_watchAsset). */
  readonly source?: 'user' | 'dapp'
  readonly origin?: string
}

export interface CustomToken {
  readonly chainId: number
  readonly address: string
  readonly name: string
  readonly symbol: string
  readonly decimals: number
  readonly logoURI?: string
  readonly source: 'user' | 'dapp'
  readonly origin?: string
}

export type CustomTokenStore = Readonly<Record<number, readonly CustomToken[]>>

/** Pinned public-list URL per chain. ETN uses the ElectroSwap static list. */
export const PUBLIC_LIST_URLS: Readonly<Record<number, string>> = {
  52014: 'https://static.electroswap.io/tokens/tokenlist.json',
  5201420: 'https://static.electroswap.io/tokens/tokenlist.json',
  1: 'https://tokens.uniswap.org',
  56: 'https://tokens.pancakeswap.finance/pancakeswap-extended.json',
  8453: 'https://tokens.uniswap.org',
  42161: 'https://tokens.uniswap.org',
  10: 'https://tokens.uniswap.org',
  137: 'https://tokens.uniswap.org',
  43114: 'https://tokens.uniswap.org',
  130: 'https://tokens.uniswap.org',
  59144: 'https://tokens.uniswap.org',
}

/** Raw shape of a Uniswap-format token list as fetched over the wire. */
export interface RawTokenList {
  name?: string
  logoURI?: string
  chainId?: number
  tokens: Array<{
    chainId?: number
    address?: string
    name?: string
    symbol?: string
    decimals?: number
    logoURI?: string
    tags?: string[]
  }>
}

/**
 * Validate + normalize a raw token list, keeping only entries whose chainId
 * matches `chainId`. Rejects non-checksum garbage and structural mismatches
 * (C5: the list has NO top-level chainId for the ETN list — entries carry it).
 */
/*
  What a list may say, and how much of it.

  The same bound the engine applies to on-chain metadata: strip the characters
  that move text about — control, format and separator, U+202E and its
  relatives — normalise, then cap. Duplicated here rather than imported because
  the catalogue is the boundary the list crosses, and a boundary that has to
  reach into another package to be safe is not one.
*/
const UNSAFE_LABEL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
function label(raw: string, max: number): string {
  const clean = raw.normalize('NFKC').replace(UNSAFE_LABEL, '').trim()
  return clean.length > max ? clean.slice(0, max) : clean
}

export function parseTokenList(raw: RawTokenList, chainId: number): TokenEntry[] {
  const out: TokenEntry[] = []
  for (const t of raw.tokens ?? []) {
    // Entry-level chainId is authoritative. The ETN list serves 52014 and
    // 5201420 from the same file — filter by entry, not list.
    if (t.chainId !== chainId) continue
    const addr = t.address
    if (!addr) continue
    if (!isAddress(addr, { strict: true })) continue
    if (t.decimals === undefined || !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36)
      continue
    if (!t.name || !t.symbol) continue
    /*
      A list is a remote file (ES-BV-037). Its names and symbols reach the
      portfolio, the swap picker and the approval sheet exactly where on-chain
      metadata does — and that path has gone through `label()` since it was
      written, while this one did not. A symbol carrying U+202E reorders the
      row it sits in.
    */
    const name = label(t.name, 48)
    const symbol = label(t.symbol, 12)
    if (!name || !symbol) continue
    out.push({
      chainId,
      address: getAddress(addr),
      name,
      symbol,
      decimals: t.decimals,
      logoURI: t.logoURI,
      tags: t.tags,
    })
  }
  return out
}

/**
 * Merge the full token universe for a chain. Native is a sentinel entry; custom
 * and history-discovered tokens are always included (even at zero balance) per
 * design. Deduped by checksummed address; precedence: history > custom > public.
 */
export function tokenUniverse(
  chainId: number,
  publicList: readonly TokenEntry[],
  custom: readonly CustomToken[] = [],
  historyDiscovered: readonly TokenEntry[] = [],
): TokenEntry[] {
  const byAddr = new Map<string, TokenEntry>()

  for (const t of publicList) byAddr.set(t.address.toLowerCase(), { ...t })
  for (const t of custom) {
    const addr = getAddress(t.address)
    byAddr.set(addr.toLowerCase(), {
      chainId,
      address: addr,
      name: t.name,
      symbol: t.symbol,
      decimals: t.decimals,
      logoURI: t.logoURI,
      source: t.source,
      origin: t.origin,
    })
  }
  for (const t of historyDiscovered) {
    const existing = byAddr.get(t.address.toLowerCase())
    // history-discovered wins on address; keep richer metadata if we have it
    byAddr.set(t.address.toLowerCase(), { ...existing, ...t })
  }

  const native: TokenEntry = {
    chainId,
    address: 'native',
    name: 'Native',
    symbol: 'NATIVE',
    decimals: 18,
  }
  return [native, ...Array.from(byAddr.values())]
}

/** Group a universe into the shapes the portfolio renders. */
export function partitionPortfolio(
  universe: readonly TokenEntry[],
  balances: ReadonlyMap<string, bigint>, // lowercased addr -> raw
  pinned: ReadonlySet<string> = new Set(),
): {
  native: TokenEntry | undefined
  nonZero: TokenEntry[]
  pinnedOnly: TokenEntry[]
  custom: TokenEntry[]
  zeroListed: TokenEntry[]
} {
  const native = universe.find((t) => t.address === 'native')
  const nonZero: TokenEntry[] = []
  const pinnedOnly: TokenEntry[] = []
  const custom: TokenEntry[] = []
  const zeroListed: TokenEntry[] = []

  for (const t of universe) {
    if (t.address === 'native') continue
    const bal = balances.get(t.address.toLowerCase()) ?? 0n
    const isCustom = t.source === 'user' || t.source === 'dapp'
    if (bal > 0n) {
      nonZero.push(t)
      if (isCustom) custom.push(t)
    } else if (pinned.has(t.address.toLowerCase())) {
      pinnedOnly.push(t)
    } else if (isCustom) {
      // custom tokens always appear, even at zero
      custom.push(t)
      pinnedOnly.push(t)
    } else {
      zeroListed.push(t)
    }
  }

  return { native, nonZero, pinnedOnly, custom, zeroListed }
}
