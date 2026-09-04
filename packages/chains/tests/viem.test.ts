import { describe, expect, it } from 'vitest'
import { CHAINS, chunkMulticall, createChainClient } from '../src/index.js'

describe('createChainClient (T2.1)', () => {
  it('builds a client for every registry chain (no RPC call at construction)', () => {
    for (const c of CHAINS) {
      const client = createChainClient(c.chainId)
      expect(client).toBeDefined()
    }
  })
  it('throws on unknown chain id', () => {
    expect(() => createChainClient(99999)).toThrow(/Unknown chain id/)
  })
})

describe('chunkMulticall', () => {
  it('splits by maxCalls', () => {
    const calls = Array.from({ length: 120 }, (_, i) => ({ i }))
    const chunks = chunkMulticall(calls, { maxCalls: 50 })
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20])
    // no data loss
    expect(chunks.flat()).toHaveLength(120)
  })
  it('splits by estimated calldata bytes when over the cap', () => {
    // 3 calls of ~80KB each under a 200KB cap → each alone (160KB pairs exceed)
    const calls = ['a', 'b', 'c']
    const chunks = chunkMulticall(calls, {
      maxCalls: 100,
      maxCalldataBytes: 200_000,
      estimateBytes: () => 80_000,
    })
    // 80+80=160 (ok), +80=240 (over) → [2,1]
    expect(chunks.map((c) => c.length)).toEqual([2, 1])
  })
  it('returns empty array for no calls', () => {
    expect(chunkMulticall([])).toEqual([])
  })
  it('honors BSC-style small maxCalls without dropping calls', () => {
    const calls = Array.from({ length: 10 }, (_, i) => i)
    const chunks = chunkMulticall(calls, { maxCalls: 3 })
    expect(chunks.map((c) => c.length)).toEqual([3, 3, 3, 1])
  })
})
