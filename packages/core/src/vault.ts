import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { argon2id } from 'hash-wasm'
import type { VaultAccountMeta, VaultFileV1, VaultPlaintext } from './types.js'

/**
 * Vault (VaultFileV1) — Argon2id → XChaCha20-Poly1305.
 *
 * The vault envelope stores the BIP-39 seed (hex) + imported keys + account
 * metadata, encrypted with a key derived from the user's password. The
 * wrapping key is never persisted (session/keystore only, per S1).
 *
 * Crypto kernel per design S2: noble everywhere, no node:crypto, so the same
 * code runs in the MV3 SW, the offscreen doc, and RN.
 */

export const VAULT_VERSION = 1 as const
const AAD = 'boltvault.v1'

export interface Argon2idParams {
  readonly m: number // KiB
  readonly t: number
  readonly p: number
}

/** Memory-hard defaults; fine on 2020s hardware (≈200–400ms). */
export const DEFAULT_ARGON2ID: Argon2idParams = { m: 64 * 1024, t: 3, p: 1 }

const toB64 = (u8: Uint8Array): string =>
  typeof btoa === 'function'
    ? btoa(String.fromCharCode(...u8))
    : Buffer.from(u8).toString('base64')
const fromB64 = (s: string): Uint8Array => {
  const b = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary')
  const u8 = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i)
  return u8
}
export const toHex = (u8: Uint8Array): string =>
  Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join('')
export const fromHex = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/, '')
  const u8 = new Uint8Array(clean.length / 2)
  for (let i = 0; i < u8.length; i++) u8[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return u8
}

/**
 * Overwrite key material once it is finished with (master plan §3.2, which
 * promises lock "zeroises DEK, seeds and any derived private keys
 * (`Uint8Array.fill(0)`)" — before this, no `.fill(0)` existed anywhere in the
 * tree).
 *
 * Honest scope: this shortens how long a key sits in a reachable buffer. It
 * cannot defeat code running inside the wallet's own process, and JS engines
 * may keep copies a caller cannot reach (string interning, GC-moved buffers).
 * It is defence in depth, not a boundary.
 */
export function zeroise(...buffers: ReadonlyArray<Uint8Array | null | undefined>): void {
  for (const b of buffers) b?.fill(0)
}

export function randomBytes(n: number): Uint8Array {
  const u8 = new Uint8Array(n)
  crypto.getRandomValues(u8)
  return u8
}

export async function kdfArgon2id(
  password: string,
  salt: Uint8Array,
  params: Argon2idParams = DEFAULT_ARGON2ID,
): Promise<Uint8Array> {
  return argon2id({
    password: new TextEncoder().encode(password),
    salt,
    iterations: params.t,
    parallelism: params.p,
    memorySize: params.m, // KiB
    hashLength: 32,
    outputType: 'binary',
  })
}

const AAD_BYTES = new TextEncoder().encode(AAD)

function seal(key: Uint8Array, plaintext: Uint8Array, nonce: Uint8Array): string {
  const ct = xchacha20poly1305(key, nonce, AAD_BYTES).encrypt(plaintext)
  return toB64(ct)
}

function open(
  key: Uint8Array,
  ciphertextB64: string,
  nonce: Uint8Array,
): Uint8Array | null {
  try {
    return xchacha20poly1305(key, nonce, AAD_BYTES).decrypt(fromB64(ciphertextB64))
  } catch {
    return null
  }
}

/** Encrypt a plaintext payload into a VaultFileV1 envelope. */
export async function createVault(
  password: string,
  plaintext: VaultPlaintext,
  opts: { kdf?: Argon2idParams; salt?: Uint8Array; nonce?: Uint8Array } = {},
): Promise<VaultFileV1> {
  const params = opts.kdf ?? DEFAULT_ARGON2ID
  const salt = opts.salt ?? randomBytes(16)
  const nonce = opts.nonce ?? randomBytes(24)
  const key = await kdfArgon2id(password, salt, params)
  const file: VaultFileV1 = {
    version: VAULT_VERSION,
    kdf: {
      algorithm: 'argon2id',
      salt: toHex(salt),
      m: params.m,
      t: params.t,
      p: params.p,
    },
    nonce: toHex(nonce),
    ciphertext: seal(key, new TextEncoder().encode(JSON.stringify(plaintext)), nonce),
    tag: '', // tag is inside ciphertext (noble appends it)
  }
  // round-trip guard: wrong serialization here = data loss later
  const check = open(key, file.ciphertext, nonce)
  if (check === null || new TextDecoder().decode(check) !== JSON.stringify(plaintext)) {
    throw new Error('vault create: seal round-trip failed')
  }
  return file
}

/** Decrypt a VaultFileV1. Returns null on bad password or tamper. */
export async function openVault(
  file: VaultFileV1,
  password: string,
): Promise<VaultPlaintext | null> {
  if (file.version !== VAULT_VERSION) return null
  const key = await kdfArgon2id(
    password,
    fromHex(file.kdf.salt),
    { m: file.kdf.m, t: file.kdf.t, p: file.kdf.p },
  )
  const pt = open(key, file.ciphertext, fromHex(file.nonce))
  if (pt === null) return null
  try {
    return JSON.parse(new TextDecoder().decode(pt)) as VaultPlaintext
  } catch {
    return null
  }
}

/** Re-encrypt an existing plaintext (add account / rotate password). */
export async function updateVault(
  file: VaultFileV1,
  password: string,
  mutate: (pt: VaultPlaintext) => VaultPlaintext,
): Promise<{ file: VaultFileV1; plaintext: VaultPlaintext }> {
  const pt = await openVault(file, password)
  if (pt === null) throw new Error('updateVault: current password invalid')
  const next = mutate(pt)
  const nextFile = await createVault(
    password,
    next,
    { salt: fromHex(file.kdf.salt), nonce: randomBytes(24) },
  )
  return { file: nextFile, plaintext: next }
}

/** Add an account (HD / hardware / watch) — no key material in the envelope. */
export function addAccountToPlaintext(
  pt: VaultPlaintext,
  meta: VaultAccountMeta,
): VaultPlaintext {
  if (pt.accounts.some((a) => a.id === meta.id)) {
    throw new Error(`duplicate account id ${meta.id}`)
  }
  return { ...pt, accounts: [...pt.accounts, meta] }
}

/** Add/replace an imported key + its account metadata. */
export function addImportedKey(
  pt: VaultPlaintext,
  meta: VaultAccountMeta,
  privateKeyHex: string,
): VaultPlaintext {
  if (pt.accounts.some((a) => a.id === meta.id)) {
    throw new Error(`duplicate account id ${meta.id}`)
  }
  return {
    ...pt,
    importedKeys: { ...pt.importedKeys, [meta.id]: privateKeyHex },
    accounts: [...pt.accounts, meta],
  }
}

export function emptyPlaintext(): VaultPlaintext {
  return { seedHex: null, mnemonic: null, importedKeys: {}, accounts: [] }
}
