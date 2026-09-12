/**
 * Whether this Android System WebView can say which frame spoke (ES-BV-043).
 *
 * On Android the bridge attributes a message to the posting frame only when
 * the platform supports `WEB_MESSAGE_LISTENER`; below that,
 * `react-native-webview` falls back to the `postMessage` JS interface, which
 * reports the *main frame's* URL whichever frame actually posted. The Browser
 * screen authenticates a request by comparing the posting frame's origin with
 * the session's — so on an old WebView an advert iframe embedded in a
 * connected dApp is attributed to the dApp and can speak in its name.
 *
 * `WEB_MESSAGE_LISTENER` arrived in WebView 88, which is also the Chrome major
 * version the WebView reports in its user agent. Reading that is not a native
 * check, but it is the same number, and the alternative — a native module for
 * `WebViewFeature.isFeatureSupported` — is not something a config plugin can
 * add. iOS attributes frames on every supported version and is unaffected.
 */

/** The first Android WebView that reports the posting frame. */
export const MIN_FRAME_ATTRIBUTING_WEBVIEW = 88

/**
 * The Chrome major version in a user-agent string, or null when there is none
 * to read.
 *
 * Read from the string the WebView sends before any page script runs, so a
 * page cannot shadow `navigator.userAgent` ahead of it.
 */
export function chromeMajor(userAgent: string | null | undefined): number | null {
  if (typeof userAgent !== 'string') return null
  const m = /Chrome\/(\d+)\./.exec(userAgent)
  const n = m ? Number(m[1]) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Can a dApp session be trusted on this WebView?
 *
 * Unknown answers yes: iOS sends no Chrome token, and a user agent this cannot
 * read is not evidence of an old WebView. The refusal is for the case the
 * version actually names.
 */
export function frameAttributionOk(userAgent: string | null | undefined, isAndroid: boolean): boolean {
  if (!isAndroid) return true
  const major = chromeMajor(userAgent)
  return major === null || major >= MIN_FRAME_ATTRIBUTING_WEBVIEW
}
