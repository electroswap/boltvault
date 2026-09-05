/**
 * M2 definition of done (master plan §11): create → lock → reopen → unlock,
 * through the real service-worker engine, with the words shown only in
 * tab.html and the popup handing off to it.
 */
import { expect, test, type Page } from '@playwright/test'
import { collectErrors, launchWithExtension } from './extension'

const PASSWORD = 'correct horse battery staple 42'

async function readWords(page: Page): Promise<string[]> {
  const words: string[] = []
  for (let i = 1; i <= 12; i++) words.push((await page.getByTestId(`word-${i}`).textContent())?.trim() ?? '')
  return words
}

test('create in the tab, lock and unlock from the popup, session survives a reopen', async () => {
  test.setTimeout(180_000)
  const ext = await launchWithExtension()
  try {
    // The popup on a fresh install offers creation and hands secrets to tab.html.
    const popup = await ext.context.newPage()
    const popupErrors = collectErrors(popup)
    await popup.setViewportSize({ width: 360, height: 600 })
    await popup.goto(ext.url('popup.html'))
    await popup.getByTestId('create-vault').click()
    await expect(popup.getByTestId('onboarding')).toBeVisible()
    await expect(popup.getByTestId('word-grid')).toHaveCount(0)
    const tabPromise = ext.context.waitForEvent('page')
    await popup.getByTestId('ob-create').click()
    const tab = await tabPromise
    const tabErrors = collectErrors(tab)
    await tab.waitForLoadState()
    expect(new URL(tab.url()).pathname).toBe('/tab.html')

    // Password → words → quiz.
    await expect(tab.getByTestId('onboarding')).toBeVisible({ timeout: 15_000 })
    await tab.getByTestId('ob-create').click()
    await tab.getByTestId('ob-password').fill(PASSWORD)
    await tab.getByTestId('ob-confirm').fill(PASSWORD)
    await tab.getByTestId('ob-password-continue').click()
    await expect(tab.getByTestId('ob-words')).toBeVisible({ timeout: 30_000 }) // argon2id in the worker
    const words = await readWords(tab)
    expect(words.every((w) => /^[a-z]+$/.test(w))).toBe(true)
    await tab.getByTestId('ob-words-done').click()
    await expect(tab.getByTestId('ob-quiz')).toBeVisible()
    for (const input of await tab.locator('[data-testid^="quiz-"]').all()) {
      const id = await input.getAttribute('data-testid')
      const position = Number(id?.replace('quiz-', ''))
      await input.fill(words[position - 1] ?? '')
    }
    await tab.getByTestId('ob-quiz-confirm').click()
    // Headless Chromium has no platform authenticator; the passkey offer is skipped or skippable.
    const skip = tab.getByTestId('ob-passkey-skip')
    if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) await skip.click()
    await expect(tab.getByTestId('ob-done')).toBeVisible()
    await tab.getByTestId('ob-open').click()
    await expect(tab.getByTestId('home')).toBeVisible()
    await expect(tab.getByTestId('backup-gate')).toHaveCount(0)

    // The popup (a fresh page, as after closing it) sees the unlocked vault.
    const popup2 = await ext.context.newPage()
    await popup2.setViewportSize({ width: 360, height: 600 })
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
    await popup3.setViewportSize({ width: 360, height: 600 })
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
