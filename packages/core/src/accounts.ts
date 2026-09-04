import { getAddress, isAddress } from 'viem'
import { privateKeyToAddress } from 'viem/accounts'
import { hdAccountMeta } from './hd.js'
import type { AccountId, VaultAccount, VaultAccountMeta, VaultPlaintext } from './types.js'
import { addAccountToPlaintext, addImportedKey } from './vault.js'

/**
 * Account factory — turns the per-kind inputs into a `VaultAccount` + the
 * vault-plaintext mutation. Every kind resolves to exactly one checksummed
 * EOA address (the design's "one seated account" contract).
 */

export function newAccountId(): AccountId {
  const u8 = new Uint8Array(8)
  crypto.getRandomValues(u8)
  return `acct_${Array.from(u8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

export interface HdAccountInput {
  readonly label: string
  readonly index: number
}

export interface ImportedAccountInput {
  readonly label: string
  /** 32-byte secp256k1 key, 0x-prefixed. */
  readonly privateKey: `0x${string}`
}

export interface WatchAccountInput {
  readonly label: string
  /** Checksummed (or raw) address. */
  readonly address: string
}

export interface HardwareAccountInput {
  readonly label: string
  readonly path: string
  /** For Ledger/Trezor the address comes from the device; accept a resolved one. */
  readonly address?: string
  readonly deviceId?: string
}

export type CreateAccountInput =
  | ({ readonly kind: 'hd' } & HdAccountInput)
  | ({ readonly kind: 'imported' } & ImportedAccountInput)
  | ({ readonly kind: 'watch' } & WatchAccountInput)
  | ({ readonly kind: 'ledger' | 'trezor' } & HardwareAccountInput)

export interface CreatedAccount {
  readonly account: VaultAccount
  readonly meta: VaultAccountMeta
}

function toChecksum(addr: string): string {
  const normalized = addr.startsWith('0x') ? addr : `0x${addr}`
  if (!isAddress(normalized, { strict: false })) throw new Error(`invalid address: ${addr}`)
  return getAddress(normalized)
}

/**
 * Build account metadata for an input, resolving the address from the key or
 * device where needed. Hardware accounts require the (device-resolved) address
 * at creation — the SW fetches it via the HW adapter before calling here.
 */
export function buildAccount(input: CreateAccountInput, seedHex: string | null): CreatedAccount {
  const id = newAccountId()
  switch (input.kind) {
    case 'hd': {
      if (seedHex === null) throw new Error('HD account requires a seed')
      const meta = hdAccountMeta(id, input.label, input.index, seedHex)
      return {
        meta,
        account: {
          id,
          kind: 'hd',
          label: meta.label,
          address: meta.address,
          index: meta.index,
          hasKey: true,
          createdAt: Date.now(),
        },
      }
    }
    case 'imported': {
      const address = privateKeyToAddress(input.privateKey)
      const meta: VaultAccountMeta = {
        id,
        kind: 'imported',
        label: input.label,
        address,
      }
      return {
        meta,
        account: {
          id,
          kind: 'imported',
          label: input.label,
          address,
          hasKey: true,
          createdAt: Date.now(),
        },
      }
    }
    case 'watch': {
      const address = toChecksum(input.address)
      const meta: VaultAccountMeta = {
        id,
        kind: 'watch',
        label: input.label,
        address,
      }
      return {
        meta,
        account: {
          id,
          kind: 'watch',
          label: input.label,
          address,
          hasKey: false,
          createdAt: Date.now(),
        },
      }
    }
    case 'ledger':
    case 'trezor': {
      if (!input.address) throw new Error(`hardware account ${input.kind} needs a device-resolved address`)
      const address = toChecksum(input.address)
      const meta: VaultAccountMeta = {
        id,
        kind: input.kind,
        label: input.label,
        address,
        hardware: { path: input.path, ...(input.deviceId ? { deviceId: input.deviceId } : {}) },
      }
      return {
        meta,
        account: {
          id,
          kind: input.kind,
          label: input.label,
          address,
          hasKey: false,
          hardware: { path: input.path, ...(input.deviceId ? { deviceId: input.deviceId } : {}) },
          createdAt: Date.now(),
        },
      }
    }
  }
}

/** Apply a created account to the plaintext. */
export function applyAccount(
  pt: VaultPlaintext,
  created: CreatedAccount,
  opts: { importedKey?: `0x${string}` } = {},
): VaultPlaintext {
  if (created.meta.kind === 'imported' && opts.importedKey) {
    return addImportedKey(pt, created.meta, opts.importedKey)
  }
  return addAccountToPlaintext(pt, created.meta)
}

/** All the accounts in a plaintext, as runtime VaultAccount values. */
export function accountsFromPlaintext(pt: VaultPlaintext): VaultAccount[] {
  return pt.accounts.map((m) => ({
    id: m.id,
    kind: m.kind,
    label: m.label,
    address: m.address,
    index: m.index,
    hardware: m.hardware,
    hasKey: m.kind === 'hd' || m.kind === 'imported',
    createdAt: 0,
  }))
}
