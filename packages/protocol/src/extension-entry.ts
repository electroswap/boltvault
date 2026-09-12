/**
 * The script the isolated bridge injects into the page when the manifest's
 * `world: 'MAIN'` content script is not there (master plan §4.7): the same
 * provider the manifest path installs, over the same `window.postMessage`
 * transport, asking the bridge for the same per-load channel nonce.
 *
 * Zero imports of `chrome`, `browser` or engine code — it runs as page script,
 * under the page's origin. Built to one self-contained IIFE by
 * `tools/build-page-provider.mjs` and emitted as `page-provider.js`.
 */
import { BOLTVAULT_ICON, BOLTVAULT_NAME, BOLTVAULT_PROVIDER_UUID, BOLTVAULT_RDNS } from './identity'
import { installFromChannel, type MainWorldWindow } from './main-world'

declare const window: MainWorldWindow

installFromChannel({ win: window, uuid: BOLTVAULT_PROVIDER_UUID, name: BOLTVAULT_NAME, icon: BOLTVAULT_ICON, rdns: BOLTVAULT_RDNS })
