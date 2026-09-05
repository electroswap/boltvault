/**
 * The service worker: hosts the engine and serves it to extension pages over
 * Ports (master plan §2.4, §3.5). Provider (dApp) Ports arrive in M3 through
 * the isolated content script and go to rpcFlow, never to this API.
 */
import { createEngine, serveChannel } from '@boltvault/engine'
import { defineBackground } from '#imports'
import { UI_PORT_NAME } from '../src/engine-client'
import { createServiceWorkerPlatform } from '../src/platform'
import { portChannel } from '../src/port-channel'
import { classifySender } from '../src/sender'

export default defineBackground(() => {
  const platform = createServiceWorkerPlatform()
  const engine = createEngine({ platform })

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void engine.ready
  })

  browser.runtime.onConnect.addListener((port) => {
    const cls = classifySender(port.sender, browser.runtime.id, browser.runtime.getURL(''))
    if (port.name === UI_PORT_NAME && cls === 'ui') {
      serveChannel(engine.host, portChannel(port), 'ui')
      return
    }
    // Anything else is not ours (or not yet supported): refuse the Port.
    port.disconnect()
  })
})
