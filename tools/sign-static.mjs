/**
 * sign-static — ops tooling for signed statics (master plan §9.4): signs a
 * JSON file with the statics key and writes `<file>.sig` (hex ed25519 over
 * the exact bytes). Run offline; the private key never enters the repo.
 *
 *   STATICS_PRIVATE_KEY=<hex> node tools/sign-static.mjs flags.json
 *   node tools/sign-static.mjs --keygen          # prints a fresh pair
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'packages', 'core', 'package.json'))
const { ed25519 } = require('@noble/curves/ed25519')
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (h) => Uint8Array.from(h.match(/../g).map((x) => Number.parseInt(x, 16)))

if (process.argv.includes('--keygen')) {
  const priv = ed25519.utils.randomPrivateKey()
  console.log(`STATICS_PRIVATE_KEY=${hex(priv)}`)
  console.log(`STATIC_SIGNING_PUBLIC_KEY=${hex(ed25519.getPublicKey(priv))}`)
  process.exit(0)
}
const file = process.argv[2]
const key = process.env.STATICS_PRIVATE_KEY
if (!file || !key) {
  console.error('usage: STATICS_PRIVATE_KEY=<hex> node tools/sign-static.mjs <file.json>')
  process.exit(2)
}
const bytes = await readFile(file)
JSON.parse(bytes.toString('utf8')) // must be JSON
const sig = ed25519.sign(bytes, unhex(key))
await writeFile(`${file}.sig`, hex(sig) + '\n')
console.log(`${file}.sig written (${hex(ed25519.getPublicKey(unhex(key))).slice(0, 16)}…)`)
