/**
 * The popup <-> service-worker message contract (E0a).
 *
 * One shared module both sides import from. The popup side (sw-client) sends an
 * `SwRequest` over `browser.runtime.sendMessage`; the SW (E0b) answers with an
 * `SwResponse`. Everything crossing the wire must stay JSON-safe — the SW and
 * the popup run in separate isolates, so NO `bigint`: raw balances and
 * quantities travel as decimal strings (`rawBalance`, `quantity`).
 *
 * The SW already funnels `bv:ping` + `bv:vault:*` (entrypoints/background.ts).
 * E0b adds the `bv:block:head` / `bv:portfolio` / `bv:price` cases; the shapes
 * below are the contract it implements against.
 */

/** popup -> SW request messages. */
export type SwRequest =
  | { type: 'bv:ping' }
  | { type: 'bv:block:head'; chainId: number }
  | { type: 'bv:portfolio'; chainId: number; account: string }
  | { type: 'bv:price'; chainId: number; address: string }

/**
 * One token row in a portfolio response — JSON-safe (quantities as strings, no
 * bigint). `share` is the row's fraction of the priced portfolio total
 * (0..1). `priced` is false when the token has no USD price (e.g. a
 * never-priced token), in which case `priceUsd` / `usd` are absent and the row
 * is excluded from `pricedTotalUsd` + from other rows' `share` denominators.
 */
export interface SafeRow {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  /** Raw on-chain balance in wei/base units, as a decimal string (no bigint). */
  rawBalance: string
  /** Human quantity (rawBalance / 10^decimals), as a decimal string. */
  quantity: string
  priceUsd?: number
  usd?: number
  change24h?: number
  /** Fraction of the priced portfolio this row represents (0..1). */
  share: number
  hidden: boolean
  priced: boolean
}

/** SW -> popup responses. Every success carries `ok: true`; failures `ok: false`. */
export type SwResponse =
  | { ok: true; pong: true; ts: number }
  | { ok: true; block: number; chainId: number; at: number }
  | {
      ok: true
      chainId: number
      account: string
      native: SafeRow | null
      rows: SafeRow[]
      pricedTotalUsd: number
      at: number
    }
  | { ok: true; usd: number | null; at: number }
  | { ok: false; error: string }

/** Loose result type for a transport round-trip (before narrowing). */
export type SwResult = SwResponse | { ok: false; error: string }
