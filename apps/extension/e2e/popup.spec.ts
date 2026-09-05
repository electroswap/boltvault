import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { launchWithExtension } from './extension'

test('popup renders the shared Hello screen through the service-worker engine', async () => {
  const ext = await launchWithExtension()
  try {
    const page = await ext.context.newPage()
    const cspViolations: string[] = []
    page.on('console', (msg) => {
      if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text())
    })
    await page.setViewportSize({ width: 360, height: 600 })
    await page.goto(ext.url('popup.html'))

    await expect(page.getByTestId('hello')).toBeVisible()
    await expect(page.getByTestId('vault-status')).toContainText('Not created yet', { timeout: 15_000 })
    // The head readout may be a real block (network) or the em dash (offline) — both prove the path.
    await expect(page.getByTestId('head-block')).toBeVisible()
    await expect(page.getByText('Electroneum', { exact: true })).toBeVisible()
    expect(cspViolations).toEqual([])

    await mkdir('screenshots', { recursive: true })
    await page.screenshot({ path: 'screenshots/m0-popup.png' })
  } finally {
    await ext.context.close()
  }
})
