import { describe, expect, it } from 'vitest'
import {
  computeSwapUiState,
  feeCoachCopy,
  feeSheet,
  type SwapUiInput,
} from '../src/swap-ui-state'
import { feeAmount, minOutAfterFee } from '@boltvault/swap'

const SINK = '0xA1A1a1a1A1A1A1A1A1a1a1a1a1a1A1A1a1A1a1a1'
const OUT = 1_000_000n // 1.0 token
const NOW = 1_000_000

function input(over: Partial<SwapUiInput> = {}): SwapUiInput {
  return {
    quote: { amountOut: OUT, at: NOW - 100 },
    now: NOW,
    priceImpactPct: 0.5,
    sink: SINK,
    coachDismissed: true,
    tokenOutSymbol: 'USDC',
    ...over,
  }
}

describe('computeSwapUiState (T5.4 breaker gating)', () => {
  it('arms when quote is fresh, sink pinned, coach dismissed, low impact', () => {
    const s = computeSwapUiState(input())
    expect(s.armed).toBe(true)
    expect(s.reason).toBe('armed')
    expect(s.fee).toBe(feeAmount(OUT))
    expect(s.minOut).toBe(minOutAfterFee({ quotedOut: OUT }))
    expect(s.feeLine).toContain('(fee sink)')
    expect(s.feeLine).toContain(SINK.slice(0, 6))
    expect(s.feeLine).toContain(SINK.slice(-4))
  })

  it('disarms (no-quote) when there is no quote', () => {
    const s = computeSwapUiState(input({ quote: null }))
    expect(s.armed).toBe(false)
    expect(s.reason).toBe('no-quote')
  })

  it('disarms (no-sink) when the sink is not pinned', () => {
    const s = computeSwapUiState(input({ sink: null }))
    expect(s.reason).toBe('no-sink')
  })

  it('disarms (coach) until the first-swap coach is dismissed', () => {
    const s = computeSwapUiState(input({ coachDismissed: false }))
    expect(s.armed).toBe(false)
    expect(s.reason).toBe('coach')
  })

  it('disarms (stale) when the quote is older than 8s', () => {
    const s = computeSwapUiState(input({ quote: { amountOut: OUT, at: NOW - 9000 } }))
    expect(s.reason).toBe('stale')
    expect(s.stale).toBe(true)
  })

  it('warns + disarms (impact-warn) when price impact >5%', () => {
    const s = computeSwapUiState(input({ priceImpactPct: 6.2 }))
    expect(s.reason).toBe('impact-warn')
    expect(s.impactWarn).toBe(true)
  })

  it('does NOT flag impact-warn at or under 5%', () => {
    expect(computeSwapUiState(input({ priceImpactPct: 5 })).impactWarn).toBe(false)
    expect(computeSwapUiState(input({ priceImpactPct: 0.1 })).impactWarn).toBe(false)
  })
})

describe('feeCoachCopy (T5.4)', () => {
  it('names the sink, the dApp note, and the hardware note', () => {
    const c = feeCoachCopy(SINK)
    expect(c.example).toContain('0.25')
    expect(c.sinkLine).toContain(SINK.slice(0, 6))
    expect(c.dappNote).toMatch(/websites/i)
    expect(c.hardwareNote).toMatch(/hash/i)
  })
})

describe('feeSheet (T5.4 breaker line)', () => {
  it('includes sink + min out + symbol', () => {
    const sheet = feeSheet(
      { output: OUT, fee: feeAmount(OUT), userOut: OUT - feeAmount(OUT), minOut: minOutAfterFee({ quotedOut: OUT }), sink: SINK },
      'USDC',
    )
    expect(sheet).toContain(SINK.slice(0, 6))
    expect(sheet).toContain('USDC')
    expect(sheet).toContain('min out')
  })
})
