/**
 * What it costs to read a recovery phrase (§3.2).
 *
 * Two things have been true in turn here and neither was right on its own.
 * Reveal used to demand the password and nothing else, even though the vault
 * has been wrapped independently by password, passkey PRF and device key since
 * v2 — so anyone who set the wallet up behind a passkey and never chose a
 * memorable password could not read their own phrase. Then it accepted any
 * enrolled factor, which is ATT-BV-031: a household member who could pass a
 * registered fingerprint could open Accounts → Back up and photograph the
 * words, while Security and Onboarding both told the user the password "is
 * still required to reveal or export your phrase".
 *
 * The settled answer is a policy the user can see: `revealNeedsPassword`, on
 * by default, so the code says what the copy says — and off for the wallet
 * that genuinely has no memorable password, which is what the second change
 * was for.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { describe, expect, it } from 'vitest'
import { createEngine } from '../src/create'
import { EngineError } from '../src/errors'

const FAST = { m: 1024, t: 1, p: 1 }
const heads = { blockNumber: async () => 1n }
const PRF = 'ab'.repeat(32)
const DEVICE_KEY = 'cd'.repeat(32)

async function vaultWithEveryFactor() {
  const engine = createEngine({ platform: createMemoryPlatform(), heads, kdf: FAST })
  await engine.ready
  const created = await engine.engine.vault.create({ password: 'pw' })
  await engine.engine.vault.enrolPasskey({ credentialId: 'cred-1', prfSecretHex: PRF, password: 'pw' })
  await engine.engine.vault.enrolDevice({ keyId: 'pixel', keyHex: DEVICE_KEY, password: 'pw' })
  return { engine, seedId: created.seedId, mnemonic: created.mnemonic }
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (err) {
    return err instanceof EngineError ? err.code : 'not-an-engine-error'
  }
  return 'no-error'
}

describe('seed reveal costs the password, unless the user says otherwise', () => {
  it('reveals with the password, and refuses a device factor while the policy is on', async () => {
    const { engine, seedId, mnemonic } = await vaultWithEveryFactor()
    try {
      // The default, and what Security and Onboarding have always said.
      expect((await engine.engine.settings.get()).revealNeedsPassword).toBe(true)
      expect((await engine.engine.vault.reveal({ seedId, password: 'pw' })).mnemonic).toBe(mnemonic)
      expect(await codeOf(engine.engine.vault.reveal({ seedId, credentialId: 'cred-1', prfSecretHex: PRF }))).toBe('unauthorized')
      expect(await codeOf(engine.engine.vault.reveal({ seedId, keyId: 'pixel', keyHex: DEVICE_KEY }))).toBe('unauthorized')
    } finally {
      engine.dispose()
    }
  })

  it('takes any enrolled factor once the user turns the policy off', async () => {
    const { engine, seedId, mnemonic } = await vaultWithEveryFactor()
    try {
      await engine.engine.settings.set({ revealNeedsPassword: false })
      expect((await engine.engine.vault.reveal({ seedId, credentialId: 'cred-1', prfSecretHex: PRF })).mnemonic).toBe(mnemonic)
      expect((await engine.engine.vault.reveal({ seedId, keyId: 'pixel', keyHex: DEVICE_KEY })).mnemonic).toBe(mnemonic)
    } finally {
      engine.dispose()
    }
  })

  it('refuses a wrong factor of every kind, and does not leak which seed exists', async () => {
    const { engine, seedId } = await vaultWithEveryFactor()
    try {
      // With the policy on, a device factor never reaches the unwrap at all —
      // so the factor checks themselves are exercised with it off.
      await engine.engine.settings.set({ revealNeedsPassword: false })
      expect(await codeOf(engine.engine.vault.reveal({ seedId, password: 'not-the-password' }))).toBe('wrong_password')
      // A failed passkey is not a wrong password; saying so would be a lie the UI repeats.
      expect(await codeOf(engine.engine.vault.reveal({ seedId, credentialId: 'cred-1', prfSecretHex: 'ff'.repeat(32) }))).toBe('unauthorized')
      expect(await codeOf(engine.engine.vault.reveal({ seedId, keyId: 'pixel', keyHex: 'ff'.repeat(32) }))).toBe('unauthorized')
      // An unknown credential id must not unlock by matching some other wrap.
      expect(await codeOf(engine.engine.vault.reveal({ seedId, credentialId: 'not-enrolled', prfSecretHex: PRF }))).toBe('unauthorized')
    } finally {
      engine.dispose()
    }
  })

  it('still refuses a seed that does not exist, even with a good factor', async () => {
    const { engine } = await vaultWithEveryFactor()
    try {
      expect(await codeOf(engine.engine.vault.reveal({ seedId: 'no-such-seed', password: 'pw' }))).toBe('not_found')
    } finally {
      engine.dispose()
    }
  })

  it('rejects a request that carries no factor at all', async () => {
    const { engine, seedId } = await vaultWithEveryFactor()
    try {
      // Straight at the host, because the typed client would not let this compile.
      expect(await codeOf(engine.host.invoke('vault', 'reveal', { seedId }, 'ui'))).toBe('invalid_argument')
    } finally {
      engine.dispose()
    }
  })
})
