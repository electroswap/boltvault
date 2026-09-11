/**
 * Two claims, measured before anything is changed.
 *
 * 1. "token logos are still taking a second or so to load" — even though the
 *    fifteen listed marks now ship in the bundle.
 * 2. "Caching does not seem to survive closing the extension pop-up."
 *
 * Both are about the second open, so the popup is opened, closed and opened
 * again, and every frame is sampled: how long until a token row shows a real
 * <img> rather than its TokenMark, and how long until the balance is a number
 * rather than a dash.
 *
 *   COLD=1 pnpm exec playwright test e2e/coldstart.spec.ts
 */
import { test } from '@playwright/test'
import { launchWithHarness } from './extension'
import { createVault, engineCall } from './flows'

test.skip(process.env['COLD'] !== '1', 'COLD is unset')

/** Watch from the first frame: when does a real logo image appear? */
const WATCH = `
  window.__t0 = performance.now()
  window.__marks = { ready: null, firstRow: null, firstImg: null, firstBalance: null }
  const tick = () => {
    const m = window.__marks
    const now = performance.now() - window.__t0
    // The harness flips this once the engine is up and React is rendering, so
    // anything before it is boot, not render.
    if (m.ready === null && document.documentElement.dataset['ready'] === '1') m.ready = Math.round(now)
    // A token row exists at all (portfolio answered).
    if (m.firstRow === null && document.querySelector('[data-testid^="bus-"], [data-testid="home-console"]') !== null) m.firstRow = Math.round(now)
    // A real logo, not the lettered disc: TokenMark draws <svg>, a logo is <img>.
    if (m.firstImg === null && document.querySelector('img[src*="/tokens/"]') !== null) m.firstImg = Math.round(now)
    const el = document.querySelector('[data-testid="total"]')
    if (m.firstBalance === null && el !== null && /\\d/.test(el.textContent ?? '')) m.firstBalance = Math.round(now)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
`

async function openAndMeasure(ext: Awaited<ReturnType<typeof launchWithHarness>>, label: string, url: string): Promise<void> {
  const p = await ext.context.newPage()
  await p.setViewportSize({ width: 400, height: 600 })
  await p.addInitScript(WATCH)
  await p.goto(url)
  await p.waitForTimeout(6_000)
  const marks = await p.evaluate(() => (window as unknown as { __marks: Record<string, number | null> }).__marks)
  const ready = marks['ready']
  const row = marks['firstRow']
  const render = ready !== null && ready !== undefined && row !== null && row !== undefined ? `${row - ready}ms` : 'n/a'
  console.log(`[${label}] engine ready ${marks['ready']}ms | first content ${row}ms (render ${render}) | bundled logo ${marks['firstImg']}ms | balance ${marks['firstBalance']}ms`)
  await p.close()
}

test('cold open, close, reopen', async () => {
  test.setTimeout(240_000)
  const ext = await launchWithHarness()
  try {
    const { tab } = await createVault(ext)
    // The ES Deployer, from the repo's own deploy config — a public address
    // that actually holds the listed tokens, so there is something to paint.
    const watched = (await engineCall(tab, 'accounts', 'addWatch', { address: '0xD6Cf49CbCF84B2cd2472a376B5f791689A0769d0', label: 'ES Deployer' })) as { id: string }
    await engineCall(tab, 'accounts', 'setActive', { id: watched.id })
    await tab.close()
    // Funded fixtures: real ETN addresses, so the bundled marks should resolve.
    await openAndMeasure(ext, 'harness portfolio', ext.url('harness.html?scenario=funded&screen=portfolio&body=extension-popup&motion=reduced'))
    await openAndMeasure(ext, 'first open', ext.url('popup.html'))
    // Closing every extension page releases the keep-alive hold on the worker,
    // which is what "closing the popup" does in the product.
    await new Promise((r) => setTimeout(r, 3_000))
    await openAndMeasure(ext, 'reopen', ext.url('popup.html'))
  } finally {
    await ext.context.close()
  }
})
