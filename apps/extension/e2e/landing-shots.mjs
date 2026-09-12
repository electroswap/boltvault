#!/usr/bin/env node
/**
 * Render wallet screens for the landing page's phone.
 *
 * The landing page frames each shot between a status bar and Android's
 * navigation bar, so the picture is NOT a whole phone screen — it is the app
 * area only. The screen divides 36 + 760 + 48 = 844, so a shot is
 *
 *     390 x 760 logical, rendered at 3x  ->  1170 x 2280
 *
 * Render at that viewport rather than trimming an 844-tall shot: the app then
 * lays out for the height it will actually be seen at, instead of being
 * squeezed and cut. Anything at another aspect gets cropped by `object-fit:
 * cover` on the page — 390 x 844 loses about a ninth, top and bottom.
 *
 * Read-only: it loads the already-built extension and writes only to --out.
 * It never touches e2e/baselines.
 *
 * Run it from the extension package, which is where Playwright resolves:
 *
 *   pnpm build:harness                             # once, if .output is stale
 *   cd apps/extension && node e2e/landing-shots.mjs --out /tmp/shots
 *   cd apps/extension && node e2e/landing-shots.mjs --out /tmp/shots --only home,legends
 *
 * Then convert to WebP and drop them in
 * `apps/docs/static/img/boltvault/screen-<id>.webp`, and register the id in
 * `VAULT.screens` (apps/docs/src/landing/facts.ts).
 */
import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The build with `harness.html` in it. A release build strips the harness
 * (wxt.config.ts `filterEntrypoints`), so `pnpm build:harness` puts one in a
 * suffixed sibling; a plain `pnpm build` still writes it into `.output/chrome-mv3`.
 * Say which is missing outright rather than opening a page that is not there.
 */
const CANDIDATES = ['../.output/chrome-mv3-harness/', '../.output/chrome-mv3/'].map((p) =>
  fileURLToPath(new URL(p, import.meta.url)),
)
const EXTENSION_DIR = CANDIDATES.find((dir) => existsSync(join(dir, 'harness.html')))
if (!EXTENSION_DIR) {
  process.stderr.write(
    `no harness page in either build:\n${CANDIDATES.map((d) => `  ${join(d, 'harness.html')}`).join('\n')}\nRun \`pnpm build:harness\` first.\n`,
  )
  process.exit(2)
}

/** The app area, in the phone's own logical pixels, and the scale to render it at. */
export const SHOT_WIDTH = 390
export const SHOT_HEIGHT = 760
export const SHOT_SCALE = 3

/**
 * id -> the harness screen it comes from.
 *
 * `art` asks the fixture for the collection's real images (off by default, so
 * the committed baselines stay network-free). `prepare` drives the screen
 * before the shutter: an empty Swap screen is a truthful screenshot of nothing
 * happening, so it is given an amount and the quote it produces is the app's
 * own, not a mocked one.
 */
const AMOUNT_IN = '100000'
/** The fixture vault's password (fixtureEngine.ts). */
const FIXTURE_PASSWORD = 'fixture password'
const BRIDGE_AMOUNT_IN = '250'

const SCREENS = {
  home: { screen: 'home', scenario: 'funded', dapp: 'connected' },
  swap: {
    screen: 'swap',
    scenario: 'funded',
    prepare: async (page) => {
      const amount = page.locator('input[inputmode="decimal"]').first()
      await amount.fill(AMOUNT_IN)
      await page.locator('body').click({ position: { x: 5, y: 5 } })
      /*
        Wait for a quote that is BOTH present and fresh.

        A quote is only fresh for QUOTE_STALE_MS, and the screen shows
        "Re-quoting…" over a dead key once it lapses — so waiting on the wrong
        marker does not merely fail, it spends the freshness window and
        guarantees the stale frame. The rate row proves a quote arrived; the
        absence of `swap-stale` proves it has not lapsed yet.
      */
      await waitForFreshQuote(page)
    },
  },
  farm: { screen: 'farm', scenario: 'funded' },
  legends: { screen: 'collection', scenario: 'funded', art: true },
  bridge: {
    screen: 'bridge',
    scenario: 'funded',
    prepare: async (page) => {
      const amount = page.locator('input[inputmode="decimal"]').first()
      await amount.fill(BRIDGE_AMOUNT_IN)
      await page.locator('body').click({ position: { x: 5, y: 5 } })
      // The route has to price before the shutter, or the destination column
      // is a dash and the key is dead.
      await page
        .waitForFunction(
          () =>
            !/To\s*—/.test(document.body.innerText) &&
            /Arrives at|Fees/.test(document.body.innerText),
          undefined,
          { timeout: 15_000 },
        )
        .catch(() => undefined)
    },
  },
  sign: { screen: 'sign', scenario: 'sign' },
}

/**
 * Resolve once a priced, un-lapsed quote is on screen. Keyed off the rate row
 * and the `swap-stale` marker rather than any copy that a redesign can move.
 */
async function waitForFreshQuote(page) {
  await page
    .waitForFunction(
      () => {
        const priced = /1\s+[A-Za-z]+\s*=\s*[\d.]/.test(document.body.innerText)
        return priced && document.querySelector('[data-testid="swap-stale"]') === null
      },
      undefined,
      { timeout: 12_000 },
    )
    .catch(() => undefined)
}

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : process.argv[i + 1]
}

const out = arg('out')
if (!out) {
  process.stderr.write('usage: node tools/landing-shots.mjs --out <dir> [--only id,id]\n')
  process.exit(2)
}
const only = arg('only')
  ?.split(',')
  .map((s) => s.trim())
const wanted = Object.entries(SCREENS).filter(([id]) => !only || only.includes(id))

await mkdir(out, { recursive: true })
const userDataDir = await mkdtemp(join(tmpdir(), 'bv-landing-'))
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  deviceScaleFactor: SHOT_SCALE,
  viewport: { width: SHOT_WIDTH, height: SHOT_HEIGHT },
  args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
})
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const id = new URL(worker.url()).host

let failed = 0
for (const [name, c] of wanted) {
  const page = await context.newPage()
  await page.setViewportSize({ width: SHOT_WIDTH, height: SHOT_HEIGHT })
  const params = `scenario=${c.scenario}&screen=${c.screen}&body=mobile&motion=reduced${c.art ? '&art=on' : ''}${c.dapp ? `&dapp=${c.dapp}` : ''}`
  await page.goto(`chrome-extension://${id}/harness.html?${params}`)
  try {
    await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1', undefined, {
      timeout: 30_000,
    })
  } catch {
    process.stdout.write(`${name}: never became ready\n`)
    failed += 1
    await page.close()
    continue
  }
  // A fresh context opens locked, so any screen may land on Unlock first.
  const password = page.locator('input[data-testid="unlock-password"]')
  if (await password.count()) {
    await password.fill(FIXTURE_PASSWORD)
    await password.press('Enter')
    await page
      .waitForSelector('input[data-testid="unlock-password"]', {
        state: 'detached',
        timeout: 15_000,
      })
      .catch(() => undefined)
    await page.waitForTimeout(600)
  }
  if (c.prepare) await c.prepare(page)
  // Fonts, the Field's one still frame, and any artwork over the network.
  await page.waitForTimeout(c.art ? 2500 : 900)
  if (c.art) {
    await page
      .waitForFunction(() => [...document.images].every((i) => i.complete), undefined, {
        timeout: 15_000,
      })
      .catch(() => undefined)
  }
  await page.screenshot({ path: join(out, `screen-${name}.png`) })
  process.stdout.write(
    `screen-${name}.png  ${SHOT_WIDTH * SHOT_SCALE}x${SHOT_HEIGHT * SHOT_SCALE}\n`,
  )
  await page.close()
}
await context.close()
process.exit(failed > 0 ? 1 : 0)
