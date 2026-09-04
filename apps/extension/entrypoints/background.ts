import { defineBackground } from '#imports'

/**
 * MV3 service worker skeleton (T3.1).
 *
 * T3.1 scope: prove the worker boots and answers a message — the "chrome.runtime
 * alive" check. T3.3 layers vault onboarding/unlock on top; T3.5 adds the
 * rpcFlow router + per-origin sessions. Keep this file the single SW entry.
 */
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    console.log('[BoltVault] installed', details.reason)
  })

  browser.runtime.onMessage.addListener(
    (message: { type?: string }, _sender, sendResponse: (resp: unknown) => void) => {
      // A tiny liveness probe so tests / the popup can confirm the SW is awake.
      if (message?.type === 'bv:ping') {
        sendResponse({ ok: true, pong: true, ts: Date.now() })
        return true // async response
      }
      return undefined
    },
  )
})
