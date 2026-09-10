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

  const openApproval = (request: ApprovalRequest): void => {
    void (async () => {
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
  const engine = createEngine({ platform, openApproval, clientVersion: `BoltVault/${browser.runtime.getManifest().version}`, hid, trezor: createTrezorConnect(), body: 'extension', apiOrigin: __API_ORIGIN__, ...(__WALLET_KEY__ ? { clientKey: __WALLET_KEY__ } : {}), features: { limitOrders: __LIMIT_ORDERS__ } })
  // Crash reports are off until Settings › About says otherwise (§3.7); scrubbed either way.
  installCrashReporter({ body: 'extension-worker', version: browser.runtime.getManifest().version, enabled: () => engine.engine.settings.get().then((s) => s.crashReports, () => false) })

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void engine.ready
  })

  // Closing an approval window is a rejection (§3.5).
  browser.windows.onRemoved.addListener((windowId) => {
    for (const [id, wid] of signWindows) {
      if (wid !== windowId) continue
      signWindows.delete(id)
      void engine.engine.approvals.decide({ id, approve: false }).catch(() => undefined)
    }
  })

  // A decided request closes its window.
  engine.host.events.subscribe((e) => {
    if (e.type !== 'approvals.changed') return
    for (const [id, wid] of signWindows) {
      if (e.pending.some((p) => p.id === id)) continue
      signWindows.delete(id)
      void browser.windows.remove(wid).catch(() => undefined)
    }
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
      engine.provider.serve(portChannel(port), origin, { ...(port.sender?.tab?.id !== undefined ? { tabId: port.sender.tab.id } : {}), ...(port.sender?.frameId !== undefined ? { frameId: port.sender.frameId } : {}) })
      return
    }
    // Anything else is not ours: refuse the Port.
    port.disconnect()
  })
})
