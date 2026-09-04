import { describe, expect, it } from 'vitest'
import {
  addAccountToPlaintext,
  addImportedKey,
  createVault,
  emptyPlaintext,
  openVault,
  updateVault,
  VAULT_VERSION,
  type VaultPlaintext,
} from '../src/index.js'

// Fast KDF for tests (argon2id is memory-hard; keep m low so CI stays quick).
const FAST = { m: 4 * 1024, t: 2, p: 1 }

const seedHex = 'aa'.repeat(32)
const addr0 = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'

function samplePlaintext(): VaultPlaintext {
  return {
    seedHex,
    importedKeys: {},
    accounts: [
      {
        id: 'acct-0',
        kind: 'hd',
        label: 'Main',
        address: addr0,
        index: 0,
      },
    ],
  }
}

describe('VaultFileV1 (Argon2id → XChaCha20-Poly1305)', () => {
  it('round-trips: create then open returns the same plaintext', async () => {
    const pt = samplePlaintext()
    const file = await createVault('correct horse battery', pt, { kdf: FAST })
    expect(file.version).toBe(VAULT_VERSION)
    expect(file.kdf.algorithm).toBe('argon2id')

    const back = await openVault(file, 'correct horse battery')
    expect(back).toEqual(pt)
  }, 20_000)

  it('returns null on the wrong password', async () => {
    const file = await createVault('correct horse battery', samplePlaintext(), { kdf: FAST })
    const back = await openVault(file, 'wrong password')
    expect(back).toBeNull()
  }, 20_000)

  it('returns null when the ciphertext is tampered with', async () => {
    const file = await createVault('correct horse battery', samplePlaintext(), { kdf: FAST })
    // flip a byte in the ciphertext (base64) → Poly1305 tag should reject
    const ct = file.ciphertext
    const tampered = {
      ...file,
      ciphertext: (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1),
    }
    const back = await openVault(tampered, 'correct horse battery')
    expect(back).toBeNull()
  }, 20_000)

  it('updateVault re-encrypts and preserves accounts across a password rotate', async () => {
    let file = await createVault('old-pass', samplePlaintext(), { kdf: FAST })
    const importedKey = '11'.repeat(32)
    const { file: next } = await updateVault(file, 'old-pass', (pt) =>
      addImportedKey(
        pt,
        {
          id: 'acct-imp',
          kind: 'imported',
          label: 'Imported',
          address: '0x2222222222222222222222222222222222222222',
        },
        importedKey,
      ),
    )
    void next
    // rotate password
    const { file: rotated, plaintext } = await updateVault(next, 'old-pass', (pt) => {
      return pt
    })
    expect(rotated.kdf.salt).toBe(file.kdf.salt) // salt preserved on update
    expect(plaintext.accounts.some((a) => a.id === 'acct-imp')).toBe(true)
    // open with the NEW password
    const back = await openVault(rotated, 'old-pass')
    expect(back).not.toBeNull()
  }, 30_000)

  it('addAccountToPlaintext rejects duplicate ids', async () => {
    const pt = samplePlaintext()
    expect(() =>
      addAccountToPlaintext(pt, {
        id: 'acct-0',
        kind: 'watch',
        label: 'dup',
        address: '0x9999999999999999999999999999999999999999',
      }),
    ).toThrow(/duplicate account id/)
  })
})
