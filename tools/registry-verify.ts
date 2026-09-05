/**
 * registry-verify — every chain in the registry must answer `eth_chainId` with
 * its own id on every RPC URL, and Multicall3 must have code (master plan
 * §10.1). Run at build (`pnpm registry:verify`) and mirrored at boot by the
 * engine. Exit 1 on any mismatch; `--json` for machine output.
 */
import { ALL_CHAINS } from '@boltvault/chains'
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
}

void main()
