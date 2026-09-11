/**
 * The popup is 400 px wide and must stay 400 px wide.
 *
 * Reported: "Non-fullscreen extension pop-up window resizes slightly wider
 * when clicking on any tab, leaving a permanent margin on the right side."
 *
 * Chrome sizes an action popup from the document's preferred width and, once
 * grown, never shrinks it back — so a single frame of horizontal overflow
 * anywhere leaves a permanent margin. The overflow is what we can measure:
 * `overflow: hidden` hides it visually but still reports it through
 * scrollWidth, and we sample every frame, because a 180 ms enter animation is
 * long gone by the time a settled read happens.
 *
 * On failure it names the widest element, because "something overflowed" is
 * not actionable.
 */
import { expect, test } from '@playwright/test'
import { launchWithExtension, launchWithHarness } from './extension'
import { createVault } from './flows'

const WIDTH = 400
const HEIGHT = 600

declare global {
  interface Window {
    __maxRight?: { escaped: number; tall: number; widest: number; who: string }
  }
}

test('no navigation makes the popup document wider than 400px', async () => {
  test.setTimeout(180_000)
  const ext = await launchWithExtension()
  try {
    const { tab } = await createVault(ext)
    await tab.close()

    const p = await ext.context.newPage()
    // Exactly the popup's own size. An oversized window is no good: elements
    // that legitimately fill the viewport (the Field canvas) then read as
    // overflow. `overflow: hidden` still reports the true content extent
    // through scrollWidth, so real overflow is visible at 400 px.
    await p.setViewportSize({ width: WIDTH, height: HEIGHT })
    await p.goto(ext.url('popup.html'))

    // Sample every frame; a 180 ms enter animation is invisible to a settled read.
    await p.evaluate(() => {
      window.__maxRight = { escaped: 0, tall: 0, widest: 0, who: '' }
      const describe = (el: Element): string => {
        // react-native-web class names are generated noise; the useful identity
        // is the nearest testID ancestry plus a scrap of text.
        const trail: string[] = []
        for (let n: Element | null = el; n !== null && trail.length < 4; n = n.parentElement) {
          const id = n.getAttribute('data-testid')
          if (id !== null) trail.unshift(id)
        }
        const r = el.getBoundingClientRect()
        const text = (el.textContent ?? '').trim().slice(0, 30)
        return `${el.tagName.toLowerCase()} @${trail.join('>') || '(no testid)'} left=${Math.round(r.left)} w=${Math.round(r.width)}${text ? ` "${text}"` : ''}`
      }
      const tick = (): void => {
        // Two different questions, kept apart on purpose:
        //  - `escaped` is what Chrome sizes the popup from: real scrollable
        //    overflow that reached the document. This is the assertion.
        //  - `widest` is only a hint at which element is responsible. An
        //    element clipped by an overflow:hidden ancestor still reports its
        //    unclipped rect here, so on its own it proves nothing.
        const doc = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)
        if (doc > (window.__maxRight?.escaped ?? 0)) window.__maxRight = { ...(window.__maxRight ?? { tall: 0, widest: 0, who: '' }), escaped: doc }
        // Height matters for the same reason: a document taller than the popup
        // gets a vertical scrollbar, and Chrome widens the window to fit it.
        const tall = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
        if (tall > (window.__maxRight?.tall ?? 0)) window.__maxRight = { ...(window.__maxRight ?? { escaped: 0, widest: 0, who: '' }), tall }
        for (const el of document.querySelectorAll('#root *')) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.right > (window.__maxRight?.widest ?? 0)) {
            window.__maxRight = { ...(window.__maxRight ?? { escaped: 0, tall: 0 }), widest: Math.round(r.right), who: describe(el) }
          }
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })

    const visit = async (testId: string): Promise<void> => {
      await p
        .getByTestId(testId)
        .first()
        .click({ timeout: 10_000 })
        .catch(() => undefined)
      await p.waitForTimeout(1_200)
    }

    // Every tab, twice around, plus a push and a pop — push is the direction
    // that translates on X, so it is the one most likely to overflow.
    for (const round of [0, 1]) {
      void round
      for (const name of ['swap', 'activity', 'home'] as const) await visit(`tab-${name}`)
    }
    await visit('key-send')
    await visit('back')

    const worst = await p.evaluate(() => window.__maxRight ?? { escaped: 0, tall: 0, widest: 0, who: 'none' })
    console.log(`document ${worst.escaped}x${worst.tall}px | widest element: ${worst.widest}px via ${worst.who}`)
    expect(worst.escaped, `horizontal overflow reached the document; widest element was ${worst.who}`).toBeLessThanOrEqual(WIDTH)
    expect(worst.tall, 'vertical overflow reached the document (a scrollbar here widens the popup)').toBeLessThanOrEqual(HEIGHT)
    await p.close()
  } finally {
    await ext.context.close()
  }
})

/**
 * ...and Home must fit its height too.
 *
 * Owner: "it's important that the home screen on the extension remains spaced
 * in a way that a scrollbar is not required." Home lays itself out from one
 * interval and a flexible spacer, so a change to either — or one more tile, or
 * a taller notice — can push it over 600 px without anyone noticing on a phone,
 * where it simply scrolls. This is the number that cannot drift.
 */
test('home fits a 400x600 popup without scrolling', async () => {
  const ext = await launchWithHarness()
  try {
    const page = await ext.context.newPage()
    await page.setViewportSize({ width: 400, height: 600 })
    await page.goto(ext.url('harness.html?scenario=funded&screen=home&body=extension-popup&motion=reduced'))
    await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1', undefined, { timeout: 30_000 })
    await page.waitForTimeout(900)
    const m = await page.evaluate(() => {
      const scroller = Array.from(document.querySelectorAll('div')).find((d) => d.scrollHeight > d.clientHeight + 1 && getComputedStyle(d).overflowY !== 'visible')
      return {
        doc: { scroll: document.documentElement.scrollHeight, client: document.documentElement.clientHeight },
        overflowing: scroller ? { scroll: scroller.scrollHeight, client: scroller.clientHeight, testid: scroller.getAttribute('data-testid') } : null,
      }
    })
    console.log('MEASURE=', JSON.stringify(m))
    expect(m.overflowing, 'something on Home scrolls in a 400x600 popup').toBeNull()
  } finally {
    await ext.context.close()
  }
})
