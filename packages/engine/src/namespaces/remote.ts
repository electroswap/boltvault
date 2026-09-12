/**
 * Remote sign (master plan §6, §8.16): a phone with a Trezor account, or
 * Firefox with a Ledger account, cannot sign here — a paired device can. The
 * requester seals a sign request into the pairing channel; the signing
 * device runs the full firewall on what it receives (never trusting the
 * requester's statements), shows the sheet with origin `device:<label>`,
 * signs with its own signer and seals the answer back; the requester
 * assembles, broadcasts and records. The relay only ever sees ciphertext.
 */
import type { SyncRecord } from '@boltvault/core'
import type { Platform } from '@boltvault/platform'
import type { ApprovalIntent } from '@boltvault/protocol'
import { parseTransaction, verifyMessage, verifyTypedData, type Hex, type TransactionSerializable, type TypedDataDefinition } from 'viem'
import { toAccount, type LocalAccount } from 'viem/accounts'
import { z } from 'zod'
import { GAS_CEILING_PERCENT, GAS_FLOOR_PERCENT } from '../approvalPayloads'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import { RemoteRequestSchema, type AccountView, type RemoteRequest } from '../schema'
import type { ProviderService } from './provider'
import type { SyncService } from './sync'
import type { VaultManager } from './vault'

export interface RemoteDeps {
  readonly platform: Platform
  readonly bus: EventBus
  readonly sync: SyncService
  readonly vault: VaultManager
  readonly provider: ProviderService
  /** Whether this body can sign the account locally (software key or a reachable device). */
  readonly canSignHere: (account: AccountView) => Promise<boolean>
  readonly pollMs?: number
  readonly timeoutMs?: number
}

const RequestValue = z.object({
  id: z.string(),
  address: z.string(),
  chainId: z.number().int().positive(),
  kind: z.enum(['transaction', 'message', 'typed_data']),
  /** transaction: the prepared fields; message: hex bytes; typed_data: the JSON. */
  payload: z.unknown(),
  at: z.number(),
})
type RequestValue = z.infer<typeof RequestValue>

const ResponseValue = z.object({ id: z.string(), signature: z.string().nullable(), error: z.string().nullable() })

const TxPayload = z.object({ to: z.string().nullable(), value: z.string(), data: z.string(), nonce: z.string(), gas: z.string(), type: z.enum(['legacy', 'eip1559']), gasPrice: z.string().optional(), maxFeePerGas: z.string().optional(), maxPriorityFeePerGas: z.string().optional() })

const hex = (n: bigint | number | undefined): string => `0x${BigInt(n ?? 0).toString(16)}`

/**
 * What a paired device is allowed to change about what it was asked to sign:
 * the price of gas, within the same band the local fee editor uses (§6).
 *
 * The requester used to resolve its promise with whatever string came back and
 * then only recover the signer's address — so a compromised laptop could answer
 * a phone's request with a signature over different calldata to the same
 * contract, and the phone would broadcast it and record the statements of the
 * transaction it had asked for. Recovering the address proves who signed, never
 * what.
 */
export function assertSignedTheTransaction(asked: TransactionSerializable, raw: Hex): void {
  let got: ReturnType<typeof parseTransaction>
  try {
    got = parseTransaction(raw)
  } catch {
    throw new EngineError('invalid_argument', 'The paired device answered with something that is not a signed transaction.')
  }
  const same =
    (got.chainId ?? 0) === (asked.chainId ?? 0) &&
    (got.nonce ?? 0) === (asked.nonce ?? 0) &&
    (got.to ?? null)?.toLowerCase() === (asked.to ?? null)?.toLowerCase() &&
    (got.value ?? 0n) === (asked.value ?? 0n) &&
    (got.data ?? '0x').toLowerCase() === (asked.data ?? '0x').toLowerCase() &&
    (got.gas ?? 0n) === (asked.gas ?? 0n)
  if (!same) throw new EngineError('invalid_argument', 'The paired device signed a different transaction from the one it was asked to sign.')
  /*
    The fee may move — a device with a fresher view of the chain is allowed to
    price it — but only inside the same 50–400 % band the local editor works
    in, measured against what was asked for.
  */
  const wanted = asked.type === 'eip1559' || (asked as { maxFeePerGas?: bigint }).maxFeePerGas !== undefined ? ((asked as { maxFeePerGas?: bigint }).maxFeePerGas ?? 0n) : ((asked as { gasPrice?: bigint }).gasPrice ?? 0n)
  const paid = got.maxFeePerGas ?? got.gasPrice ?? 0n
  if (wanted > 0n && (paid * 100n < wanted * BigInt(GAS_FLOOR_PERCENT) || paid * 100n > wanted * BigInt(GAS_CEILING_PERCENT)))
    throw new EngineError('invalid_argument', 'The paired device priced the transaction well outside what it was asked to pay.')
}

export async function assertSignedTheMessage(address: Hex, raw: Hex, signature: Hex): Promise<void> {
  const ok = await verifyMessage({ address, message: { raw }, signature }).catch(() => false)
  if (!ok) throw new EngineError('invalid_argument', 'The paired device signed a different message from the one it was asked to sign.')
}

export async function assertSignedTheTypedData(address: Hex, typedData: TypedDataDefinition, signature: Hex): Promise<void> {
  const ok = await verifyTypedData({ ...(typedData as Record<string, unknown>), address, signature } as never).catch(() => false)
  if (!ok) throw new EngineError('invalid_argument', 'The paired device signed different typed data from what it was asked to sign.')
}

export class RemoteSignService {
  private outgoing = new Map<string, RemoteRequest & { resolve: (sig: string) => void; reject: (err: Error) => void }>()
  private incoming = new Map<string, RemoteRequest>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: RemoteDeps) {}

  private emit(): void {
    this.deps.bus.emit({ type: 'remote.changed', outgoing: [...this.outgoing.values()].map(strip), incoming: [...this.incoming.values()] })
  }

  /** While anything is outstanding, pull the channel on a short cadence. */
  private ensurePolling(): void {
    if (this.timer) return
    const every = this.deps.pollMs ?? 3_000
    this.timer = setInterval(() => {
      void this.deps.sync.pull().catch(() => undefined)
      const now = this.deps.platform.now()
      for (const [id, o] of this.outgoing) {
        if (now - o.at > (this.deps.timeoutMs ?? 10 * 60_000)) {
          o.reject(new EngineError('internal', 'No paired device answered in time.'))
          this.outgoing.delete(id)
          this.emit()
        }
      }
      if (this.outgoing.size === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }, every)
  }

  /** The requester: a viem account whose every signature is a round trip to the paired devices. */
  async signerFor(account: AccountView): Promise<LocalAccount | null> {
    if ((await this.deps.sync.status()).devices.length === 0) return null
    const address = account.address as Hex
    const ask = (kind: RequestValue['kind'], payload: unknown, chainId: number): Promise<Hex> => this.request({ address, kind, payload, chainId })
    return toAccount({
      address,
      signMessage: async ({ message }) => {
        const raw = typeof message === 'string' ? `0x${Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, '0')).join('')}` : typeof message.raw === 'string' ? message.raw : `0x${Array.from(message.raw, (b) => b.toString(16).padStart(2, '0')).join('')}`
        const signature = await ask('message', raw, 0)
        await assertSignedTheMessage(address, raw as Hex, signature)
        return signature
      },
      signTransaction: async (transaction) => {
        const tx = transaction as TransactionSerializable
        const legacy = !tx.type || tx.type === 'legacy'
        const payload = { to: tx.to ?? null, value: hex(tx.value), data: tx.data ?? '0x', nonce: hex(tx.nonce), gas: hex(tx.gas), type: legacy ? 'legacy' : 'eip1559', ...(legacy ? { gasPrice: hex((tx as { gasPrice?: bigint }).gasPrice) } : { maxFeePerGas: hex((tx as { maxFeePerGas?: bigint }).maxFeePerGas), maxPriorityFeePerGas: hex((tx as { maxPriorityFeePerGas?: bigint }).maxPriorityFeePerGas) }) }
        const raw = await ask('transaction', payload, tx.chainId ?? 0)
        assertSignedTheTransaction(tx, raw)
        return raw
      },
      signTypedData: async (typedData) => {
        const signature = await ask('typed_data', JSON.stringify(typedData, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)), Number((typedData as TypedDataDefinition).domain?.chainId ?? 0))
        await assertSignedTheTypedData(address, typedData as TypedDataDefinition, signature)
        return signature
      },
      sign: async () => {
        throw new EngineError('not_implemented', 'Raw hashes are never signed on another device.')
      },
    })
  }

  private async request(input: { address: Hex; kind: RequestValue['kind']; payload: unknown; chainId: number }): Promise<Hex> {
    const id = Array.from(this.deps.platform.random(16), (b) => b.toString(16).padStart(2, '0')).join('')
    const at = this.deps.platform.now()
    const value: RequestValue = { id, address: input.address, chainId: input.chainId, kind: input.kind, payload: input.payload, at }
    const p = new Promise<Hex>((resolve, reject) => {
      this.outgoing.set(id, { id, address: input.address, chainId: input.chainId, kind: input.kind, from: null, at, state: 'waiting', resolve: (s) => resolve(s as Hex), reject })
    })
    await this.deps.sync.pushOne({ collection: 'signRequest', key: id, value })
    this.emit()
    this.ensurePolling()
    return p
  }

  /** Called by sync for every record of the two collections; returns whether it was consumed. */
  async onRecord(rec: SyncRecord, from: { deviceId: string; label: string }): Promise<boolean> {
    if (rec.collection === 'signResponse') {
      const r = ResponseValue.safeParse(rec.value)
      if (!r.success) return false
      const o = this.outgoing.get(r.data.id)
      if (!o) return true // a late answer for a request we gave up on
      this.outgoing.delete(r.data.id)
      if (r.data.signature) o.resolve(r.data.signature)
      else o.reject(new EngineError('rejected', r.data.error ?? `${from.label} declined.`))
      this.emit()
      return true
    }
    if (rec.collection === 'signRequest') {
      const r = RequestValue.safeParse(rec.value)
      if (!r.success) return false
      void this.handle(r.data, from)
      return true
    }
    return false
  }

  /** The signing device: the request becomes an approval with origin `device:<label>`, through the full firewall. */
  private async handle(req: RequestValue, from: { deviceId: string; label: string }): Promise<void> {
    if (this.incoming.has(req.id)) return
    const account = (await this.deps.vault.accounts()).find((a) => a.address.toLowerCase() === req.address.toLowerCase())
    if (!account || !(await this.deps.canSignHere(account))) return // another paired device may be the one
    const view: RemoteRequest = { id: req.id, address: req.address, chainId: req.chainId, kind: req.kind, from: from.label, at: req.at, state: 'waiting' }
    this.incoming.set(req.id, view)
    this.emit()
    const origin = `device:${from.label}`
    const answer = async (signature: string | null, error: string | null): Promise<void> => {
      this.incoming.delete(req.id)
      this.emit()
      await this.deps.sync.pushOne({ collection: 'signResponse', key: req.id, value: { id: req.id, signature, error } })
    }
    try {
      let intent: Extract<ApprovalIntent, { kind: 'send_transaction' | 'sign_typed_data' | 'sign_message' }>
      if (req.kind === 'transaction') {
        const tx = TxPayload.parse(req.payload)
        intent = { kind: 'send_transaction', origin, chainId: req.chainId, accountId: account.id, tx: { from: account.address as Hex, to: (tx.to as Hex | null) ?? undefined, value: tx.value as Hex, data: tx.data as Hex, nonce: tx.nonce as Hex, gas: tx.gas as Hex, ...(tx.type === 'legacy' ? { gasPrice: tx.gasPrice as Hex } : { maxFeePerGas: tx.maxFeePerGas as Hex, maxPriorityFeePerGas: tx.maxPriorityFeePerGas as Hex }) }, clientRequestId: `remote:${req.id}`, signOnly: true }
      } else if (req.kind === 'typed_data') {
        intent = { kind: 'sign_typed_data', origin, chainId: req.chainId, accountId: account.id, from: account.address as Hex, typedData: typeof req.payload === 'string' ? req.payload : JSON.stringify(req.payload), version: 'v4', clientRequestId: `remote:${req.id}` }
      } else {
        intent = { kind: 'sign_message', origin, chainId: req.chainId || 52014, accountId: account.id, from: account.address as Hex, message: String(req.payload) as Hex, clientRequestId: `remote:${req.id}` }
      }
      const r = await this.deps.provider.runInternal(intent)
      const result = await r.result
      await answer(typeof result === 'string' ? result : null, typeof result === 'string' ? null : 'The device produced no signature.')
    } catch (err) {
      await answer(null, err instanceof Error ? err.message : 'declined')
    }
  }

  list(): { outgoing: RemoteRequest[]; incoming: RemoteRequest[] } {
    return { outgoing: [...this.outgoing.values()].map(strip), incoming: [...this.incoming.values()] }
  }

  cancel(id: string): void {
    const o = this.outgoing.get(id)
    if (!o) return
    o.reject(new EngineError('rejected', 'Cancelled.'))
    this.outgoing.delete(id)
    this.emit()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

function strip(o: RemoteRequest & { resolve?: unknown; reject?: unknown }): RemoteRequest {
  return RemoteRequestSchema.parse({ id: o.id, address: o.address, chainId: o.chainId, kind: o.kind, from: o.from, at: o.at, state: o.state })
}

export function remoteNamespace(remote: RemoteSignService): NamespaceSpec {
  return {
    list: { handler: async () => remote.list() },
    cancel: { input: z.object({ id: z.string() }), handler: async (arg) => remote.cancel((arg as { id: string }).id) },
  }
}
