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

export async function createVault(ext: LoadedExtension): Promise<{ address: string; tab: Page }> {
  const tab = await ext.context.newPage()
  await tab.goto(ext.url('tab.html?screen=onboarding'))
  await expect(tab.getByTestId('onboarding')).toBeVisible({ timeout: 15_000 })
  await tab.getByTestId('ob-create').click()
  await tab.getByTestId('ob-password').fill(E2E_PASSWORD)
  await tab.getByTestId('ob-confirm').fill(E2E_PASSWORD)
  await tab.getByTestId('ob-password-continue').click()
  await expect(tab.getByTestId('ob-words')).toBeVisible({ timeout: 30_000 })
  const words: string[] = []
  for (let i = 1; i <= 12; i++) words.push((await tab.getByTestId(`word-${i}`).textContent())?.trim() ?? '')
  await tab.getByTestId('ob-words-done').click()
  await expect(tab.getByTestId('ob-quiz')).toBeVisible()
  for (const input of await tab.locator('[data-testid^="quiz-"]').all()) {
    const position = Number((await input.getAttribute('data-testid'))?.replace('quiz-', ''))
    await input.fill(words[position - 1] ?? '')
  }
  await tab.getByTestId('ob-quiz-confirm').click()
  const skip = tab.getByTestId('ob-passkey-skip')
  if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) await skip.click()
  await expect(tab.getByTestId('ob-done')).toBeVisible()
  await tab.getByTestId('ob-open').click()
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
