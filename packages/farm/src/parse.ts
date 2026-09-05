import type { Farm, FarmPosition } from './types'

/**
 * Accept either a bare array of rows, or a GraphQL-style envelope
 * `{ yieldFarms: [...] }` (or `{ data: { yieldFarms: [...] } }`).
 */
function rowsOf(raw: any): any[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.yieldFarms)) return raw.yieldFarms
    if (raw.data && Array.isArray(raw.data.yieldFarms)) return raw.data.yieldFarms
  }
  return []
}

function toNumber(value: any, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toBigInt(value: any): bigint {
  if (value === undefined || value === null || value === '') return 0n
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  // string / wei-style decimals: take the integer part (exact, no Number() precision loss)
  const s = String(value).trim().split(/[\s.]/)[0]
  try {
    return BigInt(s || '0')
  } catch {
    return 0n
  }
}

function toString(value: any, fallback = ''): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

/**
 * Defensively map GraphQL `yieldFarms` rows into `Farm`.
 * Pure — no network. Missing fields default sensibly.
 */
export function parseFarms(raw: any): Farm[] {
  return rowsOf(raw).map((row: any): Farm => {
    const version = toNumber(row?.version)
    const farm: Farm = {
      id: toNumber(row?.id),
      name: toString(row?.name ?? row?.title, 'Unknown farm'),
      version: (version === 3 ? 3 : 2) as 2 | 3,
      apy: toNumber(row?.apy),
      tvl: toNumber(row?.tvl ?? row?.totalValueLocked),
      allocation: toNumber(row?.allocation),
      token0: toString(row?.token0 ?? row?.token0Address),
      token1: toString(row?.token1 ?? row?.token1Address),
    }
    return farm
  })
}

/**
 * Defensively map GraphQL rows into `FarmPosition`.
 * Pure — no network. Missing fields default to 0.
 */
export function parsePositions(raw: any): FarmPosition[] {
  return rowsOf(raw).map((row: any): FarmPosition => {
    const position: FarmPosition = {
      farmId: toNumber(row?.farmId),
      liquidity: toBigInt(row?.liquidity),
      durationMultiplier: toNumber(row?.durationMultiplier, 1),
      boltMultiplier: toNumber(row?.boltMultiplier, 1),
      boltDeposited: toBigInt(row?.boltDeposited),
      rewards: toBigInt(row?.rewards),
      thirdPartyRewards: toBigInt(row?.thirdPartyRewards),
    }
    return position
  })
}
