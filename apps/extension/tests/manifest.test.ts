import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import crypto from 'node:crypto'

// T3.1 verification: the shell builds to a valid MV3 manifest with a pinned
// key, and that key derives to a stable, documented extension ID.
// ("load unpacked in Chromium + chrome.runtime alive" is the manual/CI step;
//  this covers the buildable-manifest + stable-ID half automatically.)

const OUT_DIR = join(process.cwd(), '.output', 'chrome-mv3-dev')

function buildIfStale(): void {
  // Rebuild if the manifest isn't there (CI / fresh checkout).
  if (!existsSync(join(OUT_DIR, 'manifest.json'))) {
    execSync('pnpm wxt build --mode development', { cwd: process.cwd(), stdio: 'pipe' })
  }
}

function extensionIdFromKey(base64Key: string): string {
  const spkiDer = Buffer.from(base64Key, 'base64')
  const hash = crypto.createHash('sha256').update(spkiDer).digest()
  return hash
    .subarray(0, 16)
    .toString('hex')
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)))
}

describe('WXT MV3 shell (T3.1)', () => {
  it('builds a valid MV3 manifest with a pinned key + SW', () => {
    buildIfStale()
    const manifest = JSON.parse(readFileSync(join(OUT_DIR, 'manifest.json'), 'utf8'))
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.name).toBe('BoltVault')
    expect(manifest.key).toBeTruthy()
    expect(manifest.host_permissions).toContain('<all_urls>')
    expect(manifest.background?.service_worker).toBe('background.js')
    expect(existsSync(join(OUT_DIR, 'background.js'))).toBe(true)
  })

  it('pinned key derives to the documented, stable extension ID', () => {
    buildIfStale()
    const manifest = JSON.parse(readFileSync(join(OUT_DIR, 'manifest.json'), 'utf8'))
    const id = extensionIdFromKey(manifest.key)
    // Deterministic for this key; matches what's documented in wxt.config.ts.
    expect(id).toBe('ggmabmmmdnkckkpolkbbblbeoaoonpgf')
    // And the ID is only ever [a-p]{32}.
    expect(id).toMatch(/^[a-p]{32}$/)
  })
})
