/**
 * Chains — the registry as views, and the block heartbeat.
 *
 * `HeadSource` is injected so tests never touch the network; the default reads
 * `eth_blockNumber` through @boltvault/chains' failover client. Heads are
 * cached briefly and every observation is emitted as `chains.head` — the
 * single event that drives the filament, the Field and portfolio refresh.
 */
import { ALL_CHAINS, HOME_CHAIN_ID, createChainClient, type ChainDef } from '@boltvault/chains'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import type { ChainHead, ChainView } from '../schema'

export interface HeadSource {
  blockNumber(chainId: number): Promise<bigint>
}

export const rpcHeadSource: HeadSource = {
  blockNumber: (chainId) => createChainClient(chainId).getBlockNumber(),
}

const TESTNETS = new Set([5201420])

export function toChainView(c: ChainDef): ChainView {
  return {
    chainId: c.chainId,
    name: c.name,
    symbol: c.nativeCurrency.symbol,
    explorerUrl: c.explorer?.url ?? null,
    isHome: c.chainId === HOME_CHAIN_ID,
    testnet: TESTNETS.has(c.chainId),
  }
}

export class ChainsService {
  private readonly cache = new Map<number, ChainHead>()
  private readonly inFlight = new Map<number, Promise<ChainHead>>()

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    private readonly heads: HeadSource,
    private readonly cacheMs = 4_000,
  ) {}

  list(): ChainView[] {
    return ALL_CHAINS.map(toChainView)
  }

  async head(chainId: number): Promise<ChainHead> {
    const def = ALL_CHAINS.find((c) => c.chainId === chainId)
    if (!def) throw new EngineError('invalid_argument', `unknown chain ${chainId}`)
    const cached = this.cache.get(chainId)
    const now = this.platform.now()
    if (cached && now - cached.observedAt < this.cacheMs) return cached
    const pending = this.inFlight.get(chainId)
    if (pending) return pending
    const p = this.fetch(def).finally(() => this.inFlight.delete(chainId))
    this.inFlight.set(chainId, p)
    return p
  }

  private async fetch(def: ChainDef): Promise<ChainHead> {
    const started = this.platform.now()
    const budget = (def.blockTimeMs ?? 12_000) * 2
    try {
      const n = await this.heads.blockNumber(def.chainId)
      const observedAt = this.platform.now()
      const head: ChainHead = {
        chainId: def.chainId,
        blockNumber: n.toString(),
        observedAt,
        live: observedAt - started <= budget,
      }
      this.cache.set(def.chainId, head)
      this.bus.emit({ type: 'chains.head', head })
      return head
    } catch (err) {
      const stale = this.cache.get(def.chainId)
      if (stale) {
        const head: ChainHead = { ...stale, live: false }
        this.cache.set(def.chainId, head)
        this.bus.emit({ type: 'chains.head', head })
        return head
      }
      throw new EngineError('internal', `${def.name} RPC did not answer`, { cause: err instanceof Error ? err.message : String(err) })
    }
  }
}

export function chainsNamespace(chains: ChainsService): NamespaceSpec {
  return {
    list: { handler: async () => chains.list() },
    head: {
      input: z.object({ chainId: z.number().int().positive() }),
      handler: (arg) => chains.head((arg as { chainId: number }).chainId),
    },
  }
}
