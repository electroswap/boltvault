import { describe, expect, it } from 'vitest'
import { CHAINS, ELECTRONEUM_ADDRESSES, requireChain } from '../src/index.js'

/**
 * Live RPC checks — skipped with SKIP_LIVE=1 (offline CI). All URLs in the
 * registry were verified 2026-09-04 (see the design spec rev 7, C3).
 */
const SKIP = process.env.SKIP_LIVE === '1'

async function chainIdFrom(url: string): Promise<number> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    signal: AbortSignal.timeout(8000),
  })
  const json = (await res.json()) as { result?: string; error?: { message: string } }
  if (json.error) throw new Error(json.error.message)
  if (json.result === undefined) throw new Error('no result')
  return Number(json.result)
}

describe.runIf(!SKIP)('live RPC (marked)', () => {
  it('every primary RPC returns its registry chainId', async () => {
    const failures: string[] = []
    for (const c of CHAINS) {
      const primary = c.rpcUrls[0]
      if (!primary) continue
      try {
        const got = await chainIdFrom(primary)
        if (got !== c.chainId) failures.push(`${c.name}: got ${got}, want ${c.chainId}`)
      } catch (e) {
        failures.push(`${c.name}: ${(e as Error).message.slice(0, 80)}`)
      }
    }
    expect(failures).toEqual([])
  }, 60_000)

  it('ETN testnet RPC returns 5201420', async () => {
    expect(await chainIdFrom('https://rpc.ankr.com/electroneum_testnet')).toBe(5201420)
  }, 15_000)

  it('ETN mainnet multicall3 has code', async () => {
    const res = await fetch('https://rpc.ankr.com/electroneum', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getCode',
        params: [ELECTRONEUM_ADDRESSES[52014].multicall3, 'latest'],
      }),
      signal: AbortSignal.timeout(8000),
    })
    const json = (await res.json()) as { result: string }
    expect(json.result.length).toBeGreaterThan(2)
  }, 15_000)
})

describe('requireChain', () => {
  it('returns the chain for a known id', () => {
    expect(requireChain(52014).name).toBe('Electroneum')
  })
  it('throws for unknown id', () => {
    expect(() => requireChain(999)).toThrow('Unknown chain id 999')
  })
})
