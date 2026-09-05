/**
 * Allowances (master plan §8.13): ERC-20 and Permit2 allowances plus
 * ERC-721 operator approvals, discovered by a known-spender grid over the
 * token universe (multicall) and a bounded `Approval` log scan for spenders
 * we do not know. Revoking goes through the same firewall as everything else
 * (`internal:approvals`).
 */
import type { Platform } from '@boltvault/platform'
import { knownContract, knownSpenders, permit2Address } from '@boltvault/security'
import { encodeFunctionData, maxUint256, pad, parseAbi, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import { readMany } from '../multicall'
import { AccountIdSchema, AllowanceViewSchema, type AllowanceView } from '../schema'
import { readDoc, writeDoc, type DocSpec } from '../storage'
import type { ChainsService } from './chains'
import type { ProviderService } from './provider'
import type { TokensService } from './tokens'
import type { VaultManager } from './vault'

const ERC20 = parseAbi(['function allowance(address owner, address spender) view returns (uint256)', 'function approve(address spender, uint256 amount) returns (bool)'])
const PERMIT2 = parseAbi(['function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)', 'function approve(address token, address spender, uint160 amount, uint48 expiration)'])
const ERC721 = parseAbi(['function isApprovedForAll(address owner, address operator) view returns (bool)', 'function setApprovalForAll(address operator, bool approved)'])
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
const LOG_WINDOW = 50_000
const LOG_CHUNK = 10_000
const UNLIMITED = maxUint256 >> 1n
const UNLIMITED_160 = ((1n << 160n) - 1n) >> 1n

const cacheDoc = (accountId: string, chainId: number): DocSpec<{ rows: AllowanceView[]; at: number }> => ({
  key: `allowances.${accountId}.${chainId}`,
  version: 1,
  schema: z.object({ rows: z.array(AllowanceViewSchema), at: z.number().int().nonnegative() }),
  defaultValue: () => ({ rows: [], at: 0 }),
})

export interface AllowancesDeps {
  readonly platform: Platform
  readonly bus: EventBus
  readonly chains: ChainsService
  readonly tokens: TokensService
  readonly vault: VaultManager
  readonly provider: ProviderService
}

export class AllowancesService {
  constructor(private readonly deps: AllowancesDeps) {}

  async cached(accountId: string, chainId: number): Promise<{ rows: AllowanceView[]; at: number }> {
    return (await readDoc(this.deps.platform.storage.local, cacheDoc(accountId, chainId), () => this.deps.platform.now())).value
  }

  async scan(accountId: string, chainId: number, opts: { logs?: boolean } = {}): Promise<AllowanceView[]> {
    const d = this.deps
    const account = (await d.vault.accounts()).find((a) => a.id === accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const owner = account.address as Hex
    const universe = (await d.tokens.universe(chainId)).filter((t) => t.address !== 'native')
    const symbols = new Map(universe.map((t) => [t.address.toLowerCase(), t.symbol]))
    const spenders = knownSpenders(chainId)
    const rows: AllowanceView[] = []

    // ERC-20 grid: every token × every known spender.
    const grid: Array<{ token: Hex; spender: Hex }> = []
    for (const t of universe) for (const s of spenders) grid.push({ token: t.address as Hex, spender: s.address })
    // Unknown spenders from the bounded Approval log scan join the grid.
    if (opts.logs !== false) {
      for (const pair of await this.approvalLogs(chainId, owner)) {
        if (!grid.some((g) => g.token.toLowerCase() === pair.token.toLowerCase() && g.spender.toLowerCase() === pair.spender.toLowerCase())) grid.push(pair)
      }
    }
    const results = await readMany(d.chains, chainId, grid.map((g) => ({ address: g.token, abi: ERC20, functionName: 'allowance', args: [owner, g.spender] })))
    grid.forEach((g, i) => {
      const r = results[i]
      if (!r?.ok || typeof r.value !== 'bigint' || r.value === 0n) return
      const known = knownContract(chainId, g.spender)
      rows.push({ chainId, token: g.token, tokenSymbol: symbols.get(g.token.toLowerCase()) ?? null, spender: g.spender, spenderName: known?.name ?? null, known: known !== null, standard: 'erc20', amount: r.value >= UNLIMITED ? 'unlimited' : r.value.toString(), expiration: null })
    })

    // Permit2: token × the routers that spend through it.
    const permit2 = permit2Address(chainId)
    if (permit2) {
      const p2 = spenders.filter((s) => s.address.toLowerCase() !== permit2.toLowerCase())
      const calls: Array<{ token: Hex; spender: Hex }> = []
      for (const t of universe) for (const s of p2) calls.push({ token: t.address as Hex, spender: s.address })
      const res = await readMany(d.chains, chainId, calls.map((c) => ({ address: permit2, abi: PERMIT2, functionName: 'allowance', args: [owner, c.token, c.spender] })))
      calls.forEach((c, i) => {
        const r = res[i]
        if (!r?.ok || !Array.isArray(r.value)) return
        const [amount, expiration] = r.value as [bigint, number, number]
        if (amount === 0n) return
        if (expiration !== 0 && expiration * 1000 < d.platform.now()) return
        const known = knownContract(chainId, c.spender)
        rows.push({ chainId, token: c.token, tokenSymbol: symbols.get(c.token.toLowerCase()) ?? null, spender: c.spender, spenderName: known?.name ?? null, known: known !== null, standard: 'permit2', amount: amount >= UNLIMITED_160 ? 'unlimited' : amount.toString(), expiration: expiration === 0 ? null : expiration })
      })
    }

    // NFT operators for the collections we know, against the operators we know.
    const collections = knownSpenders(chainId, ['nft'])
    const operators = knownSpenders(chainId, ['conduit', 'marketplace'])
    const nftCalls: Array<{ token: Hex; operator: Hex }> = []
    for (const c of collections) for (const o of operators) nftCalls.push({ token: c.address, operator: o.address })
    const nftRes = await readMany(d.chains, chainId, nftCalls.map((c) => ({ address: c.token, abi: ERC721, functionName: 'isApprovedForAll', args: [owner, c.operator] })))
    nftCalls.forEach((c, i) => {
      const r = nftRes[i]
      if (!r?.ok || r.value !== true) return
      rows.push({ chainId, token: c.token, tokenSymbol: knownContract(chainId, c.token)?.name ?? null, spender: c.operator, spenderName: knownContract(chainId, c.operator)?.name ?? null, known: true, standard: 'erc721', amount: 'all', expiration: null })
    })

    rows.sort((a, b) => rank(b) - rank(a))
    await writeDoc(d.platform.storage.local, cacheDoc(accountId, chainId), { rows, at: d.platform.now() })
    d.bus.emit({ type: 'allowances.changed', accountId, chainId, rows })
    return rows
  }

  private async approvalLogs(chainId: number, owner: Hex): Promise<Array<{ token: Hex; spender: Hex }>> {
    const d = this.deps
    const head = Number((await d.chains.head(chainId).catch(() => null))?.blockNumber ?? 0)
    if (!head) return []
    const from = Math.max(0, head - LOG_WINDOW)
    const pairs = new Map<string, { token: Hex; spender: Hex }>()
    for (let start = from; start <= head; start += LOG_CHUNK) {
      const end = Math.min(head, start + LOG_CHUNK - 1)
      const logs = (await d.chains
        .rpc(chainId, 'eth_getLogs', [{ fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, topics: [APPROVAL_TOPIC, pad(owner, { size: 32 })] }])
        .catch(() => [])) as Array<{ address: Hex; topics: Hex[] }>
      for (const log of logs) {
        const spenderTopic = log.topics[2]
        if (!spenderTopic) continue
        const spender = `0x${spenderTopic.slice(26)}` as Hex
        pairs.set(`${log.address.toLowerCase()}:${spender.toLowerCase()}`, { token: log.address, spender })
      }
    }
    return [...pairs.values()]
  }

  /** Revoke = zero the allowance, through the internal approval path. */
  async revoke(accountId: string, row: { chainId: number; token: string; spender: string; standard: 'erc20' | 'permit2' | 'erc721' }): Promise<{ requestId: string }> {
    const d = this.deps
    const permit2 = permit2Address(row.chainId)
    let to: Hex
    let data: Hex
    if (row.standard === 'erc20') {
      to = row.token as Hex
      data = encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [row.spender as Hex, 0n] })
    } else if (row.standard === 'permit2') {
      if (!permit2) throw new EngineError('invalid_argument', 'no Permit2 on this chain')
      to = permit2
      data = encodeFunctionData({ abi: PERMIT2, functionName: 'approve', args: [row.token as Hex, row.spender as Hex, 0n, 0] })
    } else {
      to = row.token as Hex
      data = encodeFunctionData({ abi: ERC721, functionName: 'setApprovalForAll', args: [row.spender as Hex, false] })
    }
    const account = (await d.vault.accounts()).find((a) => a.id === accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    return d.provider.submitInternal({ kind: 'send_transaction', origin: 'internal:approvals', chainId: row.chainId, accountId, tx: { from: account.address as Hex, to, data, value: '0x0' }, clientRequestId: `revoke:${row.token}:${row.spender}:${d.platform.now()}` })
  }
}

function rank(r: AllowanceView): number {
  return (r.amount === 'unlimited' || r.amount === 'all' ? 2 : 1) + (r.known ? 0 : 1)
}

const StandardSchema = z.enum(['erc20', 'permit2', 'erc721'])

export function allowancesNamespace(allowances: AllowancesService): NamespaceSpec {
  return {
    cached: { input: z.object({ accountId: AccountIdSchema, chainId: z.number().int().positive() }), handler: (arg) => allowances.cached((arg as { accountId: string }).accountId, (arg as { chainId: number }).chainId) },
    scan: {
      input: z.object({ accountId: AccountIdSchema, chainId: z.number().int().positive(), logs: z.boolean().optional() }),
      handler: (arg) => {
        const { accountId, chainId, logs } = arg as { accountId: string; chainId: number; logs?: boolean }
        return allowances.scan(accountId, chainId, logs === undefined ? {} : { logs })
      },
    },
    revoke: {
      input: z.object({ accountId: AccountIdSchema, chainId: z.number().int().positive(), token: z.string(), spender: z.string(), standard: StandardSchema }),
      handler: (arg) => {
        const { accountId, ...row } = arg as { accountId: string; chainId: number; token: string; spender: string; standard: 'erc20' | 'permit2' | 'erc721' }
        return allowances.revoke(accountId, row)
      },
    },
  }
}
