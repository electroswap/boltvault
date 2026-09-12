/**
 * ETN portfolio merge (T4.2) — the "chamber" data model.
 *
 * Design merge rule (the design spec §Portfolio):
 *   - **RPC quantity is source of truth** (multicall3 balanceOf / eth_getBalance);
 *     a stale indexer cannot hide a drain.
 *   - **GraphQL denominatedValue is display** (fiat + 24h). It never owns
 *     quantity, never blocks the UI when down, and is dropped (not shown) when
 *     it diverges from the on-chain quantity by >1%.
 *   - **Dust is hidden under $1 — only when a price actually returned** (no
 *     price → the row stays, shown in raw units, "price unavailable").
 *   - **Holdings are bus bars**: 44px min, fill = share of the home-chain
 *     portfolio, sorted by share desc. Overflow is a list, not drag, in v1.
 *
 * `buildEtnPortfolio` is pure (no fetch, no viem) so the merge rule is fully
 * unit-testable. The SW wires the RPC + GraphQL reads into `PortfolioRow[]` and
 * calls this.
 */
import { formatUnits } from 'viem'

export const DUST_THRESHOLD_FIAT = 1
/** |rpc - api| / max(rpc, api) above which GraphQL fiat is dropped for a row. */
const DIVERGENCE_TOLERANCE = 0.01

export interface PortfolioRow {
  readonly address: string
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly standard: 'native' | 'erc20'
  /** Raw on-chain quantity — RPC, source of truth. */
  readonly rawQuantity: bigint
  /** Raw quantity the indexer reported, for the >1% divergence check. */
  readonly rawQuantityFromApi: bigint | null
  /** GraphQL display price (fiat) — null when the API is down. */
  readonly price: number | null
  /** GraphQL display value (fiat). */
  readonly denominatedValue: number | null
  readonly pricePercentChangeDay: number | null
  readonly currency: string
  readonly logoUrl?: string | null
}

export interface BusBarToken {
  readonly address: string
  readonly symbol: string
  readonly name: string
  readonly standard: 'native' | 'erc20'
  readonly decimals: number
  readonly rawQuantity: bigint
  readonly formattedQuantity: string
  /** Fiat value (denominated). null when no price / dropped by divergence. */
  readonly denominatedValue: number | null
  readonly price: number | null
  readonly pricePercentChangeDay: number | null
  readonly currency: string
  /** 0..1 — the bus-bar fill. Share of the total *when a fiat total exists*. */
  share: number
  /** True when hidden as dust (<$1) even though a price returned. */
  hidden: boolean
  /** True when there is no price → UI shows raw units + "price unavailable". */
  readonly priceUnavailable: boolean
  readonly logoUrl?: string | null
}

export interface EtnPortfolio {
  readonly owner: string
  /** Fiat total across priced rows; null when nothing is priced. */
  readonly totalDenominated: number | null
  readonly totalChange24h: { readonly absolute: number; readonly percentage: number } | null
  /** Priced + dust-visible rows, sorted by share desc (the bus bars). */
  readonly tokens: BusBarToken[]
  /** Dust rows (<$1, price present) — collapsed to an "overflow is a list". */
  readonly dust: BusBarToken[]
  readonly priceAvailableCount: number
  readonly tokenCount: number
}

function diverged(rpc: bigint, api: bigint): boolean {
  if (api <= 0n) return false
  const hi = rpc > api ? rpc : api
  if (hi === 0n) return false
  const diff = rpc > api ? rpc - api : api - rpc
  return Number(diff) / Number(hi) > DIVERGENCE_TOLERANCE
}

/**
 * Merge rows into the portfolio the chamber renders.
 */
export function buildEtnPortfolio(
  owner: string,
  rows: readonly PortfolioRow[],
  opts: { dustThresholdFiat?: number } = {},
): EtnPortfolio {
  const dustThreshold = opts.dustThresholdFiat ?? DUST_THRESHOLD_FIAT

  const priced: BusBarToken[] = []
  const unpriced: BusBarToken[] = []
  const dust: BusBarToken[] = []
  let currentTotal = 0
  let previousTotal = 0
  let hasFiat = false

  for (const r of rows) {
    const base: Omit<
      BusBarToken,
      | 'denominatedValue'
      | 'price'
      | 'pricePercentChangeDay'
      | 'share'
      | 'hidden'
      | 'priceUnavailable'
    > = {
      address: r.address,
      symbol: r.symbol,
      name: r.name,
      standard: r.standard,
      decimals: r.decimals,
      rawQuantity: r.rawQuantity,
      formattedQuantity: formatUnits(r.rawQuantity, r.decimals),
      currency: r.currency,
      logoUrl: r.logoUrl,
    }

    const zero = r.rawQuantity === 0n
    const priceMissing = r.price == null || r.denominatedValue == null
    // Divergence: RPC quantity (truth) vs indexer quantity — drop fiat, keep the row.
    const isDiverged =
      r.rawQuantityFromApi != null && !zero && diverged(r.rawQuantity, r.rawQuantityFromApi)
    const fiatOk = !priceMissing && !isDiverged
    const denominatedValue: number | null = fiatOk ? (r.denominatedValue as number) : null

    if (denominatedValue != null) {
      hasFiat = true
      currentTotal += denominatedValue
      const changePct = r.pricePercentChangeDay ?? 0
      previousTotal += denominatedValue / (1 + changePct / 100)
    }

    const tok: BusBarToken = {
      ...base,
      denominatedValue,
      price: r.price,
      pricePercentChangeDay: r.pricePercentChangeDay,
      share: 0,
      hidden: false,
      priceUnavailable: priceMissing,
    }

    if (zero) continue // hide zero balances (pinned/custom is a caller concern)
    if (denominatedValue != null && denominatedValue < dustThreshold) {
      tok.hidden = true
      dust.push(tok)
    } else if (priceMissing) {
      unpriced.push(tok)
    } else {
      priced.push(tok)
    }
  }

  // Bus-bar fill = share of the portfolio total (only meaningful with a fiat total).
  const visible = [...priced, ...unpriced]
  for (const t of visible) {
    t.share = hasFiat && currentTotal > 0 ? (t.denominatedValue ?? 0) / currentTotal : 0
  }
  visible.sort((a, b) => (b.denominatedValue ?? 0) - (a.denominatedValue ?? 0))
  const dustList = [...dust].sort((a, b) => (b.denominatedValue ?? 0) - (a.denominatedValue ?? 0))

  const totalChange24h =
    hasFiat && previousTotal > 0
      ? {
          absolute: currentTotal - previousTotal,
          percentage: ((currentTotal - previousTotal) / previousTotal) * 100,
        }
      : null

  return {
    owner,
    totalDenominated: hasFiat ? currentTotal : null,
    totalChange24h,
    tokens: visible,
    dust: dustList,
    priceAvailableCount: priced.length,
    tokenCount: rows.length,
  }
}
