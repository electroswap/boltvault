/**
 * A viem account backed by a Ledger (master plan §2.7 S3): transactions are
 * serialised unsigned, signed on the device, `v` normalised to `yParity`,
 * then re-serialised; messages and typed data go through the app's own
 * flows. Raw hash signing (`eth_sign`) is not something a Ledger will do.
 */
import {
  getTypesForEIP712Domain,
  hashDomain,
  hashStruct,
  hexToBytes,
  serializeTransaction,
  stringToBytes,
  type Hex,
  type TransactionSerializable,
  type TypedDataDefinition,
} from 'viem'
import { toAccount, type LocalAccount } from 'viem/accounts'
import { LedgerError } from './apdu'
import type { Eip712TypedData } from './eip712'
import { supportsClearSigning, type LedgerEthApp } from './eth'
import { legacyV, yParityByRecovery, yParityFromLedgerV } from './v'

export interface LedgerAccountInput {
  readonly address: Hex
  readonly path: string
  readonly app: LedgerEthApp
  /**
   * Called when typed data had to be signed by hashes after all, with the
   * reason. The sheet already warns when the app is too old; this catches the
   * cases only the message itself can reveal.
   */
  readonly onHashedTypedData?: (reason: string) => void
}

function toSignature(r: Hex, s: Hex, v: number): Hex {
  return `0x${r.slice(2)}${s.slice(2)}${v.toString(16).padStart(2, '0')}` as Hex
}

/** A `LocalAccount` whose `source` says where the keys live, so the engine can label the sheet. */
export function ledgerAccount(input: LedgerAccountInput): LocalAccount {
  const { app, path } = input
  return toAccount({
    address: input.address,
    async signMessage({ message }) {
      const bytes =
        typeof message === 'string'
          ? stringToBytes(message)
          : typeof message.raw === 'string'
            ? hexToBytes(message.raw)
            : message.raw
      const sig = await app.signPersonalMessage(path, bytes)
      const v = sig.v >= 27 ? sig.v : sig.v + 27
      return toSignature(sig.r, sig.s, v)
    },
    async signTransaction(transaction, options) {
      const tx = transaction as TransactionSerializable
      const chainId = tx.chainId ?? 0
      const legacy = !tx.type || tx.type === 'legacy'
      const serialize = options?.serializer ?? serializeTransaction
      const unsigned = await serialize(tx)
      const sig = await app.signTransaction(path, hexToBytes(unsigned), chainId)
      const build = async (yParity: 0 | 1): Promise<Hex> => {
        const v = legacy
          ? chainId === 0
            ? 27n + BigInt(yParity)
            : legacyV(chainId, yParity)
          : BigInt(yParity)
        return serialize(tx, { r: sig.r, s: sig.s, v, yParity })
      }
      // Recovered, not interpreted: see `yParityByRecovery`.
      return build(
        await yParityByRecovery(
          build,
          input.address,
          yParityFromLedgerV(sig.v, { chainId, legacy }),
        ),
      )
    },
    async signTypedData(typedData) {
      const td = typedData as TypedDataDefinition
      const domain = (td.domain ?? {}) as Parameters<typeof getTypesForEIP712Domain>[0]['domain']
      const types = {
        EIP712Domain: getTypesForEIP712Domain({ domain }),
        ...td.types,
      } as Parameters<typeof hashStruct>[0]['types']
      /*
        Tell the device what it is signing, and only fall back to hashes when
        it cannot be told (ES-BV-006).

        Permit2 and Seaport signatures move tokens with no transaction behind
        them, so a typed-data signature is exactly the case a hardware wallet
        exists for — and a device shown two 32-byte hashes is checking
        nothing. The full flow describes every struct and walks every value, so
        the spender, the amount and the deadline appear on the device's own
        screen.

        Three things send us back to hashes: an app too old for the
        instructions, a message shaped in a way the app cannot be told about
        (`eip712Plan` throws before anything is sent), and a device that
        refuses the flow mid-way. A rejection is not one of them — that is
        the user's answer and it stands.
      */
      const full = await (async (): Promise<{ v: number; r: Hex; s: Hex } | null> => {
        try {
          const { version } = await app.getAppConfiguration()
          if (!supportsClearSigning(version)) {
            input.onHashedTypedData?.('The Ethereum app on this Ledger is too old to show the fields.')
            return null
          }
          return await app.signTypedDataFull(path, {
            types: types as unknown as Eip712TypedData['types'],
            primaryType: td.primaryType,
            domain: (domain ?? {}) as Record<string, unknown>,
            message: td.message as Record<string, unknown>,
          })
        } catch (err) {
          if (err instanceof LedgerError && err.code === 'rejected') throw err
          input.onHashedTypedData?.(err instanceof Error ? err.message : 'The device could not be shown this message.')
          return null
        }
      })()
      const sig =
        full ??
        (await app.signTypedDataHashed(
          path,
          hexToBytes(hashDomain({ domain: domain ?? {}, types })),
          hexToBytes(
            hashStruct({
              data: td.message as Record<string, unknown>,
              primaryType: td.primaryType,
              types,
            }),
          ),
        ))
      const v = sig.v >= 27 ? sig.v : sig.v + 27
      return toSignature(sig.r, sig.s, v)
    },
    async sign() {
      throw new LedgerError(
        'unsupported',
        0,
        'A Ledger will not sign a raw hash. Use a signed message or a transaction instead.',
      )
    },
  })
}
