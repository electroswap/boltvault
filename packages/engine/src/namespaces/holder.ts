/**
 * The BOLT/DYNO holder program (master plan §8.18): the account's fee tier,
 * and the whole ladder for the fee sheet.
 *
 * There is no `BoltVaultFeeSchedule` any more. The rungs come from the service
 * (`GET /api/wallet/fees`, `FeeLadders`) so ops can re-tune them without a
 * release, with `fees.json` in the build behind them — as the offline fallback
 * and as the ceiling, since a served ladder that would charge MORE than the
 * bundled one at any score is refused outright (`applyServedLadder`). So there
 * is still no degraded path and no "the server said otherwise": the worst a
 * bad answer does is cost us revenue. The only thing read from the chain is
 * what this account holds, two `balanceOf` calls that Multicall3 makes one.
 * The fee recipient is a build constant and is never taken from the service,
 * and a chain the config names can never be reconfigured at runtime (T10);
 * `configure` exists only for a chain it leaves open, which today means
 * testnet.
 *
 * One term of the score is a market ratio rather than a decision — what a DYNO
 * is worth in BOLT — and that one is measured (`DynoWeight`) with the
 * configured number as its anchor and fallback. It is still never fetched here:
 * `scheduleFrom` reads a value already in hand, so a tier read at sign time
 * touches the network exactly as much as it did before.
 */
import { ELECTRONEUM_ADDRESSES, feeRecipient, tierName, walletFeeConfig } from '@boltvault/chains'
import {
  DYNO_WEIGHT_ONE,
  ERC20_ABI,
  FALLBACK_SCHEDULE,
  nextTier,
  tierFor,
  type FeeSchedule,
} from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { getAddress, isAddress, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import { cacheKey, type Cached, type DocCache } from '../cache'
import type { NamespaceSpec } from '../host'
import type { DynoWeight } from '../dynoweight'
import type { FeeLadders } from '../feeLadder'
import { readMany } from '../multicall'
import { HolderTierSchema, AccountIdSchema, type FeeScheduleView, type HolderTier } from '../schema'
import type { ChainsService } from './chains'
import type { VaultManager } from './vault'

export interface FeeAddresses {
  readonly sink: Hex | null
  readonly schedule: Hex | null
}

export interface HolderDeps {
  readonly platform: Platform
  readonly chains: ChainsService
  readonly vault: VaultManager
  readonly cache?: DocCache
  /** The measured BOLT-per-DYNO ratio. Absent (tests, no indexer) means the configured constant. */
  readonly weights?: DynoWeight
  /** The published ladder. Absent (tests, no key) means the bundled one, which is a correct schedule. */
  readonly ladders?: FeeLadders
}

/** A tier read is good for one block (§8.18: "cached per block"). */
const TIER_CACHE_MS = 5_000
const tierSpec = (chainId: number, accountId: string) => ({
  key: cacheKey('holder', 'tier', chainId, accountId),
  schema: HolderTierSchema,
})

function isEtn(chainId: number): chainId is 52014 | 5201420 {
  return chainId === 52014 || chainId === 5201420
}

export class HolderService {
  private readonly overrides = new Map<number, FeeAddresses>()
  private readonly tierCache = new Map<string, { at: number; value: HolderTier }>()
  private readonly inflight = new Map<string, Promise<HolderTier>>()

  constructor(private readonly deps: HolderDeps) {}

  /**
   * The fee addresses for a chain: the configured recipient, or a dev override
   * on a chain the config leaves open.
   *
   * `schedule` is always null now — there is no schedule contract to name. It
   * stays in the shape because About and the fee sheet still ask, and "none"
   * is the honest answer rather than a missing field.
   */
  addresses(chainId: number): FeeAddresses {
    const configured: FeeAddresses = {
      sink: (feeRecipient(chainId) as Hex | null) ?? null,
      schedule: null,
    }
    const o = this.overrides.get(chainId)
    if (!o || configured.sink) return configured
    return { sink: o.sink, schedule: null }
  }

  /**
   * Dev/test only: give a chain a fee recipient the config leaves unset.
   * Refused wherever the config names one — no runtime message may move the
   * fee, which is the whole point of keeping it in the build (T10).
   */
  configure(input: {
    chainId: number
    sink: string | null
    schedule: string | null
  }): FeeAddresses {
    if (feeRecipient(input.chainId))
      throw new EngineError('unauthorized', 'the fee recipient for this chain is set in the build')
    const sink = input.sink && isAddress(input.sink) ? getAddress(input.sink) : null
    this.overrides.set(input.chainId, { sink, schedule: null })
    this.tierCache.clear()
    return this.addresses(input.chainId)
  }

  /**
   * The ladder for a chain: the served one where we have it, `fees.json` where
   * we do not.
   *
   * The ladder is whichever the service last published and this build was
   * willing to accept, else the one in `fees.json`; `ensure` only touches the
   * network when its copy has gone stale, so sign time does not wait on it.
   * `dynoWeight` — the one term that is a market ratio rather than a decision
   * — comes from memory or the document cache, with the configured constant
   * behind it. `DynoWeight` does its measuring elsewhere, so this answers the
   * same at sign time as it did on the last screen.
   */
  private async scheduleFrom(chainId: number): Promise<{
    schedule: FeeSchedule
    source: 'config' | 'fallback'
    dynoWeightSource: 'config' | 'average'
  }> {
    // Resolves at once once the ladder has been read, and never rejects, so a
    // quote is not held up by the network on any call after the first.
    await this.deps.ladders?.ensure(chainId)
    const c = walletFeeConfig(chainId)
    if (!c) return { schedule: FALLBACK_SCHEDULE, source: 'fallback', dynoWeightSource: 'config' }
    const w = (await this.deps.weights?.weight(chainId)) ?? {
      value: BigInt(c.dynoWeight),
      measured: false,
    }
    return {
      schedule: {
        baseBips: c.baseBips,
        tiers: c.tiers.map((t) => ({ minScore: BigInt(t.minScore), bips: t.bips })),
        dynoWeight: w.value,
        countFarmBolt: c.countFarmBolt,
      },
      source: 'config',
      dynoWeightSource: w.measured ? 'average' : 'config',
    }
  }

  async schedule(chainId: number): Promise<FeeScheduleView> {
    const a = this.addresses(chainId)
    const { schedule, source, dynoWeightSource } = await this.scheduleFrom(chainId)
    return {
      chainId,
      baseName: tierName(chainId, 0) ?? '',
      baseBips: schedule.baseBips,
      tiers: schedule.tiers.map((t, i) => ({
        name: tierName(chainId, i + 1) ?? '',
        minScore: t.minScore.toString(),
        bips: t.bips,
      })),
      dynoWeight: schedule.dynoWeight.toString(),
      dynoWeightSource,
      countFarmBolt: schedule.countFarmBolt,
      source,
      sink: a.sink,
      address: a.schedule,
    }
  }

  /** The fee this account pays right now. `fresh` bypasses the per-block cache (sign time). */
  async tier(accountId: string, chainId: number, fresh = false): Promise<HolderTier> {
    // The endpoint is part of the key: a tier read through the RPC the user has
    // just replaced is not the tier, it is the old endpoint's answer.
    const key = `${chainId}:${accountId}:${this.deps.chains.rpcEpoch(chainId)}`
    const now = this.deps.platform.now()
    const cached = this.tierCache.get(key)
    if (!fresh && cached && now - cached.at < TIER_CACHE_MS) return cached.value
    // The time cache is only written *after* the read resolves, so two mounts
    // in the same tick both missed and both did the full multicall. TabShell
    // and Home each call useHolderTier, so that was every popup open. Every
    // other service (chains, portfolio, positions, DocCache) already dedupes
    // in flight; this one did not.
    const running = this.inflight.get(key)
    if (running && !fresh) return running
    const run = this.readTier(accountId, chainId, key, now)
    if (!fresh) this.inflight.set(key, run)
    try {
      return await run
    } finally {
      if (!fresh) this.inflight.delete(key)
    }
  }

  private async readTier(
    accountId: string,
    chainId: number,
    key: string,
    now: number,
  ): Promise<HolderTier> {
    const account = (await this.deps.vault.accounts()).find((x) => x.id === accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    let value: HolderTier
    try {
      value = await this.read(account.address as Hex, chainId)
    } catch (err) {
      const last = await this.deps.cache?.read(tierSpec(chainId, accountId))
      if (!last) throw err
      return last.value
    }
    this.tierCache.set(key, { at: now, value })
    void this.deps.cache?.write(tierSpec(chainId, accountId), value).catch(() => undefined)
    return value
  }

  /** The last tier written, at once; null before the first read. */
  async cachedTier(accountId: string, chainId: number): Promise<Cached<HolderTier> | null> {
    return (await this.deps.cache?.read(tierSpec(chainId, accountId))) ?? null
  }

  private async read(owner: Hex, chainId: number): Promise<HolderTier> {
    const a = this.addresses(chainId)
    const bolt = isEtn(chainId) ? (ELECTRONEUM_ADDRESSES[chainId].bolt as Hex | null) : null
    const dyno = isEtn(chainId) ? (ELECTRONEUM_ADDRESSES[chainId].dyno as Hex) : null
    /*
      Two balances, and that is the whole read.

      It used to be three: `feeBipsFor` on the schedule contract came first and
      was the authority, with these two as a fallback. The ladder is in the
      binary now, so the only thing the chain still knows that we do not is what
      this account holds.
    */
    const calls = [
      ...(bolt
        ? [{ address: bolt, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] }]
        : []),
      ...(dyno
        ? [{ address: dyno, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] }]
        : []),
    ]
    const results = calls.length
      ? await readMany(this.deps.chains, chainId, calls).catch(() => [] as Array<{ ok: false }>)
      : []
    let i = 0
    const boltBal = bolt ? results[i++] : undefined
    const dynoBal = dyno ? results[i++] : undefined
    const wallet = boltBal?.ok && typeof boltBal.value === 'bigint' ? boltBal.value : 0n
    const dynoAmt = dynoBal?.ok && typeof dynoBal.value === 'bigint' ? dynoBal.value : 0n
    const { schedule: sched, source } = await this.scheduleFrom(chainId)
    const base = { chainId, sink: a.sink, schedule: a.schedule }
    // Farm deposits are not counted: see `countFarmBolt` in fees.json.
    const dynoPart = sched.dynoWeight > 0n ? (dynoAmt * sched.dynoWeight) / DYNO_WEIGHT_ONE : 0n
    const score = wallet + dynoPart
    const local = tierFor(sched, score)
    const next = nextTier(sched, local.tier)
    return {
      ...base,
      bips: local.bips,
      tier: local.tier,
      name: tierName(chainId, local.tier) ?? '',
      score: score.toString(),
      nextTierAt: next ? next.minScore.toString() : null,
      nextTierBips: next ? next.bips : null,
      nextTierName: tierName(chainId, local.tier + 1) ?? null,
      source,
      breakdown: { wallet: wallet.toString(), farm: '0', dyno: dynoPart.toString() },
    }
  }
}

const ChainArg = z.object({ chainId: z.number().int().positive() })

export function holderNamespace(holder: HolderService): NamespaceSpec {
  return {
    tier: {
      input: z.object({ accountId: AccountIdSchema, chainId: z.number().int().positive() }),
      handler: (arg) =>
        holder.tier((arg as { accountId: string }).accountId, (arg as { chainId: number }).chainId),
    },
    cachedTier: {
      input: z.object({ accountId: AccountIdSchema, chainId: z.number().int().positive() }),
      handler: (arg) =>
        holder.cachedTier(
          (arg as { accountId: string }).accountId,
          (arg as { chainId: number }).chainId,
        ),
    },
    schedule: {
      input: ChainArg,
      handler: (arg) => holder.schedule((arg as { chainId: number }).chainId),
    },
    addresses: {
      input: ChainArg,
      handler: async (arg) => holder.addresses((arg as { chainId: number }).chainId),
    },
    configure: {
      input: z.object({
        chainId: z.number().int().positive(),
        sink: z.string().nullable(),
        schedule: z.string().nullable(),
      }),
      handler: async (arg) =>
        holder.configure(arg as { chainId: number; sink: string | null; schedule: string | null }),
    },
  }
}
