/**
 * EngineHost — dispatches validated requests to namespace handlers and fans
 * out events. Body-agnostic: the extension serves it over a Port, mobile calls
 * it in-process.
 *
 * Sender classes (master plan §3.5): every request arrives with a class the
 * *transport* established (never the payload). `content` (a dApp's content
 * script) may call nothing in M0 — provider traffic goes through rpcFlow, not
 * this API. `ui` is an extension page or the mobile app; `internal` is the
 * host itself (mobile in-process); `device` is a paired device (§6, later).
 */
import type { ZodType } from 'zod'
import { EngineError } from './errors'
import type { EngineEvent } from './schema'
import type { EngineRequest, EngineResponse } from './wire'
import { WIRE_VERSION } from './wire'

export type SenderClass = 'ui' | 'internal' | 'content' | 'device'

export type Handler = (arg: unknown, sender: SenderClass) => Promise<unknown>

export interface MethodSpec {
  /** Input schema; `undefined` means the method takes no argument. */
  readonly input?: ZodType<unknown>
  readonly handler: Handler
  /** Sender classes allowed to call this method. Default: ui + internal. */
  readonly allow?: readonly SenderClass[]
}

export type NamespaceSpec = Record<string, MethodSpec>

export type EventListener = (event: EngineEvent) => void

export class EventBus {
  private readonly listeners = new Set<EventListener>()

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: EngineEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(event)
      } catch {
        // a listener must never break the host
      }
    }
  }
}

const DEFAULT_ALLOW: readonly SenderClass[] = ['ui', 'internal']

export class EngineHost {
  private readonly namespaces = new Map<string, NamespaceSpec>()
  readonly events = new EventBus()

  register(name: string, spec: NamespaceSpec): void {
    if (this.namespaces.has(name)) throw new Error(`namespace already registered: ${name}`)
    this.namespaces.set(name, spec)
  }

  has(ns: string, method: string): boolean {
    return this.namespaces.get(ns)?.[method] !== undefined
  }

  /** Invoke a method directly (in-process transport). Throws EngineError. */
  async invoke(ns: string, method: string, arg: unknown, sender: SenderClass): Promise<unknown> {
    const spec = this.namespaces.get(ns)?.[method]
    if (!spec) throw new EngineError('not_implemented', `${ns}.${method} is not available`)
    const allow = spec.allow ?? DEFAULT_ALLOW
    if (!allow.includes(sender)) {
      throw new EngineError('unauthorized', `${ns}.${method} is not callable by ${sender}`)
    }
    let parsed: unknown = undefined
    if (spec.input) {
      const res = spec.input.safeParse(arg)
      if (!res.success) {
        throw new EngineError('invalid_argument', `${ns}.${method}: ${res.error.issues[0]?.message ?? 'invalid argument'}`, {
          issues: res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        })
      }
      parsed = res.data
    } else if (arg !== undefined) {
      throw new EngineError('invalid_argument', `${ns}.${method} takes no argument`)
    }
    return spec.handler(parsed, sender)
  }

  /** Dispatch a wire request; never throws — every failure becomes a response. */
  async dispatch(req: EngineRequest, sender: SenderClass): Promise<EngineResponse> {
    try {
      const result = await this.invoke(req.ns, req.method, req.arg, sender)
      return { v: WIRE_VERSION, kind: 'response', id: req.id, ok: true, result }
    } catch (err) {
      const e = EngineError.from(err)
      return { v: WIRE_VERSION, kind: 'response', id: req.id, ok: false, error: e.toJSON() }
    }
  }
}
