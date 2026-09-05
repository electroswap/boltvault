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

export interface LoadedExtension {
  readonly context: BrowserContext
  readonly id: string
  url(path: string): string
}

/** A stand-in for MetaMask (packages/testing/fixtures/fake-metamask) for coexistence tests. */
export const FAKE_METAMASK_DIR = fileURLToPath(new URL('../../../packages/testing/fixtures/fake-metamask/', import.meta.url))

export async function launchWithExtension(opts: { extra?: readonly string[] } = {}): Promise<LoadedExtension> {
  if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) throw new Error(`extension not built at ${EXTENSION_DIR} — run pnpm build`)
  const userDataDir = await mkdtemp(join(tmpdir(), 'bv-e2e-'))
  const dirs = [EXTENSION_DIR, ...(opts.extra ?? [])].join(',')
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
