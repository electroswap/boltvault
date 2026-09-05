/**
 * abi-sync — copy the ABIs the wallet decodes and encodes against from the
 * ElectroSwap monorepo (the sibling `apps/interface/src/abis` JSONs, which are
 * the ABIs the production web app uses) into `packages/electroswap/abis/`,
 * with a manifest recording the source path and content hash so a drift is a
 * reviewable diff, never a silent change (master plan §3.4 decoder registry).
 *
 * Usage: pnpm abi:sync [--root <ElectroSwap workspace root>]
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const WANTED: Record<string, string> = {
  'yield-farm.json': 'YieldFarm',
  'dividend-distributor.json': 'EsDividendDistributorV2',
  'electric-legends.json': 'ElectricLegends',
  'launchpadAffiliateRewards.json': 'LaunchpadAffiliateRewards',
  'launchpadLpFeeProcessor.json': 'LaunchpadLpFeeProcessor',
  'erc20.json': 'ERC20',
  'erc721.json': 'ERC721',
  'erc1155.json': 'ERC1155',
  'eip_2612.json': 'EIP2612',
}

function findRoot(explicit: string | undefined): string {
  if (explicit) return resolve(explicit)
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'apps', 'interface', 'src', 'abis'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('could not find the ElectroSwap workspace root (apps/interface/src/abis); pass --root')
}

function main(): void {
  const rootIdx = process.argv.indexOf('--root')
  const root = findRoot(rootIdx >= 0 ? process.argv[rootIdx + 1] : undefined)
  const src = join(root, 'apps', 'interface', 'src', 'abis')
  const out = resolve('packages/electroswap/abis')
  mkdirSync(out, { recursive: true })
  const manifest: Record<string, { source: string; sha256: string; functions: number; events: number }> = {}
  for (const [file, name] of Object.entries(WANTED)) {
    const path = join(src, file)
    if (!existsSync(path)) {
      console.warn(`skip ${file} (missing at ${path})`)
      continue
    }
    const raw = readFileSync(path, 'utf8')
    const abi: unknown = JSON.parse(raw)
    if (!Array.isArray(abi)) throw new Error(`${file} is not an ABI array`)
    const items = abi as Array<{ type?: string }>
    const pretty = `${JSON.stringify(abi, null, 2)}\n`
    writeFileSync(join(out, `${name}.json`), pretty)
    manifest[name] = {
      source: `apps/interface/src/abis/${file}`,
      sha256: createHash('sha256').update(pretty).digest('hex'),
      functions: items.filter((i) => i.type === 'function').length,
      events: items.filter((i) => i.type === 'event').length,
    }
    console.log(`synced ${name} (${manifest[name].functions} fns, ${manifest[name].events} events)`)
  }
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

main()
