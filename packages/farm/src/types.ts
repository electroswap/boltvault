export interface Farm {
  id: number
  name: string
  version: 2 | 3
  apy: number
  tvl: number
  allocation: number
  token0: string
  token1: string
}

export interface FarmPosition {
  farmId: number
  liquidity: bigint
  durationMultiplier: number
  boltMultiplier: number
  boltDeposited: bigint
  rewards: bigint
  thirdPartyRewards: bigint
}
