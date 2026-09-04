import { describe, expect, it } from 'vitest'
import { VaultService, WrongPasswordError, type VaultStores } from '../src/vault-service'
import type { KeyValueStore } from '@boltvault/core'

// In-memory KeyValueStore so the SW vault logic is testable without chrome.
function memStore(): KeyValueStore {
  const m = new Map<string, string>()
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    remove: async (k) => void m.delete(k),
  }
}

function newService(): VaultStores {
  return { secret: memStore(), session: memStore() }
}

describe('VaultService (T3.3, storage-agnostic)', () => {
  it('onboards: createVault stores the envelope + returns mnemonic + first account', async () => {
    const vault = VaultService.connect(newService())
    expect(await vault.hasVault()).toBe(false)
    const created = await vault.createVault('correct horse battery staple', { bits: 128 })
    expect(await vault.hasVault()).toBe(true)
    expect(created.mnemonic.split(/\s+/).length).toBe(12)
    expect(created.accounts).toHaveLength(1)
    expect(created.accounts[0]?.kind).toBe('hd')
    expect(created.accounts[0]?.hasKey).toBe(true)
  })

  it('unlock verifies the password and holds the seed in the session', async () => {
    const stores = newService()
    const vault = VaultService.connect(stores, 'never')
    const created = await vault.createVault('pw-123')
    await vault.lock()
    expect(await vault.isUnlocked()).toBe(false)
    const accounts = await vault.unlock('pw-123')
    expect(accounts).toHaveLength(1)
    expect(await vault.isUnlocked()).toBe(true)
    // seed is the same derived value as at creation
    expect(await vault.getUnlockedSeedHex()).toBe(created.seedHex)
  })

  it('wrong password throws WrongPasswordError on unlock + reveal', async () => {
    const vault = VaultService.connect(newService(), 'never')
    await vault.createVault('right', { bits: 128 })
    await expect(vault.unlock('wrong')).rejects.toThrow(WrongPasswordError)
    const revealed = await vault.revealMnemonic('right')
    expect(revealed.split(/\s+/).length).toBe(12)
    await expect(vault.revealMnemonic('nope')).rejects.toThrow(WrongPasswordError)
  })

  it('lock clears the session seed but keeps the vault', async () => {
    const vault = VaultService.connect(newService(), 'never')
    const created = await vault.createVault('pw', { bits: 128 })
    await vault.unlock('pw')
    expect(await vault.isUnlocked()).toBe(true)
    await vault.lock()
    expect(await vault.isUnlocked()).toBe(false)
    expect(await vault.getUnlockedSeedHex()).toBeNull()
    // vault still present, still unlockable
    expect(await vault.hasVault()).toBe(true)
    expect((await vault.unlock('pw')).length).toBe(1)
    expect(created.seedHex).toMatch(/^0x[0-9a-f]{128}$/)
  })

  it('importVault derives the same address as the canonical mnemonic', async () => {
    const vault = VaultService.connect(newService(), 'never')
    const m = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    const created = await vault.importVault(m, 'pw')
    // BIP-44 index 0 of the standard vector (verified in core T1.2).
    expect(created.accounts[0]?.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')
  })

  it('rejects an invalid mnemonic on import', async () => {
    const vault = VaultService.connect(newService(), 'never')
    await expect(vault.importVault('not a valid mnemonic phrase here', 'pw')).rejects.toThrow(
      /mnemonic/i,
    )
  })

  it('quizWords returns 3 distinct positioned words', () => {
    const q = VaultService.quizWords(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    )
    expect(q.words).toHaveLength(3)
    expect(q.positions).toHaveLength(3)
    // distinct positions
    expect(new Set(q.positions).size).toBe(3)
  })
})
