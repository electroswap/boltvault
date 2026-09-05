import { createRoot } from 'react-dom/client'
import { cssVars } from '@boltvault/design'
import { NotificationView } from '../../src/Notification'
import '../../src/tokens.css'

const bvStyle = document.createElement('style')
bvStyle.textContent = cssVars()
document.head.appendChild(bvStyle)

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(<NotificationView />)
}
