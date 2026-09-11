/**
 * The MAIN-world provider (master plan §4.2, §4.3). Zero imports of
 * chrome/browser: it receives the channel nonce from the isolated script by
 * CustomEvent (either ordering) and installs `window.ethereum` + EIP-6963
 * before any page script runs.
 *
 * The body is shared with the AMO fallback's injected IIFE
 * (`protocol/extension-entry.ts`) so both take the same realm claim and only
 * one of them can ever install a provider (§4.7).
 */
import { installFromChannel, type MainWorldWindow } from '@boltvault/protocol'
import { defineContentScript } from '#imports'
import { BOLTVAULT_ICON, BOLTVAULT_NAME, BOLTVAULT_PROVIDER_UUID, BOLTVAULT_RDNS } from '../src/identity'

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: true,
  matchAboutBlank: false,
  world: 'MAIN',
  main() {
    installFromChannel({
      win: window as unknown as MainWorldWindow,
      uuid: BOLTVAULT_PROVIDER_UUID,
      name: BOLTVAULT_NAME,
      icon: BOLTVAULT_ICON,
      rdns: BOLTVAULT_RDNS,
    })
  },
})
