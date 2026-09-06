/**
 * Design loop tool: renders the screens named in SHOTS from the fixture
 * harness into SHOT_DIR without touching the baselines, and lists any hit
 * target under 44 px. Skips itself when SHOTS is unset so the normal runs
 * never see it.
 *
 *   SHOTS="home:funded:popup,send:funded:popup:segment=x" SHOT_DIR=/tmp/shots \
 *     pnpm exec playwright test e2e/shot.spec.ts
 *
 * These are deterministic, which is what baselines need, but they are the
 * *fixture* engine: no service worker and no network. Know what that hides.
 * A whole list of reported defects survived several passes because this was
 * the only loop anyone looked at — placeholder avatars (the fixtures set
 * logoUri: null on every token), the popup's real width (this forces a
 * 400x600 viewport against harness.html, which never loads the popup's own
 * sizing rules), and every request the app makes.
 *
 * For what the product actually does, use e2e/probe.spec.ts: the real popup,
 * the real service worker, the real API, with a screenshot per step.
 *
 *   PROBE=1 PROBE_SHOTS=/tmp/live pnpm exec playwright test e2e/probe.spec.ts
 *
 * Since the ElectroSwap logos ship in the bundle and resolve by address, the
 * fixture shots do now show real token marks — the fixtures always used real
 * ETN addresses; nothing could resolve them before.
 */
import { test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { collectErrors, launchWithExtension } from './extension'

const SIZES = {
  popup: { body: 'extension-popup', width: 400, height: 600 },
  tab: { body: 'extension-tab', width: 1100, height: 760 },
  mobile: { body: 'mobile', width: 390, height: 844 },
} as const

const SHOTS = process.env['SHOTS'] ?? ''
const OUT = process.env['SHOT_DIR'] ?? join(process.cwd(), 'screenshots', 'shots')

test.skip(!SHOTS, 'SHOTS is unset')

test('shots', async () => {
  test.setTimeout(240_000)
  const ext = await launchWithExtension()
  await mkdir(OUT, { recursive: true })
  const small: string[] = []
  try {
    for (const spec of SHOTS.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [screen = 'home', scenario = 'funded', size = 'popup', ...rest] = spec.split(':')
      const query = rest.join(':')
      const s = SIZES[(size in SIZES ? size : 'popup') as keyof typeof SIZES]
      const page = await ext.context.newPage()
      const errors = collectErrors(page)
      await page.setViewportSize({ width: s.width, height: s.height })
      const opts = new URLSearchParams(query)
      const full = opts.get('motion') === 'full'
      const harnessQuery = query.split('&').filter((kv) => !/^(click2?|snap|motion)=/.test(kv)).join('&')
      await page.goto(ext.url(`harness.html?scenario=${scenario}&screen=${screen}&body=${s.body}${full ? '' : '&motion=reduced'}${harnessQuery ? `&${harnessQuery}` : ''}`))
      try {
        await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1', undefined, { timeout: 30_000 })
      } catch (err) {
        throw new Error(`${spec} never became ready. Page errors:\n${errors.join('\n')}\n${String(err)}`)
      }
      await page.waitForTimeout(600)
      // `click=<testid>` (and `click2=`) presses a control before the capture, so sheets and menus can be reviewed.
      const params = new URLSearchParams(query)
      for (const key of ['click', 'click2']) {
        const id = params.get(key)
        if (id) {
          await page.getByTestId(id).first().click({ noWaitAfter: true })
          await page.waitForTimeout(Number(opts.get('snap') ?? 500))
        }
      }
      const under = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="button"],[role="tab"],button'))
          .map((el) => {
            const r = el.getBoundingClientRect()
            return { id: el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName, w: r.width, h: r.height }
          })
          .filter((r) => r.w > 0 && r.h > 0 && (r.w < 44 || r.h < 44))
          .map((r) => `${r.id} ${Math.round(r.w)}×${Math.round(r.h)}`),
      )
      for (const u of under) small.push(`${spec}: ${u}`)
      const name = `${screen}--${scenario}--${size}${query ? `--${query.replace(/[^a-z0-9]+/gi, '_')}` : ''}.png`
      await page.screenshot({ path: join(OUT, name), fullPage: false })
      await page.close()
    }
  } finally {
    await ext.context.close()
  }
  if (small.length) console.log(`hit targets under 44 px:\n${small.join('\n')}`)
})
