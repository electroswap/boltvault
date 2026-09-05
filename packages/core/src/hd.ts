import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeedSync,
  validateMnemonic,
} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { HDKey } from '@scure/bip32'
import { getAddress } from 'viem'
import { privateKeyToAddress } from 'viem/accounts'
import { toHex } from './vault.js'
import type { AccountId, VaultAccountMeta } from './types.js'

/**
 * BIP-39 + BIP-44 HD derivation, Ethereum path `m/44'/60'/0'/0/i`.
 *
 * Crypto kernel per design S2: @scure everywhere (no node:crypto), so this
 * runs in the MV3 SW and RN identically. The seed hex is stored in the vault
 * envelope (VaultPlaintext.seedHex); per-account keys are derived on demand and
 * only ever handed to the signing isolate.
 */

const BIP44_ETHEREUM = "m/44'/60'/0'/0"

export interface MnemonicEntropy {
  /** Bits of entropy: 128 (12 words) or 256 (24 words). */
  readonly bits: number
  readonly entropy: Uint8Array
  readonly mnemonic: string
}

export function generateEntropy(bits: 128 | 256 = 128): MnemonicEntropy {
  const entropy = new Uint8Array(bits / 8)
  crypto.getRandomValues(entropy)
  return { bits, entropy, mnemonic: entropyToMnemonic(entropy, wordlist) }
}

export function validateMnemonicStr(phrase: string): boolean {
  return validateMnemonic(phrase.trim(), wordlist)
}

export function mnemonicHex(phrase: string): string {
  return `0x${toHex(mnemonicToEntropy(phrase.trim(), wordlist))}`
}

/** Seed (64-byte) from a mnemonic; `seedHex` is what we store in the vault. */
export function seedHexFromMnemonic(phrase: string): string {
  return `0x${toHex(mnemonicToSeedSync(phrase.trim()))}`
}

export function mnemonicFromSeedHex(seedHex: string): { mnemonic: string; seedHex: string } {
  // For a new vault we generate entropy→mnemonic→seed. For import-by-mnemonic
  // we go the other way. This helper reconstructs the mnemonic from entropy hex.
  const entropy = fromHexBytes(seedHex)
  return { mnemonic: entropyToMnemonic(entropy, wordlist), seedHex }
}

const fromHexBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/, '')
  const u8 = new Uint8Array(clean.length / 2)
  for (let i = 0; i < u8.length; i++) u8[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return u8
}

export interface DerivedAccount {
  readonly index: number
  readonly path: string
  readonly privateKey: `0x${string}`
  readonly publicKey: `0x${string}`
  readonly address: string
}

function rootFromSeedHex(seedHex: string): HDKey {
  return HDKey.fromMasterSeed(fromHexBytes(seedHex))
}

/** Derive the Nth BIP-44 Ethereum account (0-indexed). */
export function deriveAccount(seedHex: string, index: number): DerivedAccount {
  const root = rootFromSeedHex(seedHex)
  const path = `${BIP44_ETHEREUM}/${index}`
  const node = root.derive(path)
  if (!node.privateKey) throw new Error(`no private key at ${path}`)
  const privateKey = `0x${toHex(node.privateKey)}` as `0x${string}`
  const publicKey = node.publicKey
  if (!publicKey) throw new Error(`no public key at ${path}`)
  return {
    index,
    path,
    privateKey,
    publicKey: `0x${toHex(publicKey)}` as `0x${string}`,
    address: privateKeyToAddress(privateKey),
  }
}

/**
 * Address discovery (Address management surface): scan consecutive BIP-44
 * indices, returning those that have on-chain activity. `probe` is an injected
 * async fn (RPC-dependent); core stays RPC-free. Stops after `gap` consecutive
 * empty accounts (default 3, per BIP-44 convention), bounded by `maxAccounts`.
 */
export async function discoverAccounts(
  seedHex: string,
  probe: (account: DerivedAccount) => Promise<boolean>,
  opts: { maxAccounts?: number; gap?: number } = {},
): Promise<DerivedAccount[]> {
  const max = opts.maxAccounts ?? 20
  const gap = opts.gap ?? 3
  const found: DerivedAccount[] = []
  let empty = 0
  for (let i = 0; i < max; i++) {
    const acc = deriveAccount(seedHex, i)
    if (await probe(acc)) {
      found.push(acc)
      empty = 0
    } else {
      empty++
      if (empty >= gap) break
    }
  }
  return found
}

/** Build vault account metadata for a derived (HD) account. */
export function hdAccountMeta(accountId: AccountId, label: string, index: number, seedHex: string): VaultAccountMeta {
  const acc = deriveAccount(seedHex, index)
  return {
    id: accountId,
    kind: 'hd',
    label,
    address: acc.address,
    index,
  }
}

export { getAddress }
