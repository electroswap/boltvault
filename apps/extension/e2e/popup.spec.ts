import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { collectErrors, launchWithExtension } from './extension'

test('popup renders the shared Home screen through the service-worker engine', async () => {
  const ext = await launchWithExtension()
  try {
    const page = await ext.context.newPage()
    const errors = collectErrors(page)
    await page.setViewportSize({ width: 400, height: 600 })
    await page.goto(ext.url('popup.html'))

    try {
      await expect(page.getByTestId('home')).toBeVisible({ timeout: 15_000 })
    } catch (err) {
      throw new Error(`home did not render. Page errors:\n${errors.join('\n')}\n${String(err)}`)
    }
    // A fresh install: no vault yet → the creation plate, never a fake balance.
    await expect(page.getByTestId('create-plate')).toContainText('Your vault is not created yet', { timeout: 15_000 })
    await expect(page.getByTestId('tabs')).toBeVisible()
    expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([])
    expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([])

    await mkdir('screenshots', { recursive: true })
    await page.screenshot({ path: 'screenshots/popup-fresh.png' })
  } finally {
    await ext.context.close()
  }
})
