#!/usr/bin/env node
/**
 * Render wallet screens for somebody else's picture of the wallet.
 *
 * Two consumers, one set of screens, and that is the point. The landing page's
 * phone needs the app area at phone size; the Chrome Web Store tiles need the
 * popup and the full tab. Rendering them from one table means the swap on the
 * store tile and the swap on the marketing site are the same swap, prepared the
 * same way — and a screen that has to be driven before it is worth
 * photographing is driven once, here, rather than twice, differently.
 *
 * `--body phone` (the default) is the landing page's. That page frames each
 * shot between a status bar and Android's navigation bar, so the picture is NOT
 * a whole phone screen — it is the app area only. The screen divides
 * 36 + 760 + 48 = 844, so a shot is
 *
 *     390 x 760 logical, rendered at 3x  ->  1170 x 2280
 *
 * Render at that viewport rather than trimming an 844-tall shot: the app then
 * lays out for the height it will actually be seen at, instead of being
 * squeezed and cut. Anything at another aspect gets cropped by `object-fit:
 * cover` on the page — 390 x 844 loses about a ninth, top and bottom.
 *
 * `--body popup` and `--body tab` are the extension's own two shapes, at 2x.
 *
 * Read-only: it loads the already-built extension and writes only to --out.
 * It never touches e2e/baselines.
 *
 * Run it from the extension package, which is where Playwright resolves:
 *
 *   pnpm build:harness                             # once, if .output is stale
 *   cd apps/extension && node e2e/landing-shots.mjs --out /tmp/shots
 *   cd apps/extension && node e2e/landing-shots.mjs --out /tmp/shots --only home,legends
 *   cd apps/extension && node e2e/landing-shots.mjs --out /tmp/store --body popup
 *
 * The landing page: convert to WebP and drop them in
 * `apps/docs/static/img/boltvault/screen-<id>.webp`, and register the id in
 * `VAULT.screens` (apps/docs/src/landing/facts.ts).
 *
 * The store tiles: copy the PNGs into
 * `apps/docs/static/img/boltvault/store/` and re-run `yarn store:shots` there
 * (apps/docs/tools/gen-store-shots.mjs). Both live in the docs repository
 * because that is where the brand furniture is.
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

/**
 * The three shapes, and what the harness must be told to lay out for.
 *
 * `phone` is the app area only (see above). `popup` is the panel that drops
 * from the toolbar, and `tab` the full-page view — the two sizes the extension
 * actually renders at, so a store tile shows the product at its own dimensions
 * rather than a phone screen stretched sideways.
 */
const BODIES = {
  phone: { width: 390, height: 760, scale: 3, body: 'mobile' },
  popup: { width: 400, height: 600, scale: 2, body: 'extension-popup' },
  tab: { width: 1100, height: 760, scale: 2, body: 'extension-tab' },
}

/** The app area, in the phone's own logical pixels, and the scale to render it at. */
export const SHOT_WIDTH = BODIES.phone.width
export const SHOT_HEIGHT = BODIES.phone.height
export const SHOT_SCALE = BODIES.phone.scale

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
  /*
    Store-tile screens. `devices` is the custody argument made in pictures —
    Ledger, Trezor and Keystone in a list beats a paragraph saying the wallet
    supports them — and `explore` is the breadth of markets in one frame.
  */
  devices: { screen: 'devices', scenario: 'funded' },
  explore: { screen: 'explore', scenario: 'funded' },
  accounts: { screen: 'accounts', scenario: 'funded' },
  backup: { screen: 'backup', scenario: 'funded' },
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
  process.stderr.write('usage: node e2e/landing-shots.mjs --out <dir> [--only id,id] [--body phone|popup|tab]\n')
  process.exit(2)
}
const bodyName = arg('body') ?? 'phone'
const shape = BODIES[bodyName]
if (!shape) {
  process.stderr.write(`unknown --body ${bodyName} (want ${Object.keys(BODIES).join(', ')})\n`)
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
  deviceScaleFactor: shape.scale,
  viewport: { width: shape.width, height: shape.height },
  args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
})
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const id = new URL(worker.url()).host

let failed = 0
for (const [name, c] of wanted) {
  const page = await context.newPage()
  await page.setViewportSize({ width: shape.width, height: shape.height })
  const params = `scenario=${c.scenario}&screen=${c.screen}&body=${shape.body}&motion=reduced${c.art ? '&art=on' : ''}${c.dapp ? `&dapp=${c.dapp}` : ''}`
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
  /*
    The landing page's files keep the name its markup already asks for; the
    other bodies say which shape they are, because a directory holding both
    would otherwise have two different pictures called the same thing.
  */
  const file = bodyName === 'phone' ? `screen-${name}.png` : `${name}--${bodyName}.png`
  await page.screenshot({ path: join(out, file) })
  process.stdout.write(`${file}  ${shape.width * shape.scale}x${shape.height * shape.scale}\n`)
  await page.close()
}
await context.close()
process.exit(failed > 0 ? 1 : 0)
