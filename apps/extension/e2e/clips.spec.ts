/**
 * Signature-moment clips (master plan §7.12 item 4).
 *
 * §7.12 asks for six moments, "each a Playwright/Maestro-recorded clip
 * reviewed at M1 for the first three and at M6 for the rest". Everything the
 * repo captured was a still PNG, and the milestone log concedes it: "the
 * Rack/Coil/Legends signature moments are screenshot-baselined rather than
 * recorded clips". A still frame cannot show a moment whose whole acceptance
 * criterion is how it moves — a discharge that never crosses the Field and a
 * vessel that twitches on every poll both photograph perfectly.
 *
 * This is that job. It drives `harness.html?screen=moments` with FULL motion,
 * presses each moment's beats in order, and writes one video per moment. The
 * acceptance criterion is painted on the page beside the moment, so a clip is
 * self-describing: whoever reviews it reads the sentence it has to satisfy in
 * the same frame.
 *
 * It is deliberately NOT part of the normal e2e run: it skips itself unless
 * CLIPS is set, it opens one browser per moment (video size is fixed per
 * context), and it spends real seconds watching things move. The screenshot
 * baselines in screens.spec.ts stay the fast per-PR gate; this is the thing a
 * human sits down and watches at a milestone review.
 *
 * ── How to run ────────────────────────────────────────────────────────────
 *
 *   pnpm build:harness                       # once; writes .output/chrome-mv3-harness
 *   CLIPS=1 pnpm --filter @boltvault/extension exec playwright test e2e/clips.spec.ts
 *
 * ── Where the clips land ──────────────────────────────────────────────────
 *
 *   apps/extension/screenshots/clips/<moment>--<size>.webm
 *
 * `screenshots/` is gitignored, like every other harness output: clips are
 * review artefacts, not baselines — nothing diffs them, a person watches them.
 * Attach them to the milestone note.
 *
 * ── Options ───────────────────────────────────────────────────────────────
 *
 *   CLIPS=1                  required; without it the spec skips
 *   CLIP_ONLY=coil,legends   record a subset, by moment id
 *   CLIP_DIR=/tmp/clips      write somewhere else
 *   CLIP_SPEED=2             stretch every dwell by this factor, for a slow read
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { collectErrors, launchWithHarness } from './extension'

const SIZES = {
  popup: { body: 'extension-popup', width: 400, height: 600 },
  tab: { body: 'extension-tab', width: 1100, height: 760 },
  mobile: { body: 'mobile', width: 390, height: 844 },
} as const

type SizeId = keyof typeof SIZES

const OUT = process.env['CLIP_DIR'] ?? join(process.cwd(), 'screenshots', 'clips')
const RAW = join(OUT, '.raw')
const ONLY = (process.env['CLIP_ONLY'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const SPEED = Number(process.env['CLIP_SPEED'] ?? '1') || 1

interface Clip {
  /** Matches the moment's pill in the harness: `moment-pick-<id>`. */
  readonly id: string
  /** The body the plan reviews this moment in. */
  readonly size: SizeId
  /** The beats, pressed in order. */
  drive(beat: Beat): Promise<void>
}

interface Beat {
  /** Press a control by test id and let the result play. */
  press(testId: string, dwellMs?: number): Promise<void>
  /** Let the current state play — for the moments that are about stillness. */
  hold(ms: number): Promise<void>
}

/**
 * One clip per moment, each driven through the beats its criterion names.
 * Sizes follow the plan: the QR moment is "Receive on mobile", so it is shot
 * on a phone; the rest are reviewed where there is room to see the Field.
 */
const CLIPS: readonly Clip[] = [
  {
    id: 'ignition',
    size: 'tab',
    // Ignition is an *enter*: it can only be reviewed by entering again, which
    // is what Replay does — the stage remounts and re-runs the 400 ms ceremony.
    drive: async (b) => {
      await b.hold(1200)
      await b.press('moment-ignition-replay', 1800)
      await b.press('moment-ignition-replay', 1800)
    },
  },
  {
    id: 'discharge',
    size: 'tab',
    // Twice: once to see the arc, once to see that the row lands where the eye
    // was already looking.
    drive: async (b) => {
      await b.hold(900)
      await b.press('fire-discharge', 2000)
      await b.press('fire-discharge', 2000)
    },
  },
  {
    id: 'qr',
    size: 'mobile',
    // Static on web by design; the clip records that it IS static, and the
    // frame carries the code at review size. The parallax is a device check.
    drive: async (b) => {
      await b.hold(3000)
    },
  },
  {
    id: 'rack',
    size: 'tab',
    // Dwell first: the criterion is what a stranger can tell from the shelves
    // before anything moves. Then buy, and watch the piece land with the arc.
    drive: async (b) => {
      await b.hold(2500)
      await b.press('moment-rack-buy', 2500)
    },
  },
  {
    id: 'coil',
    size: 'tab',
    // The long dwell is the point: blocks tick the whole time and the ring must
    // not move. Then Collect discharges the coil into the readout.
    drive: async (b) => {
      await b.hold(5000)
      await b.press('moment-coil-accrue', 1200)
      await b.press('moment-coil-accrue', 1200)
      await b.press('moment-coil-collect', 2500)
    },
  },
  {
    id: 'legends',
    size: 'tab',
    // Fees arrive (the liquid rises), then three polls that change nothing (the
    // liquid must not move at all — that is the criterion), then Claim drains it.
    drive: async (b) => {
      await b.hold(1200)
      await b.press('moment-legends-fee', 1600)
      await b.press('moment-legends-fee', 1600)
      await b.press('moment-legends-poll', 700)
      await b.press('moment-legends-poll', 700)
      await b.press('moment-legends-poll', 1400)
      await b.press('dividends-claim', 2500)
    },
  },
]

test.skip(!process.env['CLIPS'], 'CLIPS is unset — this is the milestone review job, not a per-PR gate')

test('records one clip per signature moment', async () => {
  test.setTimeout(600_000)
  const wanted = CLIPS.filter((c) => ONLY.length === 0 || ONLY.includes(c.id))
  expect(wanted, `CLIP_ONLY matched no moment (have: ${CLIPS.map((c) => c.id).join(', ')})`).not.toEqual([])
  await mkdir(OUT, { recursive: true })
  const written: string[] = []

  for (const clip of wanted) {
    const s = SIZES[clip.size]
    // One raw directory per clip. A persistent context opens its own blank
    // first page and records that too, so the file on disk is never picked by
    // name — `page.video()` names the one that belongs to this page.
    const raw = join(RAW, clip.id)
    await rm(raw, { recursive: true, force: true })
    await mkdir(raw, { recursive: true })
    const ext = await launchWithHarness({ recordVideo: { dir: raw, size: { width: s.width, height: s.height } } })
    const name = `${clip.id}--${clip.size}.webm`
    try {
      const page = await ext.context.newPage()
      /*
        The video belongs to this page, and it has to be saved while the
        browser is still up: `saveAs` talks to it. Closing the page finishes
        the recording; closing the context would take the connection with it.
      */
      const video = page.video()
      const errors = collectErrors(page)
      await page.setViewportSize({ width: s.width, height: s.height })
      // No `motion=reduced`: a clip of a moment in reduced motion would be a
      // clip of nothing. Reduced motion is what the still baselines cover.
      await page.goto(ext.url(`harness.html?scenario=funded&screen=moments&body=${s.body}`))
      try {
        await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1', undefined, { timeout: 30_000 })
      } catch (err) {
        throw new Error(`${clip.id}: the harness never became ready. Page errors:\n${errors.join('\n')}\n${String(err)}`)
      }
      // The Field's first frames and the web fonts: let them arrive before the
      // moment does, so the clip is of the moment and not of the page loading.
      await page.waitForTimeout(900 * SPEED)
      await page.getByTestId(`moment-pick-${clip.id}`).click()
      await page.waitForTimeout(600 * SPEED)
      await clip.drive(beats(page))
      await page.close()
      if (video === null) throw new Error(`${clip.id}: Chromium recorded no video — was recordVideo dropped?`)
      await video.saveAs(join(OUT, name))
    } finally {
      await ext.context.close()
    }
    written.push(name)
  }

  await rm(RAW, { recursive: true, force: true })
  console.log(`clips written to ${OUT}:\n  ${written.join('\n  ')}`)
  expect(written.length).toBe(wanted.length)
})

function beats(page: Page): Beat {
  return {
    press: async (testId, dwellMs = 1500) => {
      await page.getByTestId(testId).first().click()
      await page.waitForTimeout(dwellMs * SPEED)
    },
    hold: async (ms) => {
      await page.waitForTimeout(ms * SPEED)
    },
  }
}
