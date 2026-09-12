/**
 * How an address is written on screen (ES-BV-033).
 *
 * Two things were missing and both are the reader's only defence against an
 * address that is not the one they meant.
 *
 * EIP-55 casing is a checksum a person can see. Every wallet, explorer and
 * exchange shows it, so a reader compares a mixed-case string against a
 * mixed-case string and a single wrong character changes half the letters
 * downstream. Rendering lowercase throws that away and, worse, makes a pasted
 * lowercase address from an attacker indistinguishable from a real one.
 *
 * And the short form was `0x` plus four hex either end — which is exactly the
 * shape an address-poisoning generator is built to satisfy. Grinding a vanity
 * address that matches four leading and four trailing characters is minutes of
 * ordinary hardware; six and six is a few hundred thousand times more work,
 * and costs six characters of line.
 */
import { keccak_256 } from '@noble/hashes/sha3'

const HEX40 = /^0x[0-9a-fA-F]{40}$/

/**
 * EIP-55 casing, or the input unchanged when it is not an address.
 *
 * Deliberately total: this is called from render paths, and a label, an ENS
 * name or an empty string must come back as itself rather than throw.
 */
export function checksum(address: string): string {
  if (!HEX40.test(address)) return address
  const lower = address.slice(2).toLowerCase()
  const hash = keccak_256(new TextEncoder().encode(lower))
  let out = '0x'
  for (let i = 0; i < lower.length; i += 1) {
    const char = lower[i] as string
    // One nibble of the hash per character: high nibble for even positions.
    const nibble = i % 2 === 0 ? ((hash[i >> 1] as number) >> 4) : ((hash[i >> 1] as number) & 0x0f)
    out += nibble >= 8 ? char.toUpperCase() : char
  }
  return out
}

/**
 * The short form: six hex either side of the ellipsis, checksummed.
 *
 * Anything that is not an address — a name, a label — is returned as it came,
 * because the caller is showing it in the slot an address would occupy and a
 * truncated name is a different lie.
 */
export function shortAddress(address: string): string {
  if (!HEX40.test(address)) return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
  const full = checksum(address)
  return `${full.slice(0, 8)}…${full.slice(-6)}`
}

/** The whole thing, checksummed — for a line somebody is meant to verify. */
export function fullAddress(address: string): string {
  return checksum(address)
}

/**
 * Which characters differ between two addresses, for the lookalike plate.
 *
 * The firewall already computes this and nothing rendered it. Positions are
 * into the 40 hex characters, not counting the `0x`.
 */
export function differingAt(a: string, b: string): number[] {
  if (!HEX40.test(a) || !HEX40.test(b)) return []
  const x = a.slice(2).toLowerCase()
  const y = b.slice(2).toLowerCase()
  const out: number[] = []
  for (let i = 0; i < 40; i += 1) if (x[i] !== y[i]) out.push(i)
  return out
}
