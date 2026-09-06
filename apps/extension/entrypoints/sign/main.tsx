/**
 * The approval window (master plan §3.5, §8.15): the same App, opened by the
 * engine on `sign.html?id=<request>`, sized fixed, closed by the decision.
 */
import { App } from '@boltvault/wallet'
import { createRoot } from 'react-dom/client'
import { installActivityTouch } from '../../src/activity-touch'
import { connectEngine } from '../../src/engine-client'
import { extensionUiHost } from '../../src/ui-host'

const root = document.getElementById('root')
if (!root) throw new Error('sign: no #root')
const id = new URLSearchParams(location.search).get('id') ?? ''
const engine = connectEngine()
installActivityTouch(engine, window)
createRoot(root).render(<App engine={engine} body="extension-popup" host={extensionUiHost('extension-sign')} initialScreen="sign" initialParams={{ requestId: id }} />)
