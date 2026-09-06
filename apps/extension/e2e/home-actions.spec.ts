/**
 * Home's action grid must read the same everywhere and never truncate.
 *
 * Reported: the popup shows "Recei… / Colle… / Launc…", and "The page renders
 * the main actions on the home page differently in a small responsive view
 * than it does in the pop-up extension view."
 *
 * The second one has a root cause worth stating: the app has no media queries
 * or breakpoints at all. Layout is chosen from the `body` prop
 * ('extension-popup' vs 'extension-tab'), so narrowing a browser window on
 * tab.html changes nothing — the row layout, the 24 px insets and the wide
 * column all stay, at any width.
 */
import { expect, test } from '@playwright/test'
import { launchWithExtension } from './extension'
import { createVault } from './flows'

interface LabelBox {
  label: string
  clientWidth: number
  scrollWidth: number
  truncated: boolean
}

async function labels(url: string, width: number, height: number, ext: Awaited<ReturnType<typeof launchWithExtension>>): Promise<LabelBox[]> {
  const p = await ext.context.newPage()
  await p.setViewportSize({ width, height })
  await p.goto(url)
  await p.getByTestId('keys').waitFor({ timeout: 20_000 })
  await p.waitForTimeout(800)
  const out = await p.evaluate(() => {
    const grid = document.querySelector('[data-testid="keys"]')
    if (grid === null) return []
    const seen: Array<{ label: string; clientWidth: number; scrollWidth: number; truncated: boolean }> = []
    for (const cell of grid.querySelectorAll('[data-testid^="key-"]')) {
      // The deepest element that holds only text is the label.
      for (const el of cell.querySelectorAll('*')) {
        if (el.children.length > 0) continue
        const text = (el.textContent ?? '').trim()
        if (text === '') continue
        seen.push({ label: text, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, truncated: el.scrollWidth > el.clientWidth + 1 })
      }
    }
    return seen
  })
  await p.close()
  return out
}

test('no action label is truncated in the popup', async () => {
  test.setTimeout(120_000)
  const ext = await launchWithExtension()
  try {
    const { tab } = await createVault(ext)
    await tab.close()
    const found = await labels(ext.url('popup.html'), 400, 600, ext)
    console.log('popup labels:', found.map((l) => `${l.label}${l.truncated ? ` (CLIPPED ${l.scrollWidth}>${l.clientWidth})` : ''}`).join(', '))
    expect(found.length).toBeGreaterThan(0)
    expect(found.filter((l) => l.truncated).map((l) => l.label)).toEqual([])
  } finally {
    await ext.context.close()
  }
})

test('a narrow window uses the popup layout, not the wide one', async () => {
  test.setTimeout(120_000)
  const ext = await launchWithExtension()
  try {
    const { tab } = await createVault(ext)
    await tab.close()
    const narrow = await labels(ext.url('tab.html'), 380, 800, ext)
    console.log('narrow tab labels:', narrow.map((l) => `${l.label}${l.truncated ? ' (CLIPPED)' : ''}`).join(', '))
    expect(narrow.filter((l) => l.truncated).map((l) => l.label)).toEqual([])
  } finally {
    await ext.context.close()
  }
})
