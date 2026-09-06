import { App, type ScreenId } from '@boltvault/wallet'
import { createRoot } from 'react-dom/client'
import { installActivityTouch } from '../../src/activity-touch'
import { connectEngine } from '../../src/engine-client'
import { extensionUiHost } from '../../src/ui-host'

const root = document.getElementById('root')
if (!root) throw new Error('tab: no #root')
const screen = new URLSearchParams(location.search).get('screen') as ScreenId | null
const engine = connectEngine()
installActivityTouch(engine, window)
createRoot(root).render(<App engine={engine} body="extension-tab" host={extensionUiHost('extension-tab')} {...(screen ? { initialScreen: screen } : {})} />)
