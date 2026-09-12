/**
 * A viem account backed by a Keystone (master plan §2.7 S7): every signature
 * is an `eth-sign-request` QR the engine shows and an `eth-signature` QR the
 * user scans back. The bridge is the engine's pending-request table; this
 * file only builds requests and assembles what comes back.
 */
import {
  getTypesForEIP712Domain,
  hexToBytes,
  serializeTransaction,
  toHex,
  type Hex,
  type TransactionSerializable,
  type TypedDataDefinition,
} from 'viem'
import { toAccount, type LocalAccount } from 'viem/accounts'
import { yParityByRecovery, yParityFromLedgerV } from '../ledger/v'
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

/*
  One implementation of the recovery byte, shared with the Ledger path.

  This file had its own, which subtracted 35 and took the parity of the
  result. That is right until the byte wraps: for a legacy EIP-155 signature
  `v` is `(chainId × 2 + 35 + parity) mod 256`, so on any chain where
  `chainId ≡ 110 (mod 128)` a parity of 1 lands on byte 0 and was then read
  back as parity 0 — an unrecoverable signature, silently. `yParityFromLedgerV`
  already does the modulo correctly and says why.
*/
function split(
  sig: Uint8Array,
  ctx: { chainId: number; legacy: boolean },
): { r: Hex; s: Hex; yParity: 0 | 1 } {
  return {
    r: toHex(sig.slice(0, 32)),
    s: toHex(sig.slice(32, 64)),
    yParity: yParityFromLedgerV(sig[64] ?? 0, ctx),
  }
}

/** Messages and typed data are never EIP-155, so their `v` is 0/1 or 27/28. */
function toSignature(sig: Uint8Array): Hex {
  const { r, s, yParity } = split(sig, { chainId: 0, legacy: false })
  return `0x${r.slice(2)}${s.slice(2)}${(27 + yParity).toString(16)}` as Hex
}

export function keystoneAccount(input: KeystoneAccountInput): LocalAccount {
  const { bridge, path, xfp } = input
  const ask = (
    dataType: KeystoneDataType,
    signData: Uint8Array,
    chainId?: number,
  ): Promise<Uint8Array> => {
    const requestId = asUuidBytes(bridge.random(16))
    const frames = encodeSignRequest({
      requestId,
      signData,
      dataType,
      path,
      xfp,
      ...(chainId !== undefined ? { chainId } : {}),
      address: input.address,
    })
    return bridge.request({ requestId, frames, dataType, address: input.address, path })
  }
  return toAccount({
    address: input.address,
    async signMessage({ message }) {
      const bytes =
        typeof message === 'string'
          ? new TextEncoder().encode(message)
          : typeof message.raw === 'string'
            ? hexToBytes(message.raw)
            : message.raw
      return toSignature(await ask('personal_message', bytes))
    },
    async signTransaction(transaction, options) {
      const tx = transaction as TransactionSerializable
      const chainId = tx.chainId ?? 0
      const legacy = !tx.type || tx.type === 'legacy'
      const serialize = options?.serializer ?? serializeTransaction
      const unsigned = await serialize(tx)
      const sig = await ask(
        legacy ? 'transaction' : 'typed_transaction',
        hexToBytes(unsigned),
        chainId,
      )
      const { r, s, yParity: hint } = split(sig, { chainId, legacy })
      const build = async (yParity: 0 | 1): Promise<Hex> => {
        const v = legacy ? BigInt(chainId) * 2n + 35n + BigInt(yParity) : BigInt(yParity)
        return serialize(tx, { r, s, v, yParity })
      }
      /*
        The legacy `v` convention is assumed here, not verified — the fake
        encodes exactly what this reads, so the suite only ever proved the two
        agree with each other. Trying both bits and keeping the one that
        recovers to this account removes the assumption entirely.
      */
      return build(await yParityByRecovery(build, input.address, hint))
    },
    async signTypedData(typedData) {
      /*
        Put `EIP712Domain` back before handing the message over.

        `normaliseTypedData` strips it upstream so viem can re-derive it, and
        the Ledger and Trezor paths rebuild it with viem's own rule so their
        digest matches the wallet's exactly. This path serialised the stripped
        object and let the device infer the domain type itself — which may
        include or exclude `salt`, or order fields differently, producing a
        digest for a domain separator the wallet never computed.
      */
      const td = typedData as TypedDataDefinition
      const domain = (td.domain ?? {}) as Parameters<typeof getTypesForEIP712Domain>[0]['domain']
      const complete = {
        ...td,
        domain: domain ?? {},
        types: { EIP712Domain: getTypesForEIP712Domain({ domain }), ...td.types },
      }
      const json = JSON.stringify(complete, (_k, v: unknown) =>
        typeof v === 'bigint' ? v.toString() : v,
      )
      const chainId = typeof domain?.chainId === 'number' ? domain.chainId : undefined
      return toSignature(await ask('typed_data', new TextEncoder().encode(json), chainId))
    },
    async sign() {
      throw new Error(
        'A Keystone will not sign a raw hash. Use a signed message or a transaction instead.',
      )
    },
  })
}
