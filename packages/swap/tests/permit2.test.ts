/**
 * Permit2 approval path (design T5.3) — pure tests, no live RPC.
 */
import { describe, expect, it } from 'vitest'
import {
  decidePermit2Approval,
  needsApproval,
  permit2AddressFor,
  type ApprovalAction,
  type Permit2DecisionInput,
} from '../src/permit2.js'
import {
  ELECTRONEUM_ADDRESSES,
  ELECTRONEUM_MAINNET_CHAIN_ID,
  ELECTRONEUM_TESTNET_CHAIN_ID,
} from '@boltvault/chains'

// Real registry values — cross-checked against packages/chains/src/electroneum.ts.
const MAINNET_PERMIT2 = '0x012ff228Aa9Fec4dBEE6Cd704072749AF077b617'
const TESTNET_PERMIT2 = '0xDD07Fe6922d1Aab4fe98C6533fa19037159500E7'

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

/** Build a decision input with sane defaults, then run the pure decider. */
function decide(over: Partial<Permit2DecisionInput> = {}): ApprovalAction {
  const input: Permit2DecisionInput = {
    currentAllowance: 0n,
    requiredAmount: 1000n,
    exactApprovals: true,
    preferPermit: true,
    ...over,
  }
  return decidePermit2Approval(input)
}

describe('decidePermit2Approval', () => {
  it('returns none when the existing allowance already covers the amount', () => {
    // exact boundary: allowance == required is covered
    expect(decide({ currentAllowance: 1000n, requiredAmount: 1000n })).toEqual({ kind: 'none' })
    // allowance > required is covered
    expect(decide({ currentAllowance: 5000n, requiredAmount: 1000n })).toEqual({ kind: 'none' })
    // zero required, zero allowance → nothing to do
    expect(decide({ currentAllowance: 0n, requiredAmount: 0n })).toEqual({ kind: 'none' })
  })

  it('returns permit (the default path) when preferPermit and allowance < required', () => {
    expect(decide({ currentAllowance: 0n, requiredAmount: 1000n, preferPermit: true })).toEqual({
      kind: 'permit',
    })
    expect(
      decide({ currentAllowance: 499n, requiredAmount: 1000n, preferPermit: true }),
    ).toEqual({ kind: 'permit' })
    // even a 1-wei shortfall still needs a permit
    expect(decide({ currentAllowance: 999n, requiredAmount: 1000n, preferPermit: true })).toEqual({
      kind: 'permit',
    })
  })

  it('returns approve with value === requiredAmount when preferPermit=false', () => {
    const a = decide({ currentAllowance: 0n, requiredAmount: 1000n, preferPermit: false })
    expect(a).toEqual({ kind: 'approve', value: 1000n })
    expect(a.kind).toBe('approve')
  })
})

describe('decidePermit2Approval — exact-approval value', () => {
  it('approves EXACTLY requiredAmount, never max or a rounded figure', () => {
    const required = 123_456_789n
    const a = decide({ currentAllowance: 0n, requiredAmount: required, preferPermit: false })
    expect(a).toEqual({ kind: 'approve', value: required })
    if (a.kind === 'approve') {
      expect(a.value).toBe(required)
      const MAX_UINT256 = (1n << 256n) - 1n
      expect(a.value).not.toBe(MAX_UINT256) // not a 'max' approval
      expect(a.value > 0n).toBe(true)
    }
  })

  it('approves the full requiredAmount, not just the shortfall, when a partial allowance exists', () => {
    const b = decide({ currentAllowance: 7n, requiredAmount: 1000n, preferPermit: false })
    expect(b).toEqual({ kind: 'approve', value: 1000n })
    const c = decide({ currentAllowance: 999n, requiredAmount: 1000n, preferPermit: false })
    expect(c).toEqual({ kind: 'approve', value: 1000n })
  })
})

describe('needsApproval', () => {
  it('true when required > current', () => {
    expect(needsApproval(0n, 1n)).toBe(true)
    expect(needsApproval(999n, 1000n)).toBe(true)
  })

  it('false when equal or covered', () => {
    expect(needsApproval(1000n, 1000n)).toBe(false)
    expect(needsApproval(5000n, 1000n)).toBe(false)
  })
})

describe('permit2AddressFor', () => {
  it('returns the mainnet registry address for 52014', () => {
    const a = permit2AddressFor(ELECTRONEUM_MAINNET_CHAIN_ID)
    expect(a).toMatch(ADDR_RE)
    expect(a).toBe(ELECTRONEUM_ADDRESSES[ELECTRONEUM_MAINNET_CHAIN_ID].permit2)
    expect(a).toBe(MAINNET_PERMIT2)
  })

  it('returns the testnet registry address for 5201420', () => {
    const a = permit2AddressFor(ELECTRONEUM_TESTNET_CHAIN_ID)
    expect(a).toMatch(ADDR_RE)
    expect(a).toBe(ELECTRONEUM_ADDRESSES[ELECTRONEUM_TESTNET_CHAIN_ID].permit2)
    expect(a).toBe(TESTNET_PERMIT2)
  })

  it('throws for a non-ETN chain id (e.g. Ethereum mainnet = 1)', () => {
    expect(() => permit2AddressFor(1)).toThrow()
  })
})
