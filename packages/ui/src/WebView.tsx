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
  /**
   * A message from the page, with the URL of the frame that posted it.
   *
   * The native bridge is reachable from every frame even though the provider
   * script is injected into the main frame only, and the library knows which
   * frame spoke — so the frame URL is carried here rather than dropped, and
   * the host refuses anything that did not come from the committed origin.
   */
  readonly onMessage: (data: string, frameUrl: string | null) => void
  /** A committed navigation — never a provisional one, and never what the page claims. */
  readonly onNavigate: (state: {
    url: string
    canGoBack: boolean
    canGoForward: boolean
    loading: boolean
    title: string
  }) => void
  /**
   * A navigation has begun. Nothing is committed yet: a page can start a
   * cross-origin navigation and cancel it while staying loaded, so between
   * this and `onNavigate` there is no origin the host may speak for.
   */
  readonly onNavigateStart?: () => void
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
          The in-app browser lives in the phone app. Here, open the site in a tab — BoltVault is
          already injected into every page.
        </Body>
      </Plate>
    </Column>
  )
}
