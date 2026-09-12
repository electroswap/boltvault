/**
 * WebView on the phone (master plan §5.3): react-native-webview with the
 * provider injected before content loads, messages both ways, the committed
 * URL reported on every navigation, no file access, inline media allowed,
 * JavaScript on (dApps need it; NFT media views use a separate JS-off host).
 */
import {
  WebView as RNWebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview'
import type { WebViewHandle, WebViewProps } from './WebView'

export type { WebViewHandle, WebViewProps } from './WebView'

type Instance = {
  postMessage(m: string): void
  injectJavaScript(s: string): void
  goBack(): void
  goForward(): void
  reload(): void
}

export function WebView({
  url,
  injectedScriptBeforeLoad,
  onMessage,
  onNavigate,
  onNavigateStart,
  onLoadEnd,
  onError,
  onExternalNavigation,
  handleRef,
  testID,
}: WebViewProps) {
  const report = (n: WebViewNavigation): void =>
    onNavigate({
      url: n.url,
      canGoBack: n.canGoBack,
      canGoForward: n.canGoForward,
      loading: n.loading,
      title: n.title,
    })
  const attach = (r: Instance | null): void => {
    const handle: WebViewHandle | null = r
      ? {
          postMessage: (m) => r.postMessage(m),
          injectJavaScript: (s) => r.injectJavaScript(s),
          goBack: () => r.goBack(),
          goForward: () => r.goForward(),
          reload: () => r.reload(),
        }
      : null
    handleRef?.(handle)
  }
  return (
    <RNWebView
      ref={(r) => attach(r as Instance | null)}
      source={{ uri: url }}
      injectedJavaScriptBeforeContentLoaded={injectedScriptBeforeLoad}
      /*
        Main frame only: a third-party iframe has no business holding the
        provider of the page that embeds it. The native bridge itself is
        reachable from every frame whatever this says, which is why the host
        also checks the frame each message came from — see `onMessage`.
      */
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly={true}
      /*
        `nativeEvent.url` is the posting frame's URL — `sourceOrigin` from the
        Android `WebMessageListener`, `message.frameInfo.request.URL` on iOS.
        It used to be dropped, which left the host attributing an advert
        iframe's request to the page that embeds it.
      */
      onMessage={(e: WebViewMessageEvent) =>
        onMessage(e.nativeEvent.data, (e.nativeEvent as { url?: string }).url ?? null)
      }
      /*
        Committed navigations only. `onLoadStart` is reported from
        `didStartProvisionalNavigation` on WKWebView, so a page could announce
        a navigation to any origin, cancel it, and keep speaking — as that
        origin. A start now only closes the current session; the new one opens
        when `loading` goes false, which is `onPageFinished` / `didFinish`.
      */
      onNavigationStateChange={(n) => (n.loading ? onNavigateStart?.() : report(n))}
      onLoadStart={() => onNavigateStart?.()}
      onLoadEnd={() => onLoadEnd?.()}
      onError={(e) => onError?.(e.nativeEvent.description)}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsInlineMediaPlayback
      setSupportMultipleWindows={false}
      /*
        Nothing leaves this WebView without being asked about (ES-BV-039).

        `originWhitelist` alone does not refuse a navigation — the pinned
        `react-native-webview` hands anything outside the list to
        `Linking.canOpenURL` → `Linking.openURL`, so a page could set
        `location = 'ethereum:0x…@52014'` or `'boltvault://wc?uri=wc:…'` and
        the wallet would open Send with an attacker's address prefilled, or
        pair a WalletConnect session, while the user believed they were still
        inside the site's own flow. Returning false here stops the navigation
        dead; the host decides what, if anything, to do with it.
      */
      onShouldStartLoadWithRequest={(r) => {
        if (/^https:/i.test(r.url)) return true
        return (
          onExternalNavigation?.({
            url: r.url,
            // `isTopFrame` is absent on older iOS payloads; a frame that does
            // not say it is the top one is treated as one that is not.
            isTopFrame: r.isTopFrame === true,
            fromGesture: r.navigationType === 'click',
          }) ?? false
        )
      }}
      javaScriptEnabled
      domStorageEnabled
      // Cleartext navigations go to the OS browser, not into the wallet's chrome.
      originWhitelist={['https://*']}
      style={{ flex: 1, backgroundColor: '#060913' }}
      testID={testID}
    />
  )
}
