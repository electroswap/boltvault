/**
 * A viem account backed by a Trezor (master plan §2.7 S3): transactions are
 * signed field by field through Connect (`ethereumSignTransaction` takes the
 * 1559 fields), messages through `ethereumSignMessage`, typed data fully on
 * Model T / Safe and by hashes on Model One. Raw hashes are never signed.
 */
import {
  getTypesForEIP712Domain,
  hashDomain,
  hashStruct,
  hexToBytes,
  serializeTransaction,
  toHex,
  type Hex,
  type TransactionSerializable,
  type TypedDataDefinition,
} from 'viem'
import { toAccount, type LocalAccount } from 'viem/accounts'
import { TrezorError, unwrap, yParityFromTrezorV, type TrezorConnectLike } from './connect'

export interface TrezorAccountInput {
  readonly address: Hex
  readonly path: string
  readonly connect: TrezorConnectLike
  /** Model One cannot show typed data; it signs the two hashes instead. */
  readonly hashesOnly?: boolean
}

const hex = (n: bigint | number | undefined): string => `0x${BigInt(n ?? 0).toString(16)}`

export function trezorAccount(input: TrezorAccountInput): LocalAccount {
  const { connect, path } = input
  return toAccount({
    address: input.address,
    async signMessage({ message }) {
      const bytes =
        typeof message === 'string'
          ? new TextEncoder().encode(message)
          : typeof message.raw === 'string'
            ? hexToBytes(message.raw)
            : message.raw
      const r = unwrap(
        await connect.ethereumSignMessage({ path, message: toHex(bytes).slice(2), hex: true }),
      )
      return normaliseSignature(r.signature)
    },
    async signTransaction(transaction, options) {
      const tx = transaction as TransactionSerializable
      const chainId = tx.chainId ?? 0
      const legacy = !tx.type || tx.type === 'legacy'
      const serialize = options?.serializer ?? serializeTransaction
      const fields = {
        to: tx.to ?? '',
        value: hex(tx.value),
        gasLimit: hex(tx.gas),
        nonce: hex(tx.nonce ?? 0),
        chainId,
        ...(tx.data && tx.data !== '0x' ? { data: tx.data } : {}),
        ...(legacy
          ? { gasPrice: hex((tx as { gasPrice?: bigint }).gasPrice) }
          : {
              maxFeePerGas: hex((tx as { maxFeePerGas?: bigint }).maxFeePerGas),
              maxPriorityFeePerGas: hex(
                (tx as { maxPriorityFeePerGas?: bigint }).maxPriorityFeePerGas,
              ),
            }),
      }
      const sig = unwrap(await connect.ethereumSignTransaction({ path, transaction: fields }))
      const yParity = yParityFromTrezorV(sig.v)
      const v = legacy ? BigInt(chainId) * 2n + 35n + BigInt(yParity) : BigInt(yParity)
      return serialize(tx, { r: sig.r as Hex, s: sig.s as Hex, v, yParity })
    },
    async signTypedData(typedData) {
      const td = typedData as TypedDataDefinition
      const domain = (td.domain ?? {}) as Parameters<typeof getTypesForEIP712Domain>[0]['domain']
      const types = {
        EIP712Domain: getTypesForEIP712Domain({ domain }),
        ...td.types,
      } as Parameters<typeof hashStruct>[0]['types']
      const domainSeparator = hashDomain({ domain: domain ?? {}, types })
      const messageHash = hashStruct({
        data: td.message as Record<string, unknown>,
        primaryType: td.primaryType,
        types,
      })
      const data = {
        types,
        domain: td.domain ?? {},
        primaryType: td.primaryType,
        message: td.message,
      }
      const r = unwrap(
        await connect.ethereumSignTypedData({
          path,
          data,
          metamask_v4_compat: true,
          ...(input.hashesOnly
            ? { domain_separator_hash: domainSeparator, message_hash: messageHash }
            : {}),
        }),
      )
      return normaliseSignature(r.signature)
    },
    async sign() {
      throw new TrezorError(
        'Method_Unsupported',
        'A Trezor will not sign a raw hash. Use a signed message or a transaction instead.',
      )
    },
  })
}

/** Connect returns 65-byte signatures with v as 27/28 (sometimes 0/1); viem wants 27/28. */
export function normaliseSignature(signature: string): Hex {
  const s = signature.startsWith('0x') ? signature.slice(2) : signature
  if (s.length !== 130)
    throw new TrezorError(
      'Failure_DataError',
      'The Trezor returned a signature of the wrong length.',
    )
  const v = Number.parseInt(s.slice(128), 16)
  const fixed = v < 27 ? v + 27 : v
  return `0x${s.slice(0, 128)}${fixed.toString(16).padStart(2, '0')}` as Hex
}
