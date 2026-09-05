/**
 * WebView — the in-app browser's page (master plan §5.3). On the web bodies
 * there is no in-app browser (the extension *is* in the browser): this
 * implementation is the honest plate; `WebView.native.tsx` wraps
 * react-native-webview on the phone.
 */
import { Body, Column, Plate } from './primitives'

export interface WebViewHandle {
  postMessage(message: string): void
  injectJavaScript(script: string): void
  goBack(): void
  goForward(): void
  reload(): void
}

export interface WebViewProps {
  readonly url: string
  /** Runs before any page script; the provider goes here. */
  readonly injectedScriptBeforeLoad: string
  readonly onMessage: (data: string) => void
  /** The committed navigation (never what the page claims). */
  readonly onNavigate: (state: { url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; title: string }) => void
  readonly onLoadEnd?: () => void
  readonly onError?: (message: string) => void
  readonly handleRef?: (handle: WebViewHandle | null) => void
  readonly testID?: string
}

export function WebView({ url, testID }: WebViewProps) {
  return (
    <Column flex={1} padding="$4" testID={testID}>
      <Plate gap="$2">
        <Body size="title">{url}</Body>
        <Body tone="mute" size="caption">
          The in-app browser lives in the phone app. Here, open the site in a tab — BoltVault is already injected into every page.
        </Body>
      </Plate>
    </Column>
  )
}
