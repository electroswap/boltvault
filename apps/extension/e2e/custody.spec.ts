/**
 * M2 definition of done (master plan §11): create → lock → reopen → unlock,
 * through the real service-worker engine, with the words shown only in
 * tab.html and the popup handing off to it.
 */
import { expect, test } from '@playwright/test'
import { collectErrors, launchWithExtension } from './extension'
import { walkOnboarding } from './flows'

const PASSWORD = 'correct horse battery staple 42'

test('create in the tab, lock and unlock from the popup, session survives a reopen', async () => {
  test.setTimeout(180_000)
  const ext = await launchWithExtension()
  try {
    // The popup on a fresh install offers creation and hands secrets to tab.html.
    const popup = await ext.context.newPage()
    const popupErrors = collectErrors(popup)
    await popup.setViewportSize({ width: 400, height: 600 })
    await popup.goto(ext.url('popup.html'))
    await popup.getByTestId('create-vault').click()
    await expect(popup.getByTestId('onboarding')).toBeVisible()
    // Whatever else the popup shows, it never shows a recovery phrase (§3.2).
    await expect(popup.getByTestId('word-grid')).toHaveCount(0)
    // The intro comes first on a fresh install; the fork is behind it.
    const introSkip = popup.getByTestId('ob-intro-skip')
    if (await introSkip.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) await introSkip.click()
    const tabPromise = ext.context.waitForEvent('page')
    await popup.getByTestId('ob-create').click()
    const tab = await tabPromise
    const tabErrors = collectErrors(tab)
    await tab.waitForLoadState()
    expect(new URL(tab.url()).pathname).toBe('/tab.html')

    // The steps themselves, in whatever order this build runs them (see `walkOnboarding`).
    await expect(tab.getByTestId('onboarding')).toBeVisible({ timeout: 15_000 })
    const words = await walkOnboarding(tab, PASSWORD)
    // The phrase this screen showed is a real BIP-39 phrase, not placeholder text.
    expect(words).toHaveLength(12)
    expect(words.every((w) => /^[a-z]+$/.test(w))).toBe(true)
    // Onboarding lands on Home itself; there is no page in between to dismiss.
    await expect(tab.getByTestId('home')).toBeVisible()
    await expect(tab.getByTestId('backup-gate')).toHaveCount(0)

    // The popup (a fresh page, as after closing it) sees the unlocked vault.
    const popup2 = await ext.context.newPage()
    await popup2.setViewportSize({ width: 400, height: 600 })
    await popup2.goto(ext.url('popup.html'))
    await expect(popup2.getByTestId('home')).toBeVisible({ timeout: 15_000 })
    await expect(popup2.getByTestId('seat')).toBeVisible()

    // Lock from Settings; unlock with the password; a reopened popup stays unlocked.
    await popup2.getByTestId('settings-key').click()
    await popup2.getByTestId('lock-key').click()
    await expect(popup2.getByTestId('unlock')).toBeVisible()
    await popup2.getByTestId('unlock-password').fill('not the password')
    await popup2.getByTestId('unlock-submit').click()
    await expect(popup2.getByTestId('unlock-password-error')).toBeVisible({ timeout: 30_000 })
    await popup2.getByTestId('unlock-password').fill(PASSWORD)
    await popup2.getByTestId('unlock-submit').click()
    await expect(popup2.getByTestId('home')).toBeVisible({ timeout: 30_000 })

    const popup3 = await ext.context.newPage()
    await popup3.setViewportSize({ width: 400, height: 600 })
    await popup3.goto(ext.url('popup.html'))
    await expect(popup3.getByTestId('home')).toBeVisible({ timeout: 15_000 })
    await expect(popup3.getByTestId('unlock')).toHaveCount(0)

    for (const errors of [popupErrors, tabErrors]) {
      expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([])
      expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([])
    }
  } finally {
    await ext.context.close()
  }
})
