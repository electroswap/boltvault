import { App } from '@boltvault/wallet'
import { createRoot } from 'react-dom/client'
import { connectEngine } from '../../src/engine-client'
import { extensionUiHost } from '../../src/ui-host'
import { HostPermissionsGate } from '../../src/permissions'

const root = document.getElementById('root')
if (!root) throw new Error('popup: no #root')
createRoot(root).render(
  <HostPermissionsGate>
    <App engine={connectEngine()} body="extension-popup" host={extensionUiHost('extension-popup')} />
  </HostPermissionsGate>,
)
