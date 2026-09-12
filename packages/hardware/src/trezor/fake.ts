/**
 * A scripted Trezor Connect for tests and the harness: keys derived per path
 * from a seed, Connect's exact result shapes (legacy `v` with the chain
 * offset, 27/28 elsewhere), a "cancel on device" switch, and a log of what
 * the wallet asked for. No popup, no device.
 */
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import { hashMessage, hashTypedData, hexToBytes, keccak256, serializeTransaction, type Hex, type TypedDataDefinition } from 'viem'
import { privateKeyToAccount, sign } from 'viem/accounts'
import type { TrezorConnectLike, TrezorResult, TrezorTransactionInput } from './connect'

export interface FakeTrezorOptions {
  readonly seed?: Uint8Array
  readonly model?: string
  readonly label?: string
}

function keyFor(seed: Uint8Array, path: string): Hex {
  const k = hmac(sha256, seed, new TextEncoder().encode(path))
  let s = '0x'
  for (const b of k) s += b.toString(16).padStart(2, '0')
  return s as Hex
}

const cancelled: TrezorResult<never> = { success: false, payload: { error: 'Action cancelled by user', code: 'Failure_ActionCancelled' } }

export class FakeTrezorConnect implements TrezorConnectLike {
  cancelNext = false
  disconnected = false
  initialised = false
  readonly log: string[] = []
  private readonly seed: Uint8Array
  private readonly model: string
  private readonly label: string

  constructor(opts: FakeTrezorOptions = {}) {
    this.seed = opts.seed ?? new Uint8Array(32).fill(9)
    this.model = opts.model ?? 'T'
    this.label = opts.label ?? 'My Trezor'
  }

  addressFor(path: string): Hex {
    return privateKeyToAccount(keyFor(this.seed, path)).address
  }

  async init(): Promise<void> {
    this.initialised = true
  }

  dispose(): void {
    this.initialised = false
  }

  private guard<T>(name: string): TrezorResult<T> | null {
    this.log.push(name)
    if (this.disconnected) return { success: false, payload: { error: 'device disconnected during action', code: 'Device_Disconnected' } }
    if (this.cancelNext) {
      this.cancelNext = false
      return cancelled
    }
    return null
  }

  async getFeatures() {
    const g = this.guard<never>('getFeatures')
    if (g) return g
    return { success: true as const, payload: { model: this.model, label: this.label, major_version: 2, minor_version: 8, patch_version: 1, initialized: true } }
  }

  async ethereumGetAddress(input: { path: string; showOnTrezor?: boolean }) {
    const g = this.guard<{ address: string; serializedPath?: string }>(`getAddress:${input.path}:${input.showOnTrezor ? 'show' : ''}`)
    if (g) return g
    return { success: true as const, payload: { address: this.addressFor(input.path), serializedPath: input.path } }
  }

  async ethereumGetAddressBundle(input: { bundle: Array<{ path: string; showOnTrezor: false }> }) {
    const g = this.guard<Array<{ address: string; serializedPath?: string }>>('getAddressBundle')
    if (g) return g
    return { success: true as const, payload: input.bundle.map((b) => ({ address: this.addressFor(b.path), serializedPath: b.path })) }
  }

  async ethereumSignTransaction(input: { path: string; transaction: TrezorTransactionInput }) {
    const g = this.guard<{ v: string | number; r: string; s: string }>(`signTransaction:${input.path}`)
    if (g) return g
    const t = input.transaction
    const legacy = t.gasPrice !== undefined
    const base = { chainId: t.chainId, nonce: Number.parseInt(t.nonce, 16), to: t.to as Hex, value: BigInt(t.value), gas: BigInt(t.gasLimit), data: (t.data ?? '0x') as Hex }
    const unsigned = legacy ? serializeTransaction({ ...base, type: 'legacy', gasPrice: BigInt(t.gasPrice ?? '0x0') }) : serializeTransaction({ ...base, type: 'eip1559', maxFeePerGas: BigInt(t.maxFeePerGas ?? '0x0'), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGas ?? '0x0') })
    const sig = await sign({ hash: keccak256(unsigned), privateKey: keyFor(this.seed, input.path) })
    const parity = Number(sig.yParity ?? (sig.v !== undefined ? sig.v - 27n : 0n))
    // Connect reports legacy v with the EIP-155 offset and typed transactions with 27/28.
    const v = legacy ? t.chainId * 2 + 35 + parity : 27 + parity
    return { success: true as const, payload: { v: `0x${v.toString(16)}`, r: sig.r, s: sig.s } }
  }

  async ethereumSignMessage(input: { path: string; message: string; hex: boolean }) {
    const g = this.guard<{ address: string; signature: string }>(`signMessage:${input.path}`)
    if (g) return g
    const bytes = input.hex ? hexToBytes(`0x${input.message}`) : new TextEncoder().encode(input.message)
    const sig = await sign({ hash: hashMessage({ raw: bytes }), privateKey: keyFor(this.seed, input.path), to: 'hex' })
    return { success: true as const, payload: { address: this.addressFor(input.path), signature: sig.slice(2) } }
  }

  async ethereumSignTypedData(input: { path: string; data: unknown; metamask_v4_compat: boolean }) {
    const g = this.guard<{ address: string; signature: string }>(`signTypedData:${input.path}`)
    if (g) return g
    const td = input.data as TypedDataDefinition
    const sig = await sign({ hash: hashTypedData(td), privateKey: keyFor(this.seed, input.path), to: 'hex' })
    return { success: true as const, payload: { address: this.addressFor(input.path), signature: sig.slice(2) } }
  }
}
