/**
 * Measurement probe (P0) — the instrument the design loop never had.
 *
 * Unlike shot.spec/screens.spec, this drives the REAL popup (popup.html against
 * the real service worker and the real API), not harness.html against the
 * offline fixture engine. That distinction is the point: the fixture harness
 * forces a 400x600 viewport and never loads the popup's own sizing rules, so it
 * is structurally incapable of seeing request storms or the width ratchet.
 *
 * Records, per screen: JSON-RPC calls by method, GraphQL calls by operation
 * name, static-asset requests, and the document's scroll width.
 *
 *   PROBE=1 PROBE_OUT=/tmp/probe-before.json \
 *     pnpm exec playwright test e2e/probe.spec.ts
 */
import { test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchWithExtension } from './extension'
import { createVault, engineCall } from './flows'

const OUT = process.env['PROBE_OUT'] ?? '/tmp/boltvault-probe.json'
const WATCH = process.env['PROBE_ADDRESS'] ?? ''
/**
 * Where to write a screenshot per step. Owner: "Apparently you're using a mock
 * API to do testing and your screenshots. I want the real API to be used."
 * These shots are the real popup, the real service worker and the real API —
 * not harness.html against the offline fixture engine — so they are the ones
 * to look at when the question is what the product actually does.
 */
const SHOT_DIR = process.env['PROBE_SHOTS'] ?? ''

test.skip(process.env['PROBE'] !== '1', 'PROBE is unset')

interface Tally {
  rpc: Record<string, number>
  graphql: Record<string, number>
  static: number
  /** JSON-RPC methods asked for. */
  rpcTotal: number
  /** HTTP POSTs actually sent — what devtools shows, and what batching cuts. */
  rpcPosts: number
  graphqlTotal: number
}

interface Snapshot extends Tally {
  step: string
  scrollWidth: number
  clientWidth: number
}

function emptyTally(): Tally {
  return { rpc: {}, graphql: {}, static: 0, rpcTotal: 0, rpcPosts: 0, graphqlTotal: 0 }
}

/** Classify by body shape, not URL — RPC hosts vary with the failover pool. */
function classify(tally: Tally, url: string, body: string | null): void {
  if (url.includes('static.electroswap.io')) {
    tally.static += 1
    return
  }
  if (body === null || body === '') return
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed]
  let isRpc = false
  for (const call of calls) {
    if (typeof call !== 'object' || call === null) continue
    const rec = call as Record<string, unknown>
    const method = rec['method']
    if (typeof method === 'string' && 'jsonrpc' in rec) {
      tally.rpc[method] = (tally.rpc[method] ?? 0) + 1
      tally.rpcTotal += 1
      isRpc = true
      continue
    }
    const query = rec['query']
    if (typeof query === 'string') {
      const named = rec['operationName']
      const match = /(?:query|mutation)\s+(\w+)/.exec(query)
      const name = typeof named === 'string' && named !== '' ? named : (match?.[1] ?? 'anonymous')
      tally.graphql[name] = (tally.graphql[name] ?? 0) + 1
      tally.graphqlTotal += 1
    }
  }
  if (isRpc) tally.rpcPosts += 1
}

test('probe', async () => {
  test.setTimeout(300_000)
  const ext = await launchWithExtension()
  const snapshots: Snapshot[] = []
  let tally = emptyTally()

  ext.context.on('request', (req) => {
    if (req.method() !== 'POST' && !req.url().includes('static.electroswap.io')) return
    classify(tally, req.url(), req.postData())
  })

  const { tab } = await createVault(ext)
  if (WATCH !== '') await engineCall(tab, 'accounts', 'addWatch', { address: WATCH, label: 'Probe' })
  await tab.close()

  if (SHOT_DIR !== '') await mkdir(SHOT_DIR, { recursive: true })
  const popup = await ext.context.newPage()
  await popup.setViewportSize({ width: 400, height: 600 })

  // Each step: act, let the screen settle, record, then reset the tally.
  const record = async (step: string): Promise<void> => {
    await popup.waitForTimeout(4_000)
    const size = await popup.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    if (SHOT_DIR !== '') await popup.screenshot({ path: join(SHOT_DIR, `${step.replace(/[:]/g, '-')}.png`) })
    snapshots.push({ step, ...tally, ...size })
    tally = emptyTally()
  }

  await popup.goto(ext.url('popup.html'))
  await record('open:home')

  for (const name of ['swap', 'activity', 'home'] as const) {
    await popup
      .getByTestId(`tab-${name}`)
      .click({ timeout: 15_000 })
      .catch(() => undefined)
    await record(`tab:${name}`)
  }

  const report = {
    at: new Date().toISOString(),
    steps: snapshots,
    totals: {
      rpc: snapshots.reduce((n, s) => n + s.rpcTotal, 0),
      rpcPosts: snapshots.reduce((n, s) => n + s.rpcPosts, 0),
      graphql: snapshots.reduce((n, s) => n + s.graphqlTotal, 0),
      maxScrollWidth: Math.max(...snapshots.map((s) => s.scrollWidth)),
    },
  }
  await writeFile(OUT, JSON.stringify(report, null, 2))
  for (const s of snapshots) {
    const rpc = Object.entries(s.rpc)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ')
    const gql = Object.entries(s.graphql)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ')
    console.log(`\n[${s.step}] width ${s.scrollWidth}/${s.clientWidth}  rpc ${s.rpcTotal} in ${s.rpcPosts} posts  gql ${s.graphqlTotal}`)
    if (rpc !== '') console.log(`  rpc: ${rpc}`)
    if (gql !== '') console.log(`  gql: ${gql}`)
  }
  console.log(`\nwrote ${OUT}`)
  await ext.context.close()
})
