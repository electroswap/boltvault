/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useBlockHeartbeat, isStale } from '../src/heartbeat'
import type { SwClient } from '../src/sw-client'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A fake SwClient that serves a scripted block-head sequence, then repeats the last. */
function fakeClient(sequence: number[]): SwClient {
  let i = 0
  return {
    blockHead: async (_chainId: number) => {
      const v = sequence[Math.min(i, sequence.length - 1)]
      i++
      return v
    },
  } as unknown as SwClient
}

describe('isStale (pure)', () => {
  it('null at -> stale', () => expect(isStale(null, 1000, 5000)).toBe(true))
  it('fresh at -> not stale', () => expect(isStale(9000, 9500, 5000)).toBe(false))
  it('old at -> stale', () => expect(isStale(1000, 9500, 5000)).toBe(true))
})

describe('useBlockHeartbeat', () => {
  it('polls and snaps to the latest head', async () => {
    const client = fakeClient([100, 101, 102])
    const { result } = renderHook(() => useBlockHeartbeat(52014, { intervalMs: 25, client }))
    await act(async () => {
      await sleep(120)
    })
    expect(result.current.state.block).toBeGreaterThanOrEqual(102)
    expect(result.current.state.stale).toBe(false)
    expect(result.current.state.at).not.toBeNull()
  })

  it('holds (stale=true) when polls keep failing', async () => {
    const client = {
      blockHead: async () => {
        throw new Error('rpc down')
      },
    } as unknown as SwClient
    const { result } = renderHook(() => useBlockHeartbeat(1, { intervalMs: 25, client }))
    // Before the first successful read it is stale.
    expect(result.current.state.stale).toBe(true)
    await act(async () => {
      await sleep(80)
    })
    expect(result.current.state.block).toBeNull()
    expect(result.current.state.stale).toBe(true)
  })
})
