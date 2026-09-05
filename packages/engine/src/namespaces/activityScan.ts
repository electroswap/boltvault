/**
 * Incoming transfers (master plan §8.12): until the ElectroSwap
 * `walletActivity` feed exists (backend B4), inbound ERC-20 transfers come
 * from a bounded `Transfer(to = account)` log scan; native ETN arrivals show
 * on the balance but have no log — the feed fixes that. Pending entries are
 * re-watched after unlock so a worker restart never strands a transaction.
 */
import type { Platform } from '@boltvault/platform'
import { pad, type Hex } from 'viem'
import { z } from 'zod'
import type { ActivityStore } from '../activityStore'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { AccountIdSchema, type ActivityEntry } from '../schema'
import { readDoc, writeDoc, type DocSpec } from '../storage'
import type { ChainsService } from './chains'
import type { TokensService } from './tokens'
import type { VaultManager } from './vault'

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const WINDOW = 50_000
const CHUNK = 10_000

const cursorDoc = (accountId: string, chainId: number): DocSpec<{ block: number }> => ({
  key: `activity.scan.${accountId}.${chainId}`,
  version: 1,
  schema: z.object({ block: z.number().int().nonnegative() }),
  defaultValue: () => ({ block: 0 }),
})

export interface ScanDeps {
  readonly platform: Platform
  readonly chains: ChainsService
  readonly activity: ActivityStore
  readonly tokens: TokensService
  readonly vault: VaultManager
}

export class ActivityScanner {
  constructor(private readonly deps: ScanDeps) {}

  async scan(accountId: string, chainId: number): Promise<{ added: number; fromBlock: number; toBlock: number }> {
    const d = this.deps
    const account = (await d.vault.accounts()).find((a) => a.id === accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const owner = account.address as Hex
    const head = Number((await d.chains.head(chainId)).blockNumber)
    const { value: cursor } = await readDoc(d.platform.storage.local, cursorDoc(accountId, chainId), () => d.platform.now())
    const from = Math.max(cursor.block + 1, head - WINDOW, 0)
    if (from > head) return { added: 0, fromBlock: from, toBlock: head }
    const universe = await d.tokens.universe(chainId)
    const known = new Map(universe.filter((t) => t.address !== 'native').map((t) => [t.address.toLowerCase(), t]))
    const existing = new Set((await d.activity.list({ accountId, chainId })).map((e) => e.id))
    let added = 0
    let scanned = from
    for (let start = from; start <= head; start += CHUNK) {
      const end = Math.min(head, start + CHUNK - 1)
      const logs = (await d.chains.rpc(chainId, 'eth_getLogs', [{ fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, topics: [TRANSFER_TOPIC, null, pad(owner, { size: 32 })] }])) as Array<{ address: Hex; topics: Hex[]; data: Hex; transactionHash: Hex; blockNumber: Hex; logIndex: Hex }>
      for (const log of logs) {
        if (log.topics.length !== 3) continue // ERC-721 transfers carry the id as topic 3
        const id = `${log.transactionHash}:${parseInt(log.logIndex, 16)}`
        if (existing.has(id)) continue
        const token = known.get(log.address.toLowerCase())
        const fromAddr = `0x${(log.topics[1] ?? '').slice(26)}`
        const entry: ActivityEntry = {
          id,
          hash: log.transactionHash,
          chainId,
          accountId,
          to: owner,
          from: fromAddr,
          token: log.address,
          value: BigInt(log.data === '0x' ? '0x0' : log.data).toString(),
          nonce: null,
          submittedAt: d.platform.now(),
          origin: null,
          category: 'RECEIVE',
          statements: [`Received ${token ? token.symbol : 'tokens'} from ${fromAddr.slice(0, 6)}…${fromAddr.slice(-4)}`],
          riskCodes: [],
          status: 'confirmed',
          blockNumber: parseInt(log.blockNumber, 16),
        }
        await d.activity.append(entry)
        existing.add(id)
        added += 1
      }
      scanned = end
      await writeDoc(d.platform.storage.local, cursorDoc(accountId, chainId), { block: scanned })
    }
    return { added, fromBlock: from, toBlock: scanned }
  }
}

export function activityScanNamespace(scanner: ActivityScanner): NamespaceSpec {
  return {
    scan: {
      input: z.object({ accountId: AccountIdSchema, chainId: z.number().int().positive() }),
      handler: (arg) => scanner.scan((arg as { accountId: string }).accountId, (arg as { chainId: number }).chainId),
    },
  }
}
