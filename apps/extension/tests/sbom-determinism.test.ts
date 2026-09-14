/**
 * The SBOM is a function of the lockfile, not of the clock.
 *
 * `metadata.timestamp` used to be `Date.now()`, so every regeneration produced
 * a different document even when not one dependency had moved. `pnpm sbom`
 * runs from the extension build script and from CI, so a normal build left
 * `sbom.cdx.json` modified in the tree with a one-line diff of nothing but the
 * timestamp — which had to be committed again to get a clean tree back, over
 * and over. It is dated from the lockfile's own last commit now: true by
 * construction, and stable until the components actually change.
 *
 * This lives here rather than beside the tool because `tools/` is not in the
 * vitest workspace, and the extension build script — the build that kept dirtying
 * the file — is this app's.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const TOOL = join(ROOT, 'tools', 'sbom.mjs')
const dir = mkdtempSync(join(tmpdir(), 'bv-sbom-'))

/** Generate into a throwaway path, so the repo's own sbom.cdx.json is never touched. */
function generate(name: string, env: NodeJS.ProcessEnv = {}): string {
  const out = join(dir, name)
  execFileSync(process.execPath, [TOOL, out], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] })
  return readFileSync(out, 'utf8')
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the SBOM', () => {
  it('is byte-identical when nothing but the clock has moved', async () => {
    const first = generate('a.json')
    /*
      Long enough for the wall clock to tick over a whole second.

      The old timestamp had one-second resolution, so two generations inside
      the same second matched even while the bug was present — the assertion
      would have passed on the very code it exists to catch.
    */
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    const second = generate('b.json')
    // Not `toEqual` on parsed JSON: the committed artifact is the bytes, and
    // the bytes are what showed up as a dirty file.
    expect(second).toBe(first)
  })

  it('dates itself from the lockfile, not from today', () => {
    const at = execFileSync('git', ['log', '-1', '--format=%ct', '--', 'pnpm-lock.yaml'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const bom = JSON.parse(generate('c.json')) as { metadata: { timestamp: string } }
    expect(bom.metadata.timestamp).toBe(new Date(Number(at) * 1000).toISOString())
  })

  it('still lets a reproducible build pin the timestamp', () => {
    // `pnpm build:repro` sets SOURCE_DATE_EPOCH from HEAD and expects every
    // artifact it produces to honour it.
    const bom = JSON.parse(generate('d.json', { SOURCE_DATE_EPOCH: '1700000000' })) as { metadata: { timestamp: string } }
    expect(bom.metadata.timestamp).toBe('2023-11-14T22:13:20.000Z')
  })

  it('keeps the serial number tied to the lockfile it describes', () => {
    const bom = JSON.parse(generate('e.json')) as {
      serialNumber: string
      metadata: { properties: Array<{ name: string; value: string }> }
    }
    const hash = bom.metadata.properties.find((p) => p.name === 'boltvault:lockfile-sha256')?.value ?? ''
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(bom.serialNumber).toContain(hash.slice(0, 8))
  })
})
