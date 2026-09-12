/**
 * ElectroSwap yield farms (master plan §8.8): the contract's reads and writes,
 * the multiplier math the Coil draws (duration 1.0→2.5× over a year of
 * blocks, BOLT stairs 1.00/1.05/1.15), the dilution a second deposit causes
 * (the contract re-weights `startingBlock`), and the amount quoting for V2
 * (pair reserves) and V3 (the farm's position range) deposits. Pure; the
 * engine reads the chain and hands the numbers in.
 */
import { encodeFunctionData, parseAbi, type Hex } from 'viem'

export const YIELD_FARM_ABI = parseAbi([
  'struct Farm { uint256 id; uint8 version; string name; address poolAddr; uint256 liquidity; uint256 allocPoint; uint256 lastCalcBlock; uint256 accRewardsPerShare; uint256 accThirdPartyRewardsPerShare; address[] farmers; uint256 farmerCount; address token0; address token1; uint256 tokenId; int24 tickLower; int24 tickUpper; uint24 fee; uint256 accFees0PerShare; uint256 accFees1PerShare; bool active; }',
  'struct Farmer { address addr; uint256 liquidity; uint256 boltMultiplier; uint256 boltDeposited; uint256 durationMultiplier; uint256 startingBlock; uint256 rewards; uint256 rewardDebt; uint256 thirdPartyRewards; uint256 thirdPartyRewardDebt; uint256 fees0; uint256 fees0Debt; uint256 fees1; uint256 fees1Debt; }',
  'function farmCount() view returns (uint256)',
  'function getFarmById(uint256 _farmId) view returns (Farm farm)',
  'function getFarmerByFarmIdAndAddress(uint256 _farmId, address _farmerAddress) view returns (Farmer farmer)',
  'function calculateDurationMultiplier(uint256 blocksServed) view returns (uint256)',
  'function rewardPerBlock() view returns (uint256)',
  'function rewardToken() view returns (address)',
  'function totalAllocPoint() view returns (uint256)',
  'function deposit(uint256 _farmId, uint256 _amount0, uint256 _amount1, uint256 _amountBolt) payable',
  'function withdraw(uint256 _farmId, uint256 _liquidityAmt, bool _asNative)',
])

export const V2_PAIR_ABI = parseAbi(['function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)', 'function token0() view returns (address)', 'function totalSupply() view returns (uint256)'])
export const V3_POOL_ABI = parseAbi(['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'])

/** One year of Electroneum blocks; the duration bonus is linear to 2.5× and capped there (YieldFarm.sol). */
export const MAX_BLOCKS_FOR_BONUS = 6_307_200n
export const MULTIPLIER_BASE = 10_000n

/** `10000 + 15000·blocks/6 307 200`, capped at 25000 — the contract's `_calculateDurationMultiplier`. */
export function durationMultiplier(blocksServed: bigint): bigint {
  if (blocksServed < 0n) return MULTIPLIER_BASE
  if (blocksServed >= MAX_BLOCKS_FOR_BONUS) return 25_000n
  return MULTIPLIER_BASE + (15_000n * blocksServed) / MAX_BLOCKS_FOR_BONUS
}

/** Blocks still to serve before the multiplier reaches `target` (e.g. 20000 for 2.0×). */
export function blocksUntilMultiplier(blocksServed: bigint, target: bigint): bigint {
  if (target <= MULTIPLIER_BASE) return 0n
  const needed = ((target - MULTIPLIER_BASE) * MAX_BLOCKS_FOR_BONUS + 14_999n) / 15_000n
  return needed > blocksServed ? needed - blocksServed : 0n
}

/** The BOLT stairs the contract accepts (`boltMultipliers`): totals must land exactly on one. */
export const BOLT_STAIRS: ReadonlyArray<{ readonly bolt: bigint; readonly multiplier: bigint }> = [
  { bolt: 0n, multiplier: 10_000n },
  { bolt: 50_000n * 10n ** 18n, multiplier: 10_500n },
  { bolt: 100_000n * 10n ** 18n, multiplier: 11_500n },
]

export function boltStair(totalBolt: bigint): { readonly bolt: bigint; readonly multiplier: bigint } | null {
  return BOLT_STAIRS.find((s) => s.bolt === totalBolt) ?? null
}

/** The next stair above `totalBolt` and how much more BOLT it takes; null at the top. */
export function nextBoltStair(totalBolt: bigint): { readonly bolt: bigint; readonly multiplier: bigint; readonly more: bigint } | null {
  const next = BOLT_STAIRS.find((s) => s.bolt > totalBolt)
  return next ? { ...next, more: next.bolt - totalBolt } : null
}

/**
 * A second deposit re-weights the farmer's `startingBlock` by the share the
 * new liquidity is of the total (YieldFarm.deposit): the multiplier the
 * farmer keeps afterwards, so the dilution plate can say so before signing.
 */
export function dilution(input: { readonly existingLiquidity: bigint; readonly startingBlock: bigint; readonly currentBlock: bigint; readonly addedLiquidity: bigint }): { readonly before: bigint; readonly after: bigint; readonly blocksLost: bigint } {
  const blocksServed = input.currentBlock > input.startingBlock ? input.currentBlock - input.startingBlock : 0n
  const before = durationMultiplier(blocksServed)
  if (input.existingLiquidity === 0n || input.addedLiquidity === 0n) return { before, after: before, blocksLost: 0n }
  const increaseOfTotal = (input.addedLiquidity * 10n ** 18n) / (input.existingLiquidity + input.addedLiquidity)
  const adjusted = blocksServed - (blocksServed * increaseOfTotal) / 10n ** 18n
  return { before, after: durationMultiplier(adjusted), blocksLost: blocksServed - adjusted }
}

/** Pending rewards ≈ farmer.rewards from the chain read; the effective share is liquidity × both multipliers. */
export function effectiveShare(liquidity: bigint, duration: bigint, bolt: bigint): bigint {
  return (liquidity * duration * bolt) / (MULTIPLIER_BASE * MULTIPLIER_BASE)
}

export function encodeDeposit(farmId: bigint, amount0: bigint, amount1: bigint, amountBolt: bigint): Hex {
  return encodeFunctionData({ abi: YIELD_FARM_ABI, functionName: 'deposit', args: [farmId, amount0, amount1, amountBolt] })
}

export function encodeWithdraw(farmId: bigint, liquidity: bigint, asNative: boolean): Hex {
  return encodeFunctionData({ abi: YIELD_FARM_ABI, functionName: 'withdraw', args: [farmId, liquidity, asNative] })
}

/** Collect = `withdraw(farmId, 0, asNative)`: runs `_collectRewardsAndFees` and leaves the liquidity untouched. */
export function encodeCollect(farmId: bigint, asNative: boolean): Hex {
  return encodeWithdraw(farmId, 0n, asNative)
}

// ---- amount quoting ------------------------------------------------------------------------

/** V2: the pair's ratio decides how much of the other token a deposit takes; the contract refunds the rest. */
export function v2Counterpart(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (reserveIn === 0n) return 0n
  return (amountIn * reserveOut) / reserveIn
}

/** The LP tokens a V2 deposit mints, for the share preview (Router02.addLiquidity math). */
export function v2LiquidityMinted(amount0: bigint, amount1: bigint, reserve0: bigint, reserve1: bigint, totalSupply: bigint): bigint {
  if (totalSupply === 0n || reserve0 === 0n || reserve1 === 0n) return 0n
  const a = (amount0 * totalSupply) / reserve0
  const b = (amount1 * totalSupply) / reserve1
  return a < b ? a : b
}

const Q96 = 1n << 96n

/** TickMath.getSqrtRatioAtTick in bigint (Uniswap V3), exact to the reference implementation. */
export function sqrtRatioAtTick(tick: number): bigint {
  const absTick = BigInt(Math.abs(tick))
  if (absTick > 887_272n) throw new Error('tick out of range')
  let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n
  const mul = (m: bigint): void => {
    ratio = (ratio * m) >> 128n
  }
  if ((absTick & 0x2n) !== 0n) mul(0xfff97272373d413259a46990580e213an)
  if ((absTick & 0x4n) !== 0n) mul(0xfff2e50f5f656932ef12357cf3c7fdccn)
  if ((absTick & 0x8n) !== 0n) mul(0xffe5caca7e10e4e61c3624eaa0941cd0n)
  if ((absTick & 0x10n) !== 0n) mul(0xffcb9843d60f6159c9db58835c926644n)
  if ((absTick & 0x20n) !== 0n) mul(0xff973b41fa98c081472e6896dfb254c0n)
  if ((absTick & 0x40n) !== 0n) mul(0xff2ea16466c96a3843ec78b326b52861n)
  if ((absTick & 0x80n) !== 0n) mul(0xfe5dee046a99a2a811c461f1969c3053n)
  if ((absTick & 0x100n) !== 0n) mul(0xfcbe86c7900a88aedcffc83b479aa3a4n)
  if ((absTick & 0x200n) !== 0n) mul(0xf987a7253ac413176f2b074cf7815e54n)
  if ((absTick & 0x400n) !== 0n) mul(0xf3392b0822b70005940c7a398e4b70f3n)
  if ((absTick & 0x800n) !== 0n) mul(0xe7159475a2c29b7443b29c7fa6e889d9n)
  if ((absTick & 0x1000n) !== 0n) mul(0xd097f3bdfd2022b8845ad8f792aa5825n)
  if ((absTick & 0x2000n) !== 0n) mul(0xa9f746462d870fdf8a65dc1f90e061e5n)
  if ((absTick & 0x4000n) !== 0n) mul(0x70d869a156d2a1b890bb3df62baf32f7n)
  if ((absTick & 0x8000n) !== 0n) mul(0x31be135f97d08fd981231505542fcfa6n)
  if ((absTick & 0x10000n) !== 0n) mul(0x9aa508b5b7a84e1c677de54f3e99bc9n)
  if ((absTick & 0x20000n) !== 0n) mul(0x5d6af8dedb81196699c329225ee604n)
  if ((absTick & 0x40000n) !== 0n) mul(0x2216e584f5fa1ea926041bedfe98n)
  if ((absTick & 0x80000n) !== 0n) mul(0x48a170391f7dc42444e8fa2n)
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio
  // Q128.128 → Q64.96, rounding up.
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

/** Amounts of token0/token1 a V3 position of `liquidity` holds between the ticks at the current price (LiquidityAmounts). */
export function v3AmountsForLiquidity(sqrtPriceX96: bigint, tickLower: number, tickUpper: number, liquidity: bigint): { amount0: bigint; amount1: bigint } {
  const lower = sqrtRatioAtTick(tickLower)
  const upper = sqrtRatioAtTick(tickUpper)
  const amount0 = (a: bigint, b: bigint): bigint => (liquidity * Q96 * (b - a)) / b / a
  const amount1 = (a: bigint, b: bigint): bigint => (liquidity * (b - a)) / Q96
  if (sqrtPriceX96 <= lower) return { amount0: amount0(lower, upper), amount1: 0n }
  if (sqrtPriceX96 >= upper) return { amount0: 0n, amount1: amount1(lower, upper) }
  return { amount0: amount0(sqrtPriceX96, upper), amount1: amount1(lower, sqrtPriceX96) }
}

/** The token1 a V3 deposit needs beside `amount0` in the farm's range (0n when the range is one-sided). */
export function v3Counterpart(amount0: bigint, sqrtPriceX96: bigint, tickLower: number, tickUpper: number): { amount1: bigint; liquidity: bigint } {
  const lower = sqrtRatioAtTick(tickLower)
  const upper = sqrtRatioAtTick(tickUpper)
  if (sqrtPriceX96 <= lower || amount0 === 0n) return { amount1: 0n, liquidity: 0n }
  if (sqrtPriceX96 >= upper) return { amount1: 0n, liquidity: 0n }
  // liquidity from amount0 over [price, upper], then amount1 over [lower, price].
  const liquidity = (amount0 * sqrtPriceX96 * upper) / Q96 / (upper - sqrtPriceX96)
  const amount1 = (liquidity * (sqrtPriceX96 - lower)) / Q96
  return { amount1, liquidity }
}
