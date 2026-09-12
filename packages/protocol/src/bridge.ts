/**
 * The isolated-world bridge (master plan §3.5, §4.2): mints the per-load
 * channel nonce, hands it to the MAIN world through a CustomEvent (both
 * orderings of the two document_start scripts are handled), relays
 * page requests to a Port and Port responses/events back. The Port is
 * opened lazily so pages that never use a wallet do not wake the worker,
 * and re-opened after a worker restart with pending requests re-sent (the
 * engine de-duplicates approvals by client request id).
 *
 * Pure over small interfaces so it is unit-tested without a browser.
 */
import {
  CHANNEL_EVENT,
  CHANNEL_REQUEST_EVENT,
  CONTENT_TARGET,
  isInpageRequest,
  isProviderPortMessage,
  type InpageMessage,
  type ProviderPortMessage,
} from './wire'

export interface BridgePort {
  postMessage(message: ProviderPortMessage): void
  onMessage(listener: (message: unknown) => void): void
  onDisconnect(listener: () => void): void
  disconnect(): void
}

export interface BridgeWindow {
  readonly location: { readonly origin: string }
  postMessage(message: InpageMessage, targetOrigin: string): void
  addEventListener(
    type: string,
    listener: (ev: { source: unknown; origin: string; data: unknown }) => void,
  ): void
  dispatchEvent(ev: unknown): boolean
  readonly CustomEvent: new (type: string, init?: { detail?: unknown }) => unknown
}

export interface BridgeDeps {
  readonly win: BridgeWindow
  readonly nonce: string
  connect(): BridgePort
  /** Re-send pending requests after this many ms once the Port drops (default 250). */
  readonly reconnectDelayMs?: number
  setTimeout?(fn: () => void, ms: number): unknown
}

export interface Bridge {
  readonly nonce: string
  stop(): void
}

/**
 * A sandboxed iframe, `about:blank` or a PDF viewer has an opaque origin, which
 * serialises as the string 'null'. §3.6 denies those outright: we cannot key a
 * session to them, and the frame's Port sender URL would key it to the embedding
 * page instead — handing a sandboxed frame the parent page's wallet session.
 */
export function hasOpaqueOrigin(win: { location: { origin: string } }): boolean {
  return win.location.origin === 'null' || win.location.origin === ''
}

export function startBridge(deps: BridgeDeps): Bridge {
  const { win, nonce } = deps
  // Never speak to an opaque origin (§3.6). No nonce is announced, so the
  // MAIN-world script never installs a provider in this frame.
  if (hasOpaqueOrigin(win)) return { nonce, stop: () => undefined }
  const targetOrigin = win.location.origin
  const pending = new Map<number, ProviderPortMessage & { kind: 'request' }>()
  let port: BridgePort | null = null
  let stopped = false
  const schedule = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))

  const toPage = (m: InpageMessage): void => {
    win.postMessage(m, targetOrigin)
  }

  const announceChannel = (): void => {
    win.dispatchEvent(new win.CustomEvent(CHANNEL_EVENT, { detail: nonce }))
  }

  const ensurePort = (): BridgePort => {
    if (port) return port
    const p = deps.connect()
    port = p
    p.onMessage((raw) => {
      if (!isProviderPortMessage(raw)) return
      if (raw.kind === 'response') {
        pending.delete(raw.id)
        toPage({
          target: CONTENT_TARGET,
          channel: nonce,
          kind: 'response',
          id: raw.id,
          ...(raw.error ? { error: raw.error } : { result: raw.result }),
        })
      } else if (raw.kind === 'event') {
        toPage({
          target: CONTENT_TARGET,
          channel: nonce,
          kind: 'event',
          event: raw.event,
          payload: raw.payload,
        })
      }
    })
    p.onDisconnect(() => {
      if (port !== p) return
      port = null
      if (stopped || pending.size === 0) return
      // The worker was evicted mid-request: reconnect and re-send what is still open.
      schedule(() => {
        if (stopped || pending.size === 0) return
        const again = ensurePort()
        for (const req of pending.values()) again.postMessage(req)
      }, deps.reconnectDelayMs ?? 250)
    })
    return p
  }

  win.addEventListener(CHANNEL_REQUEST_EVENT as 'message', () => announceChannel())
  announceChannel()

  win.addEventListener('message', (ev) => {
    if (stopped) return
    if (ev.source !== win) return
    if (ev.origin !== win.location.origin) return
    if (!isInpageRequest(ev.data, nonce)) return
    const req: ProviderPortMessage & { kind: 'request' } = {
      kind: 'request',
      id: ev.data.id,
      method: ev.data.method,
      session: nonce,
      ...(ev.data.params === undefined ? {} : { params: ev.data.params }),
    }
    pending.set(req.id, req)
    try {
      ensurePort().postMessage(req)
    } catch {
      pending.delete(req.id)
      toPage({
        target: CONTENT_TARGET,
        channel: nonce,
        kind: 'response',
        id: req.id,
        error: { code: 4900, message: 'BoltVault is not available on this page.' },
      })
    }
  })

  return {
    nonce,
    stop: () => {
      stopped = true
      port?.disconnect()
      port = null
    },
  }
}

/** 128 random bits as hex from any `getRandomValues`. */
export function mintNonce(random: (bytes: Uint8Array) => Uint8Array): string {
  const b = random(new Uint8Array(16))
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
