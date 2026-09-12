/**
 * Portfolio (master plan §8.2, §2.8): quantities from the chain (multicall3
 * balanceOf + native balance) — the only truth; fiat and 24 h change from the
 * ElectroSwap indexer as display, dropped per row when its quantity diverges
 * from the chain by more than 1 %. The last-good snapshot is persisted so the
 * popup paints before the first RPC answers.
 */
import { HOME_CHAIN_ID, pollMs } from '@boltvault/chains'
import type { ElectroSwapClient } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { formatUnits, parseAbi, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { PriceSource } from '../prices'
import type { EventBus, NamespaceSpec } from '../host'
import { multicallAddress, readMany, type ReadCall } from '../multicall'
import { AccountIdSchema, type PortfolioPoint, type PortfolioRow, type PortfolioSnapshot, type TokenView } from '../schema'
// Snapshots and "since you last looked" used to be one plaintext document per
// account (`bv:local:portfolio.<accountId>`), which put the USD total, every
// per-token quantity *and* the account id on disk in the clear, readable with
// the vault locked (at-rest audit 2026-09-06, F1). Both now live in a
// DEK-sealed blob keyed by account id; built in `create.ts`.
import type { LastLook } from '../blobs'
import type { SealedMap } from '../sealed'
import type { ChainsService } from './chains'
import type { TokensService } from './tokens'
import type { VaultManager } from './vault'

const ERC20_BALANCE = parseAbi(['function balanceOf(address owner) view returns (uint256)'])
/** Multicall3 weighs the native coin as well as tokens — its own view function. */
const MULTICALL3_BALANCE = parseAbi(['function getEthBalance(address addr) view returns (uint256)'])
const DUST_FIAT = 1
const DIVERGENCE = 0.01
/**
 * How often a scope may be rebuilt, at the least.
 *
 * This was a flat 2.5 s, and `usePortfolio` asks on every block — so with
 * "All chains" in scope the wallet rebuilt ten chains, a native balance and a
 * Multicall3 aggregate each, several times a minute, forever. None of those
 * chains had produced a new block worth reading. The cadence is now the
 * scope's own: one chain moves at that chain's pace, and a basket of them
 * moves at a background pace, because a chain contributing a number to a total
 * does not need asking as often as the chain you are looking at.
 */
function refreshEveryMs(chainIds: readonly number[]): number {
  const mode = chainIds.length > 1 ? 'background' : 'foreground'
  return Math.max(...chainIds.map((c) => pollMs(c, mode)), 1_000)
}
const PRICE_BUDGET_MS = 4_000

/**
 * How coarse the history series is, and how far back it reaches (§8.2).
 *
 * One point an hour, five days. Two things force a bucket. The wallet rebuilds
 * a visible scope every few seconds, so an unbucketed series would be a log of
 * repaints rather than the shape of a portfolio; and the series rides inside
 * the sealed snapshot, which is rewritten in full on every one of those
 * rebuilds, so each point is paid for again every time. An hour is already
 * finer than a chart 300 pixels wide can draw over five days, and the cap is
 * what stops a wallet left open on a desk from growing this without end.
 */
const HISTORY_BUCKET_MS = 60 * 60 * 1_000
const HISTORY_CAP = 120

/**
 * Append one reading to a bounded series, at most one point per bucket.
 *
 * Within a bucket the newest reading replaces the older one instead of being
 * dropped, so the end of the chart is always the number in the hero above it —
 * a series whose head lags the total it belongs to reads as a fault.
 *
 * Pure and exported so the bounding is testable without a chain.
 */
export function appendPoint(series: readonly PortfolioPoint[], at: number, total: number | null): PortfolioPoint[] {
  const bucket = Math.floor(at / HISTORY_BUCKET_MS)
  const next = [...series.filter((p) => Math.floor(p.at / HISTORY_BUCKET_MS) !== bucket), { at, total }].sort((a, b) => a.at - b.at)
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next
}

interface PriceRow {
  readonly price: number
  readonly change24h: number | null
  readonly apiQuantity: number | null
  readonly spam: boolean
  /** A logo the price source carried, for a token whose list entry has none. */
  readonly logoUri: string | null
}

export interface PortfolioDeps {
  readonly platform: Platform
  readonly bus: EventBus
  readonly chains: ChainsService
  readonly tokens: TokensService
  readonly vault: VaultManager
  /** Display prices for Electroneum (§9); null when the API key is not configured. */
  readonly electroswap?: ElectroSwapClient | null
  /** Display prices off Electroneum (§10.4); null disables them. */
  readonly prices?: PriceSource | null
  /** Last-good snapshot per account, sealed under the DEK. */
  readonly snapshots: SealedMap<PortfolioSnapshot>
  /** "Since you last looked" per account, sealed under the DEK. */
  readonly looks: SealedMap<LastLook>
}

/**
 * The stored key for a snapshot: the account *and* the chains it covers.
 *
 * A snapshot is only true of the chains it was built from, and this store held
 * exactly one per account. So the Home scope changing from "All chains" to one
 * chain — or Send opening, which asks for a single chain while Home holds them
 * all — read back a snapshot built for a *different* set of chains and served
 * it as the answer. The total, the row list and the per-token quantities all
 * belonged to the previous scope until a refresh landed on top. Owner: "Cache
 * keys should include chain info as I'm seeing weird numbers until chain data
 * is able to refresh", and "Switching between chains causes some really weird
 * behaviors due to caching."
 *
 * Sorted, so [1, 52014] and [52014, 1] are the same cache entry: the order
 * only decides how rows are grouped, never what is in them.
 */
function scopeKey(accountId: string, chainIds: readonly number[]): string {
  return `${accountId}:${[...new Set(chainIds)].sort((a, b) => a - b).join('-')}`
}

export class PortfolioService {
  private readonly inFlight = new Map<string, Promise<PortfolioSnapshot>>()
  private readonly lastRefresh = new Map<string, number>()

  constructor(private readonly deps: PortfolioDeps) {}

  /** The last-good snapshot at once (stale flag set), and a refresh in the background. */
  async snapshot(accountId: string, chainIds: readonly number[] = [HOME_CHAIN_ID]): Promise<PortfolioSnapshot> {
    const k = scopeKey(accountId, chainIds)
    const value = await this.deps.snapshots.get(k)
    const last = this.lastRefresh.get(k) ?? 0
    if (this.deps.platform.now() - last > refreshEveryMs(chainIds)) void this.refresh(accountId, chainIds).catch(() => undefined)
    if (value) return { ...value, stale: true }
    return { accountId, chainIds: [...chainIds], currency: 'USD', total: null, change24h: null, unpricedCount: 0, rows: [], observedAt: 0, stale: true, history: [] }
  }

  /**
   * What this wallet has seen the scope's total be, oldest first (§8.2).
   *
   * No refresh and no backfill. The series is a record of readings this device
   * took while it was open, which is the only portfolio history the wallet can
   * honestly claim: quantities come from the chain but the *value* comes from
   * display prices (§2.8), and nothing off-device is asked what the total used
   * to be. A gap in the line is a gap in the looking.
   */
  async history(accountId: string, chainIds: readonly number[] = [HOME_CHAIN_ID]): Promise<PortfolioPoint[]> {
    const snap = await this.deps.snapshots.get(scopeKey(accountId, chainIds))
    return [...(snap?.history ?? [])]
  }

  /**
   * The persisted last-good snapshot, no refresh (plan C1).
   *
   * Without a scope this answers with the widest snapshot the account has,
   * which is what a caller that names no chains is really asking for — the
   * chain sheet wants the balance held on *each* chain, and a single-chain
   * snapshot can only speak for one of them.
   */
  async cached(accountId: string, chainIds?: readonly number[]): Promise<PortfolioSnapshot | null> {
    const value = chainIds ? await this.deps.snapshots.get(scopeKey(accountId, chainIds)) : await this.widest(accountId)
    return value ? { ...value, stale: true } : null
  }

  /** The account's snapshot covering the most chains; the most recent of those breaks a tie. */
  private async widest(accountId: string): Promise<PortfolioSnapshot | null> {
    const prefix = `${accountId}:`
    let best: PortfolioSnapshot | null = null
    for (const [id, snap] of Object.entries(await this.deps.snapshots.entries())) {
      if (!id.startsWith(prefix)) continue
      if (best === null || snap.chainIds.length > best.chainIds.length || (snap.chainIds.length === best.chainIds.length && snap.observedAt > best.observedAt)) best = snap
    }
    return best
  }

  async refresh(accountId: string, chainIds: readonly number[] = [HOME_CHAIN_ID]): Promise<PortfolioSnapshot> {
    const k = scopeKey(accountId, chainIds)
    const open = this.inFlight.get(k)
    if (open) return open
    const p = this.build(accountId, chainIds).finally(() => this.inFlight.delete(k))
    this.inFlight.set(k, p)
    return p
  }

  /**
   * One chain's rows. Called for every chain at once (see `build`), so nothing
   * in here may depend on another chain having finished.
   */
  private async chainRows(
    chainId: number,
    owner: Hex,
    /** The last good rows for this scope, so an unread token keeps its figure. */
    lastGood: readonly PortfolioRow[] = [],
  ): Promise<{ rows: PortfolioRow[]; unread: number }> {
    const d = this.deps
    const rows: PortfolioRow[] = []
    let unread = 0
    const universe = await d.tokens.universe(chainId)
    const balances = await this.balances(chainId, owner, universe)
    /*
      Price what is held, not what exists.

      Off Electroneum this asked GeckoTerminal about the whole public token
      list — hundreds of addresses, thirty to a request — for a wallet
      holding a handful of them. The free tier allows about thirty calls a
      minute across all networks, so one Base refresh spent four of them and
      the next chain got a 429; the shared cooldown then left every chain
      showing "without price". Held tokens are one request, and the answer
      is the same.

      The balances have to be in hand first, which is why this no longer
      runs beside them. Quantities are still the truth and still never wait
      on display data: the price call keeps its bounded slot, and a slow or
      rate-limited source yields unpriced rows, never a late snapshot.
    */
    /*
      A token whose read failed is still "held" as far as this screen goes:
      dropping it would silently shrink the list during an outage, which is
      the same lie as showing it at zero.
    */
    const held = universe.filter((t) => {
      const b = balances.get(t.address.toLowerCase())
      return b === null || (b ?? 0n) > 0n || t.source === 'user' || t.source === 'dapp' || t.pinned
    })
    const prices = await Promise.race([this.prices(chainId, owner, held), new Promise<Map<string, PriceRow>>((resolve) => setTimeout(() => resolve(new Map()), PRICE_BUDGET_MS))])
    for (const t of held) {
      const read = balances.get(t.address.toLowerCase())
      const failed = read === null
      if (failed) unread += 1
      /*
        The last figure we actually saw, rather than a zero we invented. It is
        marked `unread` so nothing downstream treats it as current.
      */
      const remembered = failed
        ? (lastGood.find((r) => r.chainId === chainId && r.address === t.address)?.raw ?? '0')
        : null
      const raw = failed ? BigInt(remembered ?? '0') : (read ?? 0n)
      const quantityNum = Number(formatUnits(raw, t.decimals))
      const price = prices.get(t.address === 'native' ? 'native' : t.address.toLowerCase()) ?? null
      // A balance of zero is worth zero whatever the price is, and needs no
      // price to say so. `prices()` is owner-scoped, so an empty wallet gets
      // no rows back at all — which used to leave fiat null, count the token
      // as "without price", and drop the whole total to null. Owner: "an
      // empty wallet is showing '1 token - 1 without price' ... I know it's
      // got a price because a wallet with ETN in it shows the value."
      // An unread balance has no value to state, whatever the price is.
      let fiat: number | null = failed ? null : raw === 0n ? 0 : null
      let change24h: number | null = null
      if (price && Number.isFinite(price.price)) {
        const diverged = price.apiQuantity !== null && quantityNum > 0 && Math.abs(price.apiQuantity - quantityNum) / Math.max(price.apiQuantity, quantityNum) > DIVERGENCE
        if (!diverged) {
          fiat = quantityNum * price.price
          change24h = price.change24h
        }
      }
      const spam = price?.spam === true
      rows.push({
        chainId,
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        // The price source often carries a mark for a token whose list entry
        // has none — the majors on chains we ship no logo for.
        logoUri: t.logoUri ?? price?.logoUri ?? null,
        raw: raw.toString(),
        quantity: formatUnits(raw, t.decimals),
        fiat,
        change24h,
        share: 0,
        pinned: t.pinned,
        custom: t.source === 'user' || t.source === 'dapp',
        hidden: t.hidden || spam || (raw > 0n && fiat !== null && fiat < DUST_FIAT && !t.pinned && t.address !== 'native'),
        ...(failed ? { unread: true } : {}),
      })
    }
    return { rows, unread }
  }

  private async build(accountId: string, chainIds: readonly number[]): Promise<PortfolioSnapshot> {
    const d = this.deps
    const key = scopeKey(accountId, chainIds)
    // The series belongs to the scope, so it is carried forward from the
    // scope's own last snapshot — "All chains" and one chain are two different
    // questions and must not share a line.
    const stored = await d.snapshots.get(key)
    const account = (await d.vault.accounts()).find((a) => a.id === accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const owner = account.address as Hex
    /*
      Every chain at once.

      This was a `for await`, so with "All chains" the wallet read Ethereum,
      then BNB, then Base, then the other seven — each waiting on the last for
      no reason. The chains share nothing: different endpoints, different
      universes, different multicalls. Owner: "the RPC calls made for each
      chain are being made sequentially ... those calls should happen in
      parallel." Ten chains now cost about what the slowest one costs instead
      of the sum of all ten.

      Rows still come back in the caller's chain order — `Promise.all` keeps
      the array's order — so the snapshot is deterministic and the sort below
      is the only thing that decides what the user sees.
    */
    const perChain = await Promise.all(
      chainIds.map((chainId) => this.chainRows(chainId, owner, stored?.rows ?? [])),
    )
    const rows: PortfolioRow[] = perChain.flatMap((p) => p.rows)
    // Which chains could not be read, and how much of each is missing.
    const errors = chainIds
      .map((chainId, i) => ({ chainId, count: perChain[i]?.unread ?? 0 }))
      .filter((e) => e.count > 0)
    const priced = rows.filter((r) => r.fiat !== null && !r.hidden)
    const total = priced.length ? priced.reduce((s, r) => s + (r.fiat ?? 0), 0) : null
    let previous = 0
    for (const r of priced) previous += (r.fiat ?? 0) / (1 + (r.change24h ?? 0))
    const change24h = total !== null && previous > 0 ? total / previous - 1 : null
    const withShare = rows.map((r) => ({ ...r, share: total && r.fiat !== null && !r.hidden ? r.fiat / total : 0 }))
    /*
      Most valuable first, and the native coin takes its place in that order
      like everything else.

      It used to be pinned to the top whatever it was worth, which put $8,410
      of ETN above $13,756 of BOLT and made the column stop meaning what it
      looks like it means — a list sorted by size that is not sorted by size is
      worse than an unsorted one, because you trust it. Owner: "I want the
      highest value balances to always show at the top in the portfolio view
      (descending order)."

      Unpriced rows still sink below priced ones (`?? -1`), and among rows that
      tie — every row on a chain we have no prices for — `pinned` brings the
      native coin back to the top, which is where it belongs when nothing has
      a value to compare.
    */
    withShare.sort((a, b) => {
      const fa = a.fiat ?? -1
      const fb = b.fiat ?? -1
      if (fb !== fa) return fb - fa
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return Number(b.quantity) - Number(a.quantity)
    })
    const observedAt = d.platform.now()
    const snapshot: PortfolioSnapshot = {
      accountId,
      chainIds: [...chainIds],
      currency: 'USD',
      total,
      change24h,
      unpricedCount: withShare.filter((r) => r.fiat === null && !r.hidden).length,
      rows: withShare,
      observedAt,
      /*
        A build with a failed read is not a fresh answer (ES-BV-045). It is
        marked stale so every surface that shows an age shows one, its total
        is not appended to the history series — a dip invented by an outage
        would sit in the chart for good — and it is not written over the last
        good snapshot, which is the only complete figure the wallet still has.
      */
      stale: errors.length > 0,
      history:
        errors.length > 0
          ? (stored?.history ?? [])
          : appendPoint(stored?.history ?? [], observedAt, total),
      ...(errors.length > 0 ? { errors } : {}),
    }
    if (errors.length === 0) await d.snapshots.set(key, snapshot)
    this.lastRefresh.set(key, observedAt)
    d.bus.emit({ type: 'portfolio.snapshot', snapshot })
    return snapshot
  }

  /**
   * Balances by lowercase address, where `null` means the read failed
   * (ES-BV-045).
   *
   * Omitting a failed read made it indistinguishable from a token the wallet
   * did not ask about, and the row builder's `?? 0n` then turned both into a
   * confident zero. During an endpoint outage a user checking whether a
   * deposit landed saw "$0.00 — add funds" and the last good snapshot was
   * overwritten with the zeros. A read that did not answer has to say so.
   */
  private async balances(chainId: number, owner: Hex, universe: readonly TokenView[]): Promise<Map<string, bigint | null>> {
    const out = new Map<string, bigint | null>()
    const erc20 = universe.filter((t) => t.address !== 'native')
    const mc = await multicallAddress(this.deps.chains, chainId)
    const calls: ReadCall[] = erc20.map((t) => ({ address: t.address as Hex, abi: ERC20_BALANCE, functionName: 'balanceOf', args: [owner] }))
    /*
      The native coin rides in the same aggregate.

      Multicall3 has `getEthBalance` precisely so a wallet does not need a
      second round trip to weigh the coin it is already weighing tokens for.
      It was a separate `eth_getBalance` per chain, awaited before the batch —
      so ten chains meant ten extra calls, each one holding up the aggregate
      behind it.
    */
    if (mc) calls.push({ address: mc, abi: MULTICALL3_BALANCE, functionName: 'getEthBalance', args: [owner] })
    const results = await readMany(this.deps.chains, chainId, calls)
    erc20.forEach((t, i) => {
      const r = results[i]
      if (r?.ok && typeof r.value === 'bigint') {
        out.set(t.address.toLowerCase(), r.value)
        return
      }
      /*
        A `balanceOf` that reverted is a contract that is not a token, and zero
        is the right thing to say about it. A read nobody answered is not.
      */
      out.set(t.address.toLowerCase(), r && !r.ok && r.reason === 'unreachable' ? null : 0n)
    })
    const weighed = mc ? results[erc20.length] : undefined
    if (weighed?.ok && typeof weighed.value === 'bigint') {
      out.set('native', weighed.value)
      return out
    }
    // No multicall here, or it declined to answer for the coin: ask directly.
    const native = (await this.deps.chains.rpc(chainId, 'eth_getBalance', [owner, 'latest']).catch(() => null)) as string | null
    out.set('native', typeof native === 'string' ? BigInt(native) : null)
    return out
  }

  private async prices(chainId: number, owner: Hex, held: readonly TokenView[]): Promise<Map<string, PriceRow>> {
    const out = new Map<string, PriceRow>()
    const es = this.deps.electroswap
    if (chainId !== 52014 && chainId !== 5201420) return this.otherPrices(chainId, held)
    if (!es) return out
    try {
      const p = await es.portfolio(chainId, owner)
      for (const b of p.tokenBalances) {
        const qty = Number(b.quantity)
        const value = b.denominatedValue?.value
        if (!Number.isFinite(qty) || qty <= 0 || typeof value !== 'number') continue
        const k = b.token.standard === 'NATIVE' || b.token.address.toUpperCase() === 'NATIVE' ? 'native' : b.token.address.toLowerCase()
        out.set(k, { price: value / qty, change24h: typeof b.tokenProjectMarket?.pricePercentChange?.value === 'number' ? b.tokenProjectMarket.pricePercentChange.value / 100 : null, apiQuantity: qty, spam: b.tokenProjectMarket?.tokenProject?.isSpam === true, logoUri: null })
      }
    } catch {
      // Display data is optional: unpriced rows, never a shrinking hero.
    }
    return out
  }

  /** Off Electroneum only token addresses leave the wallet — never the account (§3.8). */
  private async otherPrices(chainId: number, held: readonly TokenView[]): Promise<Map<string, PriceRow>> {
    const out = new Map<string, PriceRow>()
    const source = this.deps.prices
    if (!source) return out
    try {
      const priced = await source.prices(chainId, held.map((t) => t.address))
      for (const [k, v] of priced) out.set(k, { price: v.price, change24h: v.change24h, apiQuantity: null, spam: false, logoUri: v.logoUri })
    } catch {
      // Unpriced rows, never a shrinking hero.
    }
    return out
  }

  /** "Since you last looked": the total at the previous first open, then record this one. */
  async lastLook(accountId: string): Promise<{ previous: { at: number; total: number | null } | null; total: number | null }> {
    const d = this.deps
    const previous = await d.looks.get(accountId)
    const snap = await this.widest(accountId)
    const total = snap?.total ?? null
    await d.looks.set(accountId, { at: d.platform.now(), total })
    return { previous, total }
  }
}

export function portfolioNamespace(portfolio: PortfolioService): NamespaceSpec {
  return {
    snapshot: {
      input: z.object({ accountId: AccountIdSchema, chainIds: z.array(z.number().int().positive()).optional() }),
      handler: (arg) => {
        const { accountId, chainIds } = arg as { accountId: string; chainIds?: number[] }
        return portfolio.snapshot(accountId, chainIds ?? [HOME_CHAIN_ID])
      },
    },
    refresh: {
      input: z.object({ accountId: AccountIdSchema, chainIds: z.array(z.number().int().positive()).optional() }),
      handler: (arg) => {
        const { accountId, chainIds } = arg as { accountId: string; chainIds?: number[] }
        return portfolio.refresh(accountId, chainIds ?? [HOME_CHAIN_ID])
      },
    },
    lastLook: { input: z.object({ accountId: AccountIdSchema }), handler: (arg) => portfolio.lastLook((arg as { accountId: string }).accountId) },
    /** The scope's own series of totals, oldest first (§8.2). */
    history: {
      input: z.object({ accountId: AccountIdSchema, chainIds: z.array(z.number().int().positive()).optional() }),
      handler: (arg) => {
        const { accountId, chainIds } = arg as { accountId: string; chainIds?: number[] }
        return portfolio.history(accountId, chainIds ?? [HOME_CHAIN_ID])
      },
    },
    cached: {
      input: z.object({ accountId: AccountIdSchema, chainIds: z.array(z.number().int().positive()).optional() }),
      handler: (arg) => {
        const { accountId, chainIds } = arg as { accountId: string; chainIds?: number[] }
        return portfolio.cached(accountId, chainIds)
      },
    },
  }
}
