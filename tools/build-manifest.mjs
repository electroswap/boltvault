/**
 * build-manifest — the reproducible-build fingerprint of an extension build
 * (master plan §3.7): a sorted list of every output file with its SHA-256,
 * and one hash over that list. Two builds of the same commit must produce
 * the same top hash; CI builds twice and compares, and the hash is what a
 * release publishes next to the store package.
 *
 *   node tools/build-manifest.mjs [.output/chrome-mv3] [--check <hash>]
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--')) ?? join(root, 'apps', 'extension', '.output', 'chrome-mv3')
const checkIndex = args.indexOf('--check')
const expected = checkIndex >= 0 ? args[checkIndex + 1] : null

async function walk(d) {
  const out = []
  for (const e of await readdir(d)) {
    const p = join(d, e)
    const s = await stat(p)
    if (s.isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out
}

const files = (await walk(dir)).filter((f) => !f.endsWith('.manifest.json')).sort()
const rows = []
for (const f of files) rows.push({ path: relative(dir, f).split('\\').join('/'), sha256: createHash('sha256').update(await readFile(f)).digest('hex') })
rows.sort((a, b) => a.path.localeCompare(b.path))
const top = createHash('sha256').update(rows.map((r) => `${r.sha256}  ${r.path}\n`).join('')).digest('hex')
const manifest = { dir: relative(root, dir), files: rows, sha256: top }
await writeFile(`${dir}.manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
console.log(`${top}  ${relative(root, dir)} (${rows.length} files)`)
if (expected && expected !== top) {
  console.error(`build hash mismatch: expected ${expected}`)
  process.exit(1)
}
