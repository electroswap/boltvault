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
import { expect, test, type Page } from '@playwright/test'
import { launchWithExtension } from './extension'
import { createVault, engineCall } from './flows'

/** Anything that means "this screen has nothing to show yet". */
const LOADERS = ['home-loading', 'screen-loading', 'rack-loading', 'approval-loading']

/**
 * One lap: Home → a root → back to Home.
 *
 * The dock is gone, so "click tab-swap" is no longer a thing you can do —
 * Swap and Activity are tiles on Home and carry a home key of their own.
 * The point of the test is unchanged: leave a screen, come back, and see
 * whether it rebuilds itself from nothing.
 */
async function lap(p: Page, name: 'swap' | 'activity'): Promise<void> {
  await p.getByTestId(`key-${name}`).click({ timeout: 15_000 }).catch(() => undefined)
  await p.waitForTimeout(1_500)
  // The first-swap coach is an overlay over the screen, and the way home is
  // now inside the screen rather than on a dock beneath it — so it has to go
  // first. It only appears once.
  await p.getByTestId('swap-coach-ok').click({ timeout: 2_000 }).catch(() => undefined)
  await p.getByTestId('rail-home').click({ timeout: 15_000 }).catch(() => undefined)
  await p.waitForTimeout(1_500)
}

test('revisiting a tab never shows a loader again', async () => {
  test.setTimeout(180_000)
  const ext = await launchWithExtension()
  try {
    const { tab } = await createVault(ext)
    // A funded account, or "the total is a dash" is not a bug — it is the
    // truth. The ES Deployer is public and comes from the repo's deploy config.
    const watched = (await engineCall(tab, 'accounts', 'addWatch', { address: '0xD6Cf49CbCF84B2cd2472a376B5f791689A0769d0', label: 'ES Deployer' })) as { id: string }
    await engineCall(tab, 'accounts', 'setActive', { id: watched.id })
    await tab.close()

    const p = await ext.context.newPage()
    await p.setViewportSize({ width: 400, height: 600 })
    await p.goto(ext.url('popup.html'))
    await p.getByTestId('keys').waitFor({ timeout: 20_000 })
    await p.waitForTimeout(2_000)

    // Lap one: every tab's first visit. A loader here is legitimate — the
    // chunk really is arriving and the screen really has nothing yet.
    await lap(p, 'swap')
    await lap(p, 'activity')

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
      await lap(p, 'swap')
      await lap(p, 'activity')
    }

    // Returning to Home must show the total straight away, never a dash.
    await p.getByTestId('key-swap').click({ timeout: 15_000 }).catch(() => undefined)
    await p.getByTestId('swap-coach-ok').click({ timeout: 2_000 }).catch(() => undefined)
    await p.waitForTimeout(1_200)
    await p.evaluate(() => {
      const w = window as unknown as { __dash: boolean }
      w.__dash = false
      const tick = (): void => {
        const el = document.querySelector('[data-testid="total"]')
        const text = (el?.textContent ?? '').trim()
        if (el !== null && (text === '' || text === '\u2014' || text === '-')) w.__dash = true
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await p.getByTestId('rail-home').click({ timeout: 15_000 }).catch(() => undefined)
    await p.waitForTimeout(2_500)
    const dashed = await p.evaluate(() => (window as unknown as { __dash: boolean }).__dash)
    console.log(`balance showed a dash on return: ${dashed}`)
    expect(dashed, 'the total was a dash on the way back to Home').toBe(false)

    const seen = await p.evaluate(() => (window as unknown as { __loaders: string[] }).__loaders)
    console.log(`loaders seen on revisit: ${seen.length === 0 ? 'none' : seen.join(', ')}`)
    expect(seen).toEqual([])
    await p.close()
  } finally {
    await ext.context.close()
  }
})
