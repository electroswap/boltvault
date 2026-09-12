/**
 * The script the phone injects into every page of the in-app browser
 * (master plan §5.3): the same provider as the extension, over the WebView
 * transport, with the channel nonce the host set on `window` first. Built
 * to one self-contained IIFE by `tools/build-page-provider.mjs`.
 */
import { BOLTVAULT_ICON, BOLTVAULT_NAME, BOLTVAULT_PROVIDER_UUID, BOLTVAULT_RDNS } from './identity'
import { installProvider, type WindowLike } from './page-provider'
import { WEBVIEW_CHANNEL_GLOBAL, webviewTransport, type WebViewWindowLike } from './webview'

declare const window: WindowLike & WebViewWindowLike & Record<string, unknown>

const channel = window[WEBVIEW_CHANNEL_GLOBAL]
if (
  typeof channel === 'string' &&
  channel &&
  !(window.ethereum as { isBoltVault?: boolean } | undefined)?.isBoltVault
) {
  installProvider({
    transport: webviewTransport(window, channel),
    channel,
    win: window,
    uuid: BOLTVAULT_PROVIDER_UUID,
    name: BOLTVAULT_NAME,
    icon: BOLTVAULT_ICON,
    rdns: BOLTVAULT_RDNS,
  })
}
