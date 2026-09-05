/**
 * Typed popup-side client for the service worker (E0a).
 *
 * The popup talks to the SW only through this client: each method sends one
 * `SwRequest`, awaits the `SwResponse`, and either unwraps the typed payload or
 * throws `Error(error)`. The transport is injectable so tests can fake it; the
 * production transport is `browser.runtime.sendMessage`.
 *
 * Node/happy-dom safety: the module must IMPORT cleanly where there is no
 * `browser` global (node unit tests). We therefore touch `browser` only inside
 * the transport's `send`, never at module top-level — see `runtimeTransport`.
 */
import type {
  SafeRow,
  SwRequest,
  SwResponse,
} from './sw-messages'

/** Transport the client sends `SwRequest`s through and receives raw replies from. */
export interface SwTransport {
  send(msg: SwRequest): Promise<unknown>
}

/** Production transport: `browser.runtime.sendMessage`. Only touches `browser` when called. */
export const runtimeTransport: SwTransport = {
  async send(msg) {
    // WXT exposes the chrome/browser API as the `browser` global in the SW +
    // popup bundles. Guarded so a missing global (node tests) is a clean error.
    const b = (globalThis as { browser?: { runtime: { sendMessage(m: unknown): Promise<unknown> } } })
      .browser
    if (!b?.runtime?.sendMessage) {
      throw new Error(
        'BoltVault SW transport: `browser.runtime.sendMessage` unavailable (outside the extension?)',
      )
    }
    return b.runtime.sendMessage(msg)
  },
}

/** Typed, narrowable unwrap of a raw transport reply into an `SwResponse`. */
function asResponse(raw: unknown): SwResponse {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: 'empty response from service worker' }
  }
  const r = raw as { ok?: unknown; error?: unknown }
  if (r.ok === false) {
    return { ok: false, error: typeof r.error === 'string' ? r.error : 'service worker error' }
  }
  if (r.ok !== true) {
    return { ok: false, error: 'malformed response from service worker' }
  }
  return raw as SwResponse
}

export class SwClient {
  constructor(private readonly transport: SwTransport = runtimeTransport) {}

  /** Ping the SW; resolves `{ pong: true, ts }`. */
  async ping(): Promise<{ pong: true; ts: number }> {
    const resp = asResponse(await this.transport.send({ type: 'bv:ping' }))
    if (!resp.ok) throw new Error(resp.error)
    if (!('pong' in resp)) throw new Error('malformed ping response')
    return { pong: resp.pong, ts: resp.ts }
  }

  /** Current chain head (block number) for `chainId`. */
  async blockHead(chainId: number): Promise<number> {
    const resp = asResponse(await this.transport.send({ type: 'bv:block:head', chainId }))
    if (!resp.ok) throw new Error(resp.error)
    if (!('block' in resp)) throw new Error('malformed block:head response')
    return resp.block
  }

  /** Full priced portfolio snapshot for `account` on `chainId`. */
  async portfolio(
    chainId: number,
    account: string,
  ): Promise<{
    chainId: number
    account: string
    native: SafeRow | null
    rows: SafeRow[]
    pricedTotalUsd: number
    at: number
  }> {
    const resp = asResponse(await this.transport.send({ type: 'bv:portfolio', chainId, account }))
    if (!resp.ok) throw new Error(resp.error)
    if (!('pricedTotalUsd' in resp)) throw new Error('malformed portfolio response')
    return {
      chainId: resp.chainId,
      account: resp.account,
      native: resp.native,
      rows: resp.rows,
      pricedTotalUsd: resp.pricedTotalUsd,
      at: resp.at,
    }
  }

  /** USD price of `address` on `chainId`, or null when unpriced. */
  async price(chainId: number, address: string): Promise<number | null> {
    const resp = asResponse(await this.transport.send({ type: 'bv:price', chainId, address }))
    if (!resp.ok) throw new Error(resp.error)
    if (!('usd' in resp)) throw new Error('malformed price response')
    return resp.usd
  }
}

/** Singleton the hooks + heartbeat default to. */
export const sw = new SwClient()

export default sw
