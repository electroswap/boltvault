import { App, isScreenId, isTabId, type ScreenId, type ScreenParams } from '@boltvault/wallet'
import '../../src/chrome.css'
import { createRoot } from 'react-dom/client'
import { installActivityTouch } from '../../src/activity-touch'
import { connectEngine } from '../../src/engine-client'
import { installImageCache } from '../../src/image-cache'
import { extensionUiHost } from '../../src/ui-host'

installImageCache()
const root = document.getElementById('root')
if (!root) throw new Error('tab: no #root')

// tab.html?tab=<dock tab>&screen=<screen>&p=<json params> (plan B2): every part is validated against the registry; anything else opens Home.
const q = new URLSearchParams(location.search)
const tabParam = q.get('tab') ?? ''
const screenParam = q.get('screen') ?? ''
const initialTab = isTabId(tabParam) ? tabParam : undefined
const initialScreen = isScreenId(screenParam) ? screenParam : undefined
let initialParams: ScreenParams[ScreenId] | undefined
const p = q.get('p')
if (p && initialScreen) {
  try {
    const parsed: unknown = JSON.parse(p)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) initialParams = parsed as ScreenParams[ScreenId]
  } catch {
    initialParams = undefined
  }
}

const engine = connectEngine()
installActivityTouch(engine, window)
createRoot(root).render(<App engine={engine} body="extension-tab" host={extensionUiHost('extension-tab')} {...(initialTab ? { initialTab } : {})} {...(initialScreen ? { initialScreen } : {})} {...(initialParams !== undefined ? { initialParams } : {})} />)
