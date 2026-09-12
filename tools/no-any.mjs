#!/usr/bin/env node
// `any` is a lint error in this repo. ESLint catches explicit `any` in files it
// lints; this gate scans every source file (including ones ESLint ignores while
// the old shell is being replaced) for the textual forms `: any`, `as any`,
// `<any>` and `any[]` outside comments, so nothing slips through a config gap.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.output',
  '.wxt',
  '.expo',
  'coverage',
  'screenshots',
  'fixtures',
  
  
  'docs',
  '.git',
])
const ALLOW = [/\.d\.ts$/]
const PATTERN = /(:\s*any\b|\bas\s+any\b|<any>|\bany\[\])/

// Prototype code scheduled for rewrite (see tools/lint-debt.json). Entries must
// still exist — a retired path must be removed from the list.
const debt = JSON.parse(readFileSync(join(ROOT, 'tools', 'lint-debt.json'), 'utf8'))
const DEBT = debt.entries.map((e) => join(ROOT, e.path))
for (const p of DEBT) {
  if (!existsSync(p)) {
    console.error(
      `no-any: lint-debt entry no longer exists — remove it from tools/lint-debt.json: ${relative(ROOT, p)}`,
    )
    process.exit(1)
  }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (DEBT.some((d) => p === d || p.startsWith(`${d}/`))) continue
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx|mts|cts)$/.test(name) && !ALLOW.some((r) => r.test(name))) yield p
  }
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const hits = []
for (const file of walk(ROOT)) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    if (PATTERN.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
  })
}

if (hits.length) {
  console.error(`no-any: ${hits.length} occurrence(s) of \`any\`:\n` + hits.join('\n'))
  process.exit(1)
}
console.log('no-any: clean')
