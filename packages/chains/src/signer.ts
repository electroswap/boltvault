import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts'
import { keccak256, isHex } from 'viem'
import type { Account, Hex, SignTypedDataParameters, TransactionRequest } from 'viem'

/**
 * Local private-key signer (T2.2).
 *
 * BoltVault holds the *master seed* in the vault; a session "local signer" is a
 * viem LocalAccount backed by one derived child key (T1.2 `deriveAccount`). The
 * private key never leaves the SW / keychain. Signing is local — the dApp only
 * sees the signed bytes.
 *
 * Wraps viem 2.x `viem/accounts` so the rest of the codebase never deals with
 * the version-specific export surface.
 */
export interface SignedTransaction {
  /** Serialized signed transaction (feed to eth_sendRawTransaction). */
  readonly raw: Hex
  /** keccak256(raw) — the transaction hash. */
  readonly hash: Hex
}

export class LocalSigner {
  private readonly account: Account
  private readonly _address: string

  private constructor(address: string, account: Account) {
    this._address = address
    this.account = account
  }

  get address(): string {
    return this._address
  }

  /** Signer from a raw private key (a T1.2 derived child). */
  static fromPrivateKey(privateKey: Hex): LocalSigner {
    const account = privateKeyToAccount(privateKey)
    return new LocalSigner(account.address, account)
  }

  /**
   * Signer from a BIP-39 mnemonic (the vault's master seed). Derives the
   * first BIP-44 Ethereum account (m/44'/60'/0'/0/0) — the same vector core's
   * `deriveAccount(seedHex, 0)` produces.
   */
  static fromMnemonic(mnemonic: string): LocalSigner {
    const account = mnemonicToAccount(mnemonic)
    return new LocalSigner(account.address, account)
  }

  private get signMethods() {
    const acc = this.account as unknown as {
      signTransaction: (tx: Record<string, unknown>) => Promise<Hex>
      signMessage: (p: { message: string | Uint8Array }) => Promise<Hex>
      signTypedData: (p: SignTypedDataParameters) => Promise<Hex>
    }
    return acc
  }

  /** Sign an unsigned transaction → raw RLP blob + keccak256 hash. */
  async signTransaction(
    tx: Omit<TransactionRequest, 'from'> & { chainId: number },
  ): Promise<SignedTransaction> {
    const raw = await this.signMethods.signTransaction({ ...tx })
    if (!isHex(raw)) throw new Error('signTransaction did not return hex')
    return { raw, hash: keccak256(raw) }
  }

  /** Sign an EIP-191 personal message (personal_sign). */
  async signMessage(message: string | Uint8Array): Promise<Hex> {
    return this.signMethods.signMessage({ message })
  }

  /** Sign EIP-712 typed data (connect / approvals / swap permits). */
  async signTypedData(params: SignTypedDataParameters): Promise<Hex> {
    return this.signMethods.signTypedData(params)
  }
}
