/**
 * Address poisoning (master plan §3.6). The reference set is only addresses
 * the user has *sent to*, address-book entries and the user's own accounts —
 * never inbound-only senders, or a poisoner's dust would invert the rule.
 */
import type { Hex } from './types'

export interface PoisonResult {
  readonly hit: boolean
  /** The reference address the recipient imitates, as stored. */
  readonly match: Hex | null
  /** Nibble positions (0-based, after 0x) where the two differ — for highlighting. */
  readonly differing: readonly number[]
}

/** The 4+4 rule: same first 4 and last 4 nibbles, anything else different → blocked. */
export function poisonCheck(recipient: string, reference: readonly Hex[]): PoisonResult {
  const r = recipient.trim().toLowerCase().replace(/^0x/, '')
  for (const known of reference) {
    const k = known.trim().toLowerCase().replace(/^0x/, '')
    if (r === k) continue
    if (r.length === 40 && k.length === 40 && r.slice(0, 4) === k.slice(0, 4) && r.slice(-4) === k.slice(-4)) {
      const differing: number[] = []
      for (let i = 0; i < 40; i++) if (r[i] !== k[i]) differing.push(i)
      return { hit: true, match: known, differing }
    }
  }
  return { hit: false, match: null, differing: [] }
}

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function inSet(address: string, set: readonly string[]): boolean {
  const a = address.toLowerCase()
  return set.some((s) => s.toLowerCase() === a)
}
