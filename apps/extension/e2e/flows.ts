/** Shared Playwright flows: create a vault through tab.html, call the engine over the UI Port. */
import { expect, type Page } from '@playwright/test'
import type { LoadedExtension } from './extension'

/** The extension-page global used inside `page.evaluate` (typed here; provided by Chrome at runtime). */
declare const chrome: {
  runtime: {
    connect(opts: { name: string }): {
      onMessage: { addListener(cb: (m: { kind?: string; id?: string; ok?: boolean; result?: unknown; error?: unknown }) => void): void }
      postMessage(m: unknown): void
      disconnect(): void
    }
  }
}

export const E2E_PASSWORD = 'correct horse battery staple 42'

/**
 * Visible within `ms`, without throwing when it never appears.
 *
 * NOT `locator.isVisible()`, which does not retry: on a slow first paint it
 * answers `false` for something that is about to exist, and the caller then
 * clicks a control that has not rendered.
 */
async function appears(locator: ReturnType<Page['getByTestId']>, ms = 1_000): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: 'visible', timeout: ms })
    .then(() => true)
    .catch(() => false)
}

/**
 * Create a vault through tab.html, whatever order the steps come in.
 *
 * This used to be a fixed script — create, password, words, quiz, done — which
 * made it a second definition of the flow's order, in a file nine other specs
 * depend on. It now answers whichever step is on screen, so the onboarding
 * sequence can gain an intro and swap password with the backup check without a
 * flag day across the suite.
 *
 * Bounded rather than `while (true)`: a flow that stops progressing should fail
 * as a timeout naming the step it got stuck on, not spin.
 */
/**
 * Walk onboarding on an already-open tab, whatever order the steps come in, and
 * return the recovery phrase it showed.
 *
 * The order used to be written out twice — here and in `custody.spec.ts` — which
 * made two specs a second and third definition of the flow. It is defined once,
 * here, and answers whichever step is on screen, so onboarding can gain an intro
 * and swap password with the backup check without a flag day across the suite.
 *
 * Bounded rather than `while (true)`: a flow that stops progressing should fail
 * as a timeout naming the step it stalled on, not spin.
 */
export async function walkOnboarding(tab: Page, password = E2E_PASSWORD): Promise<string[]> {
  // The intro carousel, when this build has one.
  const intro = tab.getByTestId('ob-intro-skip')
  if (await appears(intro, 2_000)) await intro.click()

  await tab.getByTestId('ob-create').click()

  const words: string[] = []
  let seen = ''
  for (let i = 0; i < 16; i++) {
    // Onboarding ends ON Home now — the "this is Electroneum" page it used to
    // finish with, and the key that dismissed it, are gone.
    if (await appears(tab.getByTestId('home'), 500)) break

    if (await appears(tab.getByTestId('ob-words'), 500)) {
      // Argon2id runs on the way in under the password-first order; be patient.
      await expect(tab.getByTestId('word-12')).toBeVisible({ timeout: 30_000 })
      words.length = 0
      for (let w = 1; w <= 12; w++) words.push((await tab.getByTestId(`word-${w}`).textContent())?.trim() ?? '')
      seen = 'words'
      await tab.getByTestId('ob-words-done').click()
      continue
    }

    if (await appears(tab.getByTestId('ob-quiz'), 500)) {
      for (const input of await tab.locator('[data-testid^="quiz-"]').all()) {
        const position = Number((await input.getAttribute('data-testid'))?.replace('quiz-', ''))
        await input.fill(words[position - 1] ?? '')
      }
      seen = 'quiz'
      await tab.getByTestId('ob-quiz-confirm').click()
      continue
    }

    if (await appears(tab.getByTestId('ob-password'), 500)) {
      await tab.getByTestId('ob-password').fill(password)
      await tab.getByTestId('ob-confirm').fill(password)
      seen = 'password'
      await tab.getByTestId('ob-password-continue').click()
      /*
        Argon2id runs here under either order, so this is the long wait — but
        wait for whatever comes NEXT, not for the end. Password-first lands on
        `words`, and watching only for the end there burned the full timeout on
        every run before continuing anyway.
      */
      await tab
        .getByTestId('ob-words')
        .or(tab.getByTestId('ob-quiz'))
        .or(tab.getByTestId('ob-passkey'))
        .or(tab.getByTestId('home'))
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => undefined)
      continue
    }

    if (await appears(tab.getByTestId('ob-passkey-skip'), 500)) {
      seen = 'passkey'
      await tab.getByTestId('ob-passkey-skip').click()
      continue
    }
  }

  await expect(tab.getByTestId('home'), `onboarding stalled after "${seen || 'welcome'}"`).toBeVisible({ timeout: 30_000 })
  return words
}

export async function createVault(ext: LoadedExtension): Promise<{ address: string; tab: Page }> {
  const tab = await ext.context.newPage()
  await tab.goto(ext.url('tab.html?screen=onboarding'))
  await expect(tab.getByTestId('onboarding')).toBeVisible({ timeout: 15_000 })
  await walkOnboarding(tab)
  await expect(tab.getByTestId('home')).toBeVisible()
  const accounts = (await engineCall(tab, 'accounts', 'list')) as Array<{ address: string }>
  const address = accounts[0]?.address
  if (!address) throw new Error('no account after onboarding')
  return { address, tab }
}

/** Call the engine the way the UI does: one request over a `bv-ui` Port from an extension page. */
export function engineCall(page: Page, ns: string, method: string, arg?: unknown): Promise<unknown> {
  return page.evaluate(
    ([ns, method, arg]) =>
      new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'bv-ui' })
        const id = `e2e-${Math.random().toString(16).slice(2)}`
        port.onMessage.addListener((m: { kind?: string; id?: string; ok?: boolean; result?: unknown; error?: unknown }) => {
          if (!m || m.kind !== 'response' || m.id !== id) return
          port.disconnect()
          if (m.ok) resolve(m.result)
          else reject(new Error(JSON.stringify(m.error)))
        })
        port.postMessage({ v: 1, kind: 'request', id, ns, method, ...(arg === undefined ? {} : { arg }) })
      }),
    [ns, method, arg] as const,
  )
}

/** The dApp's `window.ethereum.request`, run in the page. */
export function dappRequest(page: Page, method: string, params?: unknown): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }> {
  return page.evaluate(
    async ([method, params]) => {
      const eth = (window as unknown as { ethereum: { request: (a: { method: string; params?: unknown }) => Promise<unknown> } }).ethereum
      try {
        return { result: await eth.request({ method, ...(params === undefined ? {} : { params }) }) }
      } catch (err) {
        const e = err as { code?: number; message?: string; data?: unknown }
        return { error: { code: e.code ?? -1, message: e.message ?? String(err), data: e.data } }
      }
    },
    [method, params] as const,
  )
}

/** The EIP-6963 provider with our rdns, run in the page (coexistence tests). */
export function boltRequest(page: Page, method: string, params?: unknown): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }> {
  return page.evaluate(
    async ([method, params]) => {
      const found: Array<{ info: { rdns: string }; provider: { request: (a: { method: string; params?: unknown }) => Promise<unknown> } }> = []
      window.addEventListener('eip6963:announceProvider', (ev) => found.push((ev as CustomEvent).detail))
      window.dispatchEvent(new Event('eip6963:requestProvider'))
      const ours = found.find((p) => p.info.rdns === 'io.electroswap.boltvault')
      if (!ours) return { error: { code: -1, message: 'BoltVault not announced' } }
      try {
        return { result: await ours.provider.request({ method, ...(params === undefined ? {} : { params }) }) }
      } catch (err) {
        const e = err as { code?: number; message?: string; data?: unknown }
        return { error: { code: e.code ?? -1, message: e.message ?? String(err), data: e.data } }
      }
    },
    [method, params] as const,
  )
}

/** Wait for the sign window the engine opens for the next approval. */
export async function nextSignWindow(ext: LoadedExtension, trigger: () => Promise<unknown>): Promise<{ page: Page; result: Promise<unknown> }> {
  const pagePromise = ext.context.waitForEvent('page', { timeout: 15_000 })
  const result = trigger()
  const page = await pagePromise
  await page.waitForLoadState()
  await expect(page.getByTestId('approval')).toBeVisible({ timeout: 15_000 })
  return { page, result }
}

/**
 * Presses an approval key in a sign window. The window closes itself the moment the decision
 * lands (Approval's finish() plus the background's windows.remove) — with Chromium 1243 that can
 * beat the input ack, so Playwright's click may report the target as closed mid-action. The
 * close event is the proof the press landed; any other click error is still a failure.
 */
export async function decide(page: Page, key: 'approve' | 'reject'): Promise<void> {
  const closed = page.waitForEvent('close', { timeout: 15_000 })
  await page
    .getByTestId(key === 'approve' ? 'approval-primary' : 'approval-reject')
    .click()
    .catch((err: unknown) => {
      if (!/has been closed/.test(err instanceof Error ? err.message : String(err))) throw err
    })
  await closed
}
