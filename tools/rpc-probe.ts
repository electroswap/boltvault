/**
 * rpc-probe — what each registry RPC actually gives us, at the rate a wallet
 * actually asks.
 *
 * The question is not "how many calls can this endpoint take before it breaks"
 * — hammering an endpoint measures the hammer, gets us rate-limited, and tells
 * us nothing about a wallet. The question is "under the load BoltVault really
 * puts on it, does this endpoint answer, how fast, and does it ever refuse?"
 *
 * So the pattern here is the wallet's own: a head poll on the chain's cadence
 * (`pollMs`), and every 30 s the burst a portfolio refresh makes — a native
 * balance and one Multicall3 aggregate for ERC-20 balances. Every chain runs
 * at once, which is the "All chains" scope, the heaviest thing the wallet ever
 * does.
 *
 * Raw `fetch` rather than viem, because the HTTP status is the finding: a 429
 * is a rate limit, a 502 is an outage, and viem turns both into the same
 * thrown error.
 *
 *   pnpm rpc:probe               # 120 s, every chain
 *   pnpm rpc:probe --seconds 60 --chain 52014
 *   pnpm rpc:probe --json
 */
import { ALL_CHAINS, pollMs } from '@boltvault/chains'

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const MULTICALL3_OVERRIDES: Record<number, string> = { 5201420: '0x3F86b2983d92268Ba5601e4424d252795e7ED165' }
/** A public address that holds something almost everywhere — never a user's. */
const PROBE_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
/** How often a portfolio refresh happens while a wallet sits open. */
const BURST_EVERY_MS = 30_000

interface Sample {
  readonly ms: number
  readonly ok: boolean
  /** HTTP status, or 0 for a transport failure. */
  readonly status: number
  readonly note: string
}

interface Probe {
  readonly chainId: number
  readonly chain: string
  readonly url: string
  readonly samples: Sample[]
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback
}

async function call(url: string, method: string, params: unknown[]): Promise<Sample> {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    })
    const ms = Date.now() - started
    if (!res.ok) return { ms, ok: false, status: res.status, note: res.status === 429 ? 'rate limited' : `http ${res.status}` }
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } }
    if (body.error) return { ms, ok: false, status: res.status, note: (body.error.message ?? 'rpc error').slice(0, 60) }
    if (body.result === undefined || body.result === null) return { ms, ok: false, status: res.status, note: 'empty result' }
    return { ms, ok: true, status: res.status, note: method }
  } catch (err) {
    const ms = Date.now() - started
    const note = err instanceof Error ? (err.name === 'TimeoutError' ? 'timeout' : err.message.split('\n')[0] ?? 'error') : 'error'
    return { ms, ok: false, status: 0, note: note.slice(0, 60) }
  }
}

/** Multicall3 `aggregate3` over five `balanceOf` calls — the portfolio read, in one request. */
function multicallData(): string {
  const balanceOf = (owner: string): string => `0x70a08231${owner.slice(2).toLowerCase().padStart(64, '0')}`
  const inner = balanceOf(PROBE_ADDRESS)
  // aggregate3((address,bool,bytes)[]) — hand-encoded so the probe pulls in no ABI machinery.
  const n = 5
  const head = '0x82ad56cb' + (32).toString(16).padStart(64, '0') + n.toString(16).padStart(64, '0')
  const callSize = 32 * 3 + 32 + 64 // target, allowFailure, offset, len, data(36 -> 64)
  let offsets = ''
  let bodies = ''
  for (let i = 0; i < n; i += 1) {
    offsets += (n * 32 + i * callSize).toString(16).padStart(64, '0')
    bodies +=
      MULTICALL3.slice(2).toLowerCase().padStart(64, '0') +
      (1).toString(16).padStart(64, '0') +
      (96).toString(16).padStart(64, '0') +
      (36).toString(16).padStart(64, '0') +
      inner.slice(2).padEnd(128, '0')
  }
  return head + offsets + bodies
}

async function probe(chainId: number, chain: string, url: string, seconds: number): Promise<Probe> {
  const samples: Sample[] = []
  const cadence = pollMs(chainId, 'foreground')
  const mc = MULTICALL3_OVERRIDES[chainId] ?? MULTICALL3
  const data = multicallData()
  const until = Date.now() + seconds * 1_000

  // The endpoint has to say who it is before anything else is worth measuring.
  const id = await call(url, 'eth_chainId', [])
  samples.push(id)
  if (id.ok) {
    // (recorded, but a wrong id is reported separately below)
  }

  let lastBurst = 0
  while (Date.now() < until) {
    const tick = Date.now()
    samples.push(await call(url, 'eth_blockNumber', []))
    if (tick - lastBurst >= BURST_EVERY_MS) {
      lastBurst = tick
      samples.push(await call(url, 'eth_getBalance', [PROBE_ADDRESS, 'latest']))
      samples.push(await call(url, 'eth_call', [{ to: mc, data }, 'latest']))
    }
    const rest = cadence - (Date.now() - tick)
    if (rest > 0) await new Promise((r) => setTimeout(r, rest))
  }
  return { chainId, chain, url, samples }
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
}

function summarise(p: Probe): Record<string, unknown> {
  const ok = p.samples.filter((s) => s.ok)
  const bad = p.samples.filter((s) => !s.ok)
  const latencies = ok.map((s) => s.ms)
  const reasons = new Map<string, number>()
  for (const b of bad) reasons.set(b.note, (reasons.get(b.note) ?? 0) + 1)
  return {
    chainId: p.chainId,
    chain: p.chain,
    url: p.url,
    calls: p.samples.length,
    okPct: p.samples.length ? Math.round((ok.length / p.samples.length) * 1000) / 10 : 0,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: latencies.length ? Math.max(...latencies) : 0,
    rateLimited: bad.filter((b) => b.status === 429).length,
    failures: [...reasons].map(([note, n]) => `${note} x${n}`).join('; '),
  }
}

async function main(): Promise<void> {
  const seconds = Number(arg('seconds', '120'))
  const only = arg('chain', '')
  const json = process.argv.includes('--json')
  const chains = ALL_CHAINS.filter((c) => !only || String(c.chainId) === only)
  const jobs: Array<Promise<Probe>> = []
  for (const c of chains) for (const url of c.rpcUrls) jobs.push(probe(c.chainId, c.shortName, url, seconds))

  if (!json) console.error(`probing ${jobs.length} endpoints across ${chains.length} chains for ${seconds}s at wallet cadence…`)
  const results = (await Promise.all(jobs)).map(summarise)
  results.sort((a, b) => (a.chainId as number) - (b.chainId as number) || (b.okPct as number) - (a.okPct as number) || (a.p50 as number) - (b.p50 as number))

  if (json) {
    console.log(JSON.stringify(results, null, 2))
    return
  }
  const pad = (s: unknown, n: number): string => String(s).padEnd(n)
  console.log(`\n${pad('chain', 9)}${pad('url', 46)}${pad('calls', 7)}${pad('ok%', 7)}${pad('p50', 7)}${pad('p95', 7)}${pad('429', 5)}failures`)
  for (const r of results) {
    console.log(`${pad(r.chain, 9)}${pad(String(r.url).replace('https://', ''), 46)}${pad(r.calls, 7)}${pad(r.okPct, 7)}${pad(r.p50, 7)}${pad(r.p95, 7)}${pad(r.rateLimited, 5)}${r.failures}`)
  }
}

void main()
