/**
 * Screenshot harness (master plan §7.12 item 6): every registered screen ×
 * body size × motion mode, rendered from fixture engine state, diffed
 * against committed baselines with pixelmatch. `UPDATE_BASELINES=1` rewrites
 * them. Hit-target measurement runs on the same pages.
 */
import { expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { collectErrors, launchWithExtension } from './extension'

const BASELINES = join(process.cwd(), 'e2e', 'baselines')
const OUT = join(process.cwd(), 'screenshots')
const UPDATE = process.env['UPDATE_BASELINES'] === '1'

const SIZES = {
  popup: { body: 'extension-popup', width: 360, height: 600 },
  tab: { body: 'extension-tab', width: 1100, height: 760 },
  mobile: { body: 'mobile', width: 390, height: 844 },
} as const

const CASES: Array<{ screen: string; scenario: string; sizes: Array<keyof typeof SIZES>; query?: string; name?: string }> = [
  { screen: 'home', scenario: 'fresh', sizes: ['popup', 'mobile'] },
  { screen: 'home', scenario: 'locked', sizes: ['popup'] },
  { screen: 'home', scenario: 'funded', sizes: ['popup', 'tab', 'mobile'] },
  { screen: 'swap', scenario: 'funded', sizes: ['popup', 'mobile'] },
  // The first-swap coach overlay: an account that has not swapped and has not dismissed it.
  { screen: 'swap', scenario: 'unlocked', sizes: ['popup'] },
  { screen: 'explore', scenario: 'funded', sizes: ['popup'] },
  { screen: 'explore', scenario: 'funded', sizes: ['popup'], query: 'segment=collectibles', name: 'explore-collectibles' },
  { screen: 'explore', scenario: 'funded', sizes: ['popup'], query: 'segment=launch', name: 'explore-launch' },
  { screen: 'explore', scenario: 'funded', sizes: ['popup'], query: 'segment=farms', name: 'explore-farms' },
  { screen: 'portfolio', scenario: 'funded', sizes: ['popup', 'tab'] },
  { screen: 'activity', scenario: 'funded', sizes: ['popup'] },
  { screen: 'settings', scenario: 'funded', sizes: ['popup'] },
  { screen: 'moments', scenario: 'funded', sizes: ['tab', 'mobile'] },
  // M2 custody surfaces. Secrets-bearing steps render only in tab/mobile (§3.2).
  { screen: 'onboarding', scenario: 'fresh', sizes: ['popup', 'tab', 'mobile'] },
  { screen: 'unlock', scenario: 'locked', sizes: ['popup', 'mobile'] },
  { screen: 'home', scenario: 'unlocked', sizes: ['popup'] },
  { screen: 'accounts', scenario: 'funded', sizes: ['popup', 'tab', 'mobile'] },
  { screen: 'backup', scenario: 'unlocked', sizes: ['tab', 'mobile'] },
  { screen: 'security', scenario: 'funded', sizes: ['popup', 'tab'] },
  { screen: 'devices', scenario: 'funded', sizes: ['popup', 'mobile'] },
  // M3: the signing sheet (connect and a danger transaction) and connected sites.
  { screen: 'sign', scenario: 'connect', sizes: ['popup', 'mobile'] },
  { screen: 'sign', scenario: 'sign', sizes: ['popup', 'tab', 'mobile'] },
  { screen: 'sites', scenario: 'funded', sizes: ['popup'] },
  // M4: money on Electroneum.
  { screen: 'token', scenario: 'funded', sizes: ['popup', 'tab'] },
  { screen: 'send', scenario: 'funded', sizes: ['popup', 'mobile'] },
  { screen: 'receive', scenario: 'funded', sizes: ['popup', 'mobile'] },
  { screen: 'allowances', scenario: 'funded', sizes: ['popup', 'tab'] },
  { screen: 'spending', scenario: 'funded', sizes: ['popup'] },
  { screen: 'collection', scenario: 'funded', sizes: ['popup', 'tab'] },
  { screen: 'nft', scenario: 'funded', sizes: ['popup', 'mobile'] },
  { screen: 'rack', scenario: 'funded', sizes: ['popup', 'tab'] },
  { screen: 'offers', scenario: 'funded', sizes: ['popup'] },
  { screen: 'farm', scenario: 'funded', sizes: ['popup', 'mobile'] },
  { screen: 'campaign', scenario: 'funded', sizes: ['popup', 'mobile'] },
  { screen: 'legends', scenario: 'funded', sizes: ['popup', 'tab'] },
  { screen: 'alerts', scenario: 'funded', sizes: ['popup'] },
  // M7: other chains and the bridge.
  { screen: 'bridge', scenario: 'funded', sizes: ['popup', 'tab', 'mobile'] },
  { screen: 'networks', scenario: 'funded', sizes: ['popup'] },
  // M8: the Keystone prompt over Home; Devices carries the signing-requests plate.
  { screen: 'home', scenario: 'keystone', sizes: ['popup', 'mobile'] },
  // M9: the feel settings and the browser's web plate; Connected sites and Alerts carry the WalletConnect and push plates.
  { screen: 'feel', scenario: 'funded', sizes: ['popup'] },
  { screen: 'browser', scenario: 'funded', sizes: ['popup'] },
  // M10: About (version, encryption, fee sink, signed flags, crash reports).
  { screen: 'about', scenario: 'funded', sizes: ['popup'] },
]

test('every screen renders in every size and matches its baseline', async () => {
  test.setTimeout(240_000)
  const ext = await launchWithExtension()
  await mkdir(OUT, { recursive: true })
  await mkdir(BASELINES, { recursive: true })
  const failures: string[] = []
  const tooSmall: string[] = []
  try {
    for (const c of CASES) {
      for (const size of c.sizes) {
        const s = SIZES[size]
        const page = await ext.context.newPage()
        const errors = collectErrors(page)
        await page.setViewportSize({ width: s.width, height: s.height })
        const url = ext.url(`harness.html?scenario=${c.scenario}&screen=${c.screen}&body=${s.body}&motion=reduced${c.query ? `&${c.query}` : ''}`)
        await page.goto(url)
        try {
          await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1', undefined, { timeout: 30_000 })
        } catch (err) {
          throw new Error(`${c.screen}/${c.scenario}/${size} never became ready. Page errors:\n${errors.join('\n')}\n${String(err)}`)
        }
        await page.waitForTimeout(600) // fonts + the still Field frame
        // Hit-target law (§7.5): every pressable ≥ 44 px on its short side.
        const small = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[role="button"],[role="tab"],button'))
            .map((el) => {
              const r = el.getBoundingClientRect()
              return { id: el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName, w: r.width, h: r.height }
            })
            .filter((r) => r.w > 0 && r.h > 0 && (r.w < 44 || r.h < 44))
            .map((r) => `${r.id} ${Math.round(r.w)}×${Math.round(r.h)}`),
        )
        for (const sm of small) tooSmall.push(`${c.screen}/${c.scenario}/${size}: ${sm}`)

        const name = `${c.name ?? c.screen}--${c.scenario}--${size}.png`
        const buf = await page.screenshot({ path: join(OUT, name), fullPage: false })
        const baselinePath = join(BASELINES, name)
        if (UPDATE || !existsSync(baselinePath)) {
          await writeFile(baselinePath, buf)
        } else {
          const a = PNG.sync.read(await readFile(baselinePath))
          const b = PNG.sync.read(buf)
          if (a.width !== b.width || a.height !== b.height) {
            failures.push(`${name}: size changed ${a.width}×${a.height} → ${b.width}×${b.height}`)
          } else {
            const diff = new PNG({ width: a.width, height: a.height })
            const mismatched = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.12 })
            const ratio = mismatched / (a.width * a.height)
            if (ratio > 0.004) {
              await writeFile(join(OUT, `diff--${name}`), PNG.sync.write(diff))
              failures.push(`${name}: ${(ratio * 100).toFixed(2)}% pixels differ`)
            }
          }
        }
        await page.close()
      }
    }
  } finally {
    await ext.context.close()
  }
  expect(tooSmall, 'hit targets below 44 px').toEqual([])
  expect(failures, 'screens that drifted from their baselines').toEqual([])
})
