/**
 * Corners nest concentrically, or they read as two designs meeting.
 *
 * Reported: "Many containers/cards have rounded edges, and within some of
 * those cards we have other cards that have square edges, which does not feel
 * like a harmonious design."
 *
 * Reading the code found three instances and missed the ones that matter most
 * — the swap and bridge consoles — so this measures instead. It walks the real
 * DOM of every screen and reports any box that draws an edge, sits flush
 * inside a rounded ancestor, and has no radius of its own. That is the exact
 * shape of the complaint, and it cannot be missed by eye.
 *
 *   RADII=1 pnpm exec playwright test e2e/radii.spec.ts
 */
import { expect, test } from '@playwright/test'
import { launchWithHarness } from './extension'

test.skip(process.env['RADII'] !== '1', 'RADII is unset')

const SCREENS = ['home', 'swap', 'bridge', 'send', 'explore', 'portfolio', 'activity'] as const

interface Offender {
  screen: string
  child: string
  childRadius: number
  parent: string
  parentRadius: number
}

test('no square box sits flush inside a rounded one', async () => {
  test.setTimeout(240_000)
  const ext = await launchWithHarness()
  const found: Offender[] = []
  try {
    for (const screen of SCREENS) {
      const page = await ext.context.newPage()
      await page.setViewportSize({ width: 400, height: 600 })
      await page.goto(ext.url(`harness.html?scenario=funded&screen=${screen}&body=extension-popup&motion=reduced`))
      await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1', undefined, { timeout: 30_000 })
      await page.waitForTimeout(500)

      const offenders = await page.evaluate(() => {
        const radiusOf = (el: Element): number => parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
        // Only a box that actually draws an edge can show a corner.
        const draws = (el: Element): boolean => {
          const s = getComputedStyle(el)
          const bg = s.backgroundColor
          const opaque = bg !== '' && bg !== 'transparent' && !bg.endsWith(', 0)')
          return opaque || (parseFloat(s.borderTopWidth) || 0) > 0
        }
        const name = (el: Element): string => {
          const id = el.getAttribute('data-testid')
          if (id !== null) return id
          const near = el.closest('[data-testid]')?.getAttribute('data-testid')
          const text = (el.textContent ?? '').trim().slice(0, 18)
          return `${near ?? el.tagName.toLowerCase()}${text ? ` "${text}"` : ''}`
        }
        const out: Array<{ child: string; childRadius: number; parent: string; parentRadius: number }> = []
        for (const el of document.querySelectorAll('#root *')) {
          const r = el.getBoundingClientRect()
          // Hairlines, dividers and slivers cannot show a corner.
          if (r.width < 24 || r.height < 24) continue
          if (!draws(el) || radiusOf(el) > 0) continue
          for (let p = el.parentElement; p !== null; p = p.parentElement) {
            const pr = p.getBoundingClientRect()
            if (pr.width < 24 || pr.height < 24) continue
            if (!draws(p)) continue
            // A square child only reads as wrong where it reaches the rounded
            // parent's edge; one floating in the middle is just a rectangle.
            const flush = Math.abs(r.left - pr.left) < 12 || Math.abs(r.right - pr.right) < 12
            if (radiusOf(p) >= 8 && flush) out.push({ child: name(el), childRadius: radiusOf(el), parent: name(p), parentRadius: radiusOf(p) })
            break
          }
        }
        return out
      })
      for (const o of offenders) found.push({ screen, ...o })
      await page.close()
    }
  } finally {
    await ext.context.close()
  }
  for (const f of found) console.log(`${f.screen}: ${f.child} r=${f.childRadius} inside ${f.parent} r=${f.parentRadius}`)
  expect(found.map((f) => `${f.screen}: ${f.child} inside ${f.parent}`)).toEqual([])
})
