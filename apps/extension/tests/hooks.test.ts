/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePortfolio, useTokenPrice, type PortfolioData } from '../src/hooks'
import type { SwClient } from '../src/sw-client'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function goodPortfolio(): PortfolioData {
  return {
    chainId: 52014,
    account: '0xacc',
    native: null,
    rows: [],
    pricedTotalUsd: 42,
    at: 1,
  }
}

/** Fake client: returns `good` until `failAfter` calls, then always fails (to force a failing re-fetch). */
function flakyClient(good: PortfolioData, { failAfter = 1, refreshMs = 40 }: { failAfter?: number; refreshMs?: number } = {}): { client: SwClient; refreshMs: number } {
  let calls = 0
  const client = {
    portfolio: async (_c: number, _a: string) => {
      calls++
      if (calls > failAfter) throw new Error('rpc down')
      return good
    },
  } as unknown as SwClient
  return { client, refreshMs }
}

describe('usePortfolio', () => {
  it('starts loading, then resolves data', async () => {
    const { client } = flakyClient(goodPortfolio(), { failAfter: Infinity })
    const { result } = renderHook(() => usePortfolio(52014, '0xacc', { client, refreshMs: 50 }))
    await act(async () => {
      await sleep(60)
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.data?.pricedTotalUsd).toBe(42)
    expect(result.current.error).toBeNull()
  })

  it('keeps last-good data + sets stale after a failing re-fetch', async () => {
    const { client, refreshMs } = flakyClient(goodPortfolio(), { failAfter: 1 })
    const { result } = renderHook(() => usePortfolio(52014, '0xacc', { client, refreshMs }))
    // First load succeeds.
    await act(async () => {
      await sleep(refreshMs + 60)
    })
    expect(result.current.data?.pricedTotalUsd).toBe(42)
    // Let the failing re-fetch fire.
    await act(async () => {
      await sleep(refreshMs + 120)
    })
    // Last-good is retained, marked stale, error captured.
    expect(result.current.data?.pricedTotalUsd).toBe(42)
    expect(result.current.stale).toBe(true)
    expect(result.current.error).toMatch(/rpc down/)
    // refresh() retries now (still last-good until it resolves — but the fake
    // keeps failing, so it stays stale with data retained).
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.data?.pricedTotalUsd).toBe(42)
  })
})

describe('useTokenPrice', () => {
  it('resolves a price and keeps it on a failed re-fetch', async () => {
    let calls = 0
    const client = {
      price: async () => {
        calls++
        if (calls > 1) throw new Error('down')
        return 1.25
      },
    } as unknown as SwClient
    const { result } = renderHook(() => useTokenPrice(52014, '0xa', { client, refreshMs: 40 }))
    await act(async () => {
      await sleep(120)
    })
    expect(result.current.data).toBe(1.25)
    expect(result.current.stale).toBe(true) // a re-fetch failed
    expect(result.current.data).toBe(1.25) // last-good retained
  })
})
