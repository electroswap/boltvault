/**
 * A screen you have already seen never goes blank on the way back in.
 *
 * Reported: "It'll show the cached data, but then the loader shows again and
 * then the refreshed data shows again. There (stale) -> gone (loading) ->
 * there (refreshed) ... I would expect: there (stale) -> there (refresh in the
 * background) -> there (refreshed). I want this pattern applied throughout the
 * app."
 *
 * The shell unmounts a screen on every navigation, so React state goes with
 * it and the reload is a round trip to the service worker — which means the
 * empty state renders first however good the engine's cache is. useCached now
 * seeds its reducer from what the key last showed, and screens holding their
 * own state use useLastGood.
 *
 * This watches every frame of a revisit, because a skeleton that appears for
 * 80 ms is exactly the flicker being reported and a settled assertion cannot
 * see it.
 */
import { expect, test } from '@playwright/test'
import { launchWithExtension } from './extension'
import { createVault } from './flows'

/** Anything that means "this screen has nothing to show yet". */
const LOADERS = ['home-loading', 'screen-loading', 'rack-loading', 'approval-loading']

test('revisiting a tab never shows a loader again', async () => {
  test.setTimeout(180_000)
  const ext = await launchWithExtension()
  try {
    const { tab } = await createVault(ext)
    await tab.close()

    const p = await ext.context.newPage()
    await p.setViewportSize({ width: 400, height: 600 })
    await p.goto(ext.url('popup.html'))
    await p.getByTestId('keys').waitFor({ timeout: 20_000 })
    await p.waitForTimeout(2_000)

    // Lap one: every tab's first visit. A loader here is legitimate — the
    // chunk really is arriving and the screen really has nothing yet.
    for (const name of ['swap', 'activity', 'home'] as const) {
      await p
        .getByTestId(`tab-${name}`)
        .click({ timeout: 15_000 })
        .catch(() => undefined)
      await p.waitForTimeout(1_500)
    }

    // Only now start watching. Everything from here is a revisit.
    await p.evaluate((loaders) => {
      const seen: string[] = []
      const tick = (): void => {
        for (const id of loaders) if (document.querySelector(`[data-testid="${id}"]`) !== null && !seen.includes(id)) seen.push(id)
        requestAnimationFrame(tick)
      }
      ;(window as unknown as { __loaders: string[] }).__loaders = seen
      requestAnimationFrame(tick)
    }, LOADERS)

    // Two more laps of revisits.
    for (const round of [0, 1]) {
      void round
      for (const name of ['swap', 'activity', 'home'] as const) {
        await p
          .getByTestId(`tab-${name}`)
          .click({ timeout: 15_000 })
          .catch(() => undefined)
        await p.waitForTimeout(1_500)
      }
    }

    const seen = await p.evaluate(() => (window as unknown as { __loaders: string[] }).__loaders)
    console.log(`loaders seen on revisit: ${seen.length === 0 ? 'none' : seen.join(', ')}`)
    expect(seen).toEqual([])
    await p.close()
  } finally {
    await ext.context.close()
  }
})
