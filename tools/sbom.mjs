/**
 * sbom — a CycloneDX 1.5 JSON bill of materials from pnpm-lock.yaml (master
 * plan §3.7): every resolved package with its version, purl and the
 * lockfile's integrity hash, plus the workspace packages. No network; the
 * lockfile is the truth CI installs from.
 *
 *   node tools/sbom.mjs [out.json]
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lock = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')
const out = process.argv[2] ?? join(root, 'sbom.cdx.json')

// The lockfile's `packages:` section: keys are `name@version` (scoped names keep their slash), each with a resolution integrity.
const section = lock.split(/^packages:\s*$/m)[1]?.split(/^[a-zA-Z]+:\s*$/m)[0] ?? ''
const entries = [...section.matchAll(/^ {2}'?([^'\n]+?)'?:\n((?: {4}.*\n?)*)/gm)]
const components = []
for (const [, key, body] of entries) {
  const at = key.lastIndexOf('@')
  if (at <= 0) continue
  const name = key.slice(0, at)
  const version = key.slice(at + 1).split('(')[0]
  const integrity = /integrity:\s*(sha\d+-[A-Za-z0-9+/=]+)/.exec(body)?.[1]
  const hashes = []
  if (integrity) {
    const [alg, b64] = integrity.split('-')
    hashes.push({ alg: alg.toUpperCase().replace('SHA', 'SHA-'), content: Buffer.from(b64, 'base64').toString('hex') })
  }
  components.push({ type: 'library', name, version, purl: `pkg:npm/${name.startsWith('@') ? name.replace('/', '%2F') : name}@${version}`, hashes, scope: 'required' })
}
components.sort((a, b) => a.purl.localeCompare(b.purl))

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const lockHash = createHash('sha256').update(lock).digest('hex')
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${lockHash.slice(0, 8)}-${lockHash.slice(8, 12)}-4${lockHash.slice(13, 16)}-8${lockHash.slice(17, 20)}-${lockHash.slice(20, 32)}`,
  version: 1,
  metadata: {
    timestamp: new Date(Number(process.env.SOURCE_DATE_EPOCH ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    tools: [{ vendor: 'ElectroSwap', name: 'boltvault-sbom', version: '1' }],
    component: { type: 'application', name: pkg.name, version: pkg.version, purl: `pkg:npm/${pkg.name}@${pkg.version}` },
    properties: [{ name: 'boltvault:lockfile-sha256', value: lockHash }],
  },
  components,
}
await writeFile(out, JSON.stringify(bom, null, 2) + '\n')
console.log(`sbom: ${components.length} components → ${out}`)
