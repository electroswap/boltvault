/**
 * ERC-20 lets `transfer` report failure by returning false instead of
 * reverting. The trace then carries no error and `eth_estimateGas` succeeds, so
 * a preview that only looks for a revert reads a transfer that moved nothing as
 * a clean one — while the transaction still costs a fee and still shows as
 * confirmed on the explorer.
 *
 * The opposite non-compliance, returning nothing at all where the ABI says
 * bool, is the USDT class and is perfectly ordinary. It must not be flagged.
 */
import { describe, expect, it } from 'vitest'
import { simulationFromTrace, type TraceFrame } from '../src/simulate'

const ME = '0x1111111111111111111111111111111111111111' as const
const TOKEN = '0x2222222222222222222222222222222222222222' as const
const FRIEND = '0x3333333333333333333333333333333333333333' as const

const TRANSFER = '0xa9059cbb'
const APPROVE = '0x095ea7b3'
const TRANSFER_FROM = '0x23b872dd'
const FALSE = `0x${'0'.repeat(64)}` as const
const TRUE = `0x${'0'.repeat(63)}1` as const
/** topic0 of Transfer(address,address,uint256). */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const

const pad = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}` as const
const amount = (v: bigint) => `0x${v.toString(16).padStart(64, '0')}` as const

const call = (over: Partial<TraceFrame>): TraceFrame => ({ type: 'CALL', from: ME, to: TOKEN, input: `${TRANSFER}${'0'.repeat(128)}` as `0x${string}`, ...over })

describe('a token that answers false', () => {
  it('is a failed simulation, not a clean one', () => {
    const sim = simulationFromTrace(call({ output: FALSE }), ME)
    expect(sim.ok).toBe(false)
    expect(sim.revertReason).toContain('returned false')
    expect(sim.deltas).toEqual([])
  })

  it('is caught for transferFrom and approve as well', () => {
    for (const selector of [TRANSFER_FROM, APPROVE]) {
      const sim = simulationFromTrace(call({ input: `${selector}${'0'.repeat(128)}` as `0x${string}`, output: FALSE }), ME)
      expect(sim.ok, selector).toBe(false)
    }
  })

  it('is caught when it happens inside a nested call, not just at the top', () => {
    const trace: TraceFrame = { type: 'CALL', from: ME, to: FRIEND, input: '0xdeadbeef', calls: [call({ output: FALSE })] }
    expect(simulationFromTrace(trace, ME).ok).toBe(false)
  })
})

describe('what must not be mistaken for a refusal', () => {
  it('a token that returns nothing — the USDT class — is ordinary', () => {
    const trace = call({ output: '0x', logs: [{ address: TOKEN, topics: [TRANSFER_TOPIC, pad(ME), pad(FRIEND)], data: amount(5n) }] })
    const sim = simulationFromTrace(trace, ME)
    expect(sim.ok).toBe(true)
    expect(sim.deltas).toHaveLength(1)
    expect(sim.deltas[0]?.amount).toBe(-5n)
  })

  it('a token that returns true is ordinary', () => {
    expect(simulationFromTrace(call({ output: TRUE }), ME).ok).toBe(true)
  })

  it('a non-bool method that happens to return zero is left alone', () => {
    // balanceOf answering 0 is a fact about the account, not a refusal.
    expect(simulationFromTrace(call({ input: '0x70a08231', output: FALSE }), ME).ok).toBe(true)
  })

  it('a frame that already carries an error is reported as the revert it is', () => {
    const sim = simulationFromTrace({ type: 'CALL', from: ME, to: TOKEN, error: 'execution reverted', revertReason: 'ERC20: insufficient balance' }, ME)
    expect(sim.ok).toBe(false)
    expect(sim.revertReason).toBe('ERC20: insufficient balance')
  })
})
