import { describe, it, expect } from 'vitest'
import { buildAllowanceProbe } from '../src/scan'
import { knownSpenters } from '../src/known-spenters'

const OWNER = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'
const TOKENS = [
  '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e',
  '0x48E722f1458b253c2FB0E573F939318D7Dbd54e7',
]

describe('buildAllowanceProbe', () => {
  it('builds tokens × 6 spenders probes (2 tokens → 12 probes)', () => {
    const { probes } = buildAllowanceProbe(OWNER, TOKENS, 52014)
    expect(probes).toHaveLength(TOKENS.length * 6)
    expect(probes).toHaveLength(12)
  })

  it('threads the owner through for the caller to encode allowance(owner, spender)', () => {
    const { owner, probes } = buildAllowanceProbe(OWNER, TOKENS, 52014)
    expect(owner).toBe(OWNER)
    // owner is constant for the scan; every probe pairs a token with a known spender
    for (const p of probes) {
      expect(TOKENS).toContain(p.token)
      expect(knownSpenters(52014).some((s) => s.address === p.spender)).toBe(true)
    }
  })

  it('covers every known spender kind per token', () => {
    const { probes } = buildAllowanceProbe(OWNER, [TOKENS[0]!], 52014)
    const kinds = new Set(probes.map((p) => p.spenderKind))
    expect(kinds).toEqual(
      new Set(['permit2', 'universal-router', 'swap-router02', 'v2-router', 'seaport', 'farm']),
    )
    // each token is probed against exactly 6 distinct known spenders
    expect(probes).toHaveLength(6)
    expect(new Set(probes.map((p) => p.spender)).size).toBe(6)
  })

  it('returns empty probes for an empty token list', () => {
    const { probes } = buildAllowanceProbe(OWNER, [], 52014)
    expect(probes).toHaveLength(0)
  })

  it('throws for a non-ETN chain id', () => {
    expect(() => buildAllowanceProbe(OWNER, TOKENS, 1)).toThrow()
  })
})
