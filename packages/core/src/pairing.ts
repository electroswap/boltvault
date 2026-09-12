/**
 * Device pairing and sync crypto (master plan §6).
 *
 * - Pairing: X25519 key agreement between two devices that see each other's
 *   public key through a QR; both derive the same shared secret and show the
 *   same 6-digit SAS, which the user confirms on both devices (a relay-side
 *   MITM would produce two different codes).
 * - Every device has an Ed25519 signing key; every synced record is signed by
 *   its author so a compromised relay cannot forge records and the receiver
 *   can show provenance.
 * - Records travel as XChaCha20-Poly1305 under a channel key derived from the
 *   shared secret. Secrets (seeds, keys) never travel this way (§6).
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { ed25519, x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { fromHex, randomBytes, toHex } from './vault.js'

const enc = new TextEncoder()
const dec = new TextDecoder()

export interface DeviceIdentity {
  readonly deviceId: string
  /** Ed25519 signing key (private, hex) — stays on this device. */
  readonly signingPrivateKey: string
  readonly signingPublicKey: string
}

export function createDeviceIdentity(
  random: (n: number) => Uint8Array = randomBytes,
): DeviceIdentity {
  const priv = random(32)
  return {
    deviceId: toHex(random(8)),
    signingPrivateKey: toHex(priv),
    signingPublicKey: toHex(ed25519.getPublicKey(priv)),
  }
}

export interface PairingOffer {
  readonly v: 1
  readonly kind: 'boltvault-pair'
  readonly pairingId: string
  readonly deviceId: string
  readonly x25519PublicKey: string
  readonly signingPublicKey: string
  readonly relayUrl: string
  readonly expiresAt: number
}

export interface PairingKeys {
  readonly x25519PrivateKey: string
  readonly x25519PublicKey: string
}

export function createPairingKeys(random: (n: number) => Uint8Array = randomBytes): PairingKeys {
  const priv = random(32)
  return { x25519PrivateKey: toHex(priv), x25519PublicKey: toHex(x25519.getPublicKey(priv)) }
}

export function createPairingOffer(
  me: DeviceIdentity,
  keys: PairingKeys,
  relayUrl: string,
  ttlMs = 10 * 60_000,
  now = Date.now(),
  random: (n: number) => Uint8Array = randomBytes,
): PairingOffer {
  return {
    v: 1,
    kind: 'boltvault-pair',
    pairingId: toHex(random(16)),
    deviceId: me.deviceId,
    x25519PublicKey: keys.x25519PublicKey,
    signingPublicKey: me.signingPublicKey,
    relayUrl,
    expiresAt: now + ttlMs,
  }
}

export function parsePairingOffer(raw: string): PairingOffer | null {
  try {
    const o = JSON.parse(raw) as Partial<PairingOffer>
    if (o.v !== 1 || o.kind !== 'boltvault-pair') return null
    if (
      typeof o.pairingId !== 'string' ||
      typeof o.deviceId !== 'string' ||
      typeof o.x25519PublicKey !== 'string' ||
      typeof o.signingPublicKey !== 'string' ||
      typeof o.relayUrl !== 'string' ||
      typeof o.expiresAt !== 'number'
    )
      return null
    return o as PairingOffer
  } catch {
    return null
  }
}

export interface Channel {
  readonly pairingId: string
  /** Symmetric channel key, hex. Derived identically on both devices. */
  readonly key: string
  /** The 6-digit short authentication string both devices display. */
  readonly sas: string
}

/** Both sides call this with their own private key and the peer's public key. */
export function deriveChannel(
  pairingId: string,
  myX25519Private: string,
  peerX25519Public: string,
): Channel {
  const shared = x25519.getSharedSecret(fromHex(myX25519Private), fromHex(peerX25519Public))
  const salt = enc.encode(pairingId)
  const key = hkdf(sha256, shared, salt, enc.encode('bv/sync/channel/v1'), 32)
  const sasBytes = hkdf(sha256, shared, salt, enc.encode('bv/sync/sas/v1'), 4)
  const n = ((sasBytes[0]! << 24) >>> 0) + (sasBytes[1]! << 16) + (sasBytes[2]! << 8) + sasBytes[3]!
  return { pairingId, key: toHex(key), sas: String(n % 1_000_000).padStart(6, '0') }
}

export interface SyncRecord {
  /** e.g. 'addressBook', 'customToken', 'siteChain', 'settings', 'watchAccount' */
  readonly collection: string
  readonly key: string
  /** JSON value; null is a tombstone. */
  readonly value: unknown
  /**
   * The author's own sequence number at the moment it wrote this record
   * (master plan §6: "last-writer-wins per key using per-device sequence
   * numbers (no vector clocks)"). Raised past anything the device has seen, so
   * two devices' counters stay comparable without a shared clock.
   */
  readonly seq: number
  readonly authorDeviceId: string
  readonly authorLabel: string
  /**
   * The author's wall clock, for provenance only — "from Pixel 8, 3 May". It
   * must never decide a conflict: phone clocks disagree, NTP steps backwards,
   * and a device with a fast clock would otherwise win every merge forever.
   */
  readonly at: number
}

/** Everything needed to order one record against another. */
export interface RecordStamp {
  readonly seq: number
  readonly authorDeviceId: string
}

/**
 * A Lamport step: whatever this device has seen, its next write is later than.
 * Without this the two counters drift apart and the comparison below stops
 * meaning anything.
 */
export function nextSeq(ownSeq: number, highestSeen: number): number {
  return Math.max(ownSeq, highestSeen) + 1
}

/**
 * Last-writer-wins for one key. The device id breaks a tie so that both sides
 * of a concurrent edit pick the same winner and the two devices converge —
 * an arbitrary rule, but an agreed one.
 */
export function recordWins(incoming: RecordStamp, current: RecordStamp | null): boolean {
  if (!current) return true
  if (incoming.seq !== current.seq) return incoming.seq > current.seq
  return incoming.authorDeviceId > current.authorDeviceId
}

/** A delete travels as a null value, so the other device can tell "gone" from "never had it". */
export function isTombstone(record: SyncRecord): boolean {
  return record.value === null
}

export interface SealedRecord {
  readonly pairingId: string
  readonly seq: number
  readonly nonce: string
  readonly ct: string
  /** Ed25519 signature over `pairingId|seq|nonce|ct`, by the author device. */
  readonly sig: string
  readonly authorSigningPublicKey: string
}

function signedBytes(r: Omit<SealedRecord, 'sig' | 'authorSigningPublicKey'>): Uint8Array {
  return enc.encode(`${r.pairingId}|${r.seq}|${r.nonce}|${r.ct}`)
}

export function sealRecord(
  channel: Channel,
  author: DeviceIdentity,
  record: SyncRecord,
  random: (n: number) => Uint8Array = randomBytes,
): SealedRecord {
  const nonce = random(24)
  const ct = xchacha20poly1305(fromHex(channel.key), nonce, enc.encode(channel.pairingId)).encrypt(
    enc.encode(JSON.stringify(record)),
  )
  const base = { pairingId: channel.pairingId, seq: record.seq, nonce: toHex(nonce), ct: toHex(ct) }
  const sig = ed25519.sign(signedBytes(base), fromHex(author.signingPrivateKey))
  return { ...base, sig: toHex(sig), authorSigningPublicKey: author.signingPublicKey }
}

/**
 * Verify the signature against the *paired* device's known key (never the
 * key inside the record), then decrypt. Null on any failure.
 */
export function openRecord(
  channel: Channel,
  trustedPeerSigningPublicKey: string,
  sealed: SealedRecord,
): SyncRecord | null {
  if (sealed.pairingId !== channel.pairingId) return null
  if (sealed.authorSigningPublicKey !== trustedPeerSigningPublicKey) return null
  const ok = ed25519.verify(
    fromHex(sealed.sig),
    signedBytes(sealed),
    fromHex(trustedPeerSigningPublicKey),
  )
  if (!ok) return null
  try {
    const pt = xchacha20poly1305(
      fromHex(channel.key),
      fromHex(sealed.nonce),
      enc.encode(channel.pairingId),
    ).decrypt(fromHex(sealed.ct))
    const rec = JSON.parse(dec.decode(pt)) as SyncRecord
    return rec.seq === sealed.seq ? rec : null
  } catch {
    return null
  }
}
