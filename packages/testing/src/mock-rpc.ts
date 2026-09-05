/**
 * A tiny JSON-RPC server for tests: answers the handful of methods the wallet
 * uses from an in-memory chain state, records every request, and lets a test
 * script failures (timeouts, 429s) to exercise failover and degraded modes.
 *
 * Not a simulator: `eth_call` dispatches to handlers registered per
 * `(to, selector)` so a test can stub `balanceOf`, `allowance`, multicall3
 * `aggregate3`, etc. without a real EVM.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi, parseTransaction, recoverTransactionAddress, type Hex } from 'viem'

export interface RpcRequest {
  readonly id: number | string | null
  readonly method: string
  readonly params: readonly unknown[]
}

export type CallHandler = (args: { to: Hex; data: Hex; from?: Hex }) => Hex | Promise<Hex>

export interface MockChainState {
  chainId: number
  blockNumber: bigint
  balances: Map<string, bigint>
  /** Contract code by lowercase address; the sentinel 'multicall3' marks a Multicall3 the mock emulates. */
  code: Map<string, Hex | 'multicall3'>
  gasPrice: bigint
  /** Base fee per gas reported on blocks; 0 makes the wallet fall back to legacy pricing (Electroneum-like). */
  baseFeePerGas: bigint
  /** Override answers for arbitrary methods. */
  methods: Map<string, (params: readonly unknown[]) => unknown | Promise<unknown>>
  /** eth_call handlers keyed by lowercase `to`. */
  calls: Map<string, CallHandler>
  /** Nonces by lowercase address. */
  nonces: Map<string, number>
  /** Raw transactions accepted by eth_sendRawTransaction, mined on the next advanceBlocks(). */
  transactions: Map<string, { raw: Hex; from: string; to: string | null; value: bigint; nonce: number; blockNumber: bigint | null; status: 0 | 1 }>
}

export interface MockRpc {
  readonly url: string
  readonly state: MockChainState
  readonly requests: RpcRequest[]
  /** Make the next N requests fail with the given HTTP status (429/500) or hang. */
  fail(opts: { times: number; status?: number; hangMs?: number }): void
  advanceBlocks(n?: number): void
  close(): Promise<void>
}

const MULTICALL3_ABI = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
])

function hex(n: bigint): Hex {
  return `0x${n.toString(16)}`
}

function jsonError(id: RpcRequest['id'], code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export async function startMockRpc(init: Partial<Pick<MockChainState, 'chainId' | 'blockNumber' | 'gasPrice' | 'baseFeePerGas'>> & { port?: number } = {}): Promise<MockRpc> {
  const state: MockChainState = {
    chainId: init.chainId ?? 5201420,
    blockNumber: init.blockNumber ?? 1_000_000n,
    balances: new Map(),
    code: new Map(),
    gasPrice: init.gasPrice ?? 1_000_000_000n,
    baseFeePerGas: init.baseFeePerGas ?? 0n,
    methods: new Map(),
    calls: new Map(),
    nonces: new Map(),
    transactions: new Map(),
  }
  const requests: RpcRequest[] = []
  let failPlan: { times: number; status: number; hangMs: number } | null = null

  const ethCall = async (params: readonly unknown[]): Promise<Hex> => {
    const tx = params[0] as { to?: Hex; data?: Hex; from?: Hex } | undefined
    if (!tx?.to || !tx.data) throw new Error('eth_call: missing to/data')
    const to = tx.to.toLowerCase()
    const handler = state.calls.get(to)
    if (handler) return handler({ to: tx.to, data: tx.data, from: tx.from })
    // Multicall3 (any address a test registered as multicall) — recurse per call.
    if (state.code.get(to) === 'multicall3') {
      const decoded = decodeFunctionData({ abi: MULTICALL3_ABI, data: tx.data })
      const calls = decoded.args[0]
      const results: Array<{ success: boolean; returnData: Hex }> = []
      for (const c of calls) {
        try {
          const r = await ethCall([{ to: c.target, data: c.callData }])
          results.push({ success: true, returnData: r })
        } catch {
          if (!c.allowFailure) throw new Error('multicall: call failed')
          results.push({ success: false, returnData: '0x' })
        }
      }
      return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: 'aggregate3', result: results })
    }
    return '0x'
  }

  const handle = async (req: RpcRequest): Promise<unknown> => {
    requests.push(req)
    const custom = state.methods.get(req.method)
    if (custom) return { jsonrpc: '2.0', id: req.id, result: await custom(req.params) }
    switch (req.method) {
      case 'eth_chainId':
        return { jsonrpc: '2.0', id: req.id, result: hex(BigInt(state.chainId)) }
      case 'net_version':
        return { jsonrpc: '2.0', id: req.id, result: String(state.chainId) }
      case 'eth_blockNumber':
        return { jsonrpc: '2.0', id: req.id, result: hex(state.blockNumber) }
      case 'eth_gasPrice':
        return { jsonrpc: '2.0', id: req.id, result: hex(state.gasPrice) }
      case 'eth_getBalance': {
        const addr = String(req.params[0]).toLowerCase()
        return { jsonrpc: '2.0', id: req.id, result: hex(state.balances.get(addr) ?? 0n) }
      }
      case 'eth_getCode': {
        const addr = String(req.params[0]).toLowerCase()
        const code = state.code.get(addr)
        return { jsonrpc: '2.0', id: req.id, result: code === undefined ? '0x' : code === 'multicall3' ? '0x60' : code }
      }
      case 'eth_call':
        try {
          return { jsonrpc: '2.0', id: req.id, result: await ethCall(req.params) }
        } catch (err) {
          return jsonError(req.id, 3, err instanceof Error ? err.message : 'execution reverted')
        }
      case 'eth_estimateGas': {
        const tx = req.params[0] as { to?: Hex; data?: Hex } | undefined
        const plain = !tx?.data || tx.data === '0x'
        if (!plain && tx?.to && state.code.get(tx.to.toLowerCase()) === undefined && !state.calls.has(tx.to.toLowerCase())) {
          return jsonError(req.id, 3, 'execution reverted: no code at address')
        }
        return { jsonrpc: '2.0', id: req.id, result: hex(plain ? 21_000n : 60_000n) }
      }
      case 'eth_getTransactionCount': {
        const addr = String(req.params[0]).toLowerCase()
        return { jsonrpc: '2.0', id: req.id, result: hex(BigInt(state.nonces.get(addr) ?? 0)) }
      }
      case 'eth_maxPriorityFeePerGas':
        return { jsonrpc: '2.0', id: req.id, result: hex(1_000_000_000n) }
      case 'eth_feeHistory':
        return { jsonrpc: '2.0', id: req.id, result: { oldestBlock: hex(state.blockNumber), baseFeePerGas: [hex(state.baseFeePerGas), hex(state.baseFeePerGas)], gasUsedRatio: [0.5], reward: [[hex(1_000_000_000n)]] } }
      case 'eth_getBlockByNumber':
      case 'eth_getBlockByHash':
        return { jsonrpc: '2.0', id: req.id, result: { number: hex(state.blockNumber), hash: `0x${'ab'.repeat(32)}`, parentHash: `0x${'00'.repeat(32)}`, timestamp: hex(BigInt(Math.floor(Date.now() / 1000))), gasLimit: hex(30_000_000n), gasUsed: hex(0n), baseFeePerGas: hex(state.baseFeePerGas), transactions: [] } }
      case 'eth_sendRawTransaction': {
        const raw = String(req.params[0]) as Hex
        const parsed = parseTransaction(raw)
        const from = parsed.type !== undefined && 'r' in parsed ? await recoverTransactionAddress({ serializedTransaction: raw as never }) : '0x0000000000000000000000000000000000000000'
        const txHash = keccak256(raw)
        const nonce = Number(parsed.nonce ?? 0)
        const expected = state.nonces.get(from.toLowerCase()) ?? 0
        if (nonce < expected) return jsonError(req.id, -32000, 'nonce too low')
        state.nonces.set(from.toLowerCase(), nonce + 1)
        state.transactions.set(txHash, { raw, from, to: parsed.to ?? null, value: parsed.value ?? 0n, nonce, blockNumber: null, status: 1 })
        return { jsonrpc: '2.0', id: req.id, result: txHash }
      }
      case 'eth_getTransactionReceipt': {
        const t = state.transactions.get(String(req.params[0]))
        if (!t || t.blockNumber === null) return { jsonrpc: '2.0', id: req.id, result: null }
        return { jsonrpc: '2.0', id: req.id, result: { transactionHash: req.params[0], blockNumber: hex(t.blockNumber), blockHash: `0x${'cd'.repeat(32)}`, from: t.from, to: t.to, status: t.status === 1 ? '0x1' : '0x0', gasUsed: hex(21_000n), effectiveGasPrice: hex(state.gasPrice), logs: [], logsBloom: `0x${'00'.repeat(256)}`, cumulativeGasUsed: hex(21_000n), type: '0x0' } }
      }
      case 'eth_getTransactionByHash': {
        const t = state.transactions.get(String(req.params[0]))
        if (!t) return { jsonrpc: '2.0', id: req.id, result: null }
        return { jsonrpc: '2.0', id: req.id, result: { hash: req.params[0], from: t.from, to: t.to, value: hex(t.value), nonce: hex(BigInt(t.nonce)), blockNumber: t.blockNumber === null ? null : hex(t.blockNumber), input: '0x' } }
      }
      case 'eth_getLogs':
        return { jsonrpc: '2.0', id: req.id, result: [] }
      default:
        return jsonError(req.id, -32601, `Method not found: ${req.method}`)
    }
  }

  const server: Server = createServer((inc: IncomingMessage, res: ServerResponse) => {
    let body = ''
    inc.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    inc.on('end', () => {
      void (async () => {
        if (failPlan && failPlan.times > 0) {
          failPlan.times -= 1
          if (failPlan.hangMs > 0) await new Promise((r) => setTimeout(r, failPlan?.hangMs ?? 0))
          res.writeHead(failPlan.status, { 'content-type': 'text/plain' })
          res.end('mock failure')
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(body)
        } catch {
          res.writeHead(400)
          res.end()
          return
        }
        const batch = Array.isArray(parsed)
        const list = (batch ? parsed : [parsed]) as Array<{ id?: RpcRequest['id']; method: string; params?: unknown[] }>
        const answers = await Promise.all(list.map((r) => handle({ id: r.id ?? null, method: r.method, params: r.params ?? [] })))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(batch ? answers : answers[0]))
      })()
    })
  })

  await new Promise<void>((resolve) => server.listen(init.port ?? 0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    state,
    requests,
    fail: (opts) => {
      failPlan = { times: opts.times, status: opts.status ?? 500, hangMs: opts.hangMs ?? 0 }
    },
    advanceBlocks: (n = 1) => {
      state.blockNumber += BigInt(n)
      for (const t of state.transactions.values()) {
        if (t.blockNumber === null) {
          t.blockNumber = state.blockNumber
          const from = t.from.toLowerCase()
          state.balances.set(from, (state.balances.get(from) ?? 0n) - t.value)
          if (t.to) state.balances.set(t.to.toLowerCase(), (state.balances.get(t.to.toLowerCase()) ?? 0n) + t.value)
        }
      }
    },
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }
}
