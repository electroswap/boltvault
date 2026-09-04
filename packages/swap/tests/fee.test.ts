import { describe, expect, it } from 'vitest'
import {
  feeAmount,
  netAfterFee,
  minOutAfterFee,
  feeSinkFor,
  inWalletSwapEnabled,
  universalRouterFor,
  feeBreakdown,
  WALLET_FEE_BPS,
  FEE_BIPS_BASE,
  DEFAULT_SLIPPAGE_BPS,
} from '../src/fee'
import { ELECTRONEUM_ADDRESSES, BOLTVAULT_FEE_SINK } from '@boltvault/chains'

describe('fee math (T5.2, 25 bps of output, base 10_000)', () => {
  it('feeAmount is floor(output * 25 / 10000)', () => {
    expect(feeAmount(10_000n)).toBe(25n)
    expect(feeAmount(1_000_000_000n)).toBe(2_500_000n)
    // floor: 9999 * 25 / 10000 = 24.9975 → 24
    expect(feeAmount(9999n)).toBe(24n)
  })

  it('netAfterFee = output - fee, and fee + net === output (exact split, no wei lost)', () => {
    const out = 123_456_789n
    const fee = feeAmount(out)
    const net = netAfterFee(out)
    expect(fee + net).toBe(out)
    expect(net).toBe(out - fee)
  })

  it('the post-swap split is exactly 25 bps ± 1 wei (design decode invariant)', () => {
    for (const out of [1n, 2n, 1000n, 1_000_000n, 9_999_999_999n, 10n ** 18n]) {
      const fee = feeAmount(out)
      const exact = (out * BigInt(WALLET_FEE_BPS)) / BigInt(FEE_BIPS_BASE)
      // floor guarantees fee <= exact and within 1 wei.
      expect(fee <= exact).toBe(true)
      expect(exact - fee <= 1n).toBe(true)
      // and the remainder + fee reconstructs the output.
      expect(fee + (out - fee)).toBe(out)
    }
  })

  it('minOutAfterFee = afterFee * (1 - slippage), integer math', () => {
    const out = 10_000n
    // fee = 25, afterFee = 9975, minOut = 9975 * 9950 / 10000 = 9925 (floor)
    expect(minOutAfterFee({ quotedOut: out })).toBe(9925n)
    // custom slippage 0 → minOut === afterFee
    expect(minOutAfterFee({ quotedOut: out, slippageBips: 0 })).toBe(9975n)
    // custom fee bips
    expect(minOutAfterFee({ quotedOut: 10_000n, feeBips: 100, slippageBips: 0 })).toBe(9900n)
  })

  it('defaults match design (25 bps fee, 50 bps slippage)', () => {
    expect(WALLET_FEE_BPS).toBe(25)
    expect(DEFAULT_SLIPPAGE_BPS).toBe(50)
    expect(FEE_BIPS_BASE).toBe(10_000)
  })
})

describe('fee sink + enablement (T5.2)', () => {
  it('feeSinkFor mirrors the registry constant', () => {
    expect(feeSinkFor(52014)).toBe(BOLTVAULT_FEE_SINK[52014])
    expect(feeSinkFor(5201420)).toBe(BOLTVAULT_FEE_SINK[5201420])
    expect(feeSinkFor(1)).toBeNull()
  })

  it('inWalletSwapEnabled is true only when a sink is pinned (currently none)', () => {
    expect(inWalletSwapEnabled(52014)).toBe(BOLTVAULT_FEE_SINK[52014] != null)
    expect(inWalletSwapEnabled(1)).toBe(false)
  })

  it('universalRouterFor returns the registry UR address for ETN, throws otherwise', () => {
    expect(universalRouterFor(52014)).toBe(ELECTRONEUM_ADDRESSES[52014].universalRouter)
    expect(universalRouterFor(5201420)).toBe(ELECTRONEUM_ADDRESSES[5201420].universalRouter)
    expect(() => universalRouterFor(1)).toThrow(/not ETN/)
  })

  it('feeBreakdown throws when no sink is pinned (do-not-swap), else returns the sheet', () => {
    // Currently both sinks are null (pending PR-ES-5) → throws.
    if (BOLTVAULT_FEE_SINK[52014] == null) {
      expect(() => feeBreakdown(1_000_000n, 52014)).toThrow(/no fee sink/)
    } else {
      const sheet = feeBreakdown(1_000_000n, 52014)
      expect(sheet.fee + sheet.userOut).toBe(1_000_000n)
      expect(sheet.sink).toBe(BOLTVAULT_FEE_SINK[52014])
      expect(sheet.minOut <= sheet.userOut).toBe(true)
    }
  })
})
