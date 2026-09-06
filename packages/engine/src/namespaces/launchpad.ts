/**
 * Launchpad (master plan §8.9): campaigns from the API with the pool's own
 * status as the truth (the API's status resolver throws on stored CLOSED /
 * FINALIZED — B4), the account's contribution, claimables and referral
 * earnings from the chain, the binding state table, and the flows —
 * Contribute · Claim tokens · Claim refund · Claim referral rewards.
 * Referrals from links are remembered per pool for a day.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { AFFILIATE_ABI, LAUNCHPAD_MANAGER_ABI, LAUNCHPAD_POOL_ABI, campaignKeys, campaignPhase, encodeClaimRefund, encodeClaimReferralRewards, encodeClaimTokens, encodeContribute, fetchCampaign, fetchCampaigns, poolStatus, referrerFromLink, type CampaignView as EsCampaign, type ElectroSwapClient, type PresaleWireStatus } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { parseUnits, type Hex } from 'viem'
import { z } from 'zod'
import type { SealedMap } from '../sealed'
import { EngineError } from '../errors'
import { cacheKey, type Cached, type DocCache } from '../cache'
import type { NamespaceSpec } from '../host'
import { readMany, type ReadCall, type ReadResult } from '../multicall'
import { CampaignViewSchema, AccountIdSchema, type CampaignView } from '../schema'
import type { ChainsService } from './chains'
import type { FlowStore } from './flows'
import type { NamesService } from './names'
import type { ProviderService } from './provider'
import type { VaultManager } from './vault'
import type { WatchlistService } from './watchlist'

export interface LaunchpadDeps {
  readonly platform: Platform
  readonly chains: ChainsService
  readonly vault: VaultManager
  readonly provider: ProviderService
  readonly flows: FlowStore
  readonly electroswap: ElectroSwapClient | null
  readonly names: NamesService
  readonly watchlist: WatchlistService
  readonly cache?: DocCache
  /** Launchpad referrer per `<chainId>.<pool>`, sealed under the DEK. */
  readonly referrals: SealedMap<{ referrer: string; at: number }>
}

/** A campaign list is good for a minute; phases move in blocks, not frames. */
const LIST_TTL_MS = 60_000
const listSpec = (chainId: number, accountId: string | undefined) => ({ key: cacheKey('launchpad', 'list', chainId, accountId ?? '-'), schema: z.array(CampaignViewSchema) })

const REFERRAL_TTL_MS = 24 * 3_600_000
const isEtn = (chainId: number): chainId is 52014 | 5201420 => chainId === 52014 || chainId === 5201420
const hex = (n: bigint): Hex => `0x${n.toString(16)}`
const big = (r: ReadResult | undefined): bigint => (r !== undefined && r.ok && typeof r.value === 'bigint' ? r.value : 0n)
const tuple = (r: ReadResult | undefined): readonly unknown[] | null => (r !== undefined && r.ok && Array.isArray(r.value) ? (r.value as readonly unknown[]) : null)
/** Small integers (uint8/uint16/uint32) come back from viem as numbers, wider ones as bigints. */
const int = (r: ReadResult | undefined): number | null => (r !== undefined && r.ok && (typeof r.value === 'number' || typeof r.value === 'bigint') ? Number(r.value) : null)

export class LaunchpadService {
  constructor(private readonly deps: LaunchpadDeps) {}

  private async account(accountId: string): Promise<{ id: string; address: Hex; kind: string }> {
    const a = (await this.deps.vault.accounts()).find((x) => x.id === accountId)
    if (!a) throw new EngineError('not_found', 'no such account')
    return { id: a.id, address: a.address as Hex, kind: a.kind }
  }

  private async enrich(chainId: 52014 | 5201420, rows: readonly EsCampaign[], owner: Hex | null): Promise<CampaignView[]> {
    const d = this.deps
    if (rows.length === 0) return []
    const A = ELECTRONEUM_ADDRESSES[chainId]
    const pools = rows.map((r) => r.pool as Hex)
    const perPool = 6
    const calls: ReadCall[] = pools.flatMap((pool) => [
      { address: pool, abi: LAUNCHPAD_POOL_ABI, functionName: 'status', args: [] },
      { address: pool, abi: LAUNCHPAD_POOL_ABI, functionName: 'totalEtnRaised', args: [] },
      { address: pool, abi: LAUNCHPAD_POOL_ABI, functionName: 'maxContribution', args: [] },
      { address: pool, abi: LAUNCHPAD_POOL_ABI, functionName: 'minEtnToLaunch', args: [] },
      { address: pool, abi: LAUNCHPAD_POOL_ABI, functionName: 'contributionByAddress', args: [owner ?? '0x0000000000000000000000000000000000000000'] },
      { address: pool, abi: LAUNCHPAD_POOL_ABI, functionName: 'claimableTokens', args: [owner ?? '0x0000000000000000000000000000000000000000'] },
    ])
    calls.push({ address: A.launchpadManager as Hex, abi: LAUNCHPAD_MANAGER_ABI, functionName: 'minContribution', args: [] })
    if (owner) calls.push({ address: A.launchpadAffiliate as Hex, abi: AFFILIATE_ABI, functionName: 'getReferrerEarnings', args: [owner] })
    const res = await readMany(d.chains, chainId, calls)
    const minContribution = res[pools.length * perPool]
    const earnings = owner ? res[pools.length * perPool + 1] : undefined
    const earningsTuple = tuple(earnings)
    const referralClaimable = earningsTuple ? (earningsTuple as readonly [bigint, bigint, bigint])[2] : 0n
    const nowS = Math.floor(d.platform.now() / 1000)
    const starred = new Set(d.watchlist.cached().filter((w) => w.kind === 'campaign').map((w) => `${w.chainId}:${w.address.toLowerCase()}`))
    const creatorNames = await d.names.lookup(chainId, rows.map((r) => r.creator)).catch(() => [] as Array<{ address: string; name: string | null }>)
    return rows.map((r, i) => {
      const o = i * perPool
      const statusRead = res[o]
      const statusCode = int(statusRead)
      const statusOk = statusCode !== null
      const status = statusCode !== null ? poolStatus(statusCode) : r.status
      const raised = statusOk ? big(res[o + 1]) : parseUnits(String(r.raisedEtn), 18)
      const maxRead = res[o + 2]
      const maxC = maxRead !== undefined && maxRead.ok ? big(maxRead) : null
      const minRead = res[o + 3]
      const minLaunch = minRead !== undefined && minRead.ok ? big(minRead) : parseUnits(String(r.minEtnToLaunch), 18)
      const contribTuple = tuple(res[o + 4])
      const contrib: [bigint, boolean] = contribTuple ? [contribTuple[0] as bigint, contribTuple[1] === true] : [0n, false]
      const claimable = big(res[o + 5])
      const phase = campaignPhase(status, nowS, r.starts, r.ends)
      return {
        chainId,
        pool: r.pool,
        status,
        phase,
        token: { name: r.token.name, symbol: r.token.symbol, decimals: r.token.decimals, address: r.token.address },
        creator: r.creator,
        creatorName: creatorNames.find((n) => n.address.toLowerCase() === r.creator.toLowerCase())?.name ?? null,
        logoUrl: r.logoUrl,
        bannerUrl: r.bannerUrl,
        description: r.description,
        links: r.links,
        starts: r.starts,
        ends: r.ends,
        raisedWei: raised.toString(),
        minEtnToLaunchWei: minLaunch.toString(),
        maxContributionWei: maxC === null ? null : maxC.toString(),
        minContributionWei: minContribution !== undefined && minContribution.ok ? big(minContribution).toString() : null,
        fill: minLaunch > 0n ? Math.min(1, Number((raised * 10_000n) / minLaunch) / 10_000) : 0,
        contributorCount: r.contributorCount,
        affiliatePercent: r.affiliatePercent,
        shareLink: r.shareLink,
        contributedWei: contrib[0].toString(),
        claimed: contrib[1],
        claimableTokensRaw: claimable.toString(),
        referralClaimableWei: referralClaimable.toString(),
        keys: campaignKeys({ phase, contributedWei: contrib[0], claimed: contrib[1], claimableTokens: claimable, referralClaimable }),
        starred: starred.has(`${chainId}:${r.pool.toLowerCase()}`),
      }
    })
  }

  /** The Sky: live first, then upcoming, then ended (§8.9). */
  async list(chainId: number, accountId?: string, statuses?: PresaleWireStatus[]): Promise<CampaignView[]> {
    const d = this.deps
    if (!d.electroswap || !isEtn(chainId)) return []
    const client = d.electroswap
    const build = async (): Promise<CampaignView[]> => {
      const owner = accountId ? (await this.account(accountId)).address : null
      const rows = await fetchCampaigns(client, chainId, statuses).catch(() => [] as EsCampaign[])
      const views = await this.enrich(chainId, rows.slice(0, 40), owner)
      const rank = (p: CampaignView['phase']): number => (p === 'live' ? 0 : p === 'upcoming' ? 1 : p === 'awaiting_finalize' ? 2 : p === 'launched' ? 3 : 4)
      views.sort((a, b) => rank(a.phase) - rank(b.phase) || b.starts - a.starts)
      return views
    }
    // Only the unfiltered list is the cached one; a status filter is a one-off read.
    if (!d.cache || statuses) return build()
    // `refresh` always hits the network. This list is on the Home and Explore
    // hot paths and is also pulled by positions.snapshot, so with no TTL the
    // same Presales query went out several times per popup open.
    return (await d.cache.through(listSpec(chainId, accountId), LIST_TTL_MS, build)).value
  }

  async cachedList(chainId: number, accountId?: string): Promise<Cached<CampaignView[]> | null> {
    return (await this.deps.cache?.read(listSpec(chainId, accountId))) ?? null
  }

  async detail(chainId: number, pool: string, accountId?: string): Promise<CampaignView | null> {
    const d = this.deps
    if (!d.electroswap || !isEtn(chainId)) return null
    const owner = accountId ? (await this.account(accountId)).address : null
    const row = await fetchCampaign(d.electroswap, chainId, pool, owner ?? undefined).catch(() => null)
    if (!row) return null
    return (await this.enrich(chainId, [row], owner))[0] ?? null
  }

  /** Sealed under the DEK; the id used to be the storage key. */
  private referralKey(chainId: number, pool: string): string {
    return `${chainId}.${pool.toLowerCase()}`
  }

  /** A referral from a deep link is kept a day per pool (§8.9). */
  async rememberReferral(input: { chainId: number; pool: string; referrer: string }): Promise<void> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(input.referrer)) return
    await this.deps.referrals.set(this.referralKey(input.chainId, input.pool), { referrer: input.referrer, at: this.deps.platform.now() })
  }

  async rememberFromLink(url: string): Promise<{ pool: string; referrer: string | null } | null> {
    const parsed = referrerFromLink(url)
    if (!parsed) return null
    if (parsed.referrer) await this.rememberReferral({ chainId: 52014, pool: parsed.pool, referrer: parsed.referrer })
    return parsed
  }

  async referralFor(chainId: number, pool: string): Promise<Hex | null> {
    const v = await this.deps.referrals.get(this.referralKey(chainId, pool))
    if (!v) return null
    if (this.deps.platform.now() - v.at > REFERRAL_TTL_MS) return null
    return v.referrer as Hex
  }

  /** Contribute native ETN within the pool's min/max while it is live; the referrer rides along. */
  async contribute(input: { accountId: string; chainId: number; pool: string; amountEtn: string }): Promise<{ flowId: string; requestId: string | null }> {
    const chainId = input.chainId
    if (!isEtn(chainId)) throw new EngineError('invalid_argument', 'The launchpad lives on Electroneum.')
    const account = await this.account(input.accountId)
    if (account.kind === 'watch') throw new EngineError('invalid_argument', 'Watch-only — import a key or pair a device to contribute.')
    const c = await this.detail(chainId, input.pool, input.accountId)
    if (!c) throw new EngineError('not_found', 'No such campaign.')
    if (c.phase !== 'live') throw new EngineError('invalid_argument', c.phase === 'upcoming' ? 'This campaign has not started yet.' : 'This campaign is no longer taking contributions.')
    let amount = 0n
    try {
      amount = parseUnits(input.amountEtn.trim() || '0', 18)
    } catch {
      throw new EngineError('invalid_argument', 'That amount is not a number.')
    }
    if (amount <= 0n) throw new EngineError('invalid_argument', 'Enter an amount above zero.')
    if (c.minContributionWei && amount < BigInt(c.minContributionWei)) throw new EngineError('invalid_argument', 'Below the minimum contribution.')
    if (c.maxContributionWei && BigInt(c.maxContributionWei) > 0n && amount + BigInt(c.contributedWei) > BigInt(c.maxContributionWei)) throw new EngineError('invalid_argument', 'Above this campaign’s maximum per wallet.')
    const native = BigInt(String((await this.deps.chains.rpc(chainId, 'eth_getBalance', [account.address, 'latest']).catch(() => '0x0')) ?? '0x0'))
    if (amount + 300_000n * 1_000_000_000n > native) throw new EngineError('invalid_argument', 'Not enough ETN for the contribution plus the network fee.')
    const referrer = await this.referralFor(chainId, input.pool)
    const flow = await this.deps.flows.start({
      kind: 'launchpad',
      accountId: input.accountId,
      chainId,
      quote: null,
      steps: [{ step: 'contribute', waitReceipt: true, run: () => this.deps.provider.runInternal({ kind: 'send_transaction', origin: 'internal:launchpad:contribute', chainId, accountId: input.accountId, tx: { from: account.address, to: input.pool as Hex, value: hex(amount), data: encodeContribute(referrer) }, clientRequestId: `launchpad:contribute:${input.pool}:${this.deps.platform.now()}` }) }],
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  /** Claim tokens, a refund, or referral rewards — whichever the state table allows (§8.9). */
  async claim(input: { accountId: string; chainId: number; pool: string; kind: 'tokens' | 'refund' | 'referral' }): Promise<{ flowId: string; requestId: string | null }> {
    const chainId = input.chainId
    if (!isEtn(chainId)) throw new EngineError('invalid_argument', 'The launchpad lives on Electroneum.')
    const account = await this.account(input.accountId)
    const c = await this.detail(chainId, input.pool, input.accountId)
    if (!c) throw new EngineError('not_found', 'No such campaign.')
    const key = input.kind === 'tokens' ? 'claim_tokens' : input.kind === 'refund' ? 'claim_refund' : 'claim_referral'
    if (!c.keys.includes(key)) throw new EngineError('invalid_argument', input.kind === 'tokens' ? 'Nothing to claim from this campaign.' : input.kind === 'refund' ? 'No refund to claim here.' : 'No referral rewards to claim.')
    const A = ELECTRONEUM_ADDRESSES[chainId]
    const to = input.kind === 'referral' ? (A.launchpadAffiliate as Hex) : (input.pool as Hex)
    const data = input.kind === 'tokens' ? encodeClaimTokens(account.address) : input.kind === 'refund' ? encodeClaimRefund(account.address) : encodeClaimReferralRewards()
    const flow = await this.deps.flows.start({
      kind: 'launchpad',
      accountId: input.accountId,
      chainId,
      quote: null,
      steps: [{ step: 'claim', waitReceipt: true, run: () => this.deps.provider.runInternal({ kind: 'send_transaction', origin: `internal:launchpad:${input.kind}`, chainId, accountId: input.accountId, tx: { from: account.address, to, value: '0x0', data }, clientRequestId: `launchpad:${input.kind}:${input.pool}:${this.deps.platform.now()}` }) }],
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }
}

const Chain = z.object({ chainId: z.number().int().positive() })

export function launchpadNamespace(launchpad: LaunchpadService): NamespaceSpec {
  return {
    list: { input: Chain.extend({ accountId: AccountIdSchema.optional(), statuses: z.array(z.enum(['ACTIVE', 'LAUNCHED', 'FAILED', 'CANCELLED', 'PENDING'])).optional() }), handler: (arg) => launchpad.list((arg as { chainId: number }).chainId, (arg as { accountId?: string }).accountId, (arg as { statuses?: PresaleWireStatus[] }).statuses) },
    cachedList: { input: z.object({ chainId: z.number().int().positive(), accountId: AccountIdSchema.optional() }), handler: (arg) => launchpad.cachedList((arg as { chainId: number }).chainId, (arg as { accountId?: string }).accountId) },
    detail: { input: Chain.extend({ pool: z.string(), accountId: AccountIdSchema.optional() }), handler: (arg) => launchpad.detail((arg as { chainId: number }).chainId, (arg as { pool: string }).pool, (arg as { accountId?: string }).accountId) },
    contribute: { input: Chain.extend({ accountId: AccountIdSchema, pool: z.string(), amountEtn: z.string().max(60) }), handler: (arg) => launchpad.contribute(arg as { accountId: string; chainId: number; pool: string; amountEtn: string }) },
    claim: { input: Chain.extend({ accountId: AccountIdSchema, pool: z.string(), kind: z.enum(['tokens', 'refund', 'referral']) }), handler: (arg) => launchpad.claim(arg as { accountId: string; chainId: number; pool: string; kind: 'tokens' | 'refund' | 'referral' }) },
    rememberReferral: { input: Chain.extend({ pool: z.string(), referrer: z.string() }), handler: (arg) => launchpad.rememberReferral(arg as { chainId: number; pool: string; referrer: string }) },
    rememberFromLink: { input: z.object({ url: z.string().max(2_000) }), handler: (arg) => launchpad.rememberFromLink((arg as { url: string }).url) },
  }
}
