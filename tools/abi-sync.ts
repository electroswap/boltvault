/**
 * abi-sync — copy the ABIs the wallet decodes and encodes against out of the
 * ElectroSwap monorepo into `packages/electroswap/abis/`, with a manifest
 * recording the source path and content hash so a drift is a reviewable diff,
 * never a silent change (master plan §3.4 decoder registry).
 *
 * Why this exists at all: `FOT_DETECTOR_ABI` was hand-written with five return
 * fields against a contract that returns two, so the fee-on-transfer probe
 * failed on every token for its entire lifetime while the correct artifact sat
 * unread in the tree. A hand-written signature is a guess about someone else's
 * deployed bytecode; an artifact is the bytecode's own account of itself.
 *
 * Usage: pnpm abi:sync [--root <ElectroSwap workspace root>]
 * The generated TypeScript registry is rebuilt at the end, so the two can
 * never disagree about what was synced.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { generateRegistry } from './abi-registry-gen'

interface Source {
  /** Registry name — the key in the manifest and in the generated module. */
  readonly name: string
  /** Path relative to the ElectroSwap workspace root. */
  readonly from: string
}

/*
  Every contract §3.4 step 1 names, sourced from the artifact closest to the
  deployed bytecode that actually carries an ABI.

  Two of the plan's names have no artifact anywhere in the ElectroSwap
  workspace and stay hand-written in packages/security/src/abis.ts, commented
  there: the Hyperlane warp `TokenRouter` (no Hyperlane code is vendored — §2.7
  S6 pins a registry snapshot, not contracts) and the ERC-2612 `permit`
  function (`eip_2612.json` declares only `DOMAIN_SEPARATOR` and `nonces`).
*/
const SOURCES: readonly Source[] = [
  // Standards.
  { name: 'ERC20', from: 'apps/interface/src/abis/erc20.json' },
  { name: 'ERC721', from: 'apps/interface/src/abis/erc721.json' },
  { name: 'ERC1155', from: 'apps/interface/src/abis/erc1155.json' },
  { name: 'EIP2612', from: 'apps/interface/src/abis/eip_2612.json' },
  { name: 'WETH9', from: 'apps/interface/src/abis/weth.json' },
  /*
    Multicall3 is deployed by a third party at one CREATE2 address on every
    chain, so no ElectroSwap contract source describes it; the indexer's copy
    is the one the ElectroSwap backend already calls in production, and it is
    the full Multicall3 (`aggregate3`, `aggregate3Value`, `getBasefee`).
  */
  { name: 'Multicall3', from: 'services/indexer/abis/multicallAbi.json' },

  // Swap.
  { name: 'UniversalRouter', from: 'contracts/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json' },
  /*
    Permit2's own verification JSON (contracts/electroswap/ElectroSwapV3/
    verifications/13_Permit2_0.8.17.json) is a solc standard-input: sources, no
    ABI. The permit2-sdk ships the compiled ABI for the same 0.8.17 deployment,
    and unlike apps/interface/src/abis/permit2.json — which declares `allowance`
    and nothing else — it has the `approve`, `lockdown` and `invalidateNonces`
    the firewall must be able to read.
  */
  { name: 'Permit2', from: 'sdks/permit2-sdk/abis/Permit2.json' },
  { name: 'FeeOnTransferDetector', from: 'apps/interface/src/abis/fee-on-transfer-detector.json' },
  { name: 'LimitOrders', from: 'apps/interface/src/abis/limit-orders.json' },

  // Marketplace.
  /*
    §2.7 S5 names `contracts/electroswap/Seaport` as the source, but the only
    file there is `verifications/Seaport_0.8.17.json`, a solc standard-input
    that carries the Solidity sources and no compiled ABI. The indexer's
    `seaport15Abi.json` is the compiled ABI of that same deployment — it is
    what the ElectroSwap backend decodes mainnet Seaport logs with — and
    `verifyAgainst` below pins it to the verification sources, so the claim
    "this is the ABI of the contract we deployed" is checked rather than
    asserted. The prototype's fabricated `fulfillBasicOrder(bytes)` is gone:
    the real one takes a `BasicOrderParameters` struct.
  */
  { name: 'Seaport15', from: 'services/indexer/abis/seaport15Abi.json' },

  // Farm, launchpad, lockers.
  { name: 'YieldFarm', from: 'apps/interface/src/abis/yield-farm.json' },
  { name: 'LaunchpadManager', from: 'apps/interface/src/abis/launchpadManager.json' },
  { name: 'LaunchpadPresalePool', from: 'apps/interface/src/abis/launchpadPresalePool.json' },
  { name: 'LaunchpadAffiliateRewards', from: 'apps/interface/src/abis/launchpadAffiliateRewards.json' },
  { name: 'LaunchpadLpFeeProcessor', from: 'apps/interface/src/abis/launchpadLpFeeProcessor.json' },
  { name: 'LockerV2', from: 'apps/interface/src/abis/locker-v2.json' },
  { name: 'LockerV3', from: 'apps/interface/src/abis/locker-v3.json' },

  // NFT.
  { name: 'ElectricLegends', from: 'apps/interface/src/abis/electric-legends.json' },
  { name: 'EsDividendDistributorV2', from: 'apps/interface/src/abis/dividend-distributor.json' },
  { name: 'EsMinterV2', from: 'apps/interface/src/abis/esMinter.json' },
]

/**
 * A compiled ABI is only as trustworthy as its provenance. Where the ABI does
 * not come from the same directory as the deployed contract's sources, pin it
 * to those sources: every external function the interface declares must appear
 * in the ABI, and the ABI must declare no external function the interface does
 * not — which is precisely the check a fabricated `fulfillBasicOrder(bytes)`
 * would have failed.
 */
interface VerifyAgainst {
  /** solc standard-JSON (or any JSON with a `sources` map) in the workspace. */
  readonly standardJson: string
  /** Key inside that `sources` map holding the external interface. */
  readonly sourceKey: string
}

const VERIFY: Readonly<Record<string, VerifyAgainst>> = {
  Seaport15: {
    standardJson: 'contracts/electroswap/Seaport/verifications/Seaport_0.8.17.json',
    sourceKey: 'contracts/Seaport/interfaces/ConsiderationInterface.sol',
  },
}

interface ManifestEntry {
  readonly source: string
  readonly sha256: string
  readonly functions: number
  readonly events: number
  readonly verifiedAgainst?: string
}

interface AbiItem {
  readonly type?: string
  readonly name?: string
  readonly inputs?: ReadonlyArray<unknown>
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

/**
 * Artifacts arrive in two shapes: a bare ABI array (the interface's JSONs, the
 * SDK ABIs) and a Hardhat artifact object with the ABI under `abi`. A solc
 * standard-*input* has neither, and must fail loudly — silently skipping it is
 * how a contract ends up with a hand-written ABI nobody checks.
 */
function abiOf(file: string, raw: unknown): readonly AbiItem[] {
  if (Array.isArray(raw)) return raw as readonly AbiItem[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { abi?: unknown }).abi)) return (raw as { abi: readonly AbiItem[] }).abi
  throw new Error(`${file} carries no ABI (a solc standard-input has sources but no compiled ABI — point at the compiled artifact instead)`)
}

function signature(item: AbiItem): string {
  const types = (item.inputs ?? []).map((i) => typeOf(i))
  return `${item.name ?? ''}(${types.join(',')})`
}

function typeOf(input: unknown): string {
  const i = input as { type?: string; components?: ReadonlyArray<unknown> }
  const t = i.type ?? ''
  if (!t.startsWith('tuple') || !i.components) return t
  return `(${i.components.map((c) => typeOf(c)).join(',')})${t.slice('tuple'.length)}`
}

/** External function signatures declared by a Solidity interface source. */
function interfaceSignatures(source: string): ReadonlySet<string> {
  const out = new Set<string>()
  // Solidity declarations span lines; collapse whitespace and read `function name(args) ... ;`.
  const flat = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  for (const m of flat.matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g)) {
    const name = m[1] ?? ''
    const args = (m[2] ?? '')
      .split(',')
      .map((a) => a.trim().split(/\s+/)[0] ?? '')
      .filter((a) => a.length > 0)
    out.add(`${name}(${args.join(',')})`)
  }
  return out
}

/**
 * The interface source names struct types (`Order`, `bytes32`), the ABI names
 * their expansion (`((address,address,...),bytes)`), so the two cannot be
 * compared word for word. Compare on names and arity, which is what the
 * fee-on-transfer bug and a fabricated overload both get wrong.
 */
function shapeKey(sig: string): string {
  const open = sig.indexOf('(')
  const name = sig.slice(0, open)
  const args = sig.slice(open + 1, sig.lastIndexOf(')'))
  return `${name}/${args.length === 0 ? 0 : splitTop(args).length}`
}

function splitTop(args: string): readonly string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < args.length; i++) {
    const c = args[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      out.push(args.slice(start, i))
      start = i + 1
    }
  }
  out.push(args.slice(start))
  return out
}

function verify(name: string, root: string, abi: readonly AbiItem[], against: VerifyAgainst): void {
  const path = join(root, against.standardJson)
  if (!existsSync(path)) throw new Error(`${name}: verification source missing at ${path}`)
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const sources = (parsed as { sources?: Record<string, { content?: string }> }).sources
  const content = sources?.[against.sourceKey]?.content
  if (!content) throw new Error(`${name}: ${against.standardJson} has no source ${against.sourceKey}`)
  const declared = new Set([...interfaceSignatures(content)].map(shapeKey))
  const shipped = new Set(abi.filter((i) => i.type === 'function').map((i) => shapeKey(signature(i))))
  const missing = [...declared].filter((s) => !shipped.has(s))
  const extra = [...shipped].filter((s) => !declared.has(s))
  if (missing.length || extra.length) {
    throw new Error(`${name}: ABI does not match ${against.sourceKey}\n  only in the interface: ${missing.join(', ') || '(none)'}\n  only in the ABI: ${extra.join(', ') || '(none)'}`)
  }
  console.log(`  verified ${name} against ${against.sourceKey} (${declared.size} external functions)`)
}

function main(): void {
  const rootIdx = process.argv.indexOf('--root')
  const root = findRoot(rootIdx >= 0 ? process.argv[rootIdx + 1] : undefined)
  const out = resolve('packages/electroswap/abis')
  mkdirSync(out, { recursive: true })
  const manifest: Record<string, ManifestEntry> = {}
  for (const { name, from } of SOURCES) {
    const path = join(root, from)
    if (!existsSync(path)) {
      console.warn(`skip ${name} (missing at ${path})`)
      continue
    }
    const abi = abiOf(from, JSON.parse(readFileSync(path, 'utf8')))
    const against = VERIFY[name]
    if (against) verify(name, root, abi, against)
    const pretty = `${JSON.stringify(abi, null, 2)}\n`
    writeFileSync(join(out, `${name}.json`), pretty)
    manifest[name] = {
      source: from,
      sha256: createHash('sha256').update(pretty).digest('hex'),
      functions: abi.filter((i) => i.type === 'function').length,
      events: abi.filter((i) => i.type === 'event').length,
      ...(against ? { verifiedAgainst: against.standardJson } : {}),
    }
    const e = manifest[name]
    console.log(`synced ${name} (${e.functions} fns, ${e.events} events)`)
  }
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  generateRegistry()
}

main()
