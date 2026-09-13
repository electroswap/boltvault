/**
 * The screenshot/motion harness page. Renders any registered screen against a
 * fixture engine (no service worker, no network) so screenshots are
 * deterministic. Never linked from the product UI; the manifest does not
 * expose it and it holds no secrets.
 *
 * harness.html?scenario=funded&screen=home&body=extension-popup&motion=reduced
 *
 * `art=on` additionally loads the collection's real images from the CDN. It is
 * off by default so the committed baselines stay network-free and
 * deterministic; the landing page's screenshots are the only thing that asks.
 */
import { App, isTabId, type ScreenId } from '@boltvault/wallet'
// The harness is the only thing that builds a scripted engine, so it is the
// only thing that imports one (ES-BV-044).
import { createFixtureEngine, type FixtureScenario } from '@boltvault/wallet/fixtures'
import '../../src/chrome.css'
import { createRoot } from 'react-dom/client'

const q = new URLSearchParams(location.search)
const scenario = (q.get('scenario') ?? 'funded') as FixtureScenario
const screen = (q.get('screen') ?? 'home') as ScreenId
const body = (q.get('body') ?? 'extension-popup') as 'extension-popup' | 'extension-tab' | 'mobile'
const reducedMotion = q.get('motion') === 'reduced'
const dapp = q.get('dapp') ?? 'on'
const art = q.get('art') === 'on'
/**
 * `dapp=connected` also makes the host report the harness body.
 *
 * Home only asks for the site strip when the host is the extension popup or
 * the harness (`host.body`), because "the site under the popup" is an
 * extension idea — a phone has no current tab. The fixture already connects
 * app.electroswap.io, so declaring the body is the whole of what was missing.
 * It is opt-in because several screens branch on `host.body`, and flipping it
 * for every shot would move more than this one strip.
 */
const harnessHost = {
  copy: async () => undefined,
  currentTab: async () => (dapp === 'none' ? null : dapp === 'off' ? { origin: 'https://example.com', host: 'example.com', favicon: null } : { origin: 'https://app.electroswap.io', host: 'app.electroswap.io', favicon: null }),
  ...(dapp === 'connected' ? { body: 'harness' as const } : {}),
  /*
    At mobile size, declare the capability a phone has.
    `host.browser` is how a screen asks "is there an in-app browser here" —
    Home's address bar and Explore's browser key both read it — so without it
    the `mobile` shots were the phone's dimensions showing the extension's
    surface area, and the one baseline that should have caught a missing
    mobile-only control could not see it. Only the capability is declared;
    `providerScript` is empty because nothing in the harness loads a page, and
    `Browser.tsx` renders the web `WebView` stub here in any case.
  */
  ...(body === 'mobile' ? { browser: { providerScript: '' } } : {}),
}

const root = document.getElementById('root')
if (!root) throw new Error('harness: no #root')

createFixtureEngine(scenario, { art }).then((engine) => {
  const initialTab = isTabId(screen) ? screen : 'home'
  // Screens with required params get a representative fixture value.
  const LEGENDS = '0x31cbb613D14cc85Cf3A8889007562E4B5cE9518b'
  const segment = q.get('segment')
  /*
    `step` (and `path`) reach onboarding's later steps, which had no baseline at
    all — `screens.spec.ts` captured the first frame and nothing else, so eight
    of nine steps could regress unseen. The screen validates the value through
    `clampEntryStep`, which admits only steps that need no state from a previous
    one; `words` and `quiz` are deliberately not among them, because a phrase is
    freshly random every run and would make a pixel baseline meaningless.
  */
  const step = q.get('step')
  const path = q.get('path')
  /*
    `address` reaches a different token than the default one.

    The token screen branches on what the token is — a market, a bridge
    corridor, a custom entry — and with one hardcoded address only one of those
    branches could ever be photographed. It is opt-in, so every committed
    baseline still shows BOLT.
  */
  const address = q.get('address')
  /*
    `tab` opens the token screen straight onto Transactions, which is the only
    way that half of the screen can be photographed — the control is a press,
    and a baseline run does not press anything.
  */
  const tokenTab = q.get('tab')
  const initialParams = screen === 'onboarding' ? { ...(step ? { step } : {}), ...(path === 'create' || path === 'import' || path === 'watch' ? { path } : {}) } : screen === 'token' ? { chainId: 52014, address: address ?? '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1', ...(tokenTab === 'info' || tokenTab === 'transactions' ? { tab: tokenTab } : {}) } : screen === 'collection' ? { chainId: 52014, address: LEGENDS } : screen === 'nft' ? { chainId: 52014, address: LEGENDS, tokenId: '12' } : screen === 'farm' ? { chainId: 52014, farmId: 0 } : screen === 'campaign' ? { chainId: 52014, pool: '0x9999999999999999999999999999999999999999' } : screen === 'explore' && (segment === 'tokens' || segment === 'collectibles' || segment === 'launch' || segment === 'farms') ? { segment } : undefined
  createRoot(root).render(<App engine={engine.engine} body={body} initialTab={initialTab} initialScreen={screen} {...(initialParams ? { initialParams } : {})} reducedMotion={reducedMotion} host={harnessHost} />)
  document.documentElement.dataset['ready'] = '1'
})
