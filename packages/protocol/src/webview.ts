/**
 * The in-app browser's transport (master plan §5.3): the page-provider posts
 * to `window.ReactNativeWebView.postMessage` and hears the host's answers as
 * `message` events (on `document` on Android, on `window` on iOS). The host
 * injects the channel nonce and the provider script before any page script
 * runs, and re-injects when an SPA route change dropped it.
 */
import { CONTENT_TARGET, INPAGE_TARGET, isInpageMessage, type InpageMessage, type InpageRequest } from './wire'
import type { PageTransport } from './page-provider'

export interface WebViewWindowLike {
  ReactNativeWebView?: { postMessage(message: string): void }
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  readonly document: { addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void }
}

/** The global the host sets before the provider script: `window.__BV_CHANNEL`. */
export const WEBVIEW_CHANNEL_GLOBAL = '__BV_CHANNEL'

export function webviewTransport(win: WebViewWindowLike, channel: string): PageTransport {
  return {
    post: (message: InpageRequest) => {
      win.ReactNativeWebView?.postMessage(JSON.stringify(message))
    },
    onMessage: (listener) => {
      const handle = (ev: { data: unknown }): void => {
        let data: unknown = ev.data
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data)
          } catch {
            return
          }
        }
        if (isInpageMessage(data, channel)) listener(data)
      }
      win.addEventListener('message', handle)
      win.document.addEventListener('message', handle)
    },
  }
}

/** What the host sends into the page: an `InpageMessage` for the channel, as the JSON the transport expects. */
export function webviewInpageMessage(channel: string, message: Omit<InpageMessage, 'target' | 'channel'>): string {
  return JSON.stringify({ target: CONTENT_TARGET, channel, ...message })
}

/** Parse what the page posted; null for anything that is not a request on this channel. */
export function parseWebviewRequest(raw: string, channel: string): InpageRequest | null {
  try {
    const data = JSON.parse(raw) as unknown
    if (typeof data !== 'object' || data === null) return null
    const d = data as Record<string, unknown>
    if (d['target'] !== INPAGE_TARGET || d['channel'] !== channel || typeof d['id'] !== 'number' || typeof d['method'] !== 'string') return null
    return { target: INPAGE_TARGET, channel, id: d['id'], method: d['method'], ...(d['params'] !== undefined ? { params: d['params'] } : {}) }
  } catch {
    return null
  }
}
