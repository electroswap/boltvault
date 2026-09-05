import { describe, expect, it } from 'vitest'
import {
  CONDUIT_KEY,
  SEAPORT_15,
  buildCreateOrder,
  buildFulfillOrder,
} from '../src/index.js'

describe('adapters/seaport', () => {
  const orderBytes = new Uint8Array(64).fill(7)

  it('buildFulfillOrder targets Seaport 1.5 with non-empty calldata and 0 value', () => {
    const tx = buildFulfillOrder({ order: orderBytes, offerer: `0x${'11'.repeat(20)}` })
    expect(tx.to).toBe(SEAPORT_15)
    expect(tx.data.length).toBeGreaterThan(2)
    expect(tx.data.startsWith('0x')).toBe(true)
    expect(tx.value).toBe(0n)
  })

  it('CONDUIT_KEY is ElectroSwap conduit (not OpenSea 0x7c90...)', () => {
    expect(CONDUIT_KEY).toBe(
      '0xD6Cf49CbCF84B2cd2472a376B5f791689A0769d0000000000000000000000000',
    )
    expect(CONDUIT_KEY.startsWith('0x7c90')).toBe(false)
  })

  it('buildCreateOrder returns non-empty calldata', () => {
    const tx = buildCreateOrder({ order: orderBytes })
    expect(tx.to).toBe(SEAPORT_15)
    expect(tx.data.length).toBeGreaterThan(2)
  })
})
