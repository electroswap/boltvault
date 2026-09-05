import { createRoot } from 'react-dom/client'
import { cssVars } from '@boltvault/design'
import { FullTab } from '../../src/FullTab'
import '../../src/tokens.css'

// Design tokens (the source of truth) injected once — same face contract as the
// popup. Full-tab is the "full sky + coil + shelf" chamber (design §tab).
const bvStyle = document.createElement('style')
bvStyle.textContent = cssVars()
document.head.appendChild(bvStyle)

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(<FullTab />)
}
