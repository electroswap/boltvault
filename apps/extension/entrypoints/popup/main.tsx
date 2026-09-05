import { App } from '@boltvault/wallet'
import { createRoot } from 'react-dom/client'
import { connectEngine } from '../../src/engine-client'

const root = document.getElementById('root')
if (!root) throw new Error('popup: no #root')
createRoot(root).render(<App engine={connectEngine()} body="extension-popup" />)
