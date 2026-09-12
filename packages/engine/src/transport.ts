/**
 * Transports — how a client reaches a host.
 *
 * - `createInProcessTransport(host)`: mobile, tests.
 * - `createChannelClient(channel)` + `serveChannel(host, channel, sender)`:
 *   the extension, where `channel` wraps a chrome.runtime.Port. The channel
 *   abstraction is tiny so tests can use an in-memory pair and the extension
 *   can adapt a Port in a few lines without this package importing `chrome`.
 */
import { EngineError } from './errors'
import type { EngineHost, SenderClass } from './host'
import type { EngineEvent } from './schema'
import { hasRawBytes, parseEngineMessage, refusedRawBytes, WIRE_VERSION, type EngineRequest, type EngineResponse } from './wire'

export interface EngineTransport {
  call(ns: string, method: string, arg: unknown): Promise<unknown>
  subscribe(listener: (event: EngineEvent) => void): () => void
}

/** A duplex message channel (a chrome.runtime.Port, a MessagePort, or a test pair). */
export interface MessageChannelLike {
  post(message: unknown): void
  onMessage(listener: (message: unknown) => void): () => void
  onDisconnect(listener: () => void): () => void
}

export function createInProcessTransport(host: EngineHost, sender: SenderClass = 'internal'): EngineTransport {
  return {
    call: (ns, method, arg) => host.invoke(ns, method, arg, sender),
    subscribe: (listener) => host.events.subscribe(listener),
  }
}

export interface ChannelClientOptions {
  /** Per-call timeout; approvals are events, so calls are short. */
  readonly timeoutMs?: number
  readonly nextId?: () => string
}

let counter = 0
const defaultNextId = (): string => `${Date.now().toString(36)}-${(++counter).toString(36)}`

export function createChannelClient(channel: MessageChannelLike, opts: ChannelClientOptions = {}): EngineTransport {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const nextId = opts.nextId ?? defaultNextId
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: EngineError) => void; timer: ReturnType<typeof setTimeout> }>()
  const listeners = new Set<(event: EngineEvent) => void>()

  const settle = (id: string): { resolve: (v: unknown) => void; reject: (e: EngineError) => void } | undefined => {
    const p = pending.get(id)
    if (!p) return undefined
    clearTimeout(p.timer)
    pending.delete(id)
    return p
  }

  channel.onMessage((raw) => {
    const msg = parseEngineMessage(raw)
    if (!msg) return
    if (msg.kind === 'response') {
      const p = settle(msg.id)
      if (!p) return
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new EngineError(msg.error.code as EngineError['code'], msg.error.message, msg.error.data))
    } else if (msg.kind === 'event') {
      for (const l of [...listeners]) l(msg.event)
    }
  })

  channel.onDisconnect(() => {
    for (const id of [...pending.keys()]) {
      settle(id)?.reject(new EngineError('disconnected', 'engine channel disconnected'))
    }
  })

  return {
    call(ns, method, arg) {
      const id = nextId()
      const req: EngineRequest = arg === undefined
        ? { v: WIRE_VERSION, kind: 'request', id, ns, method }
        : { v: WIRE_VERSION, kind: 'request', id, ns, method, arg }
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new EngineError('timeout', `${ns}.${method} timed out after ${timeoutMs} ms`))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
        try {
          channel.post(req)
        } catch (err) {
          settle(id)
          reject(EngineError.from(err))
        }
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Serve a host over a channel. `sender` is decided by the caller from the
 * channel's provenance (e.g. `sender.url` of a chrome Port) — never from the
 * message. Returns a function that stops serving.
 */
export function serveChannel(host: EngineHost, channel: MessageChannelLike, sender: SenderClass): () => void {
  const offMessage = channel.onMessage((raw) => {
    const msg = parseEngineMessage(raw)
    if (!msg || msg.kind !== 'request') return
    void host.dispatch(msg, sender).then((res: EngineResponse) => {
      try {
        // Defence in depth (§12): nothing shaped like key material leaves the engine over the UI channel.
        channel.post(hasRawBytes(res) ? refusedRawBytes(msg.id) : res)
      } catch {
        // channel went away mid-flight; nothing to do
      }
    })
  })
  const offEvents = host.events.subscribe((event) => {
    if (hasRawBytes(event)) return
    try {
      channel.post({ v: WIRE_VERSION, kind: 'event', event })
    } catch {
      // ignore
    }
  })
  const offDisconnect = channel.onDisconnect(() => {
    offMessage()
    offEvents()
  })
  return () => {
    offMessage()
    offEvents()
    offDisconnect()
  }
}

/** One end of an in-memory channel pair (tests, the mobile in-process bridge). */
export interface MemoryChannel extends MessageChannelLike {
  /** Simulate the peer going away: fires this end's disconnect listeners. */
  disconnect(): void
}

/**
 * An in-memory channel pair. Messages are structured-cloned through JSON so a
 * non-JSON value (bigint, class instance) fails here exactly as it would on a
 * real chrome.runtime.Port.
 */
export function createChannelPair(): [MemoryChannel, MemoryChannel] {
  interface End {
    readonly messages: Set<(m: unknown) => void>
    readonly disconnects: Set<() => void>
  }
  const ends: [End, End] = [
    { messages: new Set(), disconnects: new Set() },
    { messages: new Set(), disconnects: new Set() },
  ]
  const make = (self: End, peer: End): MemoryChannel => ({
    post(message) {
      const copy: unknown = JSON.parse(JSON.stringify(message ?? null))
      for (const l of [...peer.messages]) queueMicrotask(() => l(copy))
    },
    onMessage(listener) {
      self.messages.add(listener)
      return () => {
        self.messages.delete(listener)
      }
    },
    onDisconnect(listener) {
      self.disconnects.add(listener)
      return () => {
        self.disconnects.delete(listener)
      }
    },
    disconnect() {
      for (const l of [...self.disconnects]) l()
      for (const l of [...peer.disconnects]) l()
    },
  })
  return [make(ends[0], ends[1]), make(ends[1], ends[0])]
}
