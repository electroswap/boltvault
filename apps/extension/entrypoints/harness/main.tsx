/**
 * The screenshot/motion harness page. Renders any registered screen against a
 * fixture engine (no service worker, no network) so screenshots are
 * deterministic. Never linked from the product UI; the manifest does not
 * expose it and it holds no secrets.
 *
 * harness.html?scenario=funded&screen=home&body=extension-popup&motion=reduced
 */
import { App, createFixtureEngine, isTabId, type FixtureScenario, type ScreenId } from '@boltvault/wallet'
import { createRoot } from 'react-dom/client'

const q = new URLSearchParams(location.search)
const scenario = (q.get('scenario') ?? 'funded') as FixtureScenario
const screen = (q.get('screen') ?? 'home') as ScreenId
const body = (q.get('body') ?? 'extension-popup') as 'extension-popup' | 'extension-tab' | 'mobile'
const reducedMotion = q.get('motion') === 'reduced'

const root = document.getElementById('root')
if (!root) throw new Error('harness: no #root')

createFixtureEngine(scenario).then((engine) => {
  const initialTab = isTabId(screen) ? screen : 'home'
  // Screens with required params get a representative fixture value.
  const LEGENDS = '0x31cbb613D14cc85Cf3A8889007562E4B5cE9518b'
  const initialParams = screen === 'token' ? { chainId: 52014, address: '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1' } : screen === 'collection' ? { chainId: 52014, address: LEGENDS } : screen === 'nft' ? { chainId: 52014, address: LEGENDS, tokenId: '12' } : screen === 'farm' ? { chainId: 52014, farmId: 0 } : screen === 'campaign' ? { chainId: 52014, pool: '0x9999999999999999999999999999999999999999' } : undefined
  createRoot(root).render(<App engine={engine.engine} body={body} initialTab={initialTab} initialScreen={screen} {...(initialParams ? { initialParams } : {})} reducedMotion={reducedMotion} />)
  document.documentElement.dataset['ready'] = '1'
})
