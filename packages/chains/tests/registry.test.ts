import { describe, expect, it } from 'vitest'
import {
  ALL_CHAINS,
  CHAINS,
  ELECTRONEUM_ADDRESSES,
  ELECTRONEUM_MAINNET_CHAIN_ID,
  ELECTRONEUM_TESTNET_CHAIN_ID,
  HOME_CHAIN,
  HOME_CHAIN_ID,
  isElectroneumChainId,
} from '../src/index.js'

describe('chain registry', () => {
  it('ships 10 supported chains (ETN + 9 EVM)', () => {
    expect(CHAINS).toHaveLength(10)
    expect(ALL_CHAINS).toHaveLength(11) // + testnet
  })

  it('every supported chain has >=2 RPC URLs', () => {
    for (const c of CHAINS) {
      expect(
        c.rpcUrls.length,
        `${c.name} (${c.chainId}) must ship >=2 RPCs for failover`,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('ETN is the home chain with id 52014', () => {
    expect(HOME_CHAIN_ID).toBe(52014)
    expect(HOME_CHAIN.name).toBe('Electroneum')
    expect(CHAINS[0]?.chainId).toBe(52014)
  })

  it('has no duplicate chain ids', () => {
    const ids = ALL_CHAINS.map((c) => c.chainId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every chain has a native currency with 18 decimals and a symbol', () => {
    for (const c of ALL_CHAINS) {
      expect(c.nativeCurrency.decimals).toBe(18)
      expect(c.nativeCurrency.symbol.length).toBeGreaterThan(0)
    }
  })
})

describe('Electroneum helpers', () => {
  it('detects Electroneum chain ids', () => {
    expect(isElectroneumChainId(52014)).toBe(true)
    expect(isElectroneumChainId(5201420)).toBe(true)
    expect(isElectroneumChainId(1)).toBe(false)
  })

  it('ELECTRONEUM_ADDRESSES has both mainnet and testnet entries with core addresses', () => {
    for (const id of [ELECTRONEUM_MAINNET_CHAIN_ID, ELECTRONEUM_TESTNET_CHAIN_ID] as const) {
      const a = ELECTRONEUM_ADDRESSES[id]
      expect(a.universalRouter).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(a.multicall3).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(a.permit2).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(a.wetn).toMatch(/^0x[0-9a-fA-F]{40}$/)
    }
  })

  it('multicall3 differs between mainnet and testnet (C1)', () => {
    const main = ELECTRONEUM_ADDRESSES[ELECTRONEUM_MAINNET_CHAIN_ID].multicall3
    const test = ELECTRONEUM_ADDRESSES[ELECTRONEUM_TESTNET_CHAIN_ID].multicall3
    expect(main).not.toBe(test)
    expect(main).toBe('0xf6bd2414715713f52C74fce8341DA12221ac7446')
  })
})
