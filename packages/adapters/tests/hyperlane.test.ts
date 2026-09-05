import { describe, expect, it } from 'vitest'
import { buildDispatch, ICA_ROUTER, pollProcess } from '../src/index.js'

describe('adapters/hyperlane', () => {
  const dest = `0x${'aa'.repeat(20)}`
  const recipient = `0x${'bb'.repeat(20)}`
  const amount = 12345n

  it('buildDispatch returns calldata + 32-byte messageId + value === amount', () => {
    const tx = buildDispatch({ destination: dest, recipient, amount })
    expect(tx.to).toBe(ICA_ROUTER)
    expect(tx.data.length).toBeGreaterThan(2)
    expect(tx.data.startsWith('0x')).toBe(true)
    expect(tx.value).toBe(amount)
    // 32-byte hex: '0x' + 64 hex chars = 66 total
    expect(tx.messageId).toHaveLength(66)
    expect(tx.messageId).toMatch(/^0x[0-9a-fA-F]{64}$/)
  })

  it('pollProcess is true when messageId is present in log data', () => {
    const tx = buildDispatch({ destination: dest, recipient, amount })
    const fixture = [{ topics: [], data: `0x${'cc'.repeat(4)}` }]
    // messageId is keccak of calldata; embed it in the fixture data
    const log = { topics: [], data: `0x${tx.messageId.slice(2)}` }
    expect(pollProcess([log], tx.messageId)).toBe(true)
    expect(pollProcess(fixture, tx.messageId)).toBe(false)
  })

  it('pollProcess is true when messageId appears in a topic', () => {
    const tx = buildDispatch({ destination: dest, recipient, amount })
    const log = { topics: [tx.messageId], data: '0x' }
    expect(pollProcess([log], tx.messageId)).toBe(true)
  })

  it('pollProcess is false for empty logs or absent id', () => {
    const tx = buildDispatch({ destination: dest, recipient, amount })
    expect(pollProcess([], tx.messageId)).toBe(false)
    expect(pollProcess([{ topics: [null], data: '0x' }], tx.messageId)).toBe(false)
  })
})
