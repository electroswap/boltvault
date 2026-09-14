/**
 * `version.mjs --bump` moves both numbers and commits them — and commits
 * nothing else.
 *
 * The commit is the part worth pinning. A release tool that writes files and
 * leaves them in the tree is a tool whose output gets committed by hand with
 * `-a` on a bad day, taking whatever else was dirty with it. So this one names
 * its paths to `git commit` rather than staging first, and refuses outright
 * when one of those files is already mid-edit.
 *
 * The tool resolves its own root from `import.meta.url`, so a copy of it in a
 * throwaway repo operates on that repo — which is how this runs the REAL
 * script end to end, commits and all, without touching this one.
 *
 * Here rather than beside the tool because `tools/` is not in the vitest
 * workspace, alongside `sbom-determinism.test.ts` for the same reason.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../..', import.meta.url))
const TOOL = join(REPO, 'tools', 'version.mjs')

let dir = ''

/** Everything `--bump` reads or writes, and nothing else, inside a fresh repo. */
function scaffold(): void {
  dir = mkdtempSync(join(tmpdir(), 'bv-version-'))
  mkdirSync(join(dir, 'tools'), { recursive: true })
  mkdirSync(join(dir, 'apps', 'extension'), { recursive: true })
  mkdirSync(join(dir, 'apps', 'mobile'), { recursive: true })
  cpSync(TOOL, join(dir, 'tools', 'version.mjs'))
  writeFileSync(join(dir, 'version.json'), `${JSON.stringify({ version: '1.2.3', androidVersionCode: 9 }, null, 2)}\n`)
  for (const app of ['extension', 'mobile']) {
    writeFileSync(join(dir, 'apps', app, 'package.json'), `${JSON.stringify({ name: `@boltvault/${app}`, private: true, version: '1.2.3' }, null, 2)}\n`)
  }
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  // A developer with global commit signing on would otherwise fail here for a
  // reason that has nothing to do with the tool.
  git(['config', 'commit.gpgsign', 'false'])
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'base'])
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
}

function run(args: string[]): { status: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [join(dir, 'tools', 'version.mjs'), ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

const versionJson = (): { version: string; androidVersionCode: number } =>
  JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')) as { version: string; androidVersionCode: number }

beforeEach(scaffold)
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('version.mjs --bump', () => {
  it('moves the patch and the versionCode together, and commits them', () => {
    const { status } = run(['--bump'])
    expect(status).toBe(0)
    expect(versionJson()).toEqual({ version: '1.2.4', androidVersionCode: 10 })
    expect(git(['log', '-1', '--format=%s']).trim()).toBe('chore(version): 1.2.4 (androidVersionCode 10)')
    expect(git(['status', '--porcelain']).trim()).toBe('')
  })

  it('carries the two package.json copies in the same commit', () => {
    run(['--bump'])
    const touched = git(['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').sort()
    expect(touched).toEqual(['apps/extension/package.json', 'apps/mobile/package.json', 'version.json'])
    for (const app of ['extension', 'mobile']) {
      const pkg = JSON.parse(readFileSync(join(dir, 'apps', app, 'package.json'), 'utf8')) as { version: string }
      expect(pkg.version).toBe('1.2.4')
    }
  })

  it('leaves the rest of a dirty tree out of that commit', () => {
    writeFileSync(join(dir, 'untracked.txt'), 'scratch\n')
    writeFileSync(join(dir, 'tools', 'other.mjs'), '// mid-edit\n')
    git(['add', 'tools/other.mjs'])

    run(['--bump'])
    const touched = git(['show', '--name-only', '--format=', 'HEAD']).trim().split('\n')
    // Staged-but-unrelated work is a trap for `git commit` without paths.
    expect(touched).not.toContain('tools/other.mjs')
    expect(touched).not.toContain('untracked.txt')
    expect(git(['status', '--porcelain']).trim()).toContain('untracked.txt')
  })

  it('refuses when one of its own files is already mid-edit, and writes nothing', () => {
    writeFileSync(join(dir, 'version.json'), `${JSON.stringify({ version: '1.2.3', androidVersionCode: 9, note: 'editing' }, null, 2)}\n`)
    const before = readFileSync(join(dir, 'version.json'), 'utf8')

    const { status, out } = run(['--bump'])
    expect(status).toBe(2)
    expect(out).toContain('would carry more than the bump')
    // Refused before writing, so the edit in progress is untouched.
    expect(readFileSync(join(dir, 'version.json'), 'utf8')).toBe(before)
    expect(git(['log', '--oneline']).trim().split('\n')).toHaveLength(1)
  })

  it('--no-commit writes the numbers and stops', () => {
    const { status } = run(['--bump', '--no-commit'])
    expect(status).toBe(0)
    expect(versionJson()).toEqual({ version: '1.2.4', androidVersionCode: 10 })
    expect(git(['log', '--oneline']).trim().split('\n')).toHaveLength(1)
    expect(git(['status', '--porcelain']).trim()).not.toBe('')
  })

  it('never pushes and never tags', () => {
    const { out } = run(['--bump'])
    expect(out).toContain('not pushed')
    expect(git(['tag']).trim()).toBe('')
  })

  it('leaves the explicit form uncommitted, as it always was', () => {
    const { status } = run(['2.0.0', '--code', '11'])
    expect(status).toBe(0)
    expect(versionJson()).toEqual({ version: '2.0.0', androidVersionCode: 11 })
    // Only --bump commits; setting an exact version stays a working-tree edit.
    expect(git(['log', '--oneline']).trim().split('\n')).toHaveLength(1)
  })
})
