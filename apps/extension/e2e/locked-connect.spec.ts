/**
 * Connecting while the vault is locked (owner report, 2026-09-09): the sign
 * window "flickers open and then immediately closes", and the site is left
 * spinning on "you may need to unlock it" forever — unlocking does not free it,
 * only reloading the page does.
 *
 * The cause was the sheet's reconnect shortcut, which approved a returning
 * site's request in the moment before the vault status arrived. That spent the
 * one decision a request gets, closed the window, and failed 4100 in the engine
 * because a locked vault lists no accounts. Both tests here are the same shape
 * — the window stays, asks for the password, and answers the ORIGINAL request —
 * for a first-time site and for one that has connected before.
 */
import { serveFixture } from '@boltvault/testing'
import { expect, test, type Page } from '@playwright/test'
import { launchWithExtension, type LoadedExtension } from './extension'
import { createVault, dappRequest, decide, E2E_PASSWORD, engineCall } from './flows'

/** The sign window is open and asking for the password, and stays that way. */
async function expectHoldsAtUnlock(sign: Page): Promise<void> {
  await sign.waitForLoadState()
  await expect(sign.getByTestId('unlock')).toBeVisible({ timeout: 15_000 })
  await sign.waitForTimeout(2_000)
  expect(sign.isClosed()).toBe(false)
  await expect(sign.getByTestId('unlock')).toBeVisible()
}

async function unlock(sign: Page): Promise<void> {
  await sign.getByTestId('unlock-password').fill(E2E_PASSWORD)
  await sign.getByTestId('unlock-submit').click()
}

test('a locked vault holds the approval window open and answers the original request', async () => {
  test.setTimeout(180_000)
  const ext: LoadedExtension = await launchWithExtension()
  const site = await serveFixture()
  try {
    const { address, tab } = await createVault(ext)
    await engineCall(tab, 'vault', 'lock')
    await tab.close()

    const dapp = await ext.context.newPage()
    await dapp.goto(site.url)
    await expect(dapp.getByTestId('parse-time')).not.toHaveText('pending')

    const opened = ext.context.waitForEvent('page', { timeout: 15_000 })
    const result = dappRequest(dapp, 'eth_requestAccounts')
    const sign = await opened
    await expectHoldsAtUnlock(sign)

    // Unlocking lands on the request the window was opened for.
    await unlock(sign)
    await expect(sign.getByTestId('approval')).toBeVisible({ timeout: 30_000 })
    await expect(sign.getByTestId('approval-host')).toHaveText(new URL(site.url).host)
    await expect(sign.getByTestId('approval-primary')).toBeEnabled({ timeout: 10_000 })
    await decide(sign, 'approve')

    // The original request answers — the site never had to ask twice.
    expect(((await result) as { result?: string[] }).result).toEqual([address])
  } finally {
    await ext.context.close()
    await site.close()
  }
})

test('a returning site waits for the unlock instead of spending its request on a locked vault', async () => {
  test.setTimeout(240_000)
  const ext: LoadedExtension = await launchWithExtension()
  const site = await serveFixture()
  try {
    const { address, tab } = await createVault(ext)
    const dapp = await ext.context.newPage()
    await dapp.goto(site.url)
    await expect(dapp.getByTestId('parse-time')).not.toHaveText('pending')

    // Connect once, so the site is permitted and the next request is a reconnect.
    {
      const opened = ext.context.waitForEvent('page', { timeout: 15_000 })
      const result = dappRequest(dapp, 'eth_requestAccounts')
      const sign = await opened
      await sign.waitForLoadState()
      await expect(sign.getByTestId('approval-primary')).toBeEnabled({ timeout: 15_000 })
      await decide(sign, 'approve')
      expect(((await result) as { result?: string[] }).result).toEqual([address])
    }

    await engineCall(tab, 'vault', 'lock')
    await tab.close()
    // A locked vault has no session, so the site is asked to connect again.
    expect((await dappRequest(dapp, 'eth_accounts')).result).toEqual([])

    const opened = ext.context.waitForEvent('page', { timeout: 15_000 })
    const result = dappRequest(dapp, 'eth_requestAccounts')
    const sign = await opened
    // This is the window that used to flicker shut on its own.
    await expectHoldsAtUnlock(sign)

    // The reconnect shortcut runs once the vault is open: no second question.
    const closed = sign.waitForEvent('close', { timeout: 30_000 })
    await unlock(sign)
    await closed
    expect(((await result) as { result?: string[] }).result).toEqual([address])
    expect((await dappRequest(dapp, 'eth_accounts')).result).toEqual([address])
  } finally {
    await ext.context.close()
    await site.close()
  }
})
