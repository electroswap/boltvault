/**
 * A viem account backed by a Keystone (master plan §2.7 S7): every signature
 * is an `eth-sign-request` QR the engine shows and an `eth-signature` QR the
 * user scans back. The bridge is the engine's pending-request table; this
 * file only builds requests and assembles what comes back.
 */
import { hexToBytes, serializeTransaction, toHex, type Hex, type TransactionSerializable, type TypedDataDefinition } from 'viem'
import { toAccount, type LocalAccount } from 'viem/accounts'
import { asUuidBytes, encodeSignRequest, type KeystoneDataType } from './ur'

export type { KeystoneDataType }

export interface KeystoneRequest {
  readonly requestId: Uint8Array
  readonly frames: string[]
  readonly dataType: KeystoneDataType
  readonly address: Hex
  readonly path: string
}

export interface KeystoneBridge {
  /** Show the frames, wait for the scanned answer; resolves with the 65-byte signature whose request id matched. */
  request(req: KeystoneRequest): Promise<Uint8Array>
  random(n: number): Uint8Array
}

export interface KeystoneAccountInput {
  readonly address: Hex
  readonly path: string
  readonly xfp: string
  readonly bridge: KeystoneBridge
}

function parity(v: number): 0 | 1 {
  if (v >= 35) return ((v - 35) % 2) as 0 | 1
  if (v >= 27) return ((v - 27) % 2) as 0 | 1
  return (v % 2) as 0 | 1
}

function split(sig: Uint8Array): { r: Hex; s: Hex; yParity: 0 | 1 } {
  return { r: toHex(sig.slice(0, 32)), s: toHex(sig.slice(32, 64)), yParity: parity(sig[64] ?? 0) }
}

function toSignature(sig: Uint8Array): Hex {
  const { r, s, yParity } = split(sig)
  return `0x${r.slice(2)}${s.slice(2)}${(27 + yParity).toString(16)}` as Hex
}

export function keystoneAccount(input: KeystoneAccountInput): LocalAccount {
  const { bridge, path, xfp } = input
  const ask = (dataType: KeystoneDataType, signData: Uint8Array, chainId?: number): Promise<Uint8Array> => {
    const requestId = asUuidBytes(bridge.random(16))
    const frames = encodeSignRequest({ requestId, signData, dataType, path, xfp, ...(chainId !== undefined ? { chainId } : {}), address: input.address })
    return bridge.request({ requestId, frames, dataType, address: input.address, path })
  }
  return toAccount({
    address: input.address,
    async signMessage({ message }) {
      const bytes = typeof message === 'string' ? new TextEncoder().encode(message) : typeof message.raw === 'string' ? hexToBytes(message.raw) : message.raw
      return toSignature(await ask('personal_message', bytes))
    },
    async signTransaction(transaction, options) {
      const tx = transaction as TransactionSerializable
      const chainId = tx.chainId ?? 0
      const legacy = !tx.type || tx.type === 'legacy'
      const serialize = options?.serializer ?? serializeTransaction
      const unsigned = await serialize(tx)
      const sig = await ask(legacy ? 'transaction' : 'typed_transaction', hexToBytes(unsigned), chainId)
      const { r, s, yParity } = split(sig)
      const v = legacy ? BigInt(chainId) * 2n + 35n + BigInt(yParity) : BigInt(yParity)
      return serialize(tx, { r, s, v, yParity })
    },
    async signTypedData(typedData) {
      const td = typedData as TypedDataDefinition
      const json = JSON.stringify(td, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))
      return toSignature(await ask('typed_data', new TextEncoder().encode(json)))
    },
    async sign() {
      throw new Error('A Keystone will not sign a raw hash. Use a signed message or a transaction instead.')
    },
  })
}
