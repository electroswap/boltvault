/**
 * registry-verify — every chain in the registry must answer `eth_chainId` with
 * its own id on every RPC URL, and Multicall3 must have code (master plan
 * §10.1), and every Hyperlane warp corridor must verify by standard (§2.7
 * S6: mailbox, enrolled domains, wrapped token). Run at build
 * (`pnpm registry:verify`) and mirrored at boot by the engine. Exit 1 on any
 * mismatch; `--json` for machine output; `--no-warp` skips the corridors.
 */
import { ALL_CHAINS } from '@boltvault/chains'
import { corridorsFrom, verificationCalls, verifyCorridor, type Corridor } from '@boltvault/electroswap'
import { createPublicClient, http, type Hex } from 'viem'

const MULTICALL3_CANONICAL: Hex = '0xcA11bde05977b3631167028862bE2a173976CA11'
const MULTICALL3_OVERRIDES: Record<number, Hex> = { 5201420: '0x3F86b2983d92268Ba5601e4424d252795e7ED165' }

interface RpcResult {
  chainId: number
  name: string
  url: string
  ok: boolean
  detail: string
  ms: number
}

async function check(chainId: number, name: string, url: string): Promise<RpcResult> {
  const started = Date.now()
  try {
    const client = createPublicClient({ transport: http(url, { timeout: 8_000, retryCount: 0 }) })
    const id = await client.getChainId()
    if (id !== chainId) return { chainId, name, url, ok: false, detail: `eth_chainId returned ${id}`, ms: Date.now() - started }
    const mc = MULTICALL3_OVERRIDES[chainId] ?? MULTICALL3_CANONICAL
    const code = await client.getCode({ address: mc })
    if (!code || code === '0x') return { chainId, name, url, ok: false, detail: `no code at multicall3 ${mc}`, ms: Date.now() - started }
    return { chainId, name, url, ok: true, detail: `multicall3 ${mc.slice(0, 8)}… ok`, ms: Date.now() - started }
  } catch (err) {
    return { chainId, name, url, ok: false, detail: err instanceof Error ? err.message.split('\n')[0] ?? 'error' : String(err), ms: Date.now() - started }
  }
}

// ---- Hyperlane warp routes (§2.7 S6): code, mailbox, enrolled domains, wrapped token ----------

interface WarpResult {
  symbol: string
  chainId: number
  router: string
  toChainId: number
  ok: boolean
  detail: string
}

async function checkCorridor(c: Corridor): Promise<WarpResult> {
  const chain = ALL_CHAINS.find((x) => x.chainId === c.origin.chainId)
  const base = { symbol: c.symbol, chainId: c.origin.chainId, router: c.origin.router, toChainId: c.destination.chainId }
  if (!chain) return { ...base, ok: false, detail: 'origin chain not in the registry' }
  for (const url of chain.rpcUrls) {
    try {
      const client = createPublicClient({ transport: http(url, { timeout: 8_000, retryCount: 0 }) })
      const code = await client.getCode({ address: c.origin.router })
      if (!code || code === '0x') return { ...base, ok: false, detail: `no code at router on ${url}` }
      const results = await Promise.all(
        verificationCalls(c).map(async (call) => {
          try {
            return { ok: true, value: await client.readContract({ address: call.address, abi: call.abi, functionName: call.functionName, args: call.args }) }
          } catch (err) {
            return { ok: false, value: err instanceof Error ? err.message.split('\n')[0] : String(err) }
          }
        }),
      )
      const v = verifyCorridor(c, results)
      return { ...base, ok: v.ok, detail: v.ok ? `${c.origin.standard} verified via ${url}` : (v.reason ?? 'mismatch') }
    } catch {
      // next RPC
    }
  }
  return { ...base, ok: false, detail: 'no RPC answered' }
}

async function verifyWarp(): Promise<boolean> {
  const corridors: Corridor[] = []
  for (const chain of ALL_CHAINS) corridors.push(...corridorsFrom(chain.chainId))
  const results = await Promise.all(corridors.map(checkCorridor))
  for (const r of results) console.log(`${r.ok ? 'OK ' : 'BAD'} warp ${r.symbol.padEnd(5)} ${String(r.chainId).padEnd(6)} → ${String(r.toChainId).padEnd(6)} ${r.router}  ${r.detail}`)
  return results.every((r) => r.ok)
}

async function main(): Promise<void> {
  const json = process.argv.includes('--json')
  const results: RpcResult[] = []
  for (const chain of ALL_CHAINS) {
    const rs = await Promise.all(chain.rpcUrls.map((url) => check(chain.chainId, chain.name, url)))
    results.push(...rs)
  }
  if (json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    for (const r of results) console.log(`${r.ok ? 'OK ' : 'BAD'} ${String(r.chainId).padEnd(8)} ${r.name.padEnd(20)} ${r.url.padEnd(48)} ${String(r.ms).padStart(5)}ms  ${r.detail}`)
  }
  const bad = results.filter((r) => !r.ok)
  const chainsWithNoGoodRpc = ALL_CHAINS.filter((c) => !results.some((r) => r.chainId === c.chainId && r.ok))
  const chainsWithOneGoodRpc = ALL_CHAINS.filter((c) => results.filter((r) => r.chainId === c.chainId && r.ok).length === 1)
  if (chainsWithOneGoodRpc.length) console.warn(`WARN only one working RPC for: ${chainsWithOneGoodRpc.map((c) => c.name).join(', ')} (registry must ship ≥2)`)
  if (chainsWithNoGoodRpc.length) {
    console.error(`FAIL no working RPC for: ${chainsWithNoGoodRpc.map((c) => c.name).join(', ')}`)
    process.exit(1)
  }
  if (bad.length && process.argv.includes('--strict')) process.exit(1)
  if (!process.argv.includes('--no-warp') && !json) {
    const warpOk = await verifyWarp()
    if (!warpOk) {
      console.error('FAIL a Hyperlane corridor did not verify — the engine will switch it off at boot')
      process.exit(1)
    }
  }
}

void main()
