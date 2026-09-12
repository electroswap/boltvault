/**
 * Adapt a chrome.runtime.Port to the engine's MessageChannelLike. Both the
 * service worker (serving) and the pages (calling) use this. Pages use the
 * reconnecting form: a service-worker restart drops every Port, and a popup
 * that stayed open must not go silently blank — its listeners survive the
 * Port and re-bind to a fresh one (plan A1).
 */
import type { MessageChannelLike } from '@boltvault/engine'

export interface PortLike {
  postMessage(message: unknown): void
  disconnect(): void
  onMessage: {
    addListener(cb: (message: unknown) => void): void
    removeListener(cb: (message: unknown) => void): void
  }
  onDisconnect: { addListener(cb: () => void): void; removeListener(cb: () => void): void }
}

export function portChannel(port: PortLike): MessageChannelLike {
  return {
    post: (message) => port.postMessage(message),
    onMessage: (listener) => {
      port.onMessage.addListener(listener)
      return () => port.onMessage.removeListener(listener)
    },
    onDisconnect: (listener) => {
      port.onDisconnect.addListener(listener)
      return () => port.onDisconnect.removeListener(listener)
    },
  }
}

/** Retry delays after a disconnect, then every last value until `RECONNECT_FOR_MS`. */
const BACKOFF_MS = [50, 200, 800, 2_000] as const
const RECONNECT_FOR_MS = 30_000

export interface ReconnectingOptions {
  readonly setTimeout?: (fn: () => void, ms: number) => unknown
  readonly now?: () => number
}

/**
 * A channel over a Port that reconnects. Message and disconnect listeners
 * are kept on the channel, not the Port; every Port gets the same fan-out.
 * `post` with no live Port connects synchronously (`runtime.connect` is),
 * and a Port that throws on post is replaced once and the post retried.
 */
export function reconnectingPortChannel(
  connect: () => PortLike,
  opts: ReconnectingOptions = {},
): MessageChannelLike {
  const later = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const now = opts.now ?? (() => Date.now())
  const messages = new Set<(message: unknown) => void>()
  const disconnects = new Set<() => void>()
  let port: PortLike | null = null
  let droppedAt = 0
  let attempt = 0

  const bind = (p: PortLike): void => {
    port = p
    attempt = 0
    p.onMessage.addListener((m) => {
      if (port !== p) return
      for (const l of messages) l(m)
    })
    p.onDisconnect.addListener(() => {
      if (port !== p) return
      port = null
      droppedAt = now()
      // In-flight calls reject as 'disconnected'; hooks re-issue their reads once the page is live again.
      for (const l of disconnects) l()
      scheduleReconnect()
    })
  }

  const scheduleReconnect = (): void => {
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 2_000
    attempt += 1
    later(() => {
      if (port !== null) return
      if (now() - droppedAt > RECONNECT_FOR_MS) return
      try {
        bind(connect())
      } catch {
        scheduleReconnect()
      }
    }, delay)
  }

  const live = (): PortLike => {
    if (port) return port
    bind(connect())
    return port as unknown as PortLike
  }

  return {
    post: (message) => {
      try {
        live().postMessage(message)
      } catch {
        // "Attempting to use a disconnected port object": the worker went away between our disconnect event and this post.
        port = null
        bind(connect())
        live().postMessage(message)
      }
    },
    onMessage: (listener) => {
      messages.add(listener)
      return () => {
        messages.delete(listener)
      }
    },
    onDisconnect: (listener) => {
      disconnects.add(listener)
      return () => {
        disconnects.delete(listener)
      }
    },
  }
}
