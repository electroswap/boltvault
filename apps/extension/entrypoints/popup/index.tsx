import { createRoot } from 'react-dom/client'
import App from '../../src/App'
import '../../src/tokens.css'

// Popup entrypoint (entrypoints/popup/). WXT pairs index.html with this file
// and emits popup.html (wired as the default action). An HTML page runs its
// script as a normal ES module, so this is a TOP-LEVEL SIDE EFFECT — do NOT
// default-export a boot fn (it would be tree-shaken and never run). The popup
// IS the v1 product (design §Layout).
//
// Guard the null so WXT can evaluate this headless at build time (where #root
// does not exist); in the real popup #root is present.
const el = document.getElementById('root')
if (el) {
  createRoot(el).render(<App />)
}
