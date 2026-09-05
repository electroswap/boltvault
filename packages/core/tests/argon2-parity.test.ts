/**
 * The vault file must round-trip between the extension (hash-wasm) and mobile
 * (libsodium `crypto_pwhash`). Both implement RFC 9106 Argon2id; this pins the
 * parameter mapping so a mismatch is a red test, not a locked-out user.
 *
 *   hash-wasm  iterations = t, memorySize = m KiB, parallelism = 1
 *   libsodium  opslimit  = t, memlimit   = m * 1024 bytes, lanes = 1 (fixed)
 */
import { describe, expect, it } from 'vitest'
import sodium from 'libsodium-wrappers-sumo'
import { argon2id } from 'hash-wasm'
import { toHex } from '../src/vault'

describe('argon2id parity: hash-wasm ↔ libsodium', () => {
  it('produces identical keys for identical parameters', async () => {
    await sodium.ready
    const password = new TextEncoder().encode('correct horse battery staple')
    const salt = new Uint8Array(16).map((_, i) => i * 7 + 1)
    for (const [m, t] of [
      [8 * 1024, 1],
      [64 * 1024, 3],
    ] as const) {
      const wasm = await argon2id({ password, salt, iterations: t, memorySize: m, parallelism: 1, hashLength: 32, outputType: 'binary' })
      const libsodiumKey = sodium.crypto_pwhash(32, password, salt, t, m * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13)
      expect(toHex(libsodiumKey)).toBe(toHex(wasm))
    }
  }, 60_000)
})
