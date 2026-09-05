export const BOLT_STAIRS: { bolt: number; mult: number }[] = [
  { bolt: 0, mult: 1.0 },
  { bolt: 50000, mult: 1.05 },
  { bolt: 100000, mult: 1.15 },
]

const BOLT_STAIR_CAP = 100000
const BOLT_STAIR_MID = 50000
const MULT_NONE = 1.0
const MULT_MID = 1.05
const MULT_CAP = 1.15

/**
 * BOLT boost is STAIRS (not linear):
 *   < 50000 BOLT  → 1.00
 *   50000–99999   → 1.05
 *   >= 100000     → 1.15 (cap)
 */
export function boltStairsMultiplier(boltDeposited: number | bigint): number {
  const bolt = typeof boltDeposited === 'bigint' ? Number(boltDeposited) : boltDeposited
  if (bolt >= BOLT_STAIR_CAP) return MULT_CAP
  if (bolt >= BOLT_STAIR_MID) return MULT_MID
  return MULT_NONE
}

/** BOLT is locked in the pool and unlocks only on a 100% exit. */
export const boltUnlocksOnFullExit = true
