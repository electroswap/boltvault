/**
 * Build the Platform for the service worker from the `browser` API WXT
 * exposes. Typed structurally through ExtensionApi so nothing here is `any`.
 */
import { createExtensionPlatform, type ExtensionApi } from '@boltvault/platform/extension'
import type { Platform } from '@boltvault/platform'

export function createServiceWorkerPlatform(): Platform {
  const api: ExtensionApi = {
    storage: {
      local: browser.storage.local,
      session: browser.storage.session,
    },
    alarms: browser.alarms,
    runtime: { getPlatformInfo: () => browser.runtime.getPlatformInfo() },
    notifications: browser.notifications,
    tabs: browser.tabs,
  }
  return createExtensionPlatform(api, { iconUrl: browser.runtime.getURL('/icon/128.png') })
}
