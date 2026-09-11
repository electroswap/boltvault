/**
 * WebView on the phone (master plan §5.3): react-native-webview with the
 * provider injected before content loads, messages both ways, the committed
 * URL reported on every navigation, no file access, inline media allowed,
 * JavaScript on (dApps need it; NFT media views use a separate JS-off host).
 */
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview'
import type { WebViewHandle, WebViewProps } from './WebView'

export type { WebViewHandle, WebViewProps } from './WebView'

type Instance = { postMessage(m: string): void; injectJavaScript(s: string): void; goBack(): void; goForward(): void; reload(): void }

export function WebView({ url, injectedScriptBeforeLoad, onMessage, onNavigate, onLoadEnd, onError, handleRef, testID }: WebViewProps) {
  const report = (n: WebViewNavigation): void => onNavigate({ url: n.url, canGoBack: n.canGoBack, canGoForward: n.canGoForward, loading: n.loading, title: n.title })
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
        Main frame only. The injected script carries the channel nonce that
        authenticates a page to the host, and `onMessage` cannot tell which
        frame spoke — the host attributes every message to the top-level
        committed URL. Injecting into sub-frames therefore hands a third-party
        iframe the wallet of the page that embeds it.
      */
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly={true}
      onMessage={(e: WebViewMessageEvent) => onMessage(e.nativeEvent.data)}
      onNavigationStateChange={report}
      onLoadStart={(e) => report(e.nativeEvent as unknown as WebViewNavigation)}
      onLoadEnd={() => onLoadEnd?.()}
      onError={(e) => onError?.(e.nativeEvent.description)}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsInlineMediaPlayback
      setSupportMultipleWindows={false}
      javaScriptEnabled
      domStorageEnabled
      // Cleartext navigations go to the OS browser, not into the wallet's chrome.
      originWhitelist={['https://*']}
      style={{ flex: 1, backgroundColor: '#060913' }}
      testID={testID}
    />
  )
}
