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

/*
  A store package is not "whatever is in the output directory" (ES-BV-044).

  `zip:chrome` zipped whatever happened to be there — including a harness
  build, which carries a scripted engine and a fixture vault — and the two
  scripts were not wired to `build:release`. Three refusals, each of them a
  thing that has actually shipped from somebody's wallet repository before:
  a development harness, a development API origin, and a package nobody can
  reproduce.
*/
const harness = files.filter((f) => /(^|\/)harness/.test(f))
if (harness.length) {
  console.error(`Refusing to package: this build contains the development harness (${harness[0]}).`)
  console.error('Build with `pnpm build:release` (BOLTVAULT_HARNESS=0) before packaging.')
  process.exit(1)
}

/*
  The API origin is compiled in, so a package built from a developer's `.env`
  can point the wallet at localhost. Grep the bundle rather than trust the
  environment of whoever is running this.
*/
/*
  Hosts the gate must ignore, because they are not origins the wallet talks to.

  The grep matched any quoted `http://` string, which in a bundle means every
  XML namespace an SVG or a DOM helper carries — `http://www.w3.org/2000/svg`
  is in almost every build. A gate that fires on those is a gate somebody turns
  off (ES-BV-044).
*/
const NOT_AN_ORIGIN = /^https?:\/\/(www\.w3\.org|www\.inkscape\.org|purl\.org|ns\.adobe\.com|schemas\.|creativecommons\.org|sodipodi\.sourceforge\.net|xmlns\.)/i

// Nor are these anywhere a request can go: the http match pattern out of our
// own manifest's content_scripts, and a bare scheme that something tests a
// string against. (Line comments on purpose — the pattern ends in `*` `/`,
// which closes a block comment.)
const NOT_A_REQUEST = new Set(['http://', 'http://*/*'])

/*
  Four cleartext strings that are neither ours nor reachable, and that stopped
  every store package from being built at all.

  @trezor/connect-webextension is bundled in and carries its own development
  constants: ports 8000 and 8088 sit in the list of origins its popup accepts
  messages from, and `getSuiteUrl()` compares `connectSrc` against the bare
  `http://localhost` before falling back to a Trezor host. The wallet never sets
  `connectSrc`, so that branch cannot be taken, and the two ports are upstream's
  own dev servers.

  Excused by exact string, and only while Trezor's own origin list is still in
  the same file — so the exemption leaves when the dependency does, rather than
  outliving it as a hole. `http://localhost:4000` (services/api) and
  `http://localhost:3007` (services/quoter-api) — the two this gate exists to
  catch, because `.env` can bake either into the bundle — still fail, as does
  any other host or port.
*/
const TREZOR_DEV_ORIGINS = new Set(['http://localhost', 'http://localhost:8000', 'http://localhost:8000/connect-popup', 'http://localhost:8088'])
const TREZOR_MARKER = 'https://connect.trezor.io'

for (const name of files) {
  if (!name.endsWith('.js')) continue
  const text = await readFile(join(dir, name), 'utf8')
  const trezor = text.includes(TREZOR_MARKER)
  // Unquoted as well as quoted: a concatenated origin is still an origin, and
  // the quoted-only match was why `127.0.0.1` needed its own substring check
  // standing beside it.
  for (const m of text.matchAll(/http:\/\/[^\s"'`)\\,;<>]*/g)) {
    const url = m[0]
    if (NOT_AN_ORIGIN.test(url) || NOT_A_REQUEST.has(url)) continue
    if (trezor && TREZOR_DEV_ORIGINS.has(url)) continue
    const hint = /localhost|127\.0\.0\.1/.test(url) ? ' Build with a production WXT_BOLTVAULT_API.' : ''
    console.error(`Refusing to package: ${name} carries a cleartext origin ${url}.${hint}`)
    process.exit(1)
  }
}

/*
  The fixture engine must not be in the bundle either (ES-BV-044).

  It moved behind its own package entry so only the harness imports it, but
  "only the harness imports it" is a property of the import graph on the day
  it was checked. The fixture vault's password is a string nothing else in the
  wallet contains, so the bundle itself can be asked.
*/
const FIXTURE_MARKERS = [/fixtureEngine/, /createFixtureEngine/]
for (const name of files) {
  if (!name.endsWith('.js')) continue
  const text = await readFile(join(dir, name), 'utf8')
  const hit = FIXTURE_MARKERS.find((re) => re.test(text))
  if (hit) {
    console.error(`Refusing to package: ${name} carries the fixture engine (${String(hit)}).`)
    console.error('Build with `pnpm build:release`; the fixtures entry is for the harness only.')
    process.exit(1)
  }
}

/*
  And it must be the build the manifest describes. `build:repro` writes
  `build-manifest.json` beside the output; without it there is nothing to
  compare a published package against.
*/
const manifestPath = `${dir}.manifest.json`
let recorded
try {
  recorded = JSON.parse(await readFile(manifestPath, 'utf8'))
} catch {
  console.error(`Refusing to package: no reproducible-build manifest at ${relative(root, manifestPath)}.`)
  console.error('Run `pnpm build:repro` so the package can be checked against a manifest.')
  process.exit(1)
}

/*
  And it must describe *this* tree, not some earlier one (ES-BV-044).

  The check was presence-only, so a manifest left behind by a previous build
  satisfied it while the directory being zipped had moved on — which is the
  one thing a reproducible-build manifest exists to rule out. The hashes are
  recomputed here, the same way `build-manifest.mjs` computes them.
*/
{
  const rows = []
  for (const name of files) {
    rows.push({ path: name, sha256: createHash('sha256').update(await readFile(join(dir, name))).digest('hex') })
  }
  rows.sort((a, b) => a.path.localeCompare(b.path))
  const top = createHash('sha256').update(rows.map((r) => `${r.sha256}  ${r.path}\n`).join('')).digest('hex')
  if (recorded?.sha256 !== top) {
    console.error(`Refusing to package: ${relative(root, manifestPath)} describes a different build.`)
    console.error(`  manifest: ${String(recorded?.sha256)}`)
    console.error(`  on disk:  ${top}`)
    console.error('Run `pnpm build:repro` so the manifest and the output are the same build.')
    process.exit(1)
  }
}
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
