/**
 * The BOLT/DYNO holder program (master plan §8.18): the account's fee tier
 * as the on-chain `BoltVaultFeeSchedule` sees it, and the whole schedule for
 * the fee sheet. The sink and schedule addresses are build constants per
 * chain; a chain whose constants are unset (every chain until the testnet
 * deploy) may be configured at runtime for tests and dev builds only — a
 * pinned constant can never be overridden (T10). When the schedule cannot
 * be read the fee falls back to the base bips, never lower.
 */
import { BOLTVAULT_FEE_SCHEDULE, BOLTVAULT_FEE_SINK, ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { BASE_FEE_BIPS, ERC20_ABI, FALLBACK_SCHEDULE, FEE_SCHEDULE_ABI, nextTier, tierFor, type FeeSchedule } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { getAddress, isAddress, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { readMany } from '../multicall'
import { AccountIdSchema, type FeeScheduleView, type HolderTier } from '../schema'
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
}

/** A tier read is good for one block (§8.18: "cached per block"). */
const TIER_CACHE_MS = 5_000

function isEtn(chainId: number): chainId is 52014 | 5201420 {
  return chainId === 52014 || chainId === 5201420
}

export class HolderService {
  private readonly overrides = new Map<number, FeeAddresses>()
  private readonly tierCache = new Map<string, { at: number; value: HolderTier }>()

  constructor(private readonly deps: HolderDeps) {}

  /** The pinned constants for a chain, or the dev override when the build has none. */
  addresses(chainId: number): FeeAddresses {
    const pinned: FeeAddresses = isEtn(chainId) ? { sink: (BOLTVAULT_FEE_SINK[chainId] as Hex | null) ?? null, schedule: (BOLTVAULT_FEE_SCHEDULE[chainId] as Hex | null) ?? null } : { sink: null, schedule: null }
    const o = this.overrides.get(chainId)
    if (!o) return pinned
    return { sink: pinned.sink ?? o.sink, schedule: pinned.schedule ?? o.schedule }
  }

  /**
   * Dev/test only: point an unconfigured chain at a sink and schedule. Refused
   * for any chain whose constants are pinned in the build — the whole point
   * of T10 is that no runtime message can move the fee.
   */
  configure(input: { chainId: number; sink: string | null; schedule: string | null }): FeeAddresses {
    const pinned = isEtn(input.chainId) ? { sink: BOLTVAULT_FEE_SINK[input.chainId], schedule: BOLTVAULT_FEE_SCHEDULE[input.chainId] } : { sink: null, schedule: null }
    if (pinned.sink || pinned.schedule) throw new EngineError('unauthorized', 'the fee sink for this chain is pinned in the build')
    const sink = input.sink && isAddress(input.sink) ? getAddress(input.sink) : null
    const schedule = input.schedule && isAddress(input.schedule) ? getAddress(input.schedule) : null
    this.overrides.set(input.chainId, { sink, schedule })
    this.tierCache.clear()
    return this.addresses(input.chainId)
  }

  private async scheduleFrom(chainId: number): Promise<{ schedule: FeeSchedule; source: 'chain' | 'fallback' }> {
    const address = this.addresses(chainId).schedule
    if (!address) return { schedule: FALLBACK_SCHEDULE, source: 'fallback' }
    const [r] = await readMany(this.deps.chains, chainId, [{ address, abi: FEE_SCHEDULE_ABI, functionName: 'schedule', args: [] }])
    if (!r?.ok || !Array.isArray(r.value)) return { schedule: FALLBACK_SCHEDULE, source: 'fallback' }
    const [baseBips, tiers, dynoWeight, countFarmBolt, boltPayDiscountBips] = r.value as [number, ReadonlyArray<{ minScore: bigint; bips: number }>, bigint, boolean, number]
    return {
      schedule: { baseBips: Number(baseBips), tiers: tiers.map((t) => ({ minScore: t.minScore, bips: Number(t.bips) })), dynoWeight, countFarmBolt, boltPayDiscountBips: Number(boltPayDiscountBips) },
      source: 'chain',
    }
  }

  async schedule(chainId: number): Promise<FeeScheduleView> {
    const a = this.addresses(chainId)
    const { schedule, source } = await this.scheduleFrom(chainId)
    return {
      chainId,
      baseBips: schedule.baseBips,
      tiers: schedule.tiers.map((t) => ({ minScore: t.minScore.toString(), bips: t.bips })),
      dynoWeight: schedule.dynoWeight.toString(),
      countFarmBolt: schedule.countFarmBolt,
      boltPayDiscountBips: schedule.boltPayDiscountBips,
      source,
      sink: a.sink,
      address: a.schedule,
    }
  }

  /** The fee this account pays right now. `fresh` bypasses the per-block cache (sign time). */
  async tier(accountId: string, chainId: number, fresh = false): Promise<HolderTier> {
    const key = `${chainId}:${accountId}`
    const now = this.deps.platform.now()
    const cached = this.tierCache.get(key)
    if (!fresh && cached && now - cached.at < TIER_CACHE_MS) return cached.value
    const account = (await this.deps.vault.accounts()).find((x) => x.id === accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const value = await this.read(account.address as Hex, chainId)
    this.tierCache.set(key, { at: now, value })
    return value
  }

  private async read(owner: Hex, chainId: number): Promise<HolderTier> {
    const a = this.addresses(chainId)
    const bolt = isEtn(chainId) ? (ELECTRONEUM_ADDRESSES[chainId].bolt as Hex | null) : null
    const dyno = isEtn(chainId) ? (ELECTRONEUM_ADDRESSES[chainId].dyno as Hex) : null
    const calls = [
      ...(a.schedule ? [{ address: a.schedule, abi: FEE_SCHEDULE_ABI, functionName: 'feeBipsFor', args: [owner] }] : []),
      ...(bolt ? [{ address: bolt, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] }] : []),
      ...(dyno ? [{ address: dyno, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] }] : []),
    ]
    const results = calls.length ? await readMany(this.deps.chains, chainId, calls).catch(() => [] as Array<{ ok: false }>) : []
    let i = 0
    const fee = a.schedule ? results[i++] : undefined
    const boltBal = bolt ? results[i++] : undefined
    const dynoBal = dyno ? results[i++] : undefined
    const wallet = boltBal?.ok && typeof boltBal.value === 'bigint' ? boltBal.value : 0n
    const dynoAmt = dynoBal?.ok && typeof dynoBal.value === 'bigint' ? dynoBal.value : 0n
    const { schedule, source: scheduleSource } = await this.scheduleFrom(chainId)
    const base = { chainId, sink: a.sink, schedule: a.schedule }
    if (fee?.ok && Array.isArray(fee.value)) {
      const [bips, tier, score] = fee.value as [number, number, bigint]
      const next = nextTier(schedule, Number(tier))
      const dynoPart = schedule.dynoWeight > 0n ? dynoAmt / schedule.dynoWeight : 0n
      const farm = score > wallet + dynoPart ? score - wallet - dynoPart : 0n
      return { ...base, bips: Number(bips), tier: Number(tier), score: score.toString(), nextTierAt: next ? next.minScore.toString() : null, nextTierBips: next ? next.bips : null, source: 'chain', breakdown: { wallet: wallet.toString(), farm: farm.toString(), dyno: dynoPart.toString() } }
    }
    // No schedule answer: the base fee (never lower), with the wallet's own BOLT shown for context.
    const local = tierFor(scheduleSource === 'chain' ? schedule : FALLBACK_SCHEDULE, wallet)
    const next = nextTier(FALLBACK_SCHEDULE, local.tier)
    return { ...base, bips: BASE_FEE_BIPS, tier: 0, score: wallet.toString(), nextTierAt: next ? next.minScore.toString() : null, nextTierBips: next ? next.bips : null, source: 'fallback', breakdown: { wallet: wallet.toString(), farm: '0', dyno: '0' } }
  }
}

const ChainArg = z.object({ chainId: z.number().int().positive() })

export function holderNamespace(holder: HolderService): NamespaceSpec {
  return {
    tier: { input: z.object({ accountId: AccountIdSchema, chainId: z.number().int().positive() }), handler: (arg) => holder.tier((arg as { accountId: string }).accountId, (arg as { chainId: number }).chainId) },
    schedule: { input: ChainArg, handler: (arg) => holder.schedule((arg as { chainId: number }).chainId) },
    addresses: { input: ChainArg, handler: async (arg) => holder.addresses((arg as { chainId: number }).chainId) },
    configure: { input: z.object({ chainId: z.number().int().positive(), sink: z.string().nullable(), schedule: z.string().nullable() }), handler: async (arg) => holder.configure(arg as { chainId: number; sink: string | null; schedule: string | null }) },
  }
}
