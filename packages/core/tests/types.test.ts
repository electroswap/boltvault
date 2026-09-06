import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import { privateKeyToAddress } from 'viem/accounts'
import {
  DEFAULT_SETTINGS,
  type BoltVaultSettings,
  type ConnectedSite,
  type HistoryEntry,
  type VaultAccount,
  type VaultFileV1,
} from '../src/index.js'

describe('core types', () => {
  it('VaultAccount round-trips through the HD shape', () => {
    const acct: VaultAccount = {
      id: 'acct-1',
      kind: 'hd',
      label: 'Main',
      address: getAddress('0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'),
      index: 0,
      hasKey: true,
      createdAt: Date.now(),
    }
    expect(acct.kind).toBe('hd')
    expect(acct.hasKey).toBe(true)
  })

  it('ConnectedSite carries origin + per-origin chain', () => {
    const site: ConnectedSite = {
      origin: 'https://app.electroswap.io',
      chainId: 52014,
      accountId: 'acct-1',
      connected: true,
      permissions: ['eth_accounts'],
      connectedAt: Date.now(),
    }
    expect(site.chainId).toBe(52014)
  })

  it('HistoryEntry encodes a send with category', () => {
    const h: HistoryEntry = {
      hash: '0x' + 'ab'.repeat(32),
      chainId: 52014,
      account: 'acct-1',
      to: '0x' + 'cd'.repeat(20),
      data: '0x',
      value: '0xde0b6b3a7640000',
      nonce: 0,
      submittedAt: Date.now(),
      category: 'SEND',
      status: 'pending',
    }
    expect(h.category).toBe('SEND')
  })

  it('DEFAULT_SETTINGS match design (exactApprovals on, ethSign off, 15min auto-lock)', () => {
    const s: BoltVaultSettings = DEFAULT_SETTINGS
    expect(s.exactApprovals).toBe(true)
    expect(s.ethSignEnabled).toBe(false)
    expect(s.defaultWallet).toBe(false)
    expect(s.autoLock).toBe('15min')
  })

  it('VaultFileV1 envelope shape is versioned', () => {
    const v: VaultFileV1 = {
      version: 1,
      kdf: { algorithm: 'argon2id', salt: 'ab', m: 64 * 1024 * 1024, t: 3, p: 1 },
      ciphertext: 'AA==',
      nonce: 'AA==',
      tag: 'AA==',
    }
    expect(v.version).toBe(1)
  })

  it('a known private key derives a stable checksummed address (smoke for viem path)', () => {
    const pk = '0x' + '11'.repeat(32)
    const addr = getAddress(privateKeyToAddress(pk as `0x${string}`))
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})
