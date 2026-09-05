/**
 * Playwright helpers: launch Chromium with the built extension loaded and find
 * its id from the service worker. Requires `pnpm build` first.
 */
import { chromium, type BrowserContext } from '@playwright/test'
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

export async function launchWithExtension(): Promise<LoadedExtension> {
  if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) throw new Error(`extension not built at ${EXTENSION_DIR} — run pnpm build`)
  const userDataDir = await mkdtemp(join(tmpdir(), 'bv-e2e-'))
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  })
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const id = new URL(worker.url()).host
  return { context, id, url: (path) => `chrome-extension://${id}/${path}` }
}
