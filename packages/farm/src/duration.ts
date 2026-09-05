/** ≈ one year of 5s blocks: 365 * 24 * 3600 / 5. */
export const MAX_BLOCKS_FOR_BONUS = 63072000n

const MIN_MULT = 1.0
const MAX_MULT = 2.5

/**
 * Duration multiplier: ramps linearly 1.0 → 2.5 over MAX_BLOCKS_FOR_BONUS
 * blocks from the position's startBlock, then stays at 2.5.
 */
export function durationMultiplier(block: number, startBlock: number): number {
  const MAX = Number(MAX_BLOCKS_FOR_BONUS)
  const elapsed = block - startBlock
  const progress = Math.min(1, Math.max(0, elapsed / MAX))
  const mult = MIN_MULT + (MAX_MULT - MIN_MULT) * progress
  return Math.min(MAX_MULT, Math.max(MIN_MULT, mult))
}

/**
 * Project the future date when the linear ramp reaches `target`
 * (1.0 < target <= 2.5). Returns null if the ramp is already past `target`
 * (or `target` is out of range / would require negative blocks).
 */
export function dateToMultiplier(
  target: number,
  startBlock: number,
  nowBlock: number,
  nowMs: number,
): Date | null {
  if (!(target > 1.0 && target <= 2.5)) return null
  const MAX = Number(MAX_BLOCKS_FOR_BONUS)
  const blocksNeeded = ((target - 1.0) / (2.5 - 1.0)) * MAX
  const targetBlock = startBlock + blocksNeeded
  const deltaBlocks = targetBlock - nowBlock
  if (deltaBlocks <= 0) return null
  const SECONDS_PER_BLOCK = 5
  return new Date(nowMs + deltaBlocks * SECONDS_PER_BLOCK * 1000)
}

/**
 * True if starting a fresh position at `newStartBlock` (i.e. resetting the
 * ramp) would lower the multiplier earned at `nowBlock` versus continuing
 * the current ramp.
 */
export function dilutionWarning(a: {
  currentMultiplier: number
  newStartBlock: number
  nowBlock: number
}): boolean {
  const fresh = durationMultiplier(a.nowBlock, a.newStartBlock)
  return fresh < a.currentMultiplier - 1e-9
}
