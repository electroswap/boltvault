import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPublicClient, encodeFunctionData, encodeFunctionResult, http, parseAbi } from 'viem'
import { startMockRpc, type MockRpc } from '../src/mock-rpc'
import { serveFixture, type FixtureServer } from '../src/fixture-server'

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)'])
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11'
const TOKEN = '0x0000000000000000000000000000000000000abc'

describe('mock rpc', () => {
  let rpc: MockRpc
  beforeAll(async () => {
    rpc = await startMockRpc({ chainId: 52014, blockNumber: 15_000_000n })
    rpc.state.balances.set('0x00000000000000000000000000000000000000aa', 5n * 10n ** 18n)
    rpc.state.code.set(MULTICALL, 'multicall3')
    rpc.state.calls.set(TOKEN, ({ data }) => {
      if (data.startsWith('0x70a08231')) return encodeFunctionResult({ abi: ERC20, functionName: 'balanceOf', result: 42n })
      throw new Error('unknown selector')
    })
  })
  afterAll(() => rpc.close())

  it('answers chain id, block number, balances, and multicall3 aggregate3', async () => {
    const client = createPublicClient({ transport: http(rpc.url), cacheTime: 0 })
    expect(await client.getChainId()).toBe(52014)
    expect(await client.getBlockNumber()).toBe(15_000_000n)
    rpc.advanceBlocks(2)
    expect(await client.getBlockNumber()).toBe(15_000_002n)
    expect(await client.getBalance({ address: '0x00000000000000000000000000000000000000aa' })).toBe(5n * 10n ** 18n)
    const bal = await client.readContract({ address: TOKEN, abi: ERC20, functionName: 'balanceOf', args: ['0x00000000000000000000000000000000000000aa'] })
    expect(bal).toBe(42n)
    const results = await client.multicall({
      multicallAddress: MULTICALL,
      allowFailure: true,
      contracts: [
        { address: TOKEN, abi: ERC20, functionName: 'balanceOf', args: ['0x00000000000000000000000000000000000000aa'] },
        { address: '0x0000000000000000000000000000000000000def', abi: ERC20, functionName: 'balanceOf', args: ['0x00000000000000000000000000000000000000aa'] },
      ],
    })
    expect(results[0]).toEqual({ status: 'success', result: 42n })
    expect(results[1]?.status).toBe('failure')
    expect(rpc.requests.some((r) => r.method === 'eth_call')).toBe(true)
    void encodeFunctionData
  })

  it('can fail on demand', async () => {
    rpc.fail({ times: 1, status: 429 })
    const client = createPublicClient({ transport: http(rpc.url, { retryCount: 0 }) })
    await expect(client.getBlockNumber()).rejects.toThrow()
    expect(await client.getBlockNumber()).toBeGreaterThan(0n)
  })
})

describe('fixture server', () => {
  let fx: FixtureServer
  beforeAll(async () => {
    fx = await serveFixture()
  })
  afterAll(() => fx.close())

  it('serves the dApp over http and blocks traversal', async () => {
    const html = await (await fetch(fx.url)).text()
    expect(html).toContain('BoltVault fixture dApp')
    const js = await fetch(`${fx.url}dapp.js`)
    expect(js.headers.get('content-type')).toContain('javascript')
    expect((await fetch(`${fx.url}../package.json`)).status).not.toBe(200)
  })
})
