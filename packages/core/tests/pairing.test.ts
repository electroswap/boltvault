import { describe, expect, it } from 'vitest'
import { createDeviceIdentity, createPairingKeys, createPairingOffer, deriveChannel, openRecord, parsePairingOffer, sealRecord, type SyncRecord } from '../src/pairing'

describe('pairing', () => {
  it('both devices derive the same channel and SAS; a MITM gets a different SAS', () => {
    const a = createDeviceIdentity()
    const b = createDeviceIdentity()
    const ka = createPairingKeys()
    const kb = createPairingKeys()
    const offer = createPairingOffer(a, ka, 'https://electroswap.io/api/wallet/sync', 60_000, 1000)
    const parsed = parsePairingOffer(JSON.stringify(offer))
    expect(parsed?.pairingId).toBe(offer.pairingId)
    expect(parsePairingOffer('{"v":1,"kind":"nope"}')).toBeNull()

    const chA = deriveChannel(offer.pairingId, ka.x25519PrivateKey, kb.x25519PublicKey)
    const chB = deriveChannel(offer.pairingId, kb.x25519PrivateKey, ka.x25519PublicKey)
    expect(chA.key).toBe(chB.key)
    expect(chA.sas).toBe(chB.sas)
    expect(chA.sas).toMatch(/^\d{6}$/)

    const mallory = createPairingKeys()
    const chAM = deriveChannel(offer.pairingId, ka.x25519PrivateKey, mallory.x25519PublicKey)
    expect(chAM.sas).not.toBe(chB.sas)
    void b
  })

  it('records are signed by the author and rejected when forged, replayed under another key, or tampered', () => {
    const a = createDeviceIdentity()
    const b = createDeviceIdentity()
    const ka = createPairingKeys()
    const kb = createPairingKeys()
    const ch = deriveChannel('p1', ka.x25519PrivateKey, kb.x25519PublicKey)
    const record: SyncRecord = { collection: 'addressBook', key: 'mum', value: { address: '0x1234', label: 'Mum' }, seq: 3, authorDeviceId: a.deviceId, authorLabel: 'Pixel 8', at: 5 }
    const sealed = sealRecord(ch, a, record)
    expect(openRecord(ch, a.signingPublicKey, sealed)).toEqual(record)
    // the receiver trusts only the paired device's key
    expect(openRecord(ch, b.signingPublicKey, sealed)).toBeNull()
    // a forger signing with their own key and claiming a's key fails verification
    const forged = { ...sealRecord(ch, b, record), authorSigningPublicKey: a.signingPublicKey }
    expect(openRecord(ch, a.signingPublicKey, forged)).toBeNull()
    // tampered ciphertext
    expect(openRecord(ch, a.signingPublicKey, { ...sealed, ct: sealed.ct.replace(/^../, 'ff') })).toBeNull()
    // wrong channel
    const other = deriveChannel('p2', ka.x25519PrivateKey, kb.x25519PublicKey)
    expect(openRecord(other, a.signingPublicKey, sealed)).toBeNull()
  })
})
