/**
 * The signature-moment harness (master plan §7.12 item 4).
 *
 * Three of the six moments had no harness at all for most of the project, and
 * the three that did carried no statement of what they were supposed to
 * achieve — a reviewer watching a discharge had to remember the criterion.
 * Two things are pinned here, and neither can be checked by a pixel diff:
 *
 *  1. all six moments are driveable — a pill, and a stage behind it;
 *  2. the criterion each stage prints is the plan's own sentence. A criterion
 *     paraphrased by whoever last touched the screen is a criterion that has
 *     quietly become whatever the screen already does.
 *
 * Read as text rather than imported: the screen pulls in the whole UI, and
 * these suites run in plain node where Reanimated cannot load.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCREEN = readFileSync(fileURLToPath(new URL('../src/screens/Moments.tsx', import.meta.url)), 'utf8')

/**
 * The specification is kept outside the published tree, so this reads it
 * where it lives and returns '' when it is not there; the criterion check
 * below is skipped in that case rather than failing on a document it
 * cannot see.
 */
function readPlan(): string {
  try {
    return readFileSync(fileURLToPath(new URL('../../../internal-docs/master-plan.md', import.meta.url)), 'utf8')
  } catch {
    return ''
  }
}
const PLAN = readPlan()

/** The six of §7.12, in the plan's order. */
const MOMENTS = ['ignition', 'discharge', 'qr', 'rack', 'coil', 'legends'] as const

/**
 * Quote style and line wrapping are not content: the plan writes 'like this'
 * and TypeScript sometimes has to write "like this", and the source is
 * indented where the markdown is not.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”'"]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every `t({ id: 'moments.criterion.x', message: '…' })` in the screen. */
function criteria(): Map<string, string> {
  const out = new Map<string, string>()
  const re = /id: 'moments\.criterion\.([a-z]+)',\s*message:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
  for (const m of SCREEN.matchAll(re)) {
    const id = m[1]
    const body = m[2] ?? m[3]
    if (id !== undefined && body !== undefined) out.set(id, body.replace(/\\(['"])/g, '$1'))
  }
  return out
}

describe('the six signature moments', () => {
  it('all six can be driven from the harness', () => {
    // One pill per id, built from MOMENT_IDS, and a stage behind each.
    expect(SCREEN, 'the picker no longer names its pills by moment id').toContain('testID={`moment-pick-${id}`}')
    for (const id of MOMENTS) expect(SCREEN, `${id} has no stage`).toContain(`moment === '${id}'`)
  })

  it('lists exactly the six, in the plan’s order', () => {
    const declared = /MOMENT_IDS: readonly MomentId\[\] = \[([^\]]*)\]/.exec(SCREEN)?.[1] ?? ''
    expect(declared.match(/'([a-z]+)'/g)?.map((s) => s.slice(1, -1))).toEqual([...MOMENTS])
  })

  it('states each moment’s acceptance criterion on screen', () => {
    expect([...criteria().keys()].sort()).toEqual([...MOMENTS].sort())
  })

  it.skipIf(PLAN === '')('quotes those criteria from the plan rather than paraphrasing them', () => {
    const plan = normalise(PLAN)
    for (const [id, text] of criteria()) {
      // The harness drops the plan's "*Name* — " prefix and starts the sentence
      // with a capital; everything after that has to be the plan's words.
      expect(plan, `moments.criterion.${id} is not in the master plan §7.12`).toContain(normalise(text))
    }
  })
})
