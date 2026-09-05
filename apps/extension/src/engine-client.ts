/**
 * The UI side: one Port to the service worker per page, wrapped as a typed
 * WalletEngine. The SW classifies this Port as `ui` from its sender URL.
 */
import { createChannelClient, createEngineClient, type WalletEngine } from '@boltvault/engine'
import { portChannel } from './port-channel'

export const UI_PORT_NAME = 'bv-ui'

export function connectEngine(): WalletEngine {
  const port = browser.runtime.connect({ name: UI_PORT_NAME })
  return createEngineClient(createChannelClient(portChannel(port)))
}
