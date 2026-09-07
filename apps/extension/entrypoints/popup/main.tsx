import { App } from '@boltvault/wallet'
import '../../src/chrome.css'
import { createRoot } from 'react-dom/client'
import { installActivityTouch } from '../../src/activity-touch'
import { connectEngine } from '../../src/engine-client'
import { installImageCache } from '../../src/image-cache'
import { extensionUiHost } from '../../src/ui-host'
import { HostPermissionsGate } from '../../src/permissions'

installImageCache()
const root = document.getElementById('root')
if (!root) throw new Error('popup: no #root')
const engine = connectEngine()
installActivityTouch(engine, window)
createRoot(root).render(
  <HostPermissionsGate>
    <App engine={engine} body="extension-popup" host={extensionUiHost('extension-popup')} />
  </HostPermissionsGate>,
)
