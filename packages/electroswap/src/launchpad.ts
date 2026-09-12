/**
 * ElectroSwap launchpad (master plan §8.9): the pool's reads, the manager's
 * limits, the affiliate rewards, the binding state table, and the encoders
 * for Contribute · Claim tokens · Claim refund · Claim referral rewards.
 * Creator flows stay on the web app.
 */
import { encodeFunctionData, parseAbi, type Hex } from 'viem'

export const LAUNCHPAD_POOL_ABI = parseAbi([
  'function status() view returns (uint8)',
  'function token() view returns (address)',
  'function totalEtnRaised() view returns (uint256)',
  'function minEtnToLaunch() view returns (uint256)',
  'function minEtnToList() view returns (uint256)',
  'function maxContribution() view returns (uint256)',
  'function startTime() view returns (uint256)',
  'function endTime() view returns (uint256)',
  'function contributorCount() view returns (uint256)',
  'function contributionByAddress(address contributor) view returns (uint256 etnAmount, bool claimed)',
  'function claimableTokens(address contributor) view returns (uint256)',
  'function getReferralReward(address referrer) view returns (uint256 reward)',
  'function contribute(address referrer) payable',
  'function claimTokens(address recipient)',
  'function claimRefund(address recipient)',
])

export const LAUNCHPAD_MANAGER_ABI = parseAbi([
  'function minContribution() view returns (uint256)',
  'function teamWallet() view returns (address)',
])

export const AFFILIATE_ABI = parseAbi([
  'function getReferrerEarnings(address referrer) view returns (uint256 lifetimeEarnings, uint256 claimedAmount, uint256 claimableAmount)',
  'function claimReferralRewards()',
])

/** EsLaunchpadAbstractPool.Status — the numbers are binding (§8.9 state table). */
export type PoolStatus = 'ACTIVE' | 'LAUNCHED' | 'FAILED' | 'CANCELLED' | 'PENDING'
const STATUS: readonly PoolStatus[] = ['ACTIVE', 'LAUNCHED', 'FAILED', 'CANCELLED', 'PENDING']

export function poolStatus(code: number): PoolStatus {
  return STATUS[code] ?? 'PENDING'
}

export type CampaignPhase =
  'upcoming' | 'live' | 'awaiting_finalize' | 'launched' | 'failed' | 'cancelled'

/** The phase a campaign is in from its on-chain status and the clock (the "ended, not finalized" row is derived). */
export function campaignPhase(
  status: PoolStatus,
  nowSeconds: number,
  startTime: number,
  endTime: number,
): CampaignPhase {
  switch (status) {
    case 'PENDING':
      return 'upcoming'
    case 'ACTIVE':
      if (nowSeconds < startTime) return 'upcoming'
      return nowSeconds >= endTime ? 'awaiting_finalize' : 'live'
    case 'LAUNCHED':
      return 'launched'
    case 'FAILED':
      return 'failed'
    case 'CANCELLED':
      return 'cancelled'
  }
}

export type CampaignKey = 'contribute' | 'claim_tokens' | 'claim_refund' | 'claim_referral'

/** Which keys the campaign page shows for this account (§8.9 table). */
export function campaignKeys(input: {
  phase: CampaignPhase
  contributedWei: bigint
  claimed: boolean
  claimableTokens: bigint
  referralClaimable: bigint
}): CampaignKey[] {
  const keys: CampaignKey[] = []
  if (input.phase === 'live') keys.push('contribute')
  if (input.phase === 'launched' && input.claimableTokens > 0n && !input.claimed)
    keys.push('claim_tokens')
  if (
    (input.phase === 'failed' || input.phase === 'cancelled') &&
    input.contributedWei > 0n &&
    !input.claimed
  )
    keys.push('claim_refund')
  if (input.referralClaimable > 0n) keys.push('claim_referral')
  return keys
}

export const ZERO_REFERRER = '0x0000000000000000000000000000000000000000' as const

export function encodeContribute(referrer: Hex | null): Hex {
  return encodeFunctionData({
    abi: LAUNCHPAD_POOL_ABI,
    functionName: 'contribute',
    args: [referrer ?? ZERO_REFERRER],
  })
}

export function encodeClaimTokens(recipient: Hex): Hex {
  return encodeFunctionData({
    abi: LAUNCHPAD_POOL_ABI,
    functionName: 'claimTokens',
    args: [recipient],
  })
}

export function encodeClaimRefund(recipient: Hex): Hex {
  return encodeFunctionData({
    abi: LAUNCHPAD_POOL_ABI,
    functionName: 'claimRefund',
    args: [recipient],
  })
}

export function encodeClaimReferralRewards(): Hex {
  return encodeFunctionData({ abi: AFFILIATE_ABI, functionName: 'claimReferralRewards' })
}

/** A referral from a link: `boltvault://launchpad/<pool>?ref=0x…` or `…/launchpad/<pool>?refId=0x…` (§8.9). */
export function referrerFromLink(url: string): { pool: Hex; referrer: Hex | null } | null {
  try {
    const u = new URL(url)
    // `boltvault://launchpad/<pool>` parses `launchpad` as the host, so match the whole string.
    const m = url.match(/launchpad\/(0x[0-9a-fA-F]{40})/)
    if (!m?.[1]) return null
    const ref = u.searchParams.get('ref') ?? u.searchParams.get('refId')
    return {
      pool: m[1] as Hex,
      referrer: ref && /^0x[0-9a-fA-F]{40}$/.test(ref) ? (ref as Hex) : null,
    }
  } catch {
    return null
  }
}
