import { describe, expect, it } from 'vitest'
import {
  addWrap,
  assembleQrFrames,
  calibrateArgon2,
  changePassword,
  chunkForQr,
  createVaultV2,
  defaultVaultCrypto,
  emptyPlaintextV2,
  exportVaultV2,
  migrateV1,
  openVaultExport,
  openVaultV2,
  removeWrap,
  resealVaultV2,
  unwrapDek,
  type VaultPlaintextV2,
} from '../src/vault2'
import { createVault } from '../src/vault'
import { toHex } from '../src/vault'

// Small KDF so the suite stays fast; production params come from calibration.
const FAST = { m: 1024, t: 1, p: 1 }
const crypto = defaultVaultCrypto

function sample(): VaultPlaintextV2 {
  return {
    v: 2,
    seeds: [{ id: 'seed1', label: 'Seed 1', mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', seedHex: '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4', backedUpAt: null, createdAt: 1 }],
    importedKeys: {},
    accounts: [{ id: 'acct_1', kind: 'hd', label: 'Account 1', address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94', seedId: 'seed1', index: 0, hidden: false, order: 0, createdAt: 1 }],
  }
}

describe('vault v2', () => {
  it('creates, unwraps with the password, opens, and rejects a wrong password', async () => {
    const { file, dek } = await createVaultV2(crypto, { password: 'pw', plaintext: sample(), kdf: FAST })
    expect(file.wraps.map((w) => w.by)).toEqual(['password'])
    expect(openVaultV2(file, dek)).toEqual(sample())
    const again = await unwrapDek(crypto, file, { password: 'pw' })
    expect(again && toHex(again)).toBe(toHex(dek))
    expect(await unwrapDek(crypto, file, { password: 'nope' })).toBeNull()
  })

  it('reseals metadata with the DEK alone and keeps every wrap valid', async () => {
    const { file, dek } = await createVaultV2(crypto, { password: 'pw', plaintext: sample(), kdf: FAST })
    const pt = openVaultV2(file, dek)!
    const renamed: VaultPlaintextV2 = { ...pt, accounts: [{ ...pt.accounts[0]!, label: 'Main' }] }
    const next = resealVaultV2(crypto, file, dek, renamed, 99)
    expect(next.wraps).toBe(file.wraps)
    expect(next.updatedAt).toBe(99)
    expect(openVaultV2(next, dek)?.accounts[0]?.label).toBe('Main')
    expect(openVaultV2(file, dek)?.accounts[0]?.label).toBe('Account 1')
    // ciphertext bound to the vault id: swapping ct between files fails
    const other = await createVaultV2(crypto, { password: 'pw', plaintext: sample(), kdf: FAST })
    expect(openVaultV2({ ...other.file, ct: next.ct, nonce: next.nonce }, dek)).toBeNull()
  })

  it('adds passkey (PRF) and device wraps; any one unlocks; removal keeps the password', async () => {
    const { file, dek } = await createVaultV2(crypto, { password: 'pw', plaintext: sample(), kdf: FAST })
    const prf = new Uint8Array(32).fill(7)
    const devKey = new Uint8Array(32).fill(9)
    let f = await addWrap(crypto, file, dek, { by: 'prf', credentialId: 'cred-1', prfSecret: prf })
    f = await addWrap(crypto, f, dek, { by: 'device', keyId: 'pixel-8', deviceKey: devKey })
    expect(f.wraps.map((w) => `${w.by}:${w.id}`)).toEqual(['password:password', 'prf:cred-1', 'device:pixel-8'])
    for (const unlock of [{ password: 'pw' }, { prfSecret: prf, credentialId: 'cred-1' }, { deviceKey: devKey, keyId: 'pixel-8' }] as const) {
      const d = await unwrapDek(crypto, f, unlock)
      expect(d && toHex(d)).toBe(toHex(dek))
    }
    expect(await unwrapDek(crypto, f, { prfSecret: new Uint8Array(32), credentialId: 'cred-1' })).toBeNull()
    expect(await unwrapDek(crypto, f, { prfSecret: prf, credentialId: 'cred-2' })).toBeNull()
    f = removeWrap(f, 'prf', 'cred-1')
    expect(await unwrapDek(crypto, f, { prfSecret: prf, credentialId: 'cred-1' })).toBeNull()
    expect(() => removeWrap(f, 'password', 'password')).toThrow(/password wrap/)
  })

  it('changes the password by re-wrapping 32 bytes, not the seeds', async () => {
    const { file, dek } = await createVaultV2(crypto, { password: 'old', plaintext: sample(), kdf: FAST })
    const next = await changePassword(crypto, file, dek, 'new', FAST)
    expect(next.ct).toBe(file.ct) // plaintext untouched
    expect(await unwrapDek(crypto, next, { password: 'old' })).toBeNull()
    const d = await unwrapDek(crypto, next, { password: 'new' })
    expect(d && toHex(d)).toBe(toHex(dek))
  })

  it('migrates a v1 file, preserving the seed, accounts and imported keys', async () => {
    const v1 = await createVault('pw', {
      seedHex: sample().seeds[0]!.seedHex,
      mnemonic: sample().seeds[0]!.mnemonic,
      importedKeys: { acct_imp: '11'.repeat(32) },
      accounts: [
        { id: 'acct_1', kind: 'hd', label: 'Account 1', address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94', index: 0 },
        { id: 'acct_imp', kind: 'imported', label: 'Imported', address: '0x19e7E376E7C213B7E7e7e46cc70A5dD086DAff2A' },
      ],
    }, { kdf: FAST })
    expect(await migrateV1(crypto, v1, 'wrong', FAST)).toBeNull()
    const m = await migrateV1(crypto, v1, 'pw', FAST)
    expect(m).not.toBeNull()
    const pt = openVaultV2(m!.file, m!.dek)!
    expect(pt.seeds).toHaveLength(1)
    expect(pt.seeds[0]?.mnemonic).toBe(sample().seeds[0]!.mnemonic)
    expect(pt.accounts.map((a) => [a.kind, a.seedId === pt.seeds[0]?.id, a.order])).toEqual([['hd', true, 0], ['imported', false, 1]])
    expect(pt.importedKeys['acct_imp']).toBe(`0x${'11'.repeat(32)}`)
  })

  it('export/import round-trips under a one-time code and QR frames reassemble in any order', async () => {
    const env = await exportVaultV2(crypto, sample(), 'Correct Horse Battery', FAST)
    expect(await openVaultExport(crypto, env, 'wrong code')).toBeNull()
    expect(await openVaultExport(crypto, env, '  correct horse battery ')).toEqual(sample())
    const payload = JSON.stringify(env)
    const frames = chunkForQr(payload, 120)
    expect(frames.length).toBeGreaterThan(3)
    expect(assembleQrFrames(frames.slice(0, -1))).toBeNull()
    expect(assembleQrFrames([...frames].reverse())).toBe(payload)
  })

  it('calibration respects the floor and ceiling', async () => {
    const fast = await calibrateArgon2(crypto, { targetMs: 1, floorKiB: 1024, ceilKiB: 4096, now: () => 0 })
    expect(fast.m).toBe(1024)
    let t = 0
    const slow = await calibrateArgon2({ ...crypto, argon2id: async (i) => crypto.argon2id({ ...i, memoryKiB: 1024 }) }, { targetMs: 10_000, floorKiB: 1024, ceilKiB: 4096, now: () => (t += 5) })
    expect(slow.m).toBe(4096)
  })

  it('an empty plaintext is valid', async () => {
    const { file, dek } = await createVaultV2(crypto, { password: 'pw', plaintext: emptyPlaintextV2(), kdf: FAST })
    expect(openVaultV2(file, dek)).toEqual({ v: 2, seeds: [], importedKeys: {}, accounts: [] })
  })
})
