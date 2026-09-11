/**
 * External dApp transports (master plan §2.7 S9, §5.3): the in-app browser's
 * WebView and WalletConnect sessions become virtual channels on the same
 * `provider.serve` the extension's content ports use, so every request goes
 * through the one rpcFlow, the per-origin sessions and the firewall. The
 * origin is what the host observed (the committed navigation URL, Verify's
 * attestation) — never what the page claims; non-http origins are refused.
 */
import { registrableOrigin } from '@boltvault/security'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import type { DappSession } from '../schema'
import type { MessageChannelLike } from '../transport'
import type { ProviderService } from './provider'

export interface DappsDeps {
  readonly provider: ProviderService
  readonly bus: EventBus
  readonly now: () => number
  readonly random: (n: number) => Uint8Array
}

interface Live {
  readonly view: DappSession
  readonly listeners: Set<(message: unknown) => void>
  readonly disconnects: Set<() => void>
  readonly pending: Map<number, (m: { result?: unknown; error?: { code: number; message: string; data?: unknown } }) => void>
  stop: () => void
}

const ResponseShape = z.object({ kind: z.literal('response'), id: z.number(), result: z.unknown().optional(), error: z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() }).optional() })
const EventShape = z.object({ kind: z.literal('event'), event: z.string(), payload: z.unknown() })

export class DappsService {
  private sessions = new Map<string, Live>()

  constructor(private readonly deps: DappsDeps) {}

  /** Open a session for an origin the host observed. `url` is normalised to its registrable origin. */
  open(input: { url: string; kind: 'webview' | 'walletconnect'; verified?: boolean }): DappSession {
    const origin = registrableOrigin(input.url)
    if (!origin) throw new EngineError('invalid_argument', 'Only http(s) pages can connect.')
    const sessionId = Array.from(this.deps.random(8), (b) => b.toString(16).padStart(2, '0')).join('')
/*
      "Verified" used to default to true for every WebView session, which made
      the trust chip a constant: it said the same thing for an HTTPS dApp and
      for a cleartext page an attacker had rewritten in flight. The caller
      knows what it observed; it has to say so.
    */
    const live: Live = { view: { sessionId, origin, kind: input.kind, verified: input.verified ?? false, openedAt: this.deps.now() }, listeners: new Set(), disconnects: new Set(), pending: new Map(), stop: () => undefined }
    const channel: MessageChannelLike = {
      post: (message) => {
        const r = ResponseShape.safeParse(message)
        if (r.success) {
          const waiter = live.pending.get(r.data.id)
          live.pending.delete(r.data.id)
          waiter?.(r.data.error ? { error: r.data.error } : { result: r.data.result ?? null })
          return
        }
        const e = EventShape.safeParse(message)
        if (e.success) this.deps.bus.emit({ type: 'dapp.event', sessionId, origin, event: e.data.event, payload: e.data.payload })
      },
      onMessage: (listener) => {
        live.listeners.add(listener)
        return () => {
          live.listeners.delete(listener)
        }
      },
      onDisconnect: (listener) => {
        live.disconnects.add(listener)
        return () => {
          live.disconnects.delete(listener)
        }
      },
    }
    live.stop = this.deps.provider.serve(channel, origin, { kind: input.kind, verified: live.view.verified })
    this.sessions.set(sessionId, live)
    return live.view
  }

  /** One EIP-1193 request from the page; resolves with the JSON-RPC result or error the flow produced. */
  request(input: { sessionId: string; id: number; method: string; params?: unknown }): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }> {
    const live = this.sessions.get(input.sessionId)
    if (!live) return Promise.resolve({ error: { code: 4900, message: 'The session is closed.' } })
    return new Promise((resolve) => {
      live.pending.set(input.id, resolve)
      const message = { kind: 'request', id: input.id, method: input.method, ...(input.params !== undefined ? { params: input.params } : {}), session: input.sessionId }
      for (const l of [...live.listeners]) l(message)
    })
  }

  close(input: { sessionId: string }): void {
    const live = this.sessions.get(input.sessionId)
    if (!live) return
    this.sessions.delete(input.sessionId)
    for (const d of [...live.disconnects]) d()
    live.stop()
    for (const waiter of live.pending.values()) waiter({ error: { code: 4900, message: 'The session is closed.' } })
    live.pending.clear()
  }

  list(): DappSession[] {
    return [...this.sessions.values()].map((l) => l.view)
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.close({ sessionId: id })
  }
}

export function dappsNamespace(dapps: DappsService): NamespaceSpec {
  return {
    open: { input: z.object({ url: z.string().min(1), kind: z.enum(['webview', 'walletconnect']), verified: z.boolean().optional() }), handler: async (arg) => dapps.open(arg as { url: string; kind: 'webview' | 'walletconnect'; verified?: boolean }) },
    request: { input: z.object({ sessionId: z.string(), id: z.number(), method: z.string().min(1).max(64), params: z.unknown().optional() }), handler: (arg) => dapps.request(arg as { sessionId: string; id: number; method: string; params?: unknown }) },
    close: { input: z.object({ sessionId: z.string() }), handler: async (arg) => dapps.close(arg as { sessionId: string }) },
    list: { handler: async () => dapps.list() },
  }
}
