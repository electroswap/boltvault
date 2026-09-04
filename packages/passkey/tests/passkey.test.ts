import { describe, expect, it } from 'vitest'
import {
  hkdf,
  unlockMode,
  unlockLabel,
  passkeyAlone,
  deriveWrapKeyFromPRF,
  passkeyRegistration,
  passkeyGetOptions,
  SHA256_LEN,
  type Hmac,
} from '../src'

/** Deterministic 32-byte "HMAC" stub (mixes key + data) — good enough for HKDF property tests. */
const stubHmac: Hmac = async (key, data) => {
  const out = new Uint8Array(32)
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key[i] ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  for (let i = 0; i < 32; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0
    out[i] = h & 0xff
  }
  return out
}

const IKM = new Uint8Array(32).fill(7)

describe('hkdf (T6.5, injectable HMAC)', () => {
  it('returns the requested length and is deterministic', async () => {
    const a = await hkdf(IKM, { length: 32, hmac: stubHmac })
    const b = await hkdf(IKM, { length: 32, hmac: stubHmac })
    expect(a).toHaveLength(32)
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'))
  })

  it('produces different output for different info', async () => {
    const a = await hkdf(IKM, { length: 32, info: new TextEncoder().encode('A'), hmac: stubHmac })
    const b = await hkdf(IKM, { length: 32, info: new TextEncoder().encode('B'), hmac: stubHmac })
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'))
  })

  it('supports multi-block expansion (length > 32)', async () => {
    const out = await hkdf(IKM, { length: 64, hmac: stubHmac })
    expect(out).toHaveLength(64)
  })
})

describe('unlock mode + labels (T6.5)', () => {
  it('PRF present → passkey alone unlocks; label "Unlock with passkey"', () => {
    const mode = unlockMode(true)
    expect(mode).toBe('prf')
    expect(passkeyAlone(mode)).toBe(true)
    expect(unlockLabel(mode)).toBe('Unlock with passkey')
  })

  it('no PRF → passkey + password; distinct label', () => {
    const mode = unlockMode(false)
    expect(mode).toBe('passkey-plus-password')
    expect(passkeyAlone(mode)).toBe(false)
    expect(unlockLabel(mode)).toBe('Passkey + password')
  })

  it('the two labels are visibly different (design: do not look identical)', () => {
    expect(unlockLabel('prf')).not.toBe(unlockLabel('passkey-plus-password'))
  })
})

describe('deriveWrapKeyFromPRF (T6.5)', () => {
  it('derives a 32-byte wrap key, deterministic for a given PRF secret', async () => {
    const secret = new Uint8Array(32).fill(9)
    const k1 = await deriveWrapKeyFromPRF(secret, stubHmac)
    const k2 = await deriveWrapKeyFromPRF(secret, stubHmac)
    expect(k1).toHaveLength(SHA256_LEN)
    expect(Buffer.from(k1).toString('hex')).toBe(Buffer.from(k2).toString('hex'))
  })
})

describe('WebAuthn credential builders (T6.5)', () => {
  it('registration requests the prf extension + resident key', () => {
    const opts = passkeyRegistration({
      challenge: new Uint8Array(32),
      userName: 'brad@example.com',
      displayName: 'Brad',
      rpId: 'boltvault.local',
      requestPrt: true,
    })
    expect(opts.challenge).toHaveLength(32)
    expect(opts.user.name).toBe('brad@example.com')
    expect(opts.rp.name).toBe('boltvault.local')
    expect(opts.authenticatorSelection.residentKey).toBe('preferred')
    expect(opts.extensions.prf).toBeTruthy()
    expect(opts.pubKeyCredParams.some((p) => p.alg === -7)).toBe(true) // ES256
  })

  it('get options carry the challenge + preferred verification', () => {
    const challenge = new Uint8Array(32).fill(1)
    const opts = passkeyGetOptions(challenge)
    expect(opts.challenge).toBe(challenge)
    expect(opts.userVerification).toBe('preferred')
    expect(opts.timeout).toBe(60_000)
  })
})
