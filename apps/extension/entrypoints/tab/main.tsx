import { App, type ScreenId } from '@boltvault/wallet'
import { createRoot } from 'react-dom/client'
import { connectEngine } from '../../src/engine-client'
import { extensionUiHost } from '../../src/ui-host'

const root = document.getElementById('root')
if (!root) throw new Error('tab: no #root')
const screen = new URLSearchParams(location.search).get('screen') as ScreenId | null
createRoot(root).render(<App engine={connectEngine()} body="extension-tab" host={extensionUiHost('extension-tab')} {...(screen ? { initialScreen: screen } : {})} />)
