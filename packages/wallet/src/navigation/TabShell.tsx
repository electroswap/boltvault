/**
 * TabShell — mounts the four tabs and the push stack for every body. While
 * the vault exists but is locked, every surface except onboarding/harness
 * screens is replaced by Unlock. A pending dApp approval takes over the
 * popup and the mobile body (the sign window mounts it by route).
 */
import { Column, Field, MotionProvider, PageLoader, Scrim, ScreenEnter, TabBar, metrics, useInsets, useWindowDimensions, type EnterDirection } from '@boltvault/ui'
import { Suspense, lazy, useEffect, useRef } from 'react'
import { t } from '../i18n'
import { Approval } from '../screens/Approval'
import { Home, type HomeProps } from '../screens/Home'
import { Onboarding } from '../screens/Onboarding'
import { Splash } from '../screens/Splash'
import { UpdateRequired } from '../components/UpdateRequired'
import { Unlock } from '../screens/Unlock'
import { useApprovals } from '../state/useApprovals'
import { HardwarePrompt } from '../components/HardwarePrompt'
import { useFlowNavigation } from '../state/useSwapFlow'
import { useLinks } from '../state/useLinks'
import { useFeelEvents } from '../feel'
import { useWalletState } from '../state/useWalletState'
import { useScene } from '../state/useScene'
import { useAnyScreenBusy } from '../state/useScreenBusy'
import { MotionContext, useReducedMotion } from '../state/useReducedMotion'
import { useNotifications } from '../hooks/useNotifications'
import { useChainHead } from '../hooks/useChainHead'
import { useHolderTier } from '../hooks/useHolderTier'
import { SCREENS, TABS, TAB_ORDER, type TabId } from './registry'
import { useAndroidBack } from '../state/useAndroidBack'
import { useRouter } from './router'

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
  const insets = useInsets()
  useAndroidBack()
  const { vault, loading, active } = useWalletState()
  const { width, height } = useWindowDimensions()
  const scene = useScene()
  // One loader for the whole app, drawn here where it can cover the screen and
  // centre against the viewport rather than against a screen's scroll content.
  const busy = useAnyScreenBusy()
  // The Grid (plan B2): one Field behind every `grid` screen, pulsed by the ETN head, warmed by the holder tier.
  const head = useChainHead(ETN)
  const tier = useHolderTier(active?.id ?? null)
  const { pending } = useApprovals()
  const { current, state } = router
  // One answer for every screen (plan A4): the setting, the system preference, or the harness override.
  const reducedMotion = useReducedMotion(reducedMotionOverride)
  const { unread } = useNotifications()
  // A swap or limit-order flow opens its sheets from here, where nothing unmounts (§8.6).
  useFlowNavigation()
  useFeelEvents()
  useLinks()
  // Owner: split the routes, "but preload other CSS for the rest of the bundle
  // after home is rendered so there's no additional load time for next
  // tabs/pages." One effect after the first paint, on idle.
  useEffect(() => {
    prefetchScreens()
  }, [])
  const items = TAB_ORDER.map((id) => ({ id, label: t({ id: TABS[id].labelId, message: TABS[id].labelMessage }), icon: TABS[id].icon, ...(id === 'activity' && unread > 0 ? { badge: unread } : {}) }))
  const meta = SCREENS[current.screen]
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
  const showTabs = meta.dock && !wide
  // How the view arrives (style bible › motion): a push from the right, a pop from the left, a tab change rising in place; the same route never re-animates.
  const depth = state.stack.length
  const prev = useRef({ depth, tab: state.tab, screen: current.screen })
  const direction: EnterDirection = state.tab !== prev.current.tab ? 'tab' : depth > prev.current.depth ? 'push' : depth < prev.current.depth ? 'pop' : current.screen !== prev.current.screen ? 'push' : 'none'
  useEffect(() => {
    prev.current = { depth, tab: state.tab, screen: current.screen }
  })
  const enterKey = `${state.tab}:${depth}:${current.screen}:${JSON.stringify(current.params ?? null)}`

  const locked = !loading && !!vault?.exists && !vault.unlocked
  if (locked && current.screen !== 'onboarding' && current.screen !== 'moments') {
    return (
      <MotionContext.Provider value={reducedMotion}>
        <Unlock body={body} reducedMotion={reducedMotion} />
      </MotionContext.Provider>
    )
  }

  // A dApp is waiting: the popup and the phone show the sheet over everything (§8.15).
  // Our own flows (Send, Revoke) navigate to the sheet themselves.
  const external = pending.filter((p) => !p.origin.startsWith('internal:'))
  if (external.length > 0 && body !== 'extension-tab' && current.screen !== 'sign' && current.screen !== 'onboarding' && current.screen !== 'moments') {
    return (
      <MotionContext.Provider value={reducedMotion}>
        <Approval body={body} reducedMotion={reducedMotion} requestId={external[0]?.id} />
      </MotionContext.Provider>
    )
  }

  let screen: React.ReactNode
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

  return (
    <MotionProvider reduced={reducedMotion}>
    <MotionContext.Provider value={reducedMotion}>
      <Column flex={1} backgroundColor="$void">
        {meta.grid ? (
          <>
            <Field scene={scene} address={active?.address ?? NO_ACCOUNT_SEED} pulse={head?.live ? 1 : 0} warmth={tier ? Math.min(1, tier.tier / 4) : 0} intensity={current.screen === 'home' ? (body === 'extension-popup' ? 0.75 : 1) : 0.5} quiet={!vault?.unlocked} reducedMotion={reducedMotion} fps={body === 'extension-popup' ? 30 : 60} width={width} height={height} testID="field" />
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
          </>
        ) : null}
        {/*
          The screen area clips. Every enter animation starts outside its own
          box — a push from translateX(14), a tab change from translateY(6), a
          sheet panel from translateY(28) — and without a clip here that
          overflow reaches the document. Chrome sizes an action popup from the
          document and never shrinks it back, so one frame of a 14 px slide
          left the popup permanently wider with a margin down the right side.
          Sheets are position:absolute inset-0 inside this same column, so
          clipping it does not change what they cover.
        */}
        {/*
          Top inset only here, so the scene still paints edge to edge behind the
          status bar while nothing readable sits under it. The dock takes the
          bottom inset itself.
        */}
        <Column flex={1} zIndex={1} overflow="hidden" paddingTop={insets.top}>
          {/*
            One width for every screen, applied here rather than in each of
            thirty. Home, Portfolio, Swap, the Rack and a handful of others had
            said it for themselves; Send, Receive, Explore, the Launchpad and
            the rest had not, so they ran the width of the display. A screen
            that wants to be narrower still says so — a narrower child inside
            this is exactly what it looks like.
          */}
          <Column flex={1} width="100%" {...(wide ? { maxWidth: metrics.page, alignSelf: 'center' } : {})}>
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
          {/* Over the screen, under the tab bar: the page assembles beneath it. */}
          {busy ? <PageLoader overlay reducedMotion={reducedMotion} testID="page-loading" /> : null}
        </Column>
        {showTabs ? <TabBar items={items} activeId={state.tab} onSelect={(id) => router.setTab(id as TabId)} testID="tabs" /> : null}
        {/* Last child, so a device round trip sheet paints above the tab bar (§7.5). */}
        <HardwarePrompt body={body} reducedMotion={reducedMotion} />
        <UpdateRequired />
      </Column>
    </MotionContext.Provider>
    </MotionProvider>
  )
}
