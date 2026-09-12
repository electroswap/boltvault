/**
 * The envelope a "Move a vault here" scan produces, read as a stranger's file
 * (ES-BV-009).
 *
 * `importExport` used to `JSON.parse` the payload and hand the object to
 * `openVaultExport`, which reads the Argon2id cost straight out of it — so a
 * QR naming four gibibytes hung the phone before a code was ever typed, and a
 * missing salt threw a raw `TypeError` out of `fromHex`.
 */
import { describe, expect, it } from 'vitest'
import { VaultExportEnvelopeSchema, defaultVaultCrypto, exportVaultV2, type VaultPlaintextV2 } from '../src/vault2'

const pt: VaultPlaintextV2 = { v: 2, seeds: [], importedKeys: {}, accounts: [] }

describe('VaultExportEnvelopeSchema', () => {
  it('accepts what this wallet itself writes', async () => {
    const env = await exportVaultV2(defaultVaultCrypto, pt, 'orbit velvet cactus ember quartz lattice', { m: 8 * 1024, t: 1, p: 1 }, 1_700_000_000_000)
    const parsed = VaultExportEnvelopeSchema.safeParse(JSON.parse(JSON.stringify(env)))
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true)
  })

  it('refuses a cost that would hang the device before a code is typed', async () => {
    const env = await exportVaultV2(defaultVaultCrypto, pt, 'orbit velvet cactus ember quartz lattice', { m: 8 * 1024, t: 1, p: 1 }, 1_700_000_000_000)
    const huge = { ...env, kdf: { ...env.kdf, m: 2 ** 22 } }
    expect(VaultExportEnvelopeSchema.safeParse(huge).success).toBe(false)
    const slow = { ...env, kdf: { ...env.kdf, t: 1_000_000 } }
    expect(VaultExportEnvelopeSchema.safeParse(slow).success).toBe(false)
  })

  it('refuses an envelope missing the fields the opener reads', async () => {
    const env = await exportVaultV2(defaultVaultCrypto, pt, 'orbit velvet cactus ember quartz lattice', { m: 8 * 1024, t: 1, p: 1 }, 1_700_000_000_000)
    for (const drop of ['nonce', 'ct', 'createdAt'] as const) {
      const bad: Record<string, unknown> = { ...env }
      delete bad[drop]
      expect(VaultExportEnvelopeSchema.safeParse(bad).success, drop).toBe(false)
    }
    expect(VaultExportEnvelopeSchema.safeParse({ ...env, kdf: { ...env.kdf, salt: 'zz' } }).success).toBe(false)
    expect(VaultExportEnvelopeSchema.safeParse({ ...env, kind: 'something-else' }).success).toBe(false)
  })
})
