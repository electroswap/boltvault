import { describe, expect, it } from 'vitest'

/**
 * Infrastructure smoke test — proves the per-package vitest + TS pipeline works.
 * Each package keeps one such test until real tests land in T0.2+.
 */
describe('bolt-vault test infra', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
