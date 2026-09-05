/**
 * Signed statics (master plan §3.6, §3.7): a detached ed25519 signature over
 * the exact bytes, refused on any change, and the semver compare that backs
 * the minimum-version flag.
 */
import { describe, expect, it } from 'vitest'
import { FlagsSchema, ScamOriginsSchema, semverAtLeast, signStatic, staticKeyPair, verifyStatic } from '../src/statics'

const seed = new Uint8Array(32).map((_v, i) => (i * 7 + 3) & 0xff)
const keys = staticKeyPair(seed)
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('signed statics', () => {
  it('verifies exactly the signed bytes and nothing else', () => {
    const body = enc(JSON.stringify({ v: 1, issuedAt: 10, disabled: { swap: true } }))
    const sig = signStatic(body, keys.privateKeyHex)
    expect(verifyStatic(body, sig, keys.publicKeyHex)).toBe(true)
    expect(verifyStatic(enc(JSON.stringify({ v: 1, issuedAt: 10, disabled: { swap: false } })), sig, keys.publicKeyHex)).toBe(false)
    expect(verifyStatic(body, sig.replace(/^../, 'ff'), keys.publicKeyHex)).toBe(false)
    expect(verifyStatic(body, 'nope', keys.publicKeyHex)).toBe(false)
    expect(verifyStatic(body, sig)).toBe(false) // the baked-in key is not this test key
  })

  it('parses flags and the scam list with their defaults', () => {
    const f = FlagsSchema.parse({ v: 1, issuedAt: 5 })
    expect(f).toEqual({ v: 1, issuedAt: 5, minVersion: {}, disabled: {}, notice: null })
    expect(FlagsSchema.safeParse({ v: 2, issuedAt: 5 }).success).toBe(false)
    expect(ScamOriginsSchema.parse({ v: 1, issuedAt: 1, origins: ['https://free-mint.xyz'] }).origins).toEqual(['https://free-mint.xyz'])
  })

  it('compares versions the minimum-version flag way', () => {
    expect(semverAtLeast('0.1.0', '0.1.0')).toBe(true)
    expect(semverAtLeast('0.2.0', '0.1.9')).toBe(true)
    expect(semverAtLeast('0.1.0', '0.1.1')).toBe(false)
    expect(semverAtLeast('1.0.0-beta', '0.9')).toBe(true)
    expect(semverAtLeast('junk', '0.0.1')).toBe(false)
  })
})
