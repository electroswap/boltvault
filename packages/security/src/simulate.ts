/**
 * Simulation (master plan §3.4 step 2). On Electroneum the source is a
 * `debug_traceCall` (callTracer, withLog) against the ElectroSwap trace node,
 * reached through `POST /api/wallet/trace` because that node is not on the
 * public internet; elsewhere `eth_simulateV1` where it exists; everywhere
 * `eth_estimateGas` as the revert check. This module turns a trace into
 * balance deltas — it never talks to the network itself.
 */
import { decodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { TOPICS } from './abis'
import type { ApprovalDelta, AssetDelta, Simulation } from './types'

export interface TraceLog {
  readonly address: Hex
  readonly topics: readonly Hex[]
  readonly data: Hex
}

/** The callTracer frame shape (`withLog: true`). */
export interface TraceFrame {
  readonly type?: string
  readonly from?: Hex
  readonly to?: Hex
  readonly value?: Hex
  readonly error?: string
  readonly revertReason?: string
  readonly gasUsed?: Hex
  readonly logs?: readonly TraceLog[]
  readonly calls?: readonly TraceFrame[]
}

function topicAddress(topic: Hex | undefined): Hex | null {
  if (!topic || topic.length !== 66) return null
  return `0x${topic.slice(26)}` as Hex
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

const UINT = parseAbiParameters('uint256 v')
const UINT_UINT = parseAbiParameters('uint256 id, uint256 value')
const UINT_ARR2 = parseAbiParameters('uint256[] ids, uint256[] values')
const BOOL = parseAbiParameters('bool v')

/** Fold a trace into what leaves and enters `account`, plus approvals granted. */
export function deltasFromTrace(trace: TraceFrame, account: Hex): { deltas: AssetDelta[]; approvals: ApprovalDelta[] } {
  const deltas: AssetDelta[] = []
  const approvals: ApprovalDelta[] = []
  const walk = (f: TraceFrame): void => {
    // Native value moves on every CALL frame (not DELEGATECALL/STATICCALL).
    if (f.value && f.value !== '0x0' && f.value !== '0x' && (f.type === undefined || f.type === 'CALL' || f.type === 'CREATE' || f.type === 'CREATE2') && !f.error) {
      const v = BigInt(f.value)
      if (v > 0n) {
        if (f.from && same(f.from, account)) deltas.push({ asset: 'native', standard: 'native', amount: -v, ...(f.to ? { counterparty: f.to } : {}) })
        if (f.to && same(f.to, account)) deltas.push({ asset: 'native', standard: 'native', amount: v, ...(f.from ? { counterparty: f.from } : {}) })
      }
    }
    for (const log of f.logs ?? []) {
      const t0 = log.topics[0]
      if (!t0) continue
      if (t0 === TOPICS.transfer && log.topics.length === 3) {
        const from = topicAddress(log.topics[1])
        const to = topicAddress(log.topics[2])
        const [amount] = safeDecode(UINT, log.data, [0n])
        if (from && same(from, account)) deltas.push({ asset: log.address, standard: 'erc20', amount: -amount, ...(to ? { counterparty: to } : {}) })
        if (to && same(to, account)) deltas.push({ asset: log.address, standard: 'erc20', amount, ...(from ? { counterparty: from } : {}) })
      } else if (t0 === TOPICS.transfer && log.topics.length === 4) {
        const from = topicAddress(log.topics[1])
        const to = topicAddress(log.topics[2])
        const tokenId = BigInt(log.topics[3] ?? '0x0')
        if (from && same(from, account)) deltas.push({ asset: log.address, standard: 'erc721', amount: -1n, tokenId, ...(to ? { counterparty: to } : {}) })
        if (to && same(to, account)) deltas.push({ asset: log.address, standard: 'erc721', amount: 1n, tokenId, ...(from ? { counterparty: from } : {}) })
      } else if (t0 === TOPICS.transferSingle && log.topics.length === 4) {
        const from = topicAddress(log.topics[2])
        const to = topicAddress(log.topics[3])
        const [id, value] = safeDecode(UINT_UINT, log.data, [0n, 0n])
        if (from && same(from, account)) deltas.push({ asset: log.address, standard: 'erc1155', amount: -value, tokenId: id, ...(to ? { counterparty: to } : {}) })
        if (to && same(to, account)) deltas.push({ asset: log.address, standard: 'erc1155', amount: value, tokenId: id, ...(from ? { counterparty: from } : {}) })
      } else if (t0 === TOPICS.transferBatch && log.topics.length === 4) {
        const from = topicAddress(log.topics[2])
        const to = topicAddress(log.topics[3])
        const [ids, values] = safeDecode(UINT_ARR2, log.data, [[], []])
        ids.forEach((id, i) => {
          const value = values[i] ?? 0n
          if (from && same(from, account)) deltas.push({ asset: log.address, standard: 'erc1155', amount: -value, tokenId: id, ...(to ? { counterparty: to } : {}) })
          if (to && same(to, account)) deltas.push({ asset: log.address, standard: 'erc1155', amount: value, tokenId: id, ...(from ? { counterparty: from } : {}) })
        })
      } else if (t0 === TOPICS.approval && log.topics.length === 3) {
        const owner = topicAddress(log.topics[1])
        const spender = topicAddress(log.topics[2])
        const [amount] = safeDecode(UINT, log.data, [0n])
        if (owner && spender && same(owner, account)) approvals.push({ token: log.address, spender, amount, standard: 'erc20' })
      } else if (t0 === TOPICS.approvalForAll && log.topics.length === 3) {
        const owner = topicAddress(log.topics[1])
        const operator = topicAddress(log.topics[2])
        const [approved] = safeDecode(BOOL, log.data, [false])
        if (owner && operator && same(owner, account) && approved) approvals.push({ token: log.address, spender: operator, amount: 'all', standard: 'erc721' })
      }
    }
    for (const c of f.calls ?? []) walk(c)
  }
  walk(trace)
  return { deltas, approvals }
}

function safeDecode<T extends readonly unknown[]>(params: Parameters<typeof decodeAbiParameters>[0], data: Hex, fallback: T): T {
  try {
    return decodeAbiParameters(params, data) as unknown as T
  } catch {
    return fallback
  }
}

/** A trace result becomes a Simulation; a top-level error is a failed simulation. */
export function simulationFromTrace(trace: TraceFrame, account: Hex): Simulation {
  if (trace.error) {
    return { mode: 'trace', ok: false, revertReason: trace.revertReason ?? trace.error, deltas: [], approvals: [], ...(trace.gasUsed ? { gas: BigInt(trace.gasUsed) } : {}) }
  }
  const { deltas, approvals } = deltasFromTrace(trace, account)
  return { mode: 'trace', ok: true, deltas: mergeDeltas(deltas), approvals, ...(trace.gasUsed ? { gas: BigInt(trace.gasUsed) } : {}) }
}

/** Net fungible deltas per asset; NFTs stay one row per token id. */
export function mergeDeltas(deltas: readonly AssetDelta[]): AssetDelta[] {
  const fungible = new Map<string, AssetDelta>()
  const rest: AssetDelta[] = []
  for (const d of deltas) {
    if (d.standard === 'erc721' || d.standard === 'erc1155') {
      rest.push(d)
      continue
    }
    const k = d.asset.toLowerCase()
    const prev = fungible.get(k)
    fungible.set(k, prev ? { ...prev, amount: prev.amount + d.amount } : d)
  }
  return [...fungible.values()].filter((d) => d.amount !== 0n).concat(rest)
}

export const NO_SIMULATION: Simulation = { mode: 'none', ok: true, deltas: [], approvals: [] }

export function estimateSimulation(gas: bigint | null, revertReason: string | null, note?: string | null): Simulation {
  const why = note ? { note } : {}
  return revertReason === null ? { mode: 'estimate', ok: true, ...(gas !== null ? { gas } : {}), deltas: [], approvals: [], ...why } : { mode: 'estimate', ok: false, revertReason, deltas: [], approvals: [], ...why }
}
