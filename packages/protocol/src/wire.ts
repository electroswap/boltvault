/**
 * Message shapes between the three tiers (master plan §4.1):
 *
 *   page (MAIN)  ⇄ window.postMessage ⇄  isolated bridge  ⇄ Port ⇄  engine
 *
 * The page↔bridge channel carries a per-load nonce the bridge minted before
 * any page script ran; the bridge accepts only `event.source === window`,
 * same-origin messages with that nonce. No zod here: this module ships inside
 * the page provider, which has a 25 KB budget and no dependencies.
 */
export const INPAGE_TARGET = 'bolt-inpage'
export const CONTENT_TARGET = 'bolt-content'
export const CHANNEL_EVENT = 'bv:channel'
export const CHANNEL_REQUEST_EVENT = 'bv:channel-request'
/** Settings that shape the provider, delivered after install (storage is async at document_start). */
export const CONFIG_EVENT = 'bv:config'
export const PROVIDER_PORT_NAME = 'bv-provider'

export interface RpcErrorShape {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

/** page → bridge */
export interface InpageRequest {
  readonly target: typeof INPAGE_TARGET
  readonly channel: string
  readonly id: number
  readonly method: string
  readonly params?: unknown
}

/** bridge → page */
export type InpageMessage =
  | {
      readonly target: typeof CONTENT_TARGET
      readonly channel: string
      readonly kind: 'response'
      readonly id: number
      readonly result?: unknown
      readonly error?: RpcErrorShape
    }
  | {
      readonly target: typeof CONTENT_TARGET
      readonly channel: string
      readonly kind: 'event'
      readonly event: string
      readonly payload: unknown
    }

/** bridge ⇄ engine over the Port */
export type ProviderPortMessage =
  | {
      readonly kind: 'request'
      readonly id: number
      readonly method: string
      readonly params?: unknown
      /** The bridge's per-page-load nonce, so a re-sent request re-attaches to its approval. */ readonly session?: string
    }
  | {
      readonly kind: 'response'
      readonly id: number
      readonly result?: unknown
      readonly error?: RpcErrorShape
    }
  | { readonly kind: 'event'; readonly event: string; readonly payload: unknown }

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

export function isInpageRequest(x: unknown, channel: string): x is InpageRequest {
  return (
    isObj(x) &&
    x['target'] === INPAGE_TARGET &&
    x['channel'] === channel &&
    typeof x['id'] === 'number' &&
    typeof x['method'] === 'string' &&
    x['method'].length > 0 &&
    x['method'].length < 128
  )
}

export function isInpageMessage(x: unknown, channel: string): x is InpageMessage {
  if (!isObj(x) || x['target'] !== CONTENT_TARGET || x['channel'] !== channel) return false
  if (x['kind'] === 'response') return typeof x['id'] === 'number'
  if (x['kind'] === 'event') return typeof x['event'] === 'string'
  return false
}

export function isProviderPortMessage(x: unknown): x is ProviderPortMessage {
  if (!isObj(x)) return false
  if (x['kind'] === 'request') return typeof x['id'] === 'number' && typeof x['method'] === 'string'
  if (x['kind'] === 'response') return typeof x['id'] === 'number'
  if (x['kind'] === 'event') return typeof x['event'] === 'string'
  return false
}

export function isRpcErrorShape(x: unknown): x is RpcErrorShape {
  return isObj(x) && typeof x['code'] === 'number' && typeof x['message'] === 'string'
}
