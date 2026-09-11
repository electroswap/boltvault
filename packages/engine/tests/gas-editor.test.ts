/**
 * Changing the network fee on the signing sheet (§8.4, §8.15).
 *
 * The fee has always been a readout. Making it editable means letting a page
 * influence what gets signed, so the rules that make that safe are all here
 * rather than in the sheet: only the price of gas can move, it is clamped into
 * a band at the point of use rather than trusted from the page, and everything
 * that says what the transaction DOES — to, value, data, nonce — is untouchable
 * from a decision payload.
 *
 * The floor is the part worth being precise about. A wallet that lets someone
 * set a fee no block can include has not saved them money; it has taken their
 * transaction away and left it looking submitted.
 */
import { describe, expect, it } from 'vitest'
import { GAS_CEILING_PERCENT, GAS_FLOOR_PERCENT, applyGasDecision, clampPerGas, gasBand, suggestedPerGas, type PreparedTx } from '../src'

/** A node on a chain with a base fee: suggestion = base × 2 + tip. */
const BASE = 1_000_000_000n
const TIP = 100_000_000n
const SUGGESTED = BASE * 2n + TIP

const eip1559: PreparedTx = {
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  value: '0x0',
  data: '0xa9059cbb',
  nonce: 7,
  gas: '0x5208',
  type: 'eip1559',
  maxFeePerGas: `0x${SUGGESTED.toString(16)}`,
  maxPriorityFeePerGas: `0x${TIP.toString(16)}`,
}

const legacy: PreparedTx = { ...eip1559, type: 'legacy', gasPrice: '0x77359400', maxFeePerGas: undefined, maxPriorityFeePerGas: undefined }

const hex = (n: bigint): string => `0x${n.toString(16)}`

describe('the band a hand-set fee has to stay inside', () => {
  /*
    Half the suggestion is a shade above the current base fee, because the
    suggestion is base × 2 + tip. That is the real boundary: a ceiling under the
    base fee cannot be included in any block, ever.
  */
  it('floors at half the node’s suggestion, which is just above the base fee', () => {
    const band = gasBand(eip1559)
    expect(band.suggested).toBe(SUGGESTED)
    expect(band.floor).toBe((SUGGESTED * BigInt(GAS_FLOOR_PERCENT)) / 100n)
    expect(band.floor).toBeGreaterThan(BASE)
    expect(band.ceiling).toBe((SUGGESTED * BigInt(GAS_CEILING_PERCENT)) / 100n)
  })

  it('reads the suggestion from whichever fee model the chain uses', () => {
    expect(suggestedPerGas(eip1559)).toBe(SUGGESTED)
    expect(suggestedPerGas(legacy)).toBe(BigInt('0x77359400'))
  })

  it('lifts anything under the floor and trims anything over the ceiling', () => {
    expect(clampPerGas(eip1559, 0n)).toBe(gasBand(eip1559).floor)
    expect(clampPerGas(eip1559, 1n)).toBe(gasBand(eip1559).floor)
    expect(clampPerGas(eip1559, SUGGESTED * 1000n)).toBe(gasBand(eip1559).ceiling)
    // Inside the band, the user's number is the user's number.
    expect(clampPerGas(eip1559, (SUGGESTED * 70n) / 100n)).toBe((SUGGESTED * 70n) / 100n)
    expect(clampPerGas(eip1559, SUGGESTED * 2n)).toBe(SUGGESTED * 2n)
  })
})

describe('what a decision may and may not change', () => {
  it('applies a chosen ceiling, and scales nothing else', () => {
    const chosen = (SUGGESTED * 150n) / 100n
    const applied = applyGasDecision(eip1559, { maxFeePerGas: hex(chosen), maxPriorityFeePerGas: hex((TIP * 150n) / 100n) })
    expect(applied).toEqual({ maxFeePerGas: hex(chosen), maxPriorityFeePerGas: hex((TIP * 150n) / 100n) })
  })

  /*
    The dangerous direction. A page that asks for a fee of 1 wei is asking for a
    transaction that looks submitted and never lands, so the number that reaches
    the signer is the floor, not the one the page sent.
  */
  it('will not sign a fee that can never be mined, however the page asks', () => {
    const floor = gasBand(eip1559).floor
    for (const asked of [0n, 1n, BASE / 2n, floor - 1n]) {
      expect(applyGasDecision(eip1559, { maxFeePerGas: hex(asked) })?.maxFeePerGas, asked.toString()).toBe(hex(floor))
    }
  })

  it('will not sign an accidental overpay either', () => {
    const ceiling = gasBand(eip1559).ceiling
    expect(applyGasDecision(eip1559, { maxFeePerGas: hex(SUGGESTED * 500n) })?.maxFeePerGas).toBe(hex(ceiling))
  })

  /*
    A tip is paid out of the ceiling it sits under. A lowered ceiling with the
    original tip still attached is not a cheaper transaction; on most nodes it
    is a rejected one.
  */
  it('never leaves a tip larger than the ceiling it is paid from', () => {
    const low = gasBand(eip1559).floor
    const applied = applyGasDecision(eip1559, { maxFeePerGas: hex(low) })
    expect(BigInt(applied?.maxPriorityFeePerGas ?? '0x0')).toBeLessThanOrEqual(BigInt(applied?.maxFeePerGas ?? '0x0'))
    const explicit = applyGasDecision(eip1559, { maxFeePerGas: hex(low), maxPriorityFeePerGas: hex(low * 10n) })
    expect(explicit?.maxPriorityFeePerGas).toBe(hex(low))
  })

  it('speaks the legacy fee model on a chain with no base fee', () => {
    const suggested = BigInt('0x77359400')
    expect(applyGasDecision(legacy, { gasPrice: hex(suggested / 4n) })).toEqual({ gasPrice: hex((suggested * BigInt(GAS_FLOOR_PERCENT)) / 100n) })
    // And does not answer in the other model's fields, which the signer would ignore.
    expect(applyGasDecision(legacy, { maxFeePerGas: hex(suggested) })).toBeNull()
    expect(applyGasDecision(eip1559, { gasPrice: hex(suggested) })).toBeNull()
  })

  /*
    Null is the "sign what you prepared" answer, and it has to cover every way a
    decision can arrive carrying no fee — including the Connect sheet's payload,
    which is the other thing that travels on this field.
  */
  it('answers "nothing chosen" for anything that is not a fee', () => {
    for (const data of [undefined, null, {}, 'faster', 42, { accountId: 'acct-1', chainId: 52014 }, { maxFeePerGas: 'not hex' }, { maxFeePerGas: 12 }]) {
      expect(applyGasDecision(eip1559, data), JSON.stringify(data) ?? 'undefined').toBeNull()
    }
  })

  /*
    The point of the whole shape: a decision payload cannot reach anything that
    says what the transaction does. `applyGasDecision` returns fee fields and
    only fee fields, so a caller merging its answer cannot be handed a new
    recipient, a new amount, new calldata or a new nonce.
  */
  it('can only ever answer with fee fields', () => {
    const hostile = { maxFeePerGas: hex(SUGGESTED), to: '0x9999999999999999999999999999999999999999', value: '0xde0b6b3a7640000', data: '0xdeadbeef', nonce: 99, gas: '0xffffff', from: '0x9999999999999999999999999999999999999999' }
    const applied = applyGasDecision(eip1559, hostile)
    expect(Object.keys(applied ?? {}).sort()).toEqual(['maxFeePerGas', 'maxPriorityFeePerGas'])
    const merged = { ...eip1559, ...applied }
    expect(merged.to).toBe(eip1559.to)
    expect(merged.value).toBe(eip1559.value)
    expect(merged.data).toBe(eip1559.data)
    expect(merged.nonce).toBe(eip1559.nonce)
    expect(merged.gas).toBe(eip1559.gas)
  })
})
