#!/usr/bin/env node
/**
 * Package a built extension for a store upload (the release checklist):
 *
 *   node tools/zip-store.mjs chrome    → apps/extension/.output/boltvault-chrome-<version>.zip
 *   node tools/zip-store.mjs firefox   → apps/extension/.output/boltvault-firefox-<version>.zip
 *
 * The zip is the build directory byte for byte, with one exception: `key` is
 * dropped from manifest.json. That field pins the extension id for unpacked
 * (developer) loads only; the Chrome Web Store assigns and keeps its own key
 * pair, so an upload must not carry one. Entries are sorted and carry a fixed
 * timestamp, so the same build always zips to the same hash — the hash printed
 * here is what goes in the release notes next to the build manifest.
 *
 * No dependencies: a minimal ZIP writer (deflate, one central directory).
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const browser = process.argv[2] ?? 'chrome'
if (browser !== 'chrome' && browser !== 'firefox') {
  console.error('usage: node tools/zip-store.mjs [chrome|firefox]')
  process.exit(2)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'apps/extension/.output', `${browser}-mv3`)

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

/** DOS date/time for 2026-01-01 00:00:00 — any fixed value keeps the archive reproducible. */
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1
const DOS_TIME = 0

function u16(n) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n)
  return b
}
function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0)
  return b
}

let manifest
try {
  manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
} catch {
  console.error(`No build at ${relative(root, dir)} — run \`pnpm --filter @boltvault/extension build${browser === 'firefox' ? ':firefox' : ''}\` first.`)
  process.exit(1)
}
const version = String(manifest.version)
const hadKey = 'key' in manifest
delete manifest.key

const files = (await walk(dir)).map((p) => relative(dir, p).split('\\').join('/')).sort()
const locals = []
const centrals = []
let offset = 0
for (const name of files) {
  const data = name === 'manifest.json' ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n') : await readFile(join(dir, name))
  const packed = deflateRawSync(data, { level: 9 })
  const crc = crc32(data)
  const nameBuf = Buffer.from(name, 'utf8')
  const head = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(packed.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf])
  locals.push(head, packed)
  centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(packed.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf]))
  offset += head.length + packed.length
}
const central = Buffer.concat(centrals)
const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)])
const zip = Buffer.concat([...locals, central, eocd])

const out = join(root, 'apps/extension/.output', `boltvault-${browser}-${version}.zip`)
await writeFile(out, zip)
const sha = createHash('sha256').update(zip).digest('hex')
console.log(relative(root, out))
console.log(`${files.length} files · ${(zip.length / 1024).toFixed(0)} KB · manifest key ${hadKey ? 'stripped' : 'absent'} · version ${version}`)
console.log(`sha256 ${sha}`)
