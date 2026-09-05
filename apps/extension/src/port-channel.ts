/**
 * Adapt a chrome.runtime.Port to the engine's MessageChannelLike. Both the
 * service worker (serving) and the pages (calling) use this.
 */
import type { MessageChannelLike } from '@boltvault/engine'

export interface PortLike {
  postMessage(message: unknown): void
  disconnect(): void
  onMessage: { addListener(cb: (message: unknown) => void): void; removeListener(cb: (message: unknown) => void): void }
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
