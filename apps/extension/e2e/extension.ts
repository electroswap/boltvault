/**
 * Playwright helpers: launch Chromium with the built extension loaded and find
 * its id from the service worker. Requires `pnpm build` first.
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test'

/** Collect page errors and console errors so a failed wait can explain itself. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(`${msg.type()}: ${msg.text()}`)
  })
  return errors
}
import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const EXTENSION_DIR = fileURLToPath(new URL('../.output/chrome-mv3/', import.meta.url))

/**
 * The build the screenshot specs point at.
 *
 * A release build has no `harness.html` — that is the point of
 * `filterEntrypoints` in wxt.config.ts — and CI runs the suite against exactly
 * that artifact. Pointed there, a harness spec used to navigate to a URL that
 * does not exist, sit out its 30 s `waitForFunction` and fail saying only that
 * the page never became ready. So the harness build is a suffixed sibling
 * (`pnpm build:harness`), and a spec that needs it says so.
 *
 * A plain `pnpm build` still writes the harness into `.output/chrome-mv3`, so
 * a developer's build-then-screenshot loop needs no second build; the sibling
 * is preferred when both exist, because it is the one guaranteed to have the
 * page.
 */
export const HARNESS_DIR = fileURLToPath(new URL('../.output/chrome-mv3-harness/', import.meta.url))

/** Whichever built directory actually carries `harness.html` — or a failure that says what to run. */
export function harnessDir(): string {
  for (const dir of [HARNESS_DIR, EXTENSION_DIR]) if (existsSync(join(dir, 'harness.html'))) return dir
  throw new Error(
    [
      'no harness page in either build:',
      `  ${join(HARNESS_DIR, 'harness.html')}`,
      `  ${join(EXTENSION_DIR, 'harness.html')}`,
      'A release build strips it on purpose (wxt.config.ts filterEntrypoints, BOLTVAULT_HARNESS=0).',
      'Run `pnpm build:harness` (or a plain `pnpm --filter @boltvault/extension build`) first.',
    ].join('\n'),
  )
}

export interface LoadedExtension {
  readonly context: BrowserContext
  readonly id: string
  url(path: string): string
}

/** A stand-in for MetaMask (packages/testing/fixtures/fake-metamask) for coexistence tests. */
export const FAKE_METAMASK_DIR = fileURLToPath(new URL('../../../packages/testing/fixtures/fake-metamask/', import.meta.url))

export async function launchWithExtension(opts: { extra?: readonly string[]; dir?: string } = {}): Promise<LoadedExtension> {
  const extensionDir = opts.dir ?? EXTENSION_DIR
  if (!existsSync(join(extensionDir, 'manifest.json'))) throw new Error(`extension not built at ${extensionDir} — run pnpm build`)
  const userDataDir = await mkdtemp(join(tmpdir(), 'bv-e2e-'))
  /*
    Extra extensions load BEFORE ours.

    Chromium injects `document_start` content scripts in load order, and the
    coexistence test only means anything if the other wallet got to
    `window.ethereum` first — that is the case `installProvider` yields in. With
    ours first the fixture's own `if (window.ethereum) return` fired instead,
    and the test asserted our behaviour against a page MetaMask never touched.
  */
  const dirs = [...(opts.extra ?? []), extensionDir].join(',')
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dirs}`, `--load-extension=${dirs}`],
  })
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const id = new URL(worker.url()).host
  return { context, id, url: (path) => `chrome-extension://${id}/${path}` }
}

/**
 * Launch the build that has `harness.html`, failing immediately and by name
 * when no build does — rather than launching one that cannot serve the page
 * and discovering it as a timeout thirty seconds later.
 */
export async function launchWithHarness(opts: { extra?: readonly string[] } = {}): Promise<LoadedExtension> {
  return launchWithExtension({ ...opts, dir: harnessDir() })
}
