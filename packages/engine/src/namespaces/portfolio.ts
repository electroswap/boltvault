/**
 * Portfolio (master plan §8.2, §2.8): quantities from the chain (multicall3
 * balanceOf + native balance) — the only truth; fiat and 24 h change from the
 * ElectroSwap indexer as display, dropped per row when its quantity diverges
 * from the chain by more than 1 %. The last-good snapshot is persisted so the
 * popup paints before the first RPC answers.
 */
import { HOME_CHAIN_ID } from '@boltvault/chains'
import type { ElectroSwapClient } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { formatUnits, parseAbi, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import { readMany } from '../multicall'
import { AccountIdSchema, PortfolioSnapshotSchema, type PortfolioRow, type PortfolioSnapshot, type TokenView } from '../schema'
import { readDoc, writeDoc, type DocSpec } from '../storage'
import type { ChainsService } from './chains'
import type { TokensService } from './tokens'
import type { VaultManager } from './vault'

const ERC20_BALANCE = parseAbi(['function balanceOf(address owner) view returns (uint256)'])
const DUST_FIAT = 1
const DIVERGENCE = 0.01
const REFRESH_DEBOUNCE_MS = 2_500
const PRICE_BUDGET_MS = 4_000

const snapDoc = (accountId: string): DocSpec<PortfolioSnapshot | null> => ({
  key: `portfolio.${accountId}`,
  version: 1,
  schema: PortfolioSnapshotSchema.nullable(),
  defaultValue: () => null,
})

const lookDoc = (accountId: string): DocSpec<{ at: number; total: number | null } | null> => ({
  key: `portfolio.look.${accountId}`,
  version: 1,
  schema: z.object({ at: z.number().int().nonnegative(), total: z.number().nullable() }).nullable(),
  defaultValue: () => null,
})

interface PriceRow {
  readonly price: number
  readonly change24h: number | null
  readonly apiQuantity: number | null
  readonly spam: boolean
}

export interface PortfolioDeps {
  readonly platform: Platform
  readonly bus: EventBus
  readonly chains: ChainsService
  readonly tokens: TokensService
  readonly vault: VaultManager
  /** Display prices for Electroneum (§9); null when the API key is not configured. */
  readonly electroswap?: ElectroSwapClient | null
}

export class PortfolioService {
  private readonly inFlight = new Map<string, Promise<PortfolioSnapshot>>()
  private readonly lastRefresh = new Map<string, number>()

  constructor(private readonly deps: PortfolioDeps) {}

  /** The last-good snapshot at once (stale flag set), and a refresh in the background. */
  async snapshot(accountId: string, chainIds: readonly number[] = [HOME_CHAIN_ID]): Promise<PortfolioSnapshot> {
    const { value } = await readDoc(this.deps.platform.storage.local, snapDoc(accountId), () => this.deps.platform.now())
    const last = this.lastRefresh.get(accountId) ?? 0
    if (this.deps.platform.now() - last > REFRESH_DEBOUNCE_MS) void this.refresh(accountId, chainIds).catch(() => undefined)
    if (value) return { ...value, stale: true }
    return { accountId, chainIds: [...chainIds], currency: 'USD', total: null, change24h: null, unpricedCount: 0, rows: [], observedAt: 0, stale: true }
  }

  async refresh(accountId: string, chainIds: readonly number[] = [HOME_CHAIN_ID]): Promise<PortfolioSnapshot> {
    const k = `${accountId}:${chainIds.join(',')}`
    const open = this.inFlight.get(k)
    if (open) return open
    const p = this.build(accountId, chainIds).finally(() => this.inFlight.delete(k))
    this.inFlight.set(k, p)
    return p
  }

  private async build(accountId: string, chainIds: readonly number[]): Promise<PortfolioSnapshot> {
    const d = this.deps
    const account = (await d.vault.accounts()).find((a) => a.id === accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const owner = account.address as Hex
    const rows: PortfolioRow[] = []
    for (const chainId of chainIds) {
      const universe = await d.tokens.universe(chainId)
      // Quantities are the truth and never wait for display data: prices get a bounded slot.
      const [balances, prices] = await Promise.all([
        this.balances(chainId, owner, universe),
        Promise.race([this.prices(chainId, owner), new Promise<Map<string, PriceRow>>((resolve) => setTimeout(() => resolve(new Map()), PRICE_BUDGET_MS))]),
      ])
      for (const t of universe) {
        const raw = balances.get(t.address.toLowerCase()) ?? 0n
        const keep = raw > 0n || t.source === 'user' || t.source === 'dapp' || t.pinned
        if (!keep) continue
        const quantityNum = Number(formatUnits(raw, t.decimals))
        const price = prices.get(t.address === 'native' ? 'native' : t.address.toLowerCase()) ?? null
        let fiat: number | null = null
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
          logoUri: t.logoUri,
          raw: raw.toString(),
          quantity: formatUnits(raw, t.decimals),
          fiat,
          change24h,
          share: 0,
          pinned: t.pinned,
          custom: t.source === 'user' || t.source === 'dapp',
          hidden: t.hidden || spam || (fiat !== null && fiat < DUST_FIAT && !t.pinned && t.address !== 'native'),
        })
      }
    }
    const priced = rows.filter((r) => r.fiat !== null && !r.hidden)
    const total = priced.length ? priced.reduce((s, r) => s + (r.fiat ?? 0), 0) : null
    let previous = 0
    for (const r of priced) previous += (r.fiat ?? 0) / (1 + (r.change24h ?? 0))
    const change24h = total !== null && previous > 0 ? total / previous - 1 : null
    const withShare = rows.map((r) => ({ ...r, share: total && r.fiat !== null && !r.hidden ? r.fiat / total : 0 }))
    withShare.sort((a, b) => {
      if (a.address === 'native') return -1
      if (b.address === 'native') return 1
      const fa = a.fiat ?? -1
      const fb = b.fiat ?? -1
      if (fb !== fa) return fb - fa
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return Number(b.quantity) - Number(a.quantity)
    })
    const snapshot: PortfolioSnapshot = {
      accountId,
      chainIds: [...chainIds],
      currency: 'USD',
      total,
      change24h,
      unpricedCount: withShare.filter((r) => r.fiat === null && !r.hidden).length,
      rows: withShare,
      observedAt: d.platform.now(),
      stale: false,
    }
    await writeDoc(d.platform.storage.local, snapDoc(accountId), snapshot)
    this.lastRefresh.set(accountId, d.platform.now())
    d.bus.emit({ type: 'portfolio.snapshot', snapshot })
    return snapshot
  }

  private async balances(chainId: number, owner: Hex, universe: readonly TokenView[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>()
    const native = (await this.deps.chains.rpc(chainId, 'eth_getBalance', [owner, 'latest']).catch(() => null)) as string | null
    if (native) out.set('native', BigInt(native))
    const erc20 = universe.filter((t) => t.address !== 'native')
    const results = await readMany(
      this.deps.chains,
      chainId,
      erc20.map((t) => ({ address: t.address as Hex, abi: ERC20_BALANCE, functionName: 'balanceOf', args: [owner] })),
    )
    erc20.forEach((t, i) => {
      const r = results[i]
      if (r?.ok && typeof r.value === 'bigint') out.set(t.address.toLowerCase(), r.value)
    })
    return out
  }

  private async prices(chainId: number, owner: Hex): Promise<Map<string, PriceRow>> {
    const out = new Map<string, PriceRow>()
    const es = this.deps.electroswap
    if (!es || (chainId !== 52014 && chainId !== 5201420)) return out
    try {
      const p = await es.portfolio(chainId, owner)
      for (const b of p.tokenBalances) {
        const qty = Number(b.quantity)
        const value = b.denominatedValue?.value
        if (!Number.isFinite(qty) || qty <= 0 || typeof value !== 'number') continue
        const k = b.token.standard === 'NATIVE' || b.token.address.toUpperCase() === 'NATIVE' ? 'native' : b.token.address.toLowerCase()
        out.set(k, { price: value / qty, change24h: typeof b.tokenProjectMarket?.pricePercentChange?.value === 'number' ? b.tokenProjectMarket.pricePercentChange.value / 100 : null, apiQuantity: qty, spam: b.tokenProjectMarket?.tokenProject?.isSpam === true })
      }
    } catch {
      // Display data is optional: unpriced rows, never a shrinking hero.
    }
    return out
  }

  /** "Since you last looked": the total at the previous first open, then record this one. */
  async lastLook(accountId: string): Promise<{ previous: { at: number; total: number | null } | null; total: number | null }> {
    const d = this.deps
    const { value: previous } = await readDoc(d.platform.storage.local, lookDoc(accountId), () => d.platform.now())
    const { value: snap } = await readDoc(d.platform.storage.local, snapDoc(accountId), () => d.platform.now())
    const total = snap?.total ?? null
    await writeDoc(d.platform.storage.local, lookDoc(accountId), { at: d.platform.now(), total })
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
  }
}
