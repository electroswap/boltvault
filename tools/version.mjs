#!/usr/bin/env node
/**
 * One version, checked or set (the release checklist).
 *
 *   node tools/version.mjs            # check: everything agrees with version.json
 *   node tools/version.mjs 1.0.0      # set: rewrite version.json and the copies
 *   node tools/version.mjs 1.0.0 --code 7   # ...and the Android versionCode
 *   node tools/version.mjs --bump     # next patch, and the next versionCode
 *
 * `version.json` at the repo root is the source. Two build configs read it
 * directly and need nothing from this tool — `apps/extension/wxt.config.ts`
 * puts it in the extension manifest, `apps/mobile/app.config.ts` puts it in the
 * Android and iOS ones — which is the whole point: the shipped number cannot
 * drift from the source because it IS the source.
 *
 * What this tool exists for is the handful of places that cannot import a file:
 * the two private `package.json` versions, which npm and pnpm read as text. It
 * writes those on `set`, and on `check` it fails when they have wandered.
 *
 * It also refuses a literal version reappearing in the two config files. That
 * is the failure mode worth naming: someone adds `version: '1.2.0'` back to
 * `wxt.config.ts` because it is right there in the manifest block, the import
 * goes unused, and the extension ships a number nothing else in the repo
 * agrees with. A grep is a cheap way to never have that conversation.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'version.json')

/** The private package.json files that keep a copy for the package manager. */
const COPIES = ['apps/extension/package.json', 'apps/mobile/package.json']

/**
 * Files that read the source and must not also hardcode an answer.
 * `pattern` is what a reintroduced literal looks like there.
 */
const MUST_IMPORT = [
  { file: 'apps/extension/wxt.config.ts', pattern: /version:\s*['"`]\d+\.\d+\.\d+/ },
  { file: 'apps/mobile/app.config.ts', pattern: /version:\s*['"`]\d+\.\d+\.\d+/ },
  // `expo.version` moved to app.config.ts. Left here it would win on any tool
  // that reads app.json directly and lose on every build, which is worse than
  // either being true on its own.
  { file: 'apps/mobile/app.json', pattern: /"version":\s*"\d+\.\d+\.\d+"/ },
]

const SEMVER = /^\d+\.\d+\.\d+$/

/**
 * The next patch release.
 *
 * Patch only, deliberately: this is the every-build number, and a tool that
 * could also move the minor on a flag is a tool that will one day move it by
 * accident. A minor or a major is a decision, and a decision is worth typing
 * out in full — `node tools/version.mjs 0.2.0`.
 */
function nextPatch(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!parts) {
    console.error(`version.json holds "${String(version)}", which is not x.y.z — cannot bump it`)
    process.exit(2)
  }
  return `${parts[1]}.${parts[2]}.${Number(parts[3]) + 1}`
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/** Rewrite one `"version": "…"` in place, so the file keeps its own formatting. */
async function setPackageVersion(path, version) {
  const text = await readFile(path, 'utf8')
  const next = text.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`)
  if (next === text) throw new Error(`${relative(root, path)}: no "version" field to rewrite`)
  await writeFile(path, next)
}

const argv = process.argv.slice(2)
const source = await readJson(SOURCE)

const bump = argv.includes('--bump')
const codeAt = argv.indexOf('--code')
// The value after `--code` is a number, not a version, so it must not be read
// as the positional argument.
const explicit = argv.find((a, i) => !a.startsWith('-') && i !== codeAt + 1)

/*
  `--bump` decides BOTH numbers, so it refuses to share the command line with
  anything that would decide one of them differently. The alternative is a
  precedence rule nobody can remember at the moment they are shipping.
*/
if (bump && explicit !== undefined) {
  console.error(`--bump takes no version (it moves ${source.version} to the next patch); drop one of them`)
  process.exit(2)
}
if (bump && codeAt >= 0) {
  console.error('--bump already moves the versionCode; use the explicit form if you need a particular one')
  process.exit(2)
}

const target = bump ? nextPatch(String(source.version)) : explicit
const wanted = bump ? Number(source.androidVersionCode) + 1 : codeAt >= 0 ? Number(argv[codeAt + 1]) : source.androidVersionCode

if (target !== undefined) {
  const arg = target
  if (!SEMVER.test(arg)) {
    console.error(`Not a version: ${arg} (want x.y.z)`)
    process.exit(2)
  }
  const code = wanted
  if (!Number.isInteger(code) || code < 1) {
    console.error(`Not an Android versionCode: ${String(argv[codeAt + 1])} (want a positive integer)`)
    process.exit(2)
  }
  /*
    Android compares versionCode as an integer and refuses to install an older
    one over a newer; Play refuses an upload that reuses one at all. Catching a
    typo here is much cheaper than catching it in the console.
  */
  if (code < source.androidVersionCode) {
    console.error(`versionCode would go backwards: ${source.androidVersionCode} → ${code}. Android will refuse the update.`)
    process.exit(2)
  }

  const text = await readFile(SOURCE, 'utf8')
  const next = text
    .replace(/("version":\s*")[^"]*(")/, `$1${arg}$2`)
    .replace(/("androidVersionCode":\s*)\d+/, `$1${code}`)
  await writeFile(SOURCE, next)
  for (const copy of COPIES) await setPackageVersion(join(root, copy), arg)

  console.log(`version ${source.version} → ${arg}`)
  if (code !== source.androidVersionCode) console.log(`androidVersionCode ${source.androidVersionCode} → ${code}`)
  console.log(`wrote version.json, ${COPIES.join(', ')}`)
  console.log('The extension and app manifests read version.json directly; nothing else to change.')
  process.exit(0)
}

// --- check ---------------------------------------------------------------
let bad = 0

if (!SEMVER.test(String(source.version))) {
  console.error(`✗ version.json: "${String(source.version)}" is not x.y.z`)
  bad += 1
}
if (!Number.isInteger(source.androidVersionCode) || source.androidVersionCode < 1) {
  console.error(`✗ version.json: androidVersionCode must be a positive integer, got ${String(source.androidVersionCode)}`)
  bad += 1
}

for (const copy of COPIES) {
  const pkg = await readJson(join(root, copy))
  if (pkg.version !== source.version) {
    console.error(`✗ ${copy}: ${String(pkg.version)} ≠ ${source.version} — run \`node tools/version.mjs ${source.version}\``)
    bad += 1
  }
}

for (const { file, pattern } of MUST_IMPORT) {
  const text = await readFile(join(root, file), 'utf8')
  const hit = text.match(pattern)
  if (hit) {
    console.error(`✗ ${file}: a version literal is back (${hit[0].trim()}). It must read version.json instead.`)
    bad += 1
  }
}

if (bad > 0) process.exit(1)
console.log(`✓ version ${source.version} (androidVersionCode ${source.androidVersionCode}) — version.json and every copy agree`)
