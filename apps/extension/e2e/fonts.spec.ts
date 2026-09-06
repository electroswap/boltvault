/**
 * The fonts must never be seen arriving.
 *
 * Reported: "it's even noticeable that fonts are loading while the page is
 * being rendered because the font changes mid-load". Two causes, both fixed
 * here and both asserted below:
 *
 *  1. tokens.ts declared bare families ('Oxanium', 'Sora') with no fallback
 *     stack, so before the woff2 applied the browser used its default family
 *     — a serif. That is the serif "BoltVault" in the owner's screencast.
 *  2. fonts.css used font-display: swap, which *guarantees* a flash of
 *     fallback text, and only 2 of the 4 faces were preloaded (tab.html
 *     preloaded none), so 600-weight labels swapped in later than the rest.
 */
import { expect, test } from '@playwright/test'
import { launchWithExtension } from './extension'

const FACES = ['400 15px Sora', '600 15px Sora', '400 24px Oxanium', '600 24px Oxanium'] as const

for (const page of ['popup', 'tab', 'sign'] as const) {
  test(`${page}: every face is declared, preloaded and blocking`, async () => {
    const ext = await launchWithExtension()
    try {
      const p = await ext.context.newPage()
      await p.goto(ext.url(`${page}.html`))
      await p.waitForFunction(() => document.fonts.status === 'loaded', undefined, { timeout: 20_000 })

      // Every face we ship is declared and its file is fetchable. `check()`
      // would not do: it reports only faces the page happens to have matched,
      // so an unused weight legitimately reads as "not loaded".
      for (const face of FACES) {
        const got = await p.evaluate(async (f) => (await document.fonts.load(f)).length, face)
        expect(got, `${face} on ${page} resolved to no FontFace`).toBeGreaterThan(0)
      }

      // All four are preloaded, so none is discovered late.
      const preloaded = await p.evaluate(() =>
        [...document.querySelectorAll('link[rel="preload"][as="font"]')].map((l) => (l as HTMLLinkElement).href.split('/').pop()),
      )
      expect(preloaded.sort()).toEqual(['oxanium-400.woff2', 'oxanium-600.woff2', 'sora-400.woff2', 'sora-600.woff2'])

      // No face may swap: swap is what makes the change visible mid-render.
      const displays = await p.evaluate(() =>
        [...document.styleSheets]
          .flatMap((s) => {
            try {
              return [...s.cssRules]
            } catch {
              return []
            }
          })
          .filter((r): r is CSSFontFaceRule => r instanceof CSSFontFaceRule)
          .map((r) => r.style.getPropertyValue('font-display')),
      )
      expect(displays).toHaveLength(4)
      expect(displays.every((d) => d.trim() === 'block')).toBe(true)
      await p.close()
    } finally {
      await ext.context.close()
    }
  })
}

test('no rendered text can fall back to the UA default (a serif)', async () => {
  const ext = await launchWithExtension()
  try {
    const p = await ext.context.newPage()
    await p.setViewportSize({ width: 400, height: 600 })
    await p.goto(ext.url('popup.html'))
    await p.waitForFunction(() => document.fonts.status === 'loaded', undefined, { timeout: 20_000 })

    // The bug was a *bare* family: `font-family: Sora` with nothing after it.
    // Until the woff2 applies there is no Sora, so the browser uses its own
    // default — a serif. Computed style still reads "Sora", so the only thing
    // worth asserting is the invariant that prevents it: every stack that
    // names a webfont must end in a generic family.
    const stacks: string[] = await p.evaluate(() => {
      const seen = new Set<string>()
      for (const el of document.querySelectorAll('*')) {
        const text = (el.textContent ?? '').trim()
        if (text === '' || el.children.length > 0) continue
        const family = getComputedStyle(el).fontFamily
        if (family !== '') seen.add(family)
      }
      return [...seen]
    })

    expect(stacks.length).toBeGreaterThan(0)
    const bare = stacks.filter((f) => /Sora|Oxanium/.test(f) && !/\b(sans-serif|monospace|system-ui)\b/.test(f))
    expect(bare, 'font stacks with no generic fallback').toEqual([])
    await p.close()
  } finally {
    await ext.context.close()
  }
})
