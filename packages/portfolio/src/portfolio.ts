/**
 * Other-chain portfolio (T7.2) — quantity from the on-chain multicall is TRUTH;
 * market-data prices are display-only enrichment.
 *
 * Merge rules (mirrors the ETN portfolio, design §"Other chains"):
 *   - quantity (raw balance) always comes from the multicall read — never the
 *     market API.
 *   - a row is PRICED only when a market price exists for it; otherwise it shows
 *     quantity with NO fiat (unpriced ≠ zero, never block the UI).
 *   - dust-hide: a row with a price but a fiat value < $1 is hidden from the
 *     default view (it is NOT deleted — `hidden: true`, still in `rows`).
 *     A row with NO price is never dust-hidden (we can't judge its value).
 *   - `share` is each row's fraction of the priced total (0 when unpriced or when
 *     the priced total is 0). The "bus bar" renders these shares.
 *
 * All of this is pure: the caller supplies the universe (tokens), the raw
 * balance map (from `chunkMulticall`), and the price map (from `MarketData`).
 */

import { type TokenEntry } from '@boltvault/token-catalog'

/**
 * The minimal price shape portfolio consumes (structural — matches
 * `@boltvault/market-data`'s `TokenPrice` without importing it, so this package
 * stays independently testable).
 */
export interface PriceLike {
  readonly usd: number
  readonly change24h?: number
  readonly at?: number
}

export interface PortfolioRow {
  readonly address: string
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly logoURI?: string
  /** Raw balance in smallest units (truth — from the multicall read). */
  readonly rawBalance: bigint
  /** Human quantity (decimal string), e.g. "1.5". */
  readonly quantity: string
  /** Present when a market price exists; null/absent → unpriced (no fiat). */
  readonly priceUsd?: number
  /** Fiat value (number) — only when priced. */
  readonly usd?: number
  /** change24h passthrough, when the price had it. */
  readonly change24h?: number
  /** Row's fraction of the priced total (0 when unpriced / no priced total). */
  readonly share: number
  /** true when priced but < DUST_HIDE_USD (hidden from the default view). */
  readonly hidden: boolean
  /** true when a market price was available for this row. */
  readonly priced: boolean
  readonly at?: number
}

export interface Portfolio {
  readonly chainId: number
  /** Native row (raw balance = native balance; priced only if a native price was given). */
  readonly native: PortfolioRow | null
  /** ERC-20 rows (non-zero OR custom OR pinned — the universe already filtered these). */
  readonly rows: PortfolioRow[]
  /** Sum of the PRICED rows' fiat (the bus-bar total). Unpriced rows don't add. */
  readonly pricedTotalUsd: number
  /** Rows hidden by dust-hiding (convenience view). */
  readonly hiddenRows: PortfolioRow[]
  /** Rows that are visible by default (priced and >= dust, or unpriced-but-balanced). */
  readonly visibleRows: PortfolioRow[]
}

export interface BuildPortfolioOpts {
  readonly chainId: number
  /** The universe for this chain (native + ERC-20s to read). Order preserved. */
  readonly universe: readonly TokenEntry[]
  /**
   * Raw balances from the on-chain multicall, keyed by lowercased address.
   * `native` key = the native balance. Missing key = 0 (token with no balance).
   */
  readonly balances: Readonly<Record<string, bigint>>
  /**
   * Market prices, keyed by lowercased address. `native` key = native price.
   * A missing key (or a null value) = unpriced.
   */
  readonly prices: Readonly<Record<string, PriceLike | null>>
  /** Hide priced rows below this fiat value (default $1). */
  readonly dustHideUsd?: number
}

const DEFAULT_DUST_HIDE_USD = 1

function rawToDecimalString(raw: bigint, decimals: number): string {
  if (raw === 0n) return '0'
  const base = 10n ** BigInt(decimals)
  const whole = raw / base
  const frac = raw % base
  let fracStr = frac.toString().padStart(decimals, '0').slice(0, decimals)
  // trim trailing zeros
  fracStr = fracStr.replace(/0+$/, '')
  return whole.toString() + (fracStr ? '.' + fracStr : '')
}

function row(
  entry: TokenEntry,
  raw: bigint,
  price: PriceLike | null | undefined,
  pricedTotalUsd: number,
  dustHideUsd: number,
): PortfolioRow {
  const quantity = rawToDecimalString(raw, entry.decimals)
  const priced = price != null && Number.isFinite(price.usd)
  const usd = priced ? (Number(raw) / 10 ** entry.decimals) * price.usd : undefined
  const hidden = priced && (usd ?? 0) < dustHideUsd
  const share = priced && pricedTotalUsd > 0 ? (usd ?? 0) / pricedTotalUsd : 0
  return {
    address: entry.address,
    symbol: entry.symbol,
    name: entry.name,
    decimals: entry.decimals,
    logoURI: entry.logoURI,
    rawBalance: raw,
    quantity,
    priceUsd: priced ? price.usd : undefined,
    usd,
    change24h: price?.change24h,
    share,
    hidden,
    priced,
    at: price?.at,
  }
}

export function buildPortfolio(opts: BuildPortfolioOpts): Portfolio {
  const dust = opts.dustHideUsd ?? DEFAULT_DUST_HIDE_USD
  const balances = opts.balances
  const prices = opts.prices

  const nativeEntry = opts.universe.find((t) => t.address === 'native')
  const nativeRaw = balances['native'] ?? 0n
  const nativePrice = prices['native'] ?? null
  const nativeDecimals = nativeEntry?.decimals ?? 18

  const erc20 = opts.universe.filter((t) => t.address !== 'native')

  // First pass: collect raw + price per token (order preserved) so we can sum
  // the priced total BEFORE finalizing rows (shares depend on the total).
  const prelim = erc20.map((t) => {
    const raw = balances[t.address.toLowerCase()] ?? 0n
    const price = prices[t.address.toLowerCase()] ?? null
    return { t, raw, price }
  })

  // Priced total across native + erc20 (for shares).
  let pricedTotalUsd = 0
  let nativeUsd = 0
  if (nativeEntry && nativePrice != null && Number.isFinite(nativePrice.usd)) {
    nativeUsd = (Number(nativeRaw) / 10 ** nativeDecimals) * nativePrice.usd
    pricedTotalUsd += nativeUsd
  }
  for (const { t, raw, price } of prelim) {
    if (price != null && Number.isFinite(price.usd)) {
      pricedTotalUsd += (Number(raw) / 10 ** t.decimals) * price.usd
    }
  }

  const native: PortfolioRow | null = nativeEntry
    ? row(nativeEntry, nativeRaw, nativePrice, pricedTotalUsd, dust)
    : null

  const rows = prelim.map((p) => row(p.t, p.raw, p.price, pricedTotalUsd, dust))

  const visibleRows = rows.filter((r) => !r.hidden)
  const hiddenRows = rows.filter((r) => r.hidden)

  return {
    chainId: opts.chainId,
    native,
    rows,
    pricedTotalUsd,
    hiddenRows,
    visibleRows,
  }
}

/**
 * Which addresses the caller must read balances for (the universe minus native,
 * minus anything with no possible balance). The caller multicalls these.
 */
export function balanceReads(universe: readonly TokenEntry[]): string[] {
  return universe
    .filter((t) => t.address !== 'native')
    .map((t) => t.address.toLowerCase())
}
