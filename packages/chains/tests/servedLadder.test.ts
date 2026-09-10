/**
 * The published ladder (`GET /api/wallet/fees`) and, mostly, the rule that
 * makes reading it over the network safe: it may lower a fee and may never
 * raise one.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { applyServedLadder, bundledFeeConfig, clearServedLadder, feeRecipient, tierLadder, tierName, walletFeeConfig, type ServedLadder } from '../src/fees'

const MAINNET = 52014
const bolt = (whole: number): string => `${BigInt(whole) * 10n ** 18n}`

/** The bundled ladder, restated as something a service could have sent. */
function asServed(): ServedLadder {
  const c = bundledFeeConfig(MAINNET)
  if (!c) throw new Error('no bundled config')
  return {
    baseName: c.baseName,
    baseBips: c.baseBips,
    tiers: c.tiers.map((t) => ({ name: t.name, minScore: t.minScore, bips: t.bips })),
    dynoWeight: c.dynoWeight,
    dynoWeightBand: c.dynoWeightBand,
    countFarmBolt: c.countFarmBolt,
  }
}

describe('served fee ladder', () => {
  beforeEach(() => clearServedLadder(MAINNET))

  it('takes a ladder that is cheaper everywhere', () => {
    const base = asServed()
    const cheaper: ServedLadder = { ...base, tiers: base.tiers.map((t) => ({ ...t, bips: t.bips - 2 })) }
    expect(applyServedLadder(MAINNET, cheaper)).toBe(true)
    expect(walletFeeConfig(MAINNET)?.tiers[0]?.bips).toBe(base.tiers[0]!.bips - 2)
  })

  it('refuses a ladder that would raise the base rate', () => {
    const dearer: ServedLadder = { ...asServed(), baseBips: 80 }
    expect(applyServedLadder(MAINNET, dearer)).toBe(false)
    expect(walletFeeConfig(MAINNET)?.baseBips).toBe(bundledFeeConfig(MAINNET)?.baseBips)
  })

  it('refuses a ladder that is dearer only between its own rungs', () => {
    // Cheap at every threshold it declares, but it has moved the discounts so
    // far up that a holder sitting between them pays more than the build says.
    // Checking the union of both ladders' thresholds is what catches this.
    const dearerInTheMiddle: ServedLadder = {
      ...asServed(),
      tiers: [
        { name: 'Charge', minScore: bolt(900_000), bips: 40 },
        { name: 'Magneto', minScore: bolt(1_000_000), bips: 30 },
        { name: 'Turbine', minScore: bolt(1_100_000), bips: 20 },
        { name: 'Reactor', minScore: bolt(1_200_000), bips: 10 },
      ],
    }
    expect(applyServedLadder(MAINNET, dearerInTheMiddle)).toBe(false)
  })

  it('refuses a rung at zero bips, which PAY_PORTION reverts on', () => {
    const base = asServed()
    const zeroed: ServedLadder = { ...base, tiers: base.tiers.map((t, i) => (i === base.tiers.length - 1 ? { ...t, bips: 0 } : t)) }
    expect(applyServedLadder(MAINNET, zeroed)).toBe(false)
  })

  it('refuses a ladder whose rungs do not climb', () => {
    const base = asServed()
    const unsorted: ServedLadder = { ...base, tiers: [...base.tiers].reverse() }
    expect(applyServedLadder(MAINNET, unsorted)).toBe(false)
  })

  /** A fee destination the service could move is one an attacker could move. */
  it('never takes the recipient from a served ladder', () => {
    const built = feeRecipient(MAINNET)
    const base = asServed()
    const withRecipient = { ...base, recipient: '0x000000000000000000000000000000000000dEaD' } as unknown as ServedLadder
    expect(applyServedLadder(MAINNET, withRecipient)).toBe(true)
    expect(feeRecipient(MAINNET)).toBe(built)
  })

  it('renames the rungs the fee sheet shows', () => {
    const base = asServed()
    const renamed: ServedLadder = { ...base, tiers: base.tiers.map((t, i) => (i === 0 ? { ...t, name: 'Kite' } : t)) }
    expect(applyServedLadder(MAINNET, renamed)).toBe(true)
    expect(tierName(MAINNET, 1)).toBe('Kite')
    clearServedLadder(MAINNET)
    expect(tierName(MAINNET, 1)).toBe('Charge')
  })

  it('goes back to the build when the served ladder is cleared', () => {
    const before = tierLadder(MAINNET)
    const base = asServed()
    expect(applyServedLadder(MAINNET, { ...base, tiers: base.tiers.map((t) => ({ ...t, bips: t.bips - 1 })) })).toBe(true)
    clearServedLadder(MAINNET)
    expect(tierLadder(MAINNET)).toEqual(before)
  })

  it('has nothing to override on a chain with no in-wallet swap', () => {
    expect(applyServedLadder(1, asServed())).toBe(false)
  })

  /** The rung names must stay clear of the API credit tiers and the DYNO token. */
  it('ships names that collide with nothing', () => {
    const names = tierLadder(MAINNET).map((t) => t.name.toLowerCase())
    for (const taken of ['spark', 'arc', 'surge', 'storm', 'dynamo', 'dyno', 'bolt']) {
      expect(names).not.toContain(taken)
    }
  })
})
