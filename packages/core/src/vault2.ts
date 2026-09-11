/**
 * VaultFileV2 — one random DEK, wrapped independently by any unlock factor
 * (master plan §3.2).
 *
 *   password ─argon2id─▶ KEK_pw ─┐
 *   passkey PRF ─HKDF──▶ KEK_pk ─┤ any one wrap unseals the DEK
 *   device key ─HKDF──▶ KEK_dev ─┘
 *                                 ▼
 *                 DEK (32 B) seals the plaintext: seeds, keys, accounts, backup state
 *
 * Why v2 exists: with v1 every metadata edit needed the password (a fresh
 * Argon2id run) because the plaintext was sealed directly under the password
 * key. With a DEK held in the session, renaming an account or deriving a new
 * one reseals in microseconds and never touches a KDF; rotating a password
 * re-wraps 32 bytes instead of re-encrypting the seeds; passkeys and device
 * keys coexist and can be added or removed independently.
 *
 * Crypto: @noble only. The KDF is injected (`Argon2idFn`) so the extension
 * (hash-wasm) and mobile (libsodium) share this file byte-for-byte.
 */
import { wordlist } from '@scure/bip39/wordlists/english'
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import type { AccountId, AccountKind, VaultFileV1 } from './types.js'
import { fromHex, kdfArgon2id, openVault, randomBytes, toHex, type Argon2idParams } from './vault.js'

export const VAULT2_VERSION = 2 as const

export interface Argon2idInput {
  readonly password: Uint8Array
  readonly salt: Uint8Array
  readonly memoryKiB: number
  readonly iterations: number
  readonly parallelism: number
  readonly hashLength: number
}
export type Argon2idFn = (input: Argon2idInput) => Promise<Uint8Array>

export interface VaultCrypto {
  readonly argon2id: Argon2idFn
  readonly random: (bytes: number) => Uint8Array
}

/** Defaults that match v1 (hash-wasm in the extension). */
export const defaultVaultCrypto: VaultCrypto = {
  argon2id: (i) =>
    kdfArgon2id(new TextDecoder().decode(i.password), i.salt, { m: i.memoryKiB, t: i.iterations, p: i.parallelism }).then((k) => k.slice(0, i.hashLength)),
  random: randomBytes,
}

// ---- plaintext ---------------------------------------------------------------

export interface VaultSeed {
  readonly id: string
  readonly label: string
  readonly mnemonic: string
  readonly seedHex: string
  /** BIP-39 passphrase ("25th word") if the user set one. */
  readonly passphrase?: string
  /** Null until the quiz (or a hardware verify) confirms the backup. */
  readonly backedUpAt: number | null
  readonly createdAt: number
}

export interface VaultAccountV2 {
  readonly id: AccountId
  readonly kind: AccountKind | 'keystone'
  readonly label: string
  readonly address: string
  /** HD accounts: which seed and which BIP-44 index. */
  readonly seedId?: string
  readonly index?: number
  readonly hardware?: { readonly path: string; readonly deviceId?: string }
  readonly hidden: boolean
  readonly order: number
  readonly createdAt: number
}

export interface VaultPlaintextV2 {
  readonly v: 2
  readonly seeds: readonly VaultSeed[]
  /** Imported 32-byte keys, 0x-hex, keyed by account id. */
  readonly importedKeys: Readonly<Record<AccountId, `0x${string}`>>
  readonly accounts: readonly VaultAccountV2[]
}

export function emptyPlaintextV2(): VaultPlaintextV2 {
  return { v: 2, seeds: [], importedKeys: {}, accounts: [] }
}

// ---- file -------------------------------------------------------------------

export type WrapKind = 'password' | 'prf' | 'device'

export interface VaultWrap {
  readonly by: WrapKind
  /** 'password' for the password wrap; credential id for prf; key id for device. */
  readonly id: string
  /** Password wraps only. */
  readonly kdf?: { readonly alg: 'argon2id'; readonly salt: string; readonly m: number; readonly t: number; readonly p: number }
  /** HKDF salt for prf/device wraps (hex). */
  readonly salt?: string
  readonly nonce: string
  readonly ct: string
  readonly createdAt: number
}

export interface VaultFileV2 {
  readonly v: 2
  readonly id: string
  readonly wraps: readonly VaultWrap[]
  readonly nonce: string
  readonly ct: string
  readonly createdAt: number
  readonly updatedAt: number
}

const enc = new TextEncoder()
const dec = new TextDecoder()

const b64 = {
  encode: (u8: Uint8Array): string => (typeof btoa === 'function' ? btoa(String.fromCharCode(...u8)) : Buffer.from(u8).toString('base64')),
  decode: (s: string): Uint8Array => {
    const b = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary')
    const u8 = new Uint8Array(b.length)
    for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i)
    return u8
  },
}

function aadFile(vaultId: string): Uint8Array {
  return enc.encode(`boltvault.v2.${vaultId}`)
}
function aadWrap(vaultId: string, wrapId: string): Uint8Array {
  return enc.encode(`boltvault.v2.wrap.${vaultId}.${wrapId}`)
}

function seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): string {
  return b64.encode(xchacha20poly1305(key, nonce, aad).encrypt(plaintext))
}
function open(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ct: string): Uint8Array | null {
  try {
    return xchacha20poly1305(key, nonce, aad).decrypt(b64.decode(ct))
  } catch {
    return null
  }
}

export type UnlockWith = { readonly password: string } | { readonly prfSecret: Uint8Array; readonly credentialId: string } | { readonly deviceKey: Uint8Array; readonly keyId: string }

async function kekFor(crypto: VaultCrypto, wrap: VaultWrap, unlock: UnlockWith): Promise<Uint8Array | null> {
  if ('password' in unlock) {
    if (wrap.by !== 'password' || !wrap.kdf) return null
    return crypto.argon2id({ password: enc.encode(unlock.password), salt: fromHex(wrap.kdf.salt), memoryKiB: wrap.kdf.m, iterations: wrap.kdf.t, parallelism: wrap.kdf.p, hashLength: 32 })
  }
  if ('prfSecret' in unlock) {
    if (wrap.by !== 'prf' || wrap.id !== unlock.credentialId || !wrap.salt) return null
    return hkdf(sha256, unlock.prfSecret, fromHex(wrap.salt), enc.encode('bv/kek/prf/v2'), 32)
  }
  if (wrap.by !== 'device' || wrap.id !== unlock.keyId || !wrap.salt) return null
  return hkdf(sha256, unlock.deviceKey, fromHex(wrap.salt), enc.encode('bv/kek/dev/v2'), 32)
}

export type WrapSpec =
  | { readonly by: 'password'; readonly password: string; readonly kdf?: Argon2idParams }
  | { readonly by: 'prf'; readonly credentialId: string; readonly prfSecret: Uint8Array }
  | { readonly by: 'device'; readonly keyId: string; readonly deviceKey: Uint8Array }

export const DEFAULT_KDF_V2: Argon2idParams = { m: 64 * 1024, t: 3, p: 1 }

async function makeWrap(crypto: VaultCrypto, vaultId: string, dek: Uint8Array, spec: WrapSpec, now: number): Promise<VaultWrap> {
  const nonce = crypto.random(24)
  if (spec.by === 'password') {
    const params = spec.kdf ?? DEFAULT_KDF_V2
    const salt = crypto.random(16)
    const kek = await crypto.argon2id({ password: enc.encode(spec.password), salt, memoryKiB: params.m, iterations: params.t, parallelism: params.p, hashLength: 32 })
    return { by: 'password', id: 'password', kdf: { alg: 'argon2id', salt: toHex(salt), m: params.m, t: params.t, p: params.p }, nonce: toHex(nonce), ct: seal(kek, nonce, aadWrap(vaultId, 'password'), dek), createdAt: now }
  }
  const salt = crypto.random(16)
  const id = spec.by === 'prf' ? spec.credentialId : spec.keyId
  const info = spec.by === 'prf' ? 'bv/kek/prf/v2' : 'bv/kek/dev/v2'
  const secret = spec.by === 'prf' ? spec.prfSecret : spec.deviceKey
  const kek = hkdf(sha256, secret, salt, enc.encode(info), 32)
  return { by: spec.by, id, salt: toHex(salt), nonce: toHex(nonce), ct: seal(kek, nonce, aadWrap(vaultId, id), dek), createdAt: now }
}

export interface CreatedVaultV2 {
  readonly file: VaultFileV2
  readonly dek: Uint8Array
}

/** Create a vault sealed by a fresh DEK with one password wrap. */
export async function createVaultV2(crypto: VaultCrypto, input: { password: string; plaintext: VaultPlaintextV2; kdf?: Argon2idParams; now?: number }): Promise<CreatedVaultV2> {
  const now = input.now ?? Date.now()
  const id = toHex(crypto.random(16))
  const dek = crypto.random(32)
  const wrap = await makeWrap(crypto, id, dek, { by: 'password', password: input.password, ...(input.kdf ? { kdf: input.kdf } : {}) }, now)
  const nonce = crypto.random(24)
  const file: VaultFileV2 = {
    v: 2,
    id,
    wraps: [wrap],
    nonce: toHex(nonce),
    ct: seal(dek, nonce, aadFile(id), enc.encode(JSON.stringify(input.plaintext))),
    createdAt: now,
    updatedAt: now,
  }
  if (openVaultV2(file, dek) === null) throw new Error('vault v2 create: seal round-trip failed')
  return { file, dek }
}

/** Try every compatible wrap; the DEK or null on a wrong factor / tamper. */
export async function unwrapDek(crypto: VaultCrypto, file: VaultFileV2, unlock: UnlockWith): Promise<Uint8Array | null> {
  for (const wrap of file.wraps) {
    const kek = await kekFor(crypto, wrap, unlock)
    if (!kek) continue
    const dek = open(kek, fromHex(wrap.nonce), aadWrap(file.id, wrap.id), wrap.ct)
    if (dek && dek.length === 32) return dek
  }
  return null
}

export function openVaultV2(file: VaultFileV2, dek: Uint8Array): VaultPlaintextV2 | null {
  if (file.v !== VAULT2_VERSION) return null
  const pt = open(dek, fromHex(file.nonce), aadFile(file.id), file.ct)
  if (!pt) return null
  try {
    const parsed = JSON.parse(dec.decode(pt)) as VaultPlaintextV2
    return parsed.v === 2 ? parsed : null
  } catch {
    return null
  }
}

/** Reseal the plaintext under the same DEK — no KDF, microseconds. */
export function resealVaultV2(crypto: VaultCrypto, file: VaultFileV2, dek: Uint8Array, plaintext: VaultPlaintextV2, now: number = Date.now()): VaultFileV2 {
  const nonce = crypto.random(24)
  return { ...file, nonce: toHex(nonce), ct: seal(dek, nonce, aadFile(file.id), enc.encode(JSON.stringify(plaintext))), updatedAt: now }
}

export async function addWrap(crypto: VaultCrypto, file: VaultFileV2, dek: Uint8Array, spec: WrapSpec, now: number = Date.now()): Promise<VaultFileV2> {
  const wrap = await makeWrap(crypto, file.id, dek, spec, now)
  const wraps = file.wraps.filter((w) => !(w.by === wrap.by && w.id === wrap.id))
  return { ...file, wraps: [...wraps, wrap], updatedAt: now }
}

export function removeWrap(file: VaultFileV2, by: WrapKind, id: string, now: number = Date.now()): VaultFileV2 {
  const wraps = file.wraps.filter((w) => !(w.by === by && w.id === id))
  if (wraps.length === 0) throw new Error('a vault must keep at least one unlock factor')
  if (!wraps.some((w) => w.by === 'password')) throw new Error('a vault must keep its password wrap')
  return { ...file, wraps, updatedAt: now }
}

/** Replace the password wrap. The caller has already verified the old password. */
export async function changePassword(crypto: VaultCrypto, file: VaultFileV2, dek: Uint8Array, newPassword: string, kdf?: Argon2idParams, now: number = Date.now()): Promise<VaultFileV2> {
  return addWrap(crypto, file, dek, { by: 'password', password: newPassword, ...(kdf ? { kdf } : {}) }, now)
}

// ---- v1 → v2 ------------------------------------------------------------------

export async function migrateV1(crypto: VaultCrypto, v1: VaultFileV1, password: string, kdf?: Argon2idParams, now: number = Date.now()): Promise<CreatedVaultV2 | null> {
  const pt = await openVault(v1, password)
  if (!pt) return null
  const seedId = pt.seedHex ? toHex(crypto.random(8)) : null
  const seeds: VaultSeed[] = pt.seedHex && pt.mnemonic ? [{ id: seedId as string, label: 'Seed 1', mnemonic: pt.mnemonic, seedHex: pt.seedHex, backedUpAt: null, createdAt: now }] : []
  const accounts: VaultAccountV2[] = pt.accounts.map((a, i) => ({
    id: a.id,
    kind: a.kind,
    label: a.label,
    address: a.address,
    ...(a.kind === 'hd' && seedId ? { seedId } : {}),
    ...(a.index !== undefined ? { index: a.index } : {}),
    ...(a.hardware ? { hardware: a.hardware } : {}),
    hidden: false,
    order: i,
    createdAt: now,
  }))
  const importedKeys: Record<string, `0x${string}`> = {}
  for (const [id, key] of Object.entries(pt.importedKeys)) importedKeys[id] = (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`
  return createVaultV2(crypto, { password, plaintext: { v: 2, seeds, importedKeys, accounts }, ...(kdf ? { kdf } : {}), now })
}

// ---- calibration ----------------------------------------------------------------

/** Pick Argon2id memory so one derivation takes ~targetMs on this device (§3.2). */
export async function calibrateArgon2(crypto: VaultCrypto, opts: { targetMs?: number; floorKiB?: number; ceilKiB?: number; now?: () => number } = {}): Promise<Argon2idParams> {
  const target = opts.targetMs ?? 600
  const floor = opts.floorKiB ?? 64 * 1024
  /*
    128 MiB, not 256.

    Calibration picks a cost on the device that creates the vault and writes it
    into the envelope, and every later unlock has to allocate it again — in an
    MV3 service worker, on a phone under memory pressure, or on a different,
    weaker device the vault was moved to. A vault that cannot be opened is
    worse than one that is cheaper to attack, and 128 MiB at t=3 is already
    comfortably above the OWASP Argon2id guidance.
  */
  const ceil = opts.ceilKiB ?? 128 * 1024
  const now = opts.now ?? (() => performance.now())
  const salt = crypto.random(16)
  const probe = async (m: number): Promise<number> => {
    const t0 = now()
    await crypto.argon2id({ password: enc.encode('calibrate'), salt, memoryKiB: m, iterations: 3, parallelism: 1, hashLength: 32 })
    return now() - t0
  }
  const ms = await probe(floor)
  if (ms <= 0) return { m: floor, t: 3, p: 1 }
  const scaled = Math.floor((floor * target) / ms / 1024) * 1024
  return { m: Math.max(floor, Math.min(ceil, scaled)), t: 3, p: 1 }
}

// ---- air-gapped export (§6) ------------------------------------------------------

export interface VaultExportEnvelope {
  readonly v: 2
  readonly kind: 'boltvault-export'
  readonly kdf: { readonly alg: 'argon2id'; readonly salt: string; readonly m: number; readonly t: number; readonly p: number }
  readonly nonce: string
  readonly ct: string
  readonly createdAt: number
}

/**
 * Mint the one-time phrase that seals an export.
 *
 * The export holds every seed, passphrase and imported key in the vault, and
 * it is rendered as a QR — so the ciphertext is public by design, and the
 * phrase is the whole of the protection. A user-invented one carried an
 * eight-character floor and was lower-cased before the KDF, which is not
 * enough for something a camera in the room can capture and grind offline.
 *
 * Six words from the BIP-39 list is about 66 bits: still typeable on the
 * destination device, and out of reach of an offline search even before
 * Argon2id makes each guess expensive.
 */
export const EXPORT_CODE_WORDS = 6
export function mintExportCode(random: (n: number) => Uint8Array): string {
  const out: string[] = []
  for (let i = 0; i < EXPORT_CODE_WORDS; i++) {
    // Rejection-sampled to stay uniform over the 2048-word list.
    let n = 2048
    while (n >= 2048) {
      const b = random(2)
      n = (((b[0] ?? 0) << 8) | (b[1] ?? 0)) & 0x07ff
    }
    out.push(wordlist[n] as string)
  }
  return out.join(' ')
}

/** Seal the plaintext under a one-time code (typed on the destination, never displayed there). */
export async function exportVaultV2(crypto: VaultCrypto, plaintext: VaultPlaintextV2, code: string, kdf: Argon2idParams = DEFAULT_KDF_V2, now: number = Date.now()): Promise<VaultExportEnvelope> {
  const salt = crypto.random(16)
  const nonce = crypto.random(24)
  const key = await crypto.argon2id({ password: enc.encode(code.trim().toLowerCase()), salt, memoryKiB: kdf.m, iterations: kdf.t, parallelism: kdf.p, hashLength: 32 })
  return { v: 2, kind: 'boltvault-export', kdf: { alg: 'argon2id', salt: toHex(salt), m: kdf.m, t: kdf.t, p: kdf.p }, nonce: toHex(nonce), ct: seal(key, nonce, enc.encode('boltvault.export.v2'), enc.encode(JSON.stringify(plaintext))), createdAt: now }
}

export async function openVaultExport(crypto: VaultCrypto, env: VaultExportEnvelope, code: string): Promise<VaultPlaintextV2 | null> {
  if (env.v !== 2 || env.kind !== 'boltvault-export') return null
  const key = await crypto.argon2id({ password: enc.encode(code.trim().toLowerCase()), salt: fromHex(env.kdf.salt), memoryKiB: env.kdf.m, iterations: env.kdf.t, parallelism: env.kdf.p, hashLength: 32 })
  const pt = open(key, fromHex(env.nonce), enc.encode('boltvault.export.v2'), env.ct)
  if (!pt) return null
  try {
    const parsed = JSON.parse(dec.decode(pt)) as VaultPlaintextV2
    return parsed.v === 2 ? parsed : null
  } catch {
    return null
  }
}

/** Split a payload into animated-QR frames: `bv:x/<i>/<n>:<data>`. */
export function chunkForQr(payload: string, chunkSize = 700): string[] {
  const frames: string[] = []
  const n = Math.max(1, Math.ceil(payload.length / chunkSize))
  for (let i = 0; i < n; i++) frames.push(`bv:x/${i + 1}/${n}:${payload.slice(i * chunkSize, (i + 1) * chunkSize)}`)
  return frames
}

/** Reassemble frames in any order; null until every frame has been seen. */
export function assembleQrFrames(frames: readonly string[]): string | null {
  const parts = new Map<number, string>()
  let total = 0
  for (const f of frames) {
    const m = /^bv:x\/(\d+)\/(\d+):([\s\S]*)$/.exec(f)
    if (!m) continue
    const i = Number(m[1])
    total = Number(m[2])
    parts.set(i, m[3] ?? '')
  }
  if (total === 0 || parts.size < total) return null
  let out = ''
  for (let i = 1; i <= total; i++) {
    const p = parts.get(i)
    if (p === undefined) return null
    out += p
  }
  return out
}
