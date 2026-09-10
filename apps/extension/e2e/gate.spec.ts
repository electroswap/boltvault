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

/**
 * 900 KB held for the whole UX programme and caught real regressions — an
 * inlined base64 logo, an XML parser pulled in for a body that did not need
 * one. It moved once, on 2026-09-07, to pay for Settings › Address book, which
 * the owner asked for after transaction naming was taken out of the signing
 * flow. Roughly 1.5 KB gzipped, and every non-background file counts here, so a
 * lazily loaded screen is not free.
 *
 * Deduplicating the ES mark was tried first and bought nothing: the export
 * carried a stacked duplicate layer, 20% of the source, which gzip was already
 * collapsing to almost nothing. Worth knowing before anyone optimises bytes
 * that the compressor has handled.
 *
 * **It was measuring the wrong build.** The screenshot harness shipped in the
 * release, and `harness.html` does not merely add its own chunk — it imports the
 * fixture engine, which reaches every screen, so Vite hoisted the lot into the
 * shared chunk the popup loads. Excluding it from a release build took the
 * measured total from 906 KB to 460 KB. The budget was never 3 KB from the edge;
 * half of what it was counting was a development surface.
 *
 * So the number comes down rather than up. 600 KB is ~140 KB above what ships
 * today, which is room for real work, and low enough that the gate bites again —
 * at 910 it could not have caught anything for years.
 */
const POPUP_GZ_BUDGET = 600 * 1024
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

test('bundle: popup ≤ 600 KB gzip, no eval / new Function anywhere', async () => {
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
  // Never conditional: no build of this extension may contain eval.
  expect(evals).toEqual([])
  /*
    The size assertion only means anything against a release build. A default
    `pnpm build` includes the harness, and the harness drags the fixture engine
    into the shared chunk — so measuring one would be measuring development
    scaffolding. Say which build this is rather than failing a developer's loop
    for a number that was never about them.
  */
  const isRelease = !files.some((f) => f.includes('harness'))
  if (!isRelease) {
    console.log(`skipping the size assertion: this is a development build (${(popupGz / 1024).toFixed(0)} KB includes the harness). Run \`pnpm build:release\` to measure what ships.`)
    test.skip(true, 'development build — run pnpm build:release to measure the shipped bundle')
    return
  }
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
