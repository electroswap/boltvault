/**
 * Sender classification (master plan §3.5). The class of a Port is decided
 * from Chrome's `sender` — never from the message. Only extension pages get
 * `ui`; a content script (has a tab + frame) is `content`; anything else is
 * refused. Pure, so it is unit-tested without a browser.
 */
import type { SenderClass } from '@boltvault/engine'

export interface PortSenderLike {
  readonly id?: string
  readonly url?: string
  readonly origin?: string
  readonly tab?: { readonly id?: number } | undefined
  readonly frameId?: number
}

export function classifySender(sender: PortSenderLike | undefined, extensionId: string, extensionOrigin: string): SenderClass | null {
  if (!sender || sender.id !== extensionId) return null
  const url = sender.url ?? ''
  if (url.startsWith(extensionOrigin) && sender.tab === undefined) return 'ui'
  // An extension page opened in a tab (tab.html, sign.html) still has our origin.
  if (url.startsWith(extensionOrigin)) return 'ui'
  if (sender.tab !== undefined && sender.frameId !== undefined && /^https?:\/\//.test(url)) return 'content'
  return null
}
