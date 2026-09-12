/**
 * Home › Positions (master plan §8.2): farm stakes with their multipliers
 * and pending rewards, the Legends vault, open limit orders and campaigns
 * with something to claim — and everything standing that Home's rotor shows
 * for them. The last snapshot is persisted per account so Home paints it at
 * once.
 */
import type { Platform } from '@boltvault/platform'
import { formatUnits } from 'viem'
import { z } from 'zod'
import type { SealedMap } from '../sealed'
import type { EventBus, NamespaceSpec } from '../host'
import { AccountIdSchema, type Positions } from '../schema'
import type { FarmService } from './farm'
import type { LaunchpadService } from './launchpad'
import type { LegendsService } from './legends'
import type { LimitService } from './limit'
import type { TokensService } from './tokens'

export interface PositionsDeps {
  readonly platform: Platform
  readonly bus: EventBus
  readonly farm: FarmService
  readonly legends: LegendsService
  readonly limit: LimitService
  readonly launchpad: LaunchpadService
  readonly tokens: TokensService
  /** Positions per `<chainId>.<accountId>`, sealed under the DEK. */
  readonly positions: SealedMap<Positions>
}

function trim(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

export class PositionsService {
  private inflight = new Map<string, Promise<Positions>>()

  constructor(private readonly deps: PositionsDeps) {}

  /** Sealed under the DEK; the id used to be the storage key, which named the account. */
  private key(accountId: string, chainId: number): string {
    return `${chainId}.${accountId}`
  }

  /** The persisted last snapshot, for the first paint. */
  async cached(accountId: string, chainId: number): Promise<Positions | null> {
    return this.deps.positions.get(this.key(accountId, chainId))
  }

  async snapshot(accountId: string, chainId: number): Promise<Positions> {
    const k = this.key(accountId, chainId)
    const running = this.inflight.get(k)
    if (running) return running
    const p = this.build(accountId, chainId).finally(() => this.inflight.delete(k))
    this.inflight.set(k, p)
    return p
  }

  private async build(accountId: string, chainId: number): Promise<Positions> {
    const d = this.deps
    const [farmsAll, legends, orders, campaignsAll] = await Promise.all([
      d.farm.list(chainId, accountId).catch(() => []),
      d.legends.status(accountId, chainId).catch(() => null),
      d.limit.list({ accountId, chainId }).catch(() => []),
      d.launchpad.list(chainId, accountId).catch(() => []),
    ])
    const farms = farmsAll.filter((f) => f.position !== null)
    // A campaign is a position while there is something left to do: claim tokens or a refund, referral rewards, or a contribution to a campaign still in flight (plan C1, owner item L1).
    const campaigns = campaignsAll.filter(
      (c) =>
        c.keys.includes('claim_tokens') ||
        c.keys.includes('claim_refund') ||
        BigInt(c.referralClaimableWei) > 0n ||
        ((c.phase === 'live' || c.phase === 'upcoming' || c.phase === 'awaiting_finalize') &&
          BigInt(c.contributedWei) > 0n),
    )
    /*
      Every standing thing, in the order Home should meet them.

      This was a cascade that assigned one winner: dividends beat farm rewards,
      which beat a claimable campaign, and the losers were simply not mentioned.
      A holder with ETN dividends and DYNO to collect saw the dividends line
      until they claimed it, then discovered the rewards. Home has a rotor now,
      so there is no reason to choose.
    */
    const accessories: Positions['accessories'] = []
    const claimable = legends ? BigInt(legends.claimableWei) : 0n
    if (claimable > 0n)
      accessories.push({
        kind: 'dividends',
        text: `${trim(Number(formatUnits(claimable, 18)).toFixed(2))} ETN in dividends to claim`,
        target: 'legends',
      })
    const rewards = farms.reduce((s, f) => s + BigInt(f.position?.pendingRewards ?? '0'), 0n)
    if (rewards > 0n) {
      const first = farms.find((f) => BigInt(f.position?.pendingRewards ?? '0') > 0n)
      accessories.push({
        kind: 'collect',
        text: `${trim(Number(formatUnits(rewards, 18)).toFixed(2))} DYNO to collect`,
        target: `farm:${first?.id ?? 0}`,
      })
    }
    const claimTokens = campaigns.find((c) => c.keys.includes('claim_tokens'))
    if (claimTokens)
      accessories.push({
        kind: 'claim_tokens',
        text: `${claimTokens.token.symbol} is ready to claim`,
        target: `campaign:${claimTokens.pool}`,
      })
    const refund = campaigns.find((c) => c.keys.includes('claim_refund'))
    if (refund)
      accessories.push({
        kind: 'claim_refund',
        text: `A refund from ${refund.token.symbol} is waiting`,
        target: `campaign:${refund.pool}`,
      })
    const positions: Positions = {
      accountId,
      chainId,
      farms,
      legends,
      orders,
      campaigns,
      accessories,
      observedAt: d.platform.now(),
    }
    await d.positions.set(this.key(accountId, chainId), positions).catch(() => undefined)
    d.bus.emit({ type: 'positions.changed', positions })
    return positions
  }
}

const AccountChain = z.object({ accountId: AccountIdSchema, chainId: z.number().int().positive() })

export function positionsNamespace(positions: PositionsService): NamespaceSpec {
  return {
    cached: {
      input: AccountChain,
      handler: (arg) =>
        positions.cached(
          (arg as { accountId: string }).accountId,
          (arg as { chainId: number }).chainId,
        ),
    },
    snapshot: {
      input: AccountChain,
      handler: (arg) =>
        positions.snapshot(
          (arg as { accountId: string }).accountId,
          (arg as { chainId: number }).chainId,
        ),
    },
  }
}
