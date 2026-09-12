/**
 * The service worker: hosts the engine and serves it to extension pages over
 * UI Ports and to dApps over provider Ports (master plan §2.4, §3.5, §4.1).
 * Approvals from dApps open sign.html; closing that window rejects.
 */
import '../src/node-shim'
import { createEngine, serveChannel, type ApprovalRequest } from '@boltvault/engine'
import type { HidDeviceLike } from '@boltvault/hardware'
import { PROVIDER_PORT_NAME } from '@boltvault/protocol'
import { registrableOrigin } from '@boltvault/security'
import { defineBackground } from '#imports'
import { UI_PORT_NAME } from '../src/engine-client'
import { createServiceWorkerPlatform } from '../src/platform'
import { portChannel } from '../src/port-channel'
import { classifySender } from '../src/sender'
import { createTrezorConnect } from '../src/trezor'
import { installCrashReporter } from '../src/crash'

const SIGN_WIDTH = 380
const SIGN_HEIGHT = 640

export default defineBackground(() => {
  const platform = createServiceWorkerPlatform()
  /** request id → window id, for the approval windows this worker opened. */
  const signWindows = new Map<string, number>()

  /** Approvals raised by a tab that was not in front; they open when it is. */
  const waiting = new Map<string, { tabId: number; request: ApprovalRequest }>()

  /*
    §3.5 says an approval-class request from a hidden tab is queued so a
    background tab cannot spawn a signing window over whatever the person is
    doing. That hold was implemented in the MAIN-world provider — page code, so
    a page skips it by posting to the bridge itself — and the worker opened
    `sign.html` with `focused: true` for anything that arrived. The tab is on
    the approval record now, and this is where the hold actually lives.
  */
  const badge = (): void => {
    const n = waiting.size
    void browser.action.setBadgeText({ text: n > 0 ? String(n) : '' }).catch(() => undefined)
    void browser.action.setBadgeBackgroundColor({ color: '#F5A524' }).catch(() => undefined)
  }

  const tabOf = (request: ApprovalRequest): number | undefined => {
    const tabId = (request.payload as { tabId?: unknown } | null)?.tabId
    return typeof tabId === 'number' ? tabId : undefined
  }

  /** Is the tab that asked the one being looked at, in the window being used? */
  const inFront = async (tabId: number): Promise<boolean> => {
    try {
      const tab = await browser.tabs.get(tabId)
      if (!tab.active) return false
      if (tab.windowId === undefined) return true
      const w = await browser.windows.get(tab.windowId)
      return w.focused === true
    } catch {
      // The tab has gone; its port goes with it and the request will expire.
      return false
    }
  }

  const openApproval = (request: ApprovalRequest): void => {
    // A cap on windows, not on requests: further approvals still queue and are
    // rendered by the popup's pending list, but nothing else steals focus.
    if (signWindows.size >= 3) return
    void (async () => {
      const tabId = tabOf(request)
      /*
        No tab means our own surfaces and the transports that have no tab at
        all (WalletConnect, a paired device). Those are the user asking, so
        they open.
      */
      if (tabId !== undefined && !(await inFront(tabId))) {
        waiting.set(request.id, { tabId, request })
        badge()
        return
      }
      let left: number | undefined
      let top: number | undefined
      try {
        const focused = await browser.windows.getLastFocused()
        if (focused.left !== undefined && focused.width !== undefined) left = Math.max(0, focused.left + focused.width - SIGN_WIDTH - 24)
        if (focused.top !== undefined) top = Math.max(0, focused.top + 72)
      } catch {
        // no window to anchor to
      }
      const create = (bounds: { left?: number; top?: number }) =>
        browser.windows.create({ url: browser.runtime.getURL(`/sign.html?id=${request.id}`), type: 'popup', width: SIGN_WIDTH, height: SIGN_HEIGHT, focused: true, ...bounds })
      let w: Awaited<ReturnType<typeof create>>
      try {
        w = await create({ ...(left !== undefined ? { left } : {}), ...(top !== undefined ? { top } : {}) })
      } catch {
        // Chrome refuses bounds that fall off the visible screen (small displays, headless): open unanchored.
        w = await create({})
      }
      if (w?.id === undefined) return
      // Opening is asynchronous, so the request can be decided while the window
      // is still on its way. A decision that lands first finds nothing in the
      // map to close and would leave the window orphaned on screen, so ask once
      // more, now that there is a window to close.
      // `engine.approvals` is the store, whose list is synchronous; `engine.engine` is the client, whose list is a promise.
      if (engine.approvals.list().some((r) => r.id === request.id)) signWindows.set(request.id, w.id)
      else void browser.windows.remove(w.id).catch(() => undefined)
    })()
  }

  // WebHID is available to extension workers since Chrome 117; pairing happens in tab.html (§2.7 S7).
  const nav = globalThis.navigator as unknown as { hid?: { getDevices(): Promise<HidDeviceLike[]> } }
  const hid = nav.hid ? { getDevices: () => nav.hid?.getDevices() ?? Promise.resolve([]) } : null
  const engine = createEngine({ platform, openApproval, clientVersion: `BoltVault/${browser.runtime.getManifest().version}`, hid, trezor: createTrezorConnect(), body: 'extension', apiOrigin: __API_ORIGIN__, ...(__WALLET_KEY__ ? { clientKey: __WALLET_KEY__ } : {}), ...(__QUOTER_URL__ ? { quoterUrl: __QUOTER_URL__ } : {}), features: { limitOrders: __LIMIT_ORDERS__ } })
  // Crash reports are off until Settings › About says otherwise (§3.7); scrubbed either way.
  installCrashReporter({ body: 'extension-worker', version: browser.runtime.getManifest().version, enabled: () => engine.engine.settings.get().then((s) => s.crashReports, () => false) })

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void engine.ready
  })

  // A held approval opens the moment its tab is the one in front.
  const release = (tabId: number): void => {
    for (const [id, held] of waiting) {
      if (held.tabId !== tabId) continue
      waiting.delete(id)
      if (engine.approvals.list().some((r) => r.id === id)) openApproval(held.request)
    }
    badge()
  }
  browser.tabs.onActivated.addListener(({ tabId }) => release(tabId))
  browser.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return
    void browser.tabs
      .query({ active: true, windowId })
      .then((tabs) => {
        const id = tabs[0]?.id
        if (id !== undefined) release(id)
      })
      .catch(() => undefined)
  })

  // Closing an approval window is a rejection (§3.5).
  browser.windows.onRemoved.addListener((windowId) => {
    for (const [id, wid] of signWindows) {
      if (wid !== windowId) continue
      signWindows.delete(id)
      void engine.engine.approvals.decide({ id, approve: false }).catch(() => undefined)
    }
  })

  // A decided request closes its window, and stops waiting for a tab.
  engine.host.events.subscribe((e) => {
    if (e.type !== 'approvals.changed') return
    for (const [id, wid] of signWindows) {
      if (e.pending.some((p) => p.id === id)) continue
      signWindows.delete(id)
      void browser.windows.remove(wid).catch(() => undefined)
    }
    let dropped = false
    for (const id of [...waiting.keys()]) {
      if (e.pending.some((p) => p.id === id)) continue
      waiting.delete(id)
      dropped = true
    }
    if (dropped) badge()
  })

  browser.runtime.onConnect.addListener((port) => {
    const cls = classifySender(port.sender, browser.runtime.id, browser.runtime.getURL(''))
    if (port.name === UI_PORT_NAME && cls === 'ui') {
      // The worker stays alive while any wallet page is open, and a page that (re)connects repaints from a fresh announcement (plan A1).
      const release = platform.keepAlive.hold('ui-port')
      port.onDisconnect.addListener(() => release())
      serveChannel(engine.host, portChannel(port), 'ui')
      void engine.vault.announce().catch(() => undefined)
      return
    }
    if (port.name === PROVIDER_PORT_NAME && cls === 'content') {
      // The origin is the sender's, never the page's claim (§3.5, §3.6). Null and non-http origins are refused.
      const origin = registrableOrigin(port.sender?.url ?? '')
      if (!origin) {
        port.disconnect()
        return
      }
      /*
        A cleartext page cannot vouch for itself (ES-BV-022). `http://` proves
        nothing about who served it, so the transport has nothing to attest and
        must not let the sheet call the origin verified.
      */
      const verified = origin.startsWith('https://')
      engine.provider.serve(portChannel(port), origin, { verified, ...(port.sender?.tab?.id !== undefined ? { tabId: port.sender.tab.id } : {}), ...(port.sender?.frameId !== undefined ? { frameId: port.sender.frameId } : {}) })
      return
    }
    // Anything else is not ours: refuse the Port.
    port.disconnect()
  })
})
