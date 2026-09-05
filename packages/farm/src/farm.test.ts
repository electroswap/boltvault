import { describe, expect, it } from 'vitest'
import { decodeFunctionData } from 'viem'
import {
  FARM_CONTRACT,
  collectCall,
  depositCall,
  withdrawCall,
} from './calldata'
import { MAX_BLOCKS_FOR_BONUS, dateToMultiplier, dilutionWarning, durationMultiplier } from './duration'
import { BOLT_STAIRS, boltStairsMultiplier, boltUnlocksOnFullExit } from './bolt'
import { parseFarms, parsePositions } from './parse'

const FARM_CONTRACT_ADDR = FARM_CONTRACT as `0x${string}`
const abi = [
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'farmId', type: 'uint256' },
      { name: 'liquidityAmt', type: 'uint256' },
      { name: 'asNative', type: 'bool' },
    ],
    outputs: [],
  },
] as const

function decodeWithdraw(data: string) {
  const decoded = decodeFunctionData({ abi, data: data as `0x${string}` })
  return {
    farmId: decoded.args[0] as bigint,
    liquidityAmt: decoded.args[1] as bigint,
    asNative: decoded.args[2] as boolean,
  }
}

describe('calldata', () => {
  it('collectCall encodes withdraw with liquidityAmt 0n to FARM_CONTRACT', () => {
    const call = collectCall({ farmId: 3, asNative: false })
    expect(call.to).toBe(FARM_CONTRACT)
    expect(call.to.toLowerCase()).toBe(FARM_CONTRACT_ADDR.toLowerCase())
    expect(decodeWithdraw(call.data)).toEqual({ farmId: 3n, liquidityAmt: 0n, asNative: false })
  })

  it('collect (liquidity 0n) differs from a non-zero withdraw', () => {
    const collect = collectCall({ farmId: 7, asNative: true })
    const partialWithdraw = withdrawCall({ farmId: 7, liquidityAmt: 12345n, asNative: true })

    expect(decodeWithdraw(collect.data).liquidityAmt).toBe(0n)
    expect(decodeWithdraw(partialWithdraw.data).liquidityAmt).toBe(12345n)
    expect(collect.data).not.toBe(partialWithdraw.data)
    // collect === withdraw with liquidity 0n, same flags
    expect(collect.data).toBe(
      withdrawCall({ farmId: 7, liquidityAmt: 0n, asNative: true }).data,
    )
  })

  it('depositCall encodes all four amounts and carries value', () => {
    const depositAbi = [
      {
        type: 'function',
        name: 'deposit',
        stateMutability: 'payable',
        inputs: [
          { name: 'farmId', type: 'uint256' },
          { name: 'amount0', type: 'uint256' },
          { name: 'amount1', type: 'uint256' },
          { name: 'amountBolt', type: 'uint256' },
        ],
        outputs: [],
      },
    ] as const
    const call = depositCall({ farmId: 1, amount0: 10n ** 18n, amount1: 5n ** 18n, amountBolt: 0n, value: 10n ** 18n })
    expect(call.to).toBe(FARM_CONTRACT)
    expect(call.value).toBe(10n ** 18n)
    const decoded = decodeFunctionData({ abi: depositAbi, data: call.data as `0x${string}` })
    expect(decoded.functionName).toBe('deposit')
    expect(decoded.args[0]).toBe(1n)
    expect(decoded.args[1]).toBe(10n ** 18n)
    expect(decoded.args[2]).toBe(5n ** 18n)
    expect(decoded.args[3]).toBe(0n)
  })
})

describe('duration', () => {
  it('ramps from 1.0 at start block', () => {
    expect(durationMultiplier(0, 0)).toBe(1.0)
  })

  it('reaches 2.5 at MAX_BLOCKS_FOR_BONUS and clamps above', () => {
    const max = Number(MAX_BLOCKS_FOR_BONUS)
    expect(durationMultiplier(max, 0)).toBeCloseTo(2.5, 6)
    expect(durationMultiplier(max * 2, 0)).toBe(2.5)
    expect(durationMultiplier(max * 10, 0)).toBe(2.5)
  })

  it('ramps linearly mid-ramp', () => {
    const max = Number(MAX_BLOCKS_FOR_BONUS)
    // halfway → exactly 1.75
    expect(durationMultiplier(max / 2, 0)).toBeCloseTo(1.75, 6)
  })

  it('handles negative elapsed (block before start) as 1.0', () => {
    expect(durationMultiplier(100, 200)).toBe(1.0)
  })

  it('dateToMultiplier projects the future hit date', () => {
    const max = Number(MAX_BLOCKS_FOR_BONUS)
    const startBlock = 0
    const nowBlock = 0
    const nowMs = 1_000_000_000_000
    // target 2.5 → hit at exactly MAX_BLOCKS_FOR_BONUS from start
    const date = dateToMultiplier(2.5, startBlock, nowBlock, nowMs)
    expect(date).toBeInstanceOf(Date)
    const expectedMs = nowMs + max * 5 * 1000
    expect((date as Date).getTime()).toBe(expectedMs)

    // already past target → null
    expect(dateToMultiplier(1.5, 0, max / 2, nowMs)).toBeNull()
    // out of range targets → null
    expect(dateToMultiplier(1.0, 0, 0, nowMs)).toBeNull()
    expect(dateToMultiplier(3.0, 0, 0, nowMs)).toBeNull()
  })

  it('dilutionWarning true when a fresh startBlock would lower the multiplier', () => {
    const max = Number(MAX_BLOCKS_FOR_BONUS)
    // deep into a mature ramp: fresh start would be much lower
    expect(
      dilutionWarning({
        currentMultiplier: durationMultiplier(max, 0),
        newStartBlock: max, // fresh start at current block
        nowBlock: max,
      }),
    ).toBe(true)
    // fresh start at the same block as the existing ramp → no dilution
    expect(
      dilutionWarning({ currentMultiplier: 1.0, newStartBlock: 5, nowBlock: 5 }),
    ).toBe(false)
    expect(
      dilutionWarning({
        currentMultiplier: durationMultiplier(max / 2, 0),
        newStartBlock: 0,
        nowBlock: max / 2,
      }),
    ).toBe(false)
  })
})

describe('bolt', () => {
  it('BOLT_STAIRS is the canonical stair table', () => {
    expect(BOLT_STAIRS).toEqual([
      { bolt: 0, mult: 1.0 },
      { bolt: 50000, mult: 1.05 },
      { bolt: 100000, mult: 1.15 },
    ])
  })

  it('boltStairsMultiplier is stairs, not linear', () => {
    expect(boltStairsMultiplier(0)).toBe(1.0)
    expect(boltStairsMultiplier(49999)).toBe(1.0)
    expect(boltStairsMultiplier(50000)).toBe(1.05)
    expect(boltStairsMultiplier(99999)).toBe(1.05)
    expect(boltStairsMultiplier(100000)).toBe(1.15)
    expect(boltStairsMultiplier(100001)).toBe(1.15)
    expect(boltStairsMultiplier(500000n)).toBe(1.15)
  })

  it('boltUnlocksOnFullExit is true (BOLT locked until 100% exit)', () => {
    expect(boltUnlocksOnFullExit).toBe(true)
  })
})

const farmsFixture = {
  yieldFarms: [
    {
      id: 1,
      name: 'BOLT/USDC',
      version: 3,
      apy: 12.5,
      tvl: 1_500_000,
      allocation: 10,
      token0: '0xToken0',
      token1: '0xToken1',
    },
    {
      id: 2,
      name: 'ETH/USDC',
      version: 2,
      apy: 7,
      tvl: 800000,
      allocation: 5,
      token0: '0xETH',
      token1: '0xUSDC',
    },
    { id: 3, name: 'Missing-fields farm', apy: '8.25' },
  ],
}

const positionsFixture = [
  {
    farmId: 1,
    liquidity: '123456789000000000000',
    durationMultiplier: 1.5,
    boltMultiplier: 1.05,
    boltDeposited: 50000,
    rewards: 42,
    thirdPartyRewards: 7,
  },
  { farmId: 2 },
]

describe('parse', () => {
  it('parseFarms maps an envelope of yieldFarms rows', () => {
    const farms = parseFarms(farmsFixture)
    expect(farms).toHaveLength(3)
    const [first, second, third] = farms
    if (!first || !second || !third) throw new Error('fixture too short')
    expect(first).toEqual({
      id: 1,
      name: 'BOLT/USDC',
      version: 3,
      apy: 12.5,
      tvl: 1_500_000,
      allocation: 10,
      token0: '0xToken0',
      token1: '0xToken1',
    })
    expect(second.version).toBe(2)
    expect(third.apy).toBe(8.25)
    expect(third.tvl).toBe(0)
    expect(third.allocation).toBe(0)
    expect(third.token0).toBe('')
    expect(third.token1).toBe('')
  })

  it('parseFarms accepts a bare array too', () => {
    const farms = parseFarms(farmsFixture.yieldFarms)
    expect(farms).toHaveLength(3)
    expect(farms[0]?.name).toBe('BOLT/USDC')
  })

  it('parseFarms defaults unknown version to 2', () => {
    const farms = parseFarms({ yieldFarms: [{ id: 9, name: 'X', version: 99 }] })
    expect(farms[0]?.version).toBe(2)
  })

  it('parsePositions maps rows with bigint coercion and 0 defaults', () => {
    const positions = parsePositions(positionsFixture)
    expect(positions).toHaveLength(2)
    const [first, second] = positions
    if (!first || !second) throw new Error('fixture too short')
    expect(first).toEqual({
      farmId: 1,
      liquidity: 123456789000000000000n,
      durationMultiplier: 1.5,
      boltMultiplier: 1.05,
      boltDeposited: 50000n,
      rewards: 42n,
      thirdPartyRewards: 7n,
    })
    expect(second).toMatchObject({
      farmId: 2,
      liquidity: 0n,
      durationMultiplier: 1,
      boltMultiplier: 1,
      boltDeposited: 0n,
      rewards: 0n,
      thirdPartyRewards: 0n,
    })
  })

  it('parsePositions handles the { yieldFarms: [...] } envelope', () => {
    const positions = parsePositions({ yieldFarms: positionsFixture })
    expect(positions).toHaveLength(2)
    expect(positions.at(0)).toMatchObject({ farmId: 1 })
  })
})
