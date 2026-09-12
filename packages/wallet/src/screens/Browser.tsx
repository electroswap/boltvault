/**
 * The in-app browser (master plan §5.3): an address bar, the page, and the
 * same provider the extension injects — over a session the engine opens for
 * the committed origin. Every request the page makes goes through the
 * engine's rpcFlow and the firewall; the sheets are the same sheets. Blocked
 * origins never load; an SPA route change that dropped the provider gets it
 * re-injected.
 */
import { Body, Column, Icon, IconButton, Input, Key, Plate, Pressable, Rim, Row, Sheet, WebView, metrics, paint, radius, type WebViewHandle } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { DappSession } from '@boltvault/engine'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { deliverLink } from '../state/useLinks'

const HOME = 'https://app.electroswap.io'
const INPAGE_TARGET = 'bolt-inpage'
const CONTENT_TARGET = 'bolt-content'

function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.protocol}//${u.host}` : null
  } catch {
    return null
  }
}

function normalise(input: string): string {
  const s = input.trim()
  if (!s) return HOME
  // A wallet browser has no reason to speak cleartext: anything typed as
  // http:// is upgraded rather than carried, so a page that can be rewritten
  // in flight never gets to hold a provider.
  if (/^http:\/\//i.test(s)) return `https://${s.slice(7)}`
  if (/^https:\/\//i.test(s)) return s
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(s)) return `https://${s}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`
}

export function Browser({
  body,
  url: initialUrl,
}: {
  body: 'extension-popup' | 'extension-tab' | 'mobile'
  url?: string
}) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const [typed, setTyped] = useState(initialUrl ?? HOME)
  const [url, setUrl] = useState(initialUrl ?? HOME)
  const [nav, setNav] = useState({
    url: initialUrl ?? HOME,
    canGoBack: false,
    canGoForward: false,
    loading: false,
    title: '',
  })
  /*
    True from the moment a navigation begins until one commits. A page may
    start a navigation to any origin and cancel it while staying loaded, so in
    between there is no origin the wallet may speak for: the session is closed
    and the channel answers 4900 (§5.3).
  */
  const [navigating, setNavigating] = useState(true)
  const [session, setSession] = useState<DappSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  /*
    A page inside the browser asking to leave it (ES-BV-039).

    `originWhitelist` does not refuse a navigation — the pinned WebView hands
    anything outside the list straight to the OS — so a page could set
    `location = 'ethereum:0x…@52014'` or `'boltvault://wc?uri=wc:…'` and the
    wallet would open Send with an attacker's address prefilled, or pair a
    WalletConnect session, while the user believed they were still inside the
    site's own flow. Nothing leaves without a top-frame tap and a yes.
  */
  const [leaving, setLeaving] = useState<string | null>(null)
  const handle = useRef<WebViewHandle | null>(null)
  const channel = useRef(
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join(''),
  )
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  // One session per committed origin; the engine refuses anything that is not http(s).
  const origin = navigating ? null : originOf(nav.url)
  useEffect(() => {
    let alive = true
    if (!origin) {
      setSession(null)
      return
    }
    // Only a page the OS actually fetched over TLS is vouched for.
    engine.dapps
      .open({
        url: origin,
        kind: 'webview',
        verified: origin.startsWith('https://'),
        channel: channel.current,
      })
      .then(
        (s) => {
          if (alive) setSession(s)
          else void engine.dapps.close({ sessionId: s.sessionId })
        },
        (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
      )
    return () => {
      alive = false
    }
  }, [engine, origin])
  useEffect(() => {
    if (!session) return
    return () => {
      void engine.dapps.close({ sessionId: session.sessionId })
    }
  }, [engine, session])

  // Provider events (accountsChanged, chainChanged) reach the page as inpage messages.
  useEffect(
    () =>
      engine.events.subscribe((e) => {
        if (e.type !== 'dapp.event' || e.sessionId !== session?.sessionId) return
        handle.current?.postMessage(
          JSON.stringify({
            target: CONTENT_TARGET,
            channel: channel.current,
            kind: 'event',
            event: e.event,
            payload: e.payload,
          }),
        )
      }),
    [engine, session],
  )

  const onMessage = useCallback(
    (raw: string, frameUrl: string | null) => {
      let data: {
        target?: unknown
        channel?: unknown
        id?: unknown
        method?: unknown
        params?: unknown
      }
      try {
        data = JSON.parse(raw) as typeof data
      } catch {
        return
      }
      if (
        data.target !== INPAGE_TARGET ||
        data.channel !== channel.current ||
        typeof data.id !== 'number' ||
        typeof data.method !== 'string'
      )
        return
      const id = data.id
      const reply = (message: Record<string, unknown>): void =>
        handle.current?.postMessage(
          JSON.stringify({
            target: CONTENT_TARGET,
            channel: channel.current,
            kind: 'response',
            id,
            ...message,
          }),
        )
      if (!session) {
        reply({ error: { code: 4900, message: 'Not connected.' } })
        return
      }
      /*
        Which frame spoke, not which page is on screen. The nonce only says
        "a script somewhere in this screen's WebView" — the provider script is
        main-frame-only but the native bridge is not, so an advert iframe on a
        connected dApp could post `eth_accounts` and have it answered in the
        dApp's name. The frame's own origin is the authenticator, and it has
        to be the origin the session was opened for.
      */
      const from = frameUrl === null ? null : originOf(frameUrl)
      if (from !== session.origin) {
        reply({ error: { code: 4900, message: 'Not connected.' } })
        return
      }
      engine.dapps
        .request({
          sessionId: session.sessionId,
          channel: channel.current,
          id,
          method: data.method,
          ...(data.params !== undefined ? { params: data.params } : {}),
        })
        .then(
          (r) => reply(r.error ? { error: r.error } : { result: r.result ?? null }),
          (err: unknown) =>
            reply({
              error: { code: -32603, message: err instanceof Error ? err.message : 'failed' },
            }),
        )
    },
    [engine, session],
  )

  const script = `window.__BV_CHANNEL=${JSON.stringify(channel.current)};${host.browser?.providerScript ?? ''}`
  // An SPA route change on iOS can drop the early injection: check on every load end and re-inject (§5.3).
  const reinject = useCallback(() => {
    handle.current?.injectJavaScript(
      `(function(){ if (!(window.ethereum && window.ethereum.isBoltVault)) { ${script} } })(); true;`,
    )
  }, [script])

  const go = (): void => {
    const next = normalise(typed)
    setNavigating(true)
    setUrl(next)
    setTyped(next)
  }

  if (!host.browser) {
    return (
      <Column flex={1} padding={inset} gap="$3" testID="browser">
        <PageHeader title={t({ id: 'browser.title', message: 'Browser' })} />
        <Plate gap="$2">
          <Body tone="mute">
            {t({
              id: 'browser.web',
              message:
                'The in-app browser is a phone feature. In the browser extension, BoltVault is already in every tab — open the site and connect from there.',
            })}
          </Body>
          <Key
            label={t({ id: 'browser.open', message: 'Open app.electroswap.io' })}
            kind="secondary"
            onPress={() => void host.openUrl?.(HOME)}
            testID="browser-open"
          />
        </Plate>
      </Column>
    )
  }

  return (
    <Column flex={1} testID="browser">
      {/*
        One bar, the way a browser has one.

        There were two: an address row, and under it a strip carrying the
        origin as a chip, the page's <title>, and the reload circle. Owner:
        "There's no need for the page title bar under the address bar… Back the
        back button consistent with the rest of the back buttons. Restyle 'Go'
        in a circle and put the refresh circle button next to 'Go'."

        The strip's one load-bearing job was saying whether the origin was
        fetched over TLS, and that is the padlock inside the field now — where
        every other browser puts it, against the URL it vouches for, instead of
        as a second copy of the address on its own line. The page title was
        never anything the URL did not already say.
      */}
      <Row gap="$2" padding={metrics.inset} paddingBottom={8} alignItems="center">
        {/* The same round Back as `ScreenHeader`'s, not a squared-off Key. */}
        <IconButton icon="back" label={t({ id: 'back', message: 'Back' })} onPress={() => (nav.canGoBack ? handle.current?.goBack() : router.back())} testID="browser-back" />
        <Row
          flex={1}
          minWidth={0}
          alignItems="center"
          gap={6}
          paddingLeft={10}
          paddingRight={4}
          height={metrics.hit}
          borderWidth={1}
          borderRadius={radius.well}
          borderColor="$edge"
          backgroundColor="$well"
          accessibilityLabel={session?.verified ? t({ id: 'browser.secure', message: 'Secure · {o}', values: { o: origin ?? '' } }) : t({ id: 'browser.insecure', message: 'Not secure · {o}', values: { o: origin ?? '' } })}
          testID="browser-origin"
        >
          <Icon name={session?.verified ? 'lock' : 'globe'} size={14} color={session?.verified ? paint.arc : paint.mute} />
          <Column flex={1} minWidth={0}>
            <Input value={typed} onChange={setTyped} placeholder="https://" bare onSubmit={go} testID="browser-url" />
          </Column>
        </Row>
        <RoundKey label={t({ id: 'browser.go', message: 'Go' })} onPress={go} testID="browser-go" />
        <IconButton icon="refresh" label={t({ id: 'browser.reload', message: 'Reload' })} onPress={() => handle.current?.reload()} testID="browser-reload" />
      </Row>
      {/* Loading was a word on the strip that is gone; it is the hairline every browser draws. */}
      <Column height={2} backgroundColor={navigating ? paint.arc : 'transparent'} testID="browser-progress" />
      {error ? (
        <Body tone="burn" size="caption" paddingHorizontal={metrics.inset} testID="browser-error">
          {error}
        </Body>
      ) : null}
      {/* The only door out of the browser (ES-BV-039). */}
      <Sheet open={leaving !== null} onClose={() => setLeaving(null)} title={t({ id: 'browser.leave.title', message: 'This page wants to open something else' })} testID="browser-leave">
        <Column gap="$3">
          <Body tone="mute" size="caption">
            {t({ id: 'browser.leave.body', message: 'It is asking to leave the browser and open this. Only continue if you asked for it.' })}
          </Body>
          <Body size="caption" selectable testID="browser-leave-url">
            {leaving ?? ''}
          </Body>
          <Row gap="$2">
            <Key label={t({ id: 'common.cancel', message: 'Cancel' })} kind="secondary" onPress={() => setLeaving(null)} testID="browser-leave-cancel" />
            <Key
              label={t({ id: 'browser.leave.go', message: 'Open it' })}
              onPress={() => {
                const target = leaving
                setLeaving(null)
                if (target) deliverLink(target)
              }}
              testID="browser-leave-go"
            />
          </Row>
        </Column>
      </Sheet>
      <WebView
        url={url}
        injectedScriptBeforeLoad={script}
        onMessage={onMessage}
        onNavigate={(s) => {
          setNav(s)
          setTyped(s.url)
          setError(null)
          setNavigating(false)
        }}
        onNavigateStart={() => setNavigating(true)}
        onExternalNavigation={({ url: target, isTopFrame, fromGesture }) => {
          // A third-party frame is not the page the user is on, and an
          // assignment to `location` is not a person deciding anything.
          if (isTopFrame && fromGesture) setLeaving(target)
          return false
        }}
        onLoadEnd={reinject}
        onError={(m) => {
          setError(m)
          setNavigating(false)
        }}
        handleRef={(h) => (handle.current = h)}
        testID="browser-page"
      />
    </Column>
  )
}

/**
 * "Go", in the same circle the icon buttons beside it wear.
 *
 * `IconButton` is that circle with a glyph in it; this is that circle with two
 * letters in it, so the three controls at the right of the address bar are one
 * row of discs rather than a rectangle and two circles. Owner: "Restyle 'Go'
 * in a circle and put the refresh circle button next to 'Go'."
 */
function RoundKey({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID} style={{ width: metrics.hit, height: metrics.hit, alignItems: 'center', justifyContent: 'center' }}>
      <Column width={metrics.disc} height={metrics.disc} borderRadius={metrics.disc / 2} backgroundColor="$glassRaised" alignItems="center" justifyContent="center" overflow="hidden">
        <Body size="caption" fontWeight="600" tone="arc" zIndex={1}>
          {label}
        </Body>
        <Rim radius={metrics.disc / 2} opacity={0.35} />
      </Column>
    </Pressable>
  )
}
