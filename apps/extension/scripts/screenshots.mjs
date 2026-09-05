// BoltVault popup screenshots (A7) — re-render the BUILT popup with realistic
// SW data, one frame per tab. Run: node scripts/screenshots.mjs
//
// The popup talks to the SW only through `browser.runtime.sendMessage`. We
// stub that global with canned, JSON-safe responses (the E0a/E0b contract) so
// the chamber fills with a believable portfolio instead of the empty state.
//
// Output: ../screenshots/*.png  (720x1200 = 360x600 popup @2x)
import { chromium } from 'playwright'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const OUT_DIR = new URL('../../../screenshots/', import.meta.url).pathname
const BUILT = new URL('../.output/chrome-mv3/', import.meta.url).pathname

// ---- canned data (JSON-safe SwResponse payloads) -------------------------
const MAIN = '0x1F909f1C46a3bA06d344c51d28fE8E19D5037B63'
const ETN_ADDR = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'
const BOLT_ADDR = '0xB01111000000000000000000000000000000b011'
const USDC_ADDR = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e'
const BLOCK = 4213887

const row = (address, symbol, name, quantity, priceUsd, share) => ({
  address, symbol, name, decimals: 18,
  rawBalance: quantity, quantity, priceUsd, usd: Number(quantity) * priceUsd,
  share, hidden: false, priced: true, change24h: 1.4,
})

const PORTFOLIO = {
  ok: true,
  chainId: 52014,
  account: MAIN,
  native: row(ETN_ADDR, 'ETN', 'Electroneum', '182440.55', 0.0424, 0.62),
  rows: [
    row(BOLT_ADDR, 'BOLT', 'BOLT', '3120.00', 1.12, 0.28),
    row(USDC_ADDR, 'USDC', 'USD Coin', '1248.00', 1.0, 0.1),
  ],
  pricedTotalUsd: 12478.0,
  at: 0,
}

// Stub the SW transport. NOTE: addInitScript(fn, arg) structured-clones `arg`,
// so the handler must live INSIDE fn (a separate fn arg is not cloneable);
// only the plain PORTFOLIO / MAIN / BLOCK data is passed in.
async function installStub(page) {
  await page.addInitScript(({ portfolio, main, block }) => {
    const handler = (msg) => {
      const t = msg && msg.type
      if (t === 'bv:vault:state') return { hasVault: true, unlocked: true }
      if (t === 'bv:accounts') return { accounts: [main] }
      if (t === 'bv:block:head') return { ok: true, block, chainId: msg.chainId ?? 52014, at: Date.now() }
      if (t === 'bv:portfolio') return { ...portfolio, at: Date.now() }
      if (t === 'bv:price') return { ok: true, usd: null, at: Date.now() }
      if (t === 'bv:ping') return { ok: true, pong: true, ts: Date.now() }
      return {}
    }
    window.browser = {
      runtime: {
        sendMessage: (msg) => Promise.resolve(handler(msg)),
      },
    }
  }, { portfolio: PORTFOLIO, main: MAIN, block: BLOCK })
}

// ---- tiny static server so ES modules load over http (file:// blocks them) --
async function serve(root) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let p = path.join(root, decodeURIComponent(url.pathname))
    try {
      const body = await readFile(p)
      const ext = path.extname(p).toLowerCase()
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext] ?? 'application/octet-stream'
      res.writeHead(200, { 'content-type': mime })
      res.end(body)
    } catch {
      res.writeHead(404); res.end('not found')
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { server, port: server.address().port }
}

const SHOTS = [
  ['01-home', 'home'],
  ['02-swap', 'swap'],
  ['03-send', 'send'],
  ['04-receive', 'receive'],
  ['05-bridge', 'bridge'],
  ['06-token', 'token'],
  ['07-farm', 'farm'],
  ['08-launchpad', 'launchpad'],
  ['09-nft', 'nft'],
  ['10-activity', 'activity'],
  ['11-approvals', 'approvals'],
  ['12-settings', 'settings'],
]

async function launch() {
  try {
    return await chromium.launch()
  } catch {
    // fall back to a cached chromium binary
    const base = path.join(os.homedir(), '.cache', 'ms-playwright')
    const { readdir } = await import('node:fs/promises')
    const dirs = (await readdir(base)).filter((d) => d.startsWith('chromium-')).sort().reverse()
    for (const d of dirs) {
      const exe = path.join(base, d, 'chrome-linux64', 'chrome')
      try { return await chromium.launch({ executablePath: exe }) } catch { /* next */ }
    }
    throw new Error('no chromium available')
  }
}

const browser = await launch()
const { server, port } = await serve(BUILT)
const page = await browser.newPage({ viewport: { width: 360, height: 600 }, deviceScaleFactor: 2 })
await installStub(page)

const url = `http://127.0.0.1:${port}/popup.html`
await page.goto(url, { waitUntil: 'networkidle' })
// Full-height chamber (the popup normally sits in a fixed 360x600 frame).
await page.addStyleTag({ content: 'html,body,#root{height:100%;margin:0;background:#05060c}' })
// Let the first portfolio read land.
await page.waitForFunction(() => {
  const t = document.querySelector('[data-testid="total"]')
  return t && t.textContent && !t.textContent.trim().includes('—')
}, { timeout: 10000 })

for (const [file, tab] of SHOTS) {
  await page.click(`[data-testid="tab-${tab}"]`)
  await page.waitForTimeout(350) // let the view settle (fonts, no spinner)
  const out = path.join(OUT_DIR, `${file}.png`)
  await page.screenshot({ path: out, fullPage: false })
  console.log(`  ✓ ${file}.png  (tab:${tab})`)
}

await browser.close()
server.close()
console.log(`\ndone — ${SHOTS.length} screenshots in ${OUT_DIR}`)
