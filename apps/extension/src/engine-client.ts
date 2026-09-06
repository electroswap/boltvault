/**
 * The UI side: one Port to the service worker per page, wrapped as a typed
 * WalletEngine. The SW classifies this Port as `ui` from its sender URL.
 */
import { createChannelClient, createEngineClient, type WalletEngine } from '@boltvault/engine'
import { reconnectingPortChannel } from './port-channel'

export const UI_PORT_NAME = 'bv-ui'

export function connectEngine(): WalletEngine {
  // Reconnects after a service-worker restart, so an open page never goes silently blank (plan A1).
  return createEngineClient(createChannelClient(reconnectingPortChannel(() => browser.runtime.connect({ name: UI_PORT_NAME }))))
}
