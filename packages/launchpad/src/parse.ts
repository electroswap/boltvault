import type { Campaign, LaunchpadStatus } from './types'

function toBigInt(value: any, fallback = 0n): bigint {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  // wei-style decimal strings: keep the integer part (exact, no Number() precision loss)
  const s = String(value).trim().split(/[\s.]/)[0]
  try {
    return BigInt(s || '0')
  } catch {
    return fallback
  }
}

function toString(value: any, fallback = ''): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function toBool(value: any): boolean {
  return value === true || value === 1 || value === 'true' || value === '1'
}

function toNumber(value: any): number {
  if (value === undefined || value === null || value === '') return NaN
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Classify a raw GraphQL presale row into one of the 6 launchpad states.
 *
 * Pure + deterministic. Accepts field names defensively:
 * `row.status`/`row.state` strings, or booleans `started`/`ended`/`launched`/
 * `finalized`/`refunded`/`failed`/`cancelled`, plus `startBlock`/`nowBlock`.
 *
 * Decision order (first match wins):
 * 1. cancelled            -> 'cancelled'
 * 2. launched/token claim -> 'launched-claim'
 * 3. failed/refunded      -> 'failed-refund'
 * 4. ended && !finalized  -> 'ended-not-finalized'
 * 5. ended &&  finalized  -> 'launched-claim'
 * 6. startBlock > nowBlock-> 'not-started'
 * 7. otherwise            -> 'live'
 */
export function classifyStatus(row: any): LaunchpadStatus {
  const r = row ?? {}
  const statusString = toString(r.status ?? r.state).toLowerCase()

  const cancelled =
    toBool(r.cancelled) ||
    toBool(r.isCancelled) ||
    statusString.includes('cancel')

  const launched =
    toBool(r.launched) ||
    toBool(r.tokenClaimable) ||
    statusString.includes('launched') ||
    statusString.includes('claim')

  const failed =
    toBool(r.failed) ||
    toBool(r.refunded) ||
    statusString.includes('fail') ||
    statusString.includes('refund')

  const ended = toBool(r.ended) || statusString.includes('end')
  // "not-finalized" / "ended" without finalize => not finalized
  const finalized =
    toBool(r.finalized) ||
    (statusString.includes('finalized') && !statusString.includes('not-finalized') && !statusString.includes('not finalized'))

  if (cancelled) return 'cancelled'
  if (launched) return 'launched-claim'
  if (failed) return 'failed-refund'
  if (ended && !finalized) return 'ended-not-finalized'
  if (ended && finalized) return 'launched-claim'

  const startBlock = toNumber(r.startBlock)
  const nowBlock = toNumber(r.nowBlock)
  if (!Number.isNaN(startBlock) && !Number.isNaN(nowBlock) && startBlock > nowBlock) {
    return 'not-started'
  }

  return 'live'
}

/**
 * Accept either a bare array of presale rows or a GraphQL-style envelope
 * `{ presales: [...] }` (or `{ data: { presales: [...] } }`).
 */
function rowsOf(raw: any): any[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.presales)) return raw.presales
    if (raw.data && Array.isArray(raw.data.presales)) return raw.data.presales
  }
  return []
}

/**
 * Defensively map GraphQL `presales` rows into `Campaign`[].
 * Pure — no network. Missing fields default sensibly.
 */
export function parseCampaigns(raw: any): Campaign[] {
  return rowsOf(raw).map((row: any): Campaign => {
    const campaign: Campaign = {
      pool: toString(row?.pool ?? row?.poolAddress ?? row?.address ?? row?.id),
      status: classifyStatus(row),
      min: toBigInt(row?.min),
      max: toBigInt(row?.max),
      raised: toBigInt(row?.raised ?? row?.totalRaised),
      yourFill: toBigInt(row?.yourFill ?? row?.fill ?? row?.contribution),
    }
    const referrer = row?.referrer
    if (referrer !== undefined && referrer !== null && toString(referrer) !== '') {
      campaign.referrer = toString(referrer)
    }
    const token = row?.token ?? row?.tokenAddress
    if (token !== undefined && token !== null && toString(token) !== '') {
      campaign.token = toString(token)
    }
    if (row?.name !== undefined && row?.name !== null) {
      campaign.name = toString(row.name)
    }
    campaign.raw = row
    return campaign
  })
}
