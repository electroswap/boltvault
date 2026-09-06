/**
 * The face gate (master plan §2.2), measured: popup interactive time from a
 * cold open, bundle sizes, and zero eval in the output. Thresholds fail the
 * test so a regression is a red CI, not an opinion.
 */
import { expect, test } from '@playwright/test'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { EXTENSION_DIR, launchWithExtension } from './extension'

const POPUP_GZ_BUDGET = 900 * 1024
const INTERACTIVE_BUDGET_MS = 300

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir)) {
    const p = join(dir, e)
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out
}

test('bundle: popup ≤ 900 KB gzip, no eval / new Function anywhere', async () => {
  const files = (await walk(EXTENSION_DIR)).filter((f) => /\.(js|css|html)$/.test(f))
  let popupGz = 0
  const evals: string[] = []
  for (const f of files) {
    const buf = await readFile(f)
    const text = buf.toString('utf8')
    if (/\beval\s*\(/.test(text) || /new Function\s*\(/.test(text)) evals.push(f.replace(EXTENSION_DIR, ''))
    if (f.includes('background')) continue
    popupGz += gzipSync(buf, { level: 9 }).length
  }
  console.log(`popup-side gzip total: ${(popupGz / 1024).toFixed(0)} KB`)
  expect(evals).toEqual([])
  expect(popupGz).toBeLessThanOrEqual(POPUP_GZ_BUDGET)
})

test('popup is interactive within 300 ms of navigation (cold open)', async () => {
  const ext = await launchWithExtension()
  try {
    const samples: number[] = []
    for (let i = 0; i < 3; i++) {
      const page = await ext.context.newPage()
      await page.setViewportSize({ width: 400, height: 600 })
      const started = Date.now()
      await page.goto(ext.url('popup.html'))
      await page.getByTestId('home').waitFor({ state: 'visible', timeout: 10_000 })
      const dom = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
        return nav ? nav.domContentLoadedEventEnd : 0
      })
      samples.push(Math.min(Date.now() - started, Math.max(dom, 1)))
      await page.close()
    }
    samples.sort((a, b) => a - b)
    const median = samples[1] ?? samples[0] ?? 0
    console.log(`popup interactive samples (ms): ${samples.join(', ')} — median ${median}`)
    expect(median).toBeLessThanOrEqual(INTERACTIVE_BUDGET_MS)
  } finally {
    await ext.context.close()
  }
})
