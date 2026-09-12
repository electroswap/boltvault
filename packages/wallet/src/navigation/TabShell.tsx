/**
 * TabShell — mounts the four tabs and the push stack for every body. While
 * the vault exists but is locked, every surface except onboarding/harness
 * screens is replaced by Unlock. A pending dApp approval takes over the
 * popup and the mobile body (the sign window mounts it by route).
 */
import { Body, Column, Field, Key, MotionProvider, PageLoader, Row, Scrim, ScreenEnter, Sheet, metrics, useAppHidden, useInsets, useWindowDimensions, type EnterDirection } from '@boltvault/ui'
import { Suspense, lazy, useEffect, useRef } from 'react'
import { Approval } from '../screens/Approval'
import { Home, type HomeProps } from '../screens/Home'
import { Onboarding } from '../screens/Onboarding'
import { Splash } from '../screens/Splash'
import { UpdateRequired, isBlockedByUpdate, useUpdateRequired } from '../components/UpdateRequired'
import { Unlock } from '../screens/Unlock'
import { useApprovals } from '../state/useApprovals'
import { HardwarePrompt } from '../components/HardwarePrompt'
import { useFlowNavigation } from '../state/useSwapFlow'
import { useLinks } from '../state/useLinks'
import { t } from '../i18n'
import { useFeelEvents } from '../feel'
import { useWalletState, vaultRequiresUnlock } from '../state/useWalletState'
import { useScene } from '../state/useScene'
import { useAnyScreenBusy } from '../state/useScreenBusy'
import { MotionContext, useReducedMotion } from '../state/useReducedMotion'
import { useChainHead } from '../hooks/useChainHead'
import { useHolderTier } from '../hooks/useHolderTier'
import { useAndroidBack } from '../state/useAndroidBack'
import { useEngine } from '../engine/EngineProvider'
import { useRouter } from './router'
import { SCREENS } from './registry'
import { setSharedTransitions, sharedTransitionActive } from './transitions'

const ETN = 52014

/**
 * Every screen but the ones needed for the first frame loads on demand.
 * The popup used to parse the whole app - all thirty-odd screens statically
 * imported into one ~1.8 MB chunk - before it could paint anything, which is
 * the black frame at the start of the owner's screencast.
 *
 * Home, Unlock, Onboarding and Approval stay eager: they are what the first
 * frame can be. Everything else is prefetched on idle once Home has painted
 * (prefetchScreens), so a later tab never waits for a chunk either.
 */
const Accounts = lazy(() => import('../screens/Accounts').then((m) => ({ default: m.Accounts })))
const Activity = lazy(() => import('../screens/Activity').then((m) => ({ default: m.Activity })))
const Allowances = lazy(() => import('../screens/Allowances').then((m) => ({ default: m.Allowances })))
const Backup = lazy(() => import('../screens/Backup').then((m) => ({ default: m.Backup })))
const ConnectedSites = lazy(() => import('../screens/ConnectedSites').then((m) => ({ default: m.ConnectedSites })))
const Devices = lazy(() => import('../screens/Devices').then((m) => ({ default: m.Devices })))
const Portfolio = lazy(() => import('../screens/Portfolio').then((m) => ({ default: m.Portfolio })))
const Moments = lazy(() => import('../screens/Moments').then((m) => ({ default: m.Moments })))
const Receive = lazy(() => import('../screens/Receive').then((m) => ({ default: m.Receive })))
const Security = lazy(() => import('../screens/Security').then((m) => ({ default: m.Security })))
const Send = lazy(() => import('../screens/Send').then((m) => ({ default: m.Send })))
const Explore = lazy(() => import('../screens/Explore').then((m) => ({ default: m.Explore })))
const Collection = lazy(() => import('../screens/Collection').then((m) => ({ default: m.Collection })))
const Piece = lazy(() => import('../screens/Piece').then((m) => ({ default: m.Piece })))
const Rack = lazy(() => import('../screens/Rack').then((m) => ({ default: m.Rack })))
const Offers = lazy(() => import('../screens/Offers').then((m) => ({ default: m.Offers })))
const Farm = lazy(() => import('../screens/Farm').then((m) => ({ default: m.Farm })))
const Campaign = lazy(() => import('../screens/Campaign').then((m) => ({ default: m.Campaign })))
const Legends = lazy(() => import('../screens/Legends').then((m) => ({ default: m.Legends })))
const Alerts = lazy(() => import('../screens/Alerts').then((m) => ({ default: m.Alerts })))
const Bridge = lazy(() => import('../screens/Bridge').then((m) => ({ default: m.Bridge })))
const Networks = lazy(() => import('../screens/Networks').then((m) => ({ default: m.Networks })))
const AddressBook = lazy(() => import('../screens/AddressBook').then((m) => ({ default: m.AddressBook })))
const Browser = lazy(() => import('../screens/Browser').then((m) => ({ default: m.Browser })))
const Feel = lazy(() => import('../screens/Feel').then((m) => ({ default: m.Feel })))
const About = lazy(() => import('../screens/About').then((m) => ({ default: m.About })))
const Spending = lazy(() => import('../screens/Spending').then((m) => ({ default: m.Spending })))
const Swap = lazy(() => import('../screens/Swap').then((m) => ({ default: m.Swap })))
const Token = lazy(() => import('../screens/Token').then((m) => ({ default: m.Token })))
const SettingsShell = lazy(() => import('../screens/shells').then((m) => ({ default: m.SettingsShell })))

/** Warm every on-demand screen once the first paint is done. */
export function prefetchScreens(): void {
  const load = (): void => {
    void Promise.all([
      import('../screens/Accounts'),
      import('../screens/Activity'),
      import('../screens/Allowances'),
      import('../screens/Backup'),
      import('../screens/ConnectedSites'),
      import('../screens/Devices'),
      import('../screens/Portfolio'),
      import('../screens/Moments'),
      import('../screens/Receive'),
      import('../screens/Security'),
      import('../screens/Send'),
      import('../screens/Explore'),
      import('../screens/Collection'),
      import('../screens/Piece'),
      import('../screens/Rack'),
      import('../screens/Offers'),
      import('../screens/Farm'),
      import('../screens/Campaign'),
      import('../screens/Legends'),
      import('../screens/Alerts'),
      import('../screens/Bridge'),
      import('../screens/Networks'),
      import('../screens/AddressBook'),
      import('../screens/Browser'),
      import('../screens/Feel'),
      import('../screens/About'),
      import('../screens/Spending'),
      import('../screens/Swap'),
      import('../screens/Token'),
      import('../screens/shells'),
    ]).catch(() => undefined)
  }
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
  if (idle) idle(load, { timeout: 2_000 })
  else setTimeout(load, 300)
}

const NO_ACCOUNT_SEED = '0x0000000000000000000000000000000000000e7n'

export interface TabShellProps {
  readonly body: HomeProps['body']
  readonly reducedMotionOverride?: boolean
}

export function TabShell({ body, reducedMotionOverride }: TabShellProps) {
  const router = useRouter()
  const engine = useEngine()
  const insets = useInsets()
  useAndroidBack()
  const { vault, loading, active } = useWalletState()
  const hidden = useAppHidden()
  const { width, height } = useWindowDimensions()
  const scene = useScene()
  // One loader for the whole app, drawn here where it can cover the screen and
  // centre against the viewport rather than against a screen's scroll content.
  const busy = useAnyScreenBusy()
  // The Grid: one Field behind every screen, pulsed by the ETN head, warmed by the holder tier.
  const head = useChainHead(ETN)
  const tier = useHolderTier(active?.id ?? null)
  const { pending } = useApprovals()
  const { current, state } = router
  // One answer for every screen (plan A4): the setting, the system preference, or the harness override.
  const reducedMotion = useReducedMotion(reducedMotionOverride)
  // A swap or limit-order flow opens its sheets from here, where nothing unmounts (§8.6).
  useFlowNavigation()
  useFeelEvents()
  const { pendingPairing, confirmPairing, dismissPairing } = useLinks()
  // Whether the signed flags say this build is too old (ES-BV-007).
  const staleBuild = useUpdateRequired()
  // Owner: split the routes, "but preload other CSS for the rest of the bundle
  // after home is rendered so there's no additional load time for next
  // tabs/pages." One effect after the first paint, on idle.
  useEffect(() => {
    prefetchScreens()
  }, [])
  // Reduced motion skips the shared move entirely, so the router stops asking
  // the browser for one (§7.6). The primitive drops its names to match.
  useEffect(() => {
    setSharedTransitions(!reducedMotion)
  }, [reducedMotion])
  /*
    The full tab is not a big phone.

    The dock is a phone's answer to "no room for anything else", and in a
    browser tab there is room for everything else — so it goes, and Swap and
    Activity move onto Home where they read as places rather than as a strip of
    icons pinned to the bottom of a monitor. What must not go with it is the
    way back: with no dock, a screen reached from Home has to offer Home, so
    the rail below does, everywhere except Home itself and the ceremonies
    (onboarding, unlock, signing) that must not offer a way out mid-flow.
  */
  const wide = body === 'extension-tab'
  /*
    There is no dock.

    It was a phone's answer to navigation, and it cost a permanent strip of the
    screen to offer three doors — two of which (Swap, Activity) are things you
    do rather than places you live. Owner: "I want to get rid of the bottom
    dock." They are tiles on Home now, alongside Send and Receive, and Swap and
    Activity carry a way home in their own title row (`HomeKey`), which is what
    the full tab has always done.

    `state.tab` survives: it is still how the router remembers which root you
    are standing on and which stack belongs to it. Only the strip is gone.
  */
  // How the view arrives: a 150 ms ease fade, covering when the incoming screen is opaque and dissolving onto the Field when it is not.
  const depth = state.stack.length
  // Resume flips `hidden` and re-renders, so `Date.now()` is current: the idle
  // deadline can have passed while we were asleep, and the last paint still
  // had `unlocked: true`.
  const locked = !loading && vaultRequiresUnlock(vault, Date.now())
  useEffect(() => {
    if (hidden || !vault?.unlocked || vault.lockAt == null || vault.lockAt > Date.now()) return
    void engine.vault.lock()
  }, [engine, hidden, vault])
  // A dApp is waiting: the popup and the phone show the sheet over everything (§8.15).
  // Our own flows (Send, Revoke) navigate to the sheet themselves.
  const external = pending.filter((p) => !p.origin.startsWith('internal:'))
  const takeover =
    locked && current.screen !== 'onboarding' && current.screen !== 'moments'
      ? 'unlock'
      : external.length > 0 && body !== 'extension-tab' && current.screen !== 'sign' && current.screen !== 'onboarding' && current.screen !== 'moments'
        ? 'approval'
        : null
  const enterKey =
    takeover === 'unlock'
      ? 'overlay:unlock'
      : takeover === 'approval'
        ? `overlay:approval:${external[0]?.id ?? ''}`
        : `${state.tab}:${depth}:${current.screen}:${JSON.stringify(current.params ?? null)}`
  const prevKey = useRef(enterKey)
  /*
    One move at a time (§7.7). While a shared element is travelling between
    two screens the arriving screen holds still: the fade and the shared
    move are two animations disagreeing about where the same pixels are, and
    the element the eye is following is the one that should win.
  */
  const direction: EnterDirection = sharedTransitionActive() ? 'none' : enterKey !== prevKey.current ? 'push' : 'none'
  useEffect(() => {
    prevKey.current = enterKey
  })

  /*
    A stale build stops quoting, routing and signing — and nothing else
    (ES-BV-007).

    `UpdateRequired` used to be a non-dismissible overlay mounted last in this
    shell, over every screen. So an operational mistake — a `minVersion` of
    "9.0.0" published by accident, or a misused signing key — locked every
    install out of Backup, Reveal and Export until a corrected file with a
    newer `issuedAt` was published and fetched, and an offline device stayed
    locked out for good. A non-custodial wallet must never put the user's
    recovery phrase behind a remote switch. The plate now stands in place of
    the screens that need current code; Settings, Security, Backup, Devices,
    Accounts and Activity are reached exactly as before.
  */
  const blockedByUpdate = staleBuild && !takeover && isBlockedByUpdate(current.screen)

  let screen: React.ReactNode
  if (blockedByUpdate) {
    // Unlock and the signing sheet are takeovers and are handled above, so a
    // stale build never stands between the user and their own vault.
    screen = <UpdateRequired />
  } else if (takeover === 'unlock') {
    screen = <Unlock body={body} reducedMotion={reducedMotion} />
  } else if (takeover === 'approval') {
    screen = <Approval body={body} reducedMotion={reducedMotion} requestId={external[0]?.id} />
  }
  if (!takeover && !blockedByUpdate) {
    switch (current.screen) {
    case 'home':
      screen = <Home body={body} reducedMotionOverride={reducedMotion} />
      break
    case 'portfolio':
      screen = <Portfolio body={body} />
      break
    case 'swap': {
      const p = current.params as { tokenIn?: string; tokenOut?: string } | undefined
      // Keyed on its prefill so Token → Swap remounts with the new pair (plan B2).
      screen = <Swap key={`${p?.tokenIn ?? ''}>${p?.tokenOut ?? ''}`} body={body} reducedMotion={reducedMotion} {...(p?.tokenIn ? { tokenIn: p.tokenIn } : {})} {...(p?.tokenOut ? { tokenOut: p.tokenOut } : {})} />
      break
    }
    case 'explore': {
      const p = current.params as { segment?: 'tokens' | 'collectibles' | 'launch' | 'farms'; search?: boolean } | undefined
      screen = <Explore body={body} {...(p?.segment ? { segment: p.segment } : {})} {...(p?.search ? { search: true } : {})} />
      break
    }
    case 'collection': {
      const p = current.params as { chainId: number; address: string } | undefined
      screen = <Collection body={body} reducedMotion={reducedMotion} chainId={p?.chainId ?? 52014} address={p?.address ?? ''} />
      break
    }
    case 'nft': {
      const p = current.params as { chainId: number; address: string; tokenId: string } | undefined
      screen = <Piece body={body} reducedMotion={reducedMotion} chainId={p?.chainId ?? 52014} address={p?.address ?? ''} tokenId={p?.tokenId ?? '0'} />
      break
    }
    case 'rack':
      screen = <Rack body={body} />
      break
    case 'offers':
      screen = <Offers body={body} reducedMotion={reducedMotion} />
      break
    case 'farm': {
      const p = current.params as { chainId: number; farmId: number } | undefined
      screen = <Farm body={body} reducedMotion={reducedMotion} chainId={p?.chainId ?? 52014} farmId={p?.farmId ?? 0} />
      break
    }
    case 'campaign': {
      const p = current.params as { chainId: number; pool: string } | undefined
      screen = <Campaign body={body} reducedMotion={reducedMotion} chainId={p?.chainId ?? 52014} pool={p?.pool ?? ''} />
      break
    }
    case 'legends':
      screen = <Legends body={body} reducedMotion={reducedMotion} />
      break
    case 'bridge': {
      const p = current.params as { chainId?: number; token?: string } | undefined
      screen = <Bridge body={body} reducedMotion={reducedMotion} {...(p?.chainId ? { chainId: p.chainId } : {})} {...(p?.token ? { token: p.token } : {})} />
      break
    }
    case 'networks':
      screen = <Networks body={body} />
      break
    case 'addressBook':
      screen = <AddressBook body={body} />
      break
    case 'browser': {
      const p = current.params as { url?: string } | undefined
      screen = <Browser body={body} {...(p?.url ? { url: p.url } : {})} />
      break
    }
    case 'feel':
      screen = <Feel body={body} />
      break
    case 'about':
      screen = <About body={body} />
      break
    case 'alerts':
      screen = <Alerts body={body} />
      break
    case 'activity':
      screen = <Activity body={body} />
      break
    case 'settings':
      screen = <SettingsShell body={body} />
      break
    case 'security':
      screen = <Security body={body} />
      break
    case 'devices':
      screen = <Devices body={body} />
      break
    case 'sites':
      screen = <ConnectedSites body={body} />
      break
    case 'allowances':
      screen = <Allowances body={body} />
      break
    case 'spending':
      screen = <Spending body={body} />
      break
    case 'accounts':
      screen = <Accounts body={body} />
      break
    case 'backup':
      screen = <Backup reducedMotion={reducedMotion} />
      break
    case 'unlock':
      screen = <Unlock body={body} reducedMotion={reducedMotion} />
      break
    case 'onboarding':
      screen = <Onboarding reducedMotion={reducedMotion} />
      break
    case 'splash':
      screen = <Splash reducedMotion={reducedMotion} />
      break
    case 'moments':
      screen = <Moments reducedMotion={reducedMotion} />
      break
    case 'sign': {
      const requestId = (current.params as { requestId?: string } | undefined)?.requestId
      screen = <Approval body={body} reducedMotion={reducedMotion} {...(requestId ? { requestId } : {})} />
      break
    }
    case 'receive': {
      const p = current.params as { token?: string; chainId?: number } | undefined
      screen = <Receive body={body} {...(p?.token ? { token: p.token } : {})} {...(p?.chainId ? { chainId: p.chainId } : {})} />
      break
    }
    case 'send': {
      const p = current.params as { token?: string; to?: string; requestId?: string; chainId?: number } | undefined
      screen = <Send body={body} reducedMotion={reducedMotion} {...(p?.token ? { token: p.token } : {})} {...(p?.to ? { to: p.to } : {})} {...(p?.requestId ? { requestId: p.requestId } : {})} {...(p?.chainId ? { chainId: p.chainId } : {})} />
      break
    }
    case 'token': {
      const p = current.params as { chainId: number; address: string } | undefined
      screen = <Token body={body} chainId={p?.chainId ?? 52014} address={p?.address ?? 'native'} />
      break
    }
    }
  }

  return (
    <MotionProvider reduced={reducedMotion}>
    <MotionContext.Provider value={reducedMotion}>
      <Column flex={1} backgroundColor="$void">
        {current.screen === 'splash' ? null : (
          <>
            <Field scene={scene} address={active?.address ?? NO_ACCOUNT_SEED} pulse={head?.live ? 1 : 0} warmth={tier ? Math.min(1, tier.tier / 4) : 0} intensity={0.5} reducedMotion={reducedMotion} fps={body === 'extension-popup' ? 30 : 60} width={width} height={height} testID="field" />
            {/*
              Dark at the top, the circuit emerging downward — the Unlock
              screen's look, which the owner asked for everywhere the scene
              runs. It is also the style bible's own rule: "the top third of the
              frame carries only the aurora and grain", and "nothing above 40 %
              luminance under a readout". The grid screens ran the scene at full
              strength from the very first pixel, so the busiest part of the
              frame sat directly behind the balance.

              A scrim rather than a shader change, because the scene is two
              hand-written implementations (WebGL and Skia) of one spec and this
              is a composition choice, not a change to what the scene is.
            */}
            <Column position="absolute" left={0} top={0} zIndex={0} pointerEvents="none">
              <Scrim width={width} height={height} edge="top" strength={0.78} testID="field-fade" />
            </Column>
            {takeover || !SCREENS[current.screen].veil ? null : (
              <Column position="absolute" left={0} top={0} zIndex={0} pointerEvents="none">
                <Scrim width={width} height={height} edge="flat" strength={0.6} testID="field-veil" />
              </Column>
            )}
          </>
        )}
        {/*
          The screen area clips. Sheets still rise from translateY(28) inside
          this column, and without a clip that overflow reaches the document.
          Chrome sizes an action popup from the document and never shrinks it
          back. Sheets are position:absolute inset-0 here, so clipping does
          not change what they cover.
        */}
        {/*
          Top inset only here, so the scene still paints edge to edge behind the
          status bar while nothing readable sits under it. The dock takes the
          bottom inset itself.
        */}
        {/*
          The bottom inset belongs to whoever is at the bottom. With a dock it
          is the dock's; without one it is the screen's, and nothing was
          claiming it — so on a phone with gesture navigation the last control
          of every dockless screen sat under the system bar. The owner
          photographed onboarding's "Next" cut in half by it.
        */}
        <Column flex={1} zIndex={1} overflow="hidden" paddingTop={insets.top} paddingBottom={insets.bottom}>
          {/*
            One width for every screen, applied here rather than in each of
            thirty. Home, Portfolio, Swap, the Rack and a handful of others had
            said it for themselves; Send, Receive, Explore, the Launchpad and
            the rest had not, so they ran the width of the display. A screen
            that wants to be narrower still says so — a narrower child inside
            this is exactly what it looks like.
          */}
          <Column flex={1} width="100%" {...(wide && !takeover ? { maxWidth: metrics.page, alignSelf: 'center' } : {})}>
            <ScreenEnter key={enterKey} direction={direction} reducedMotion={reducedMotion}>
            {/*
              The fallback is a plate-shaped skeleton, not a spinner and not a
              blank: a screen whose chunk is still arriving should look like
              the screen, for the same reason a screen whose data is still
              arriving does. In practice it is rarely seen — prefetchScreens
              warms every chunk once Home has painted.
            */}
              <Suspense fallback={<PageLoader overlay reducedMotion={reducedMotion} testID="screen-loading" />}>{screen}</Suspense>
            </ScreenEnter>
          </Column>
          {/*
            Over the screen, under the tab bar: the page assembles beneath it.

            Held through the screen-enter fade as well. Hiding it for those
            150 ms was a flash of the half-built destination — a collection
            with no art, a signing sheet with no preview — which is the gap
            the overlay exists to cover. Owner, on Swap: overlay the ES loader
            the moment the key is pressed, and only lift it when the
            transaction preview is rendered.
          */}
          {busy && !takeover ? <PageLoader overlay reducedMotion={reducedMotion} testID="page-loading" /> : null}
        </Column>
        {/* Last child, so a device round trip sheet paints above the tab bar (§7.5). */}
        {takeover ? null : (
          <>
            <HardwarePrompt body={body} reducedMotion={reducedMotion} />
            {/*
              A pairing waits for a yes (ES-BV-040).

              `pair()` used to run the moment a `wc:` link arrived from anywhere —
              a page in the in-app browser, another app, a QR in an email — and the
              first thing the user saw was a Connect sheet for a peer they had not
              knowingly invited. Pairing is not free either: it opens a relay
              subscription and tells the peer this wallet exists.
            */}
            <Sheet
              open={pendingPairing !== null}
              onClose={dismissPairing}
              title={t({ id: 'wc.pair.title', message: 'Connect to an app?' })}
              testID="wc-pair-confirm"
            >
              <Column gap="$3">
                <Body tone="mute" size="caption">
                  {/* Where it came from, because that is the part that decides
                      the answer (ES-BV-040). */}
                  {pendingPairing?.from
                    ? t({
                        id: 'wc.pair.body.page',
                        message: 'A page you were reading ({s}) asked BoltVault to start a WalletConnect session. If you did not tap Connect on that page, say no.',
                        values: { s: pendingPairing.from },
                      })
                    : t({
                        id: 'wc.pair.body',
                        message: 'A link from outside BoltVault asked it to start a WalletConnect session. If you did not just scan a code or tap Connect on a site, say no.',
                      })}
                </Body>
                <Body size="caption" tone="mute" selectable testID="wc-pair-topic">
                  {pendingPairing?.topic ?? ''}
                </Body>
                <Row gap="$2">
                  <Key label={t({ id: 'common.cancel', message: 'Cancel' })} kind="secondary" onPress={dismissPairing} testID="wc-pair-cancel" />
                  <Key label={t({ id: 'wc.pair.go', message: 'Connect' })} onPress={confirmPairing} testID="wc-pair-go" />
                </Row>
              </Column>
            </Sheet>
          </>
        )}
      </Column>
    </MotionContext.Provider>
    </MotionProvider>
  )
}
