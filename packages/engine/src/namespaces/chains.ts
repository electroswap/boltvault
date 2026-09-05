/**
 * Chains — the registry as views, the block heartbeat, and the RPC clients
 * every service reads through (failover per chain, optional per-chain
 * override from Settings › Networks, validated by eth_chainId when set).
 *
 * `HeadSource` is injected so tests never touch the network; the default reads
 * `eth_blockNumber` through the same clients. Every head observation is
 * emitted as `chains.head` — the single event behind the filament, the Field
 * and portfolio refresh.
 */
import { ALL_CHAINS, HOME_CHAIN_ID, type ChainDef } from '@boltvault/chains'
import type { Platform } from '@boltvault/platform'
import { createPublicClient, fallback, http, type PublicClient } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import type { ChainHead, ChainView } from '../schema'
import { readDoc, writeDoc, type DocSpec } from '../storage'

export interface HeadSource {
  blockNumber(chainId: number): Promise<bigint>
}

const RPC_DOC: DocSpec<Record<string, { url: string; trace?: string }>> = {
  key: 'chains.rpc',
  version: 1,
  schema: z.record(z.string(), z.object({ url: z.string().url(), trace: z.string().url().optional() })),
  defaultValue: () => ({}),
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

export class ChainsService implements HeadSource {
  private readonly cache = new Map<number, ChainHead>()
  private readonly inFlight = new Map<number, Promise<ChainHead>>()
  private readonly clients = new Map<number, PublicClient>()
  private overrides: Record<string, { url: string; trace?: string }> = {}
  private loaded: Promise<void> | null = null
  private readonly heads: HeadSource

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    heads?: HeadSource,
    private readonly cacheMs = 4_000,
  ) {
    this.heads = heads ?? this
  }

  private async load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = readDoc(this.platform.storage.local, RPC_DOC, () => this.platform.now()).then(({ value }) => {
        this.overrides = value
      })
    }
    return this.loaded
  }

  list(): ChainView[] {
    return ALL_CHAINS.map(toChainView)
  }

  def(chainId: number): ChainDef {
    const def = ALL_CHAINS.find((c) => c.chainId === chainId)
    if (!def) throw new EngineError('invalid_argument', `unknown chain ${chainId}`)
    return def
  }

  known(chainId: number): boolean {
    return ALL_CHAINS.some((c) => c.chainId === chainId)
  }

  /** The viem client for a chain: the user's override if set, else the registry's failover pair. */
  async client(chainId: number): Promise<PublicClient> {
    await this.load()
    const cached = this.clients.get(chainId)
    if (cached) return cached
    const def = this.def(chainId)
    const override = this.overrides[String(chainId)]
    const urls = override ? [override.url] : [...def.rpcUrls]
    const client = createPublicClient({ transport: fallback(urls.map((u) => http(u, { timeout: 10_000, batch: false })), { retryCount: 0 }) })
    this.clients.set(chainId, client)
    return client
  }

  /** Raw JSON-RPC on a chain (SAFE passthrough, gas, receipts). */
  async rpc(chainId: number, method: string, params: readonly unknown[]): Promise<unknown> {
    const client = await this.client(chainId)
    return client.request({ method, params } as never)
  }

  /** The trace endpoint for a chain (master plan §9.2), when the user or a signed config set one. */
  async traceUrl(chainId: number): Promise<string | null> {
    await this.load()
    return this.overrides[String(chainId)]?.trace ?? null
  }

  async rpcs(): Promise<Record<string, { url: string; trace?: string }>> {
    await this.load()
    return { ...this.overrides }
  }

  /** Set (or clear with null) the RPC for a chain; the URL must answer eth_chainId with that chain. */
  async setRpc(chainId: number, url: string | null, trace?: string | null): Promise<void> {
    await this.load()
    this.def(chainId)
    if (url === null) {
      delete this.overrides[String(chainId)]
    } else {
      const probe = createPublicClient({ transport: http(url, { timeout: 8_000 }) })
      const answered = await probe.getChainId().catch(() => null)
      if (answered !== chainId) throw new EngineError('invalid_argument', `${url} answers chain ${answered ?? 'nothing'}, not ${chainId}`)
      this.overrides[String(chainId)] = { url, ...(trace ? { trace } : {}) }
    }
    await writeDoc(this.platform.storage.local, RPC_DOC, this.overrides)
    this.clients.delete(chainId)
    this.cache.delete(chainId)
  }

  async blockNumber(chainId: number): Promise<bigint> {
    return (await this.client(chainId)).getBlockNumber({ cacheTime: 0 })
  }

  async head(chainId: number): Promise<ChainHead> {
    const def = this.def(chainId)
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

/** Kept for callers that only need block numbers through the registry clients. */
export const rpcHeadSource: HeadSource = {
  blockNumber: async (chainId) => {
    const def = ALL_CHAINS.find((c) => c.chainId === chainId)
    if (!def) throw new EngineError('invalid_argument', `unknown chain ${chainId}`)
    const client = createPublicClient({ transport: fallback(def.rpcUrls.map((u) => http(u, { timeout: 10_000 })), { retryCount: 0 }) })
    return client.getBlockNumber({ cacheTime: 0 })
  },
}

export function chainsNamespace(chains: ChainsService): NamespaceSpec {
  return {
    list: { handler: async () => chains.list() },
    head: {
      input: z.object({ chainId: z.number().int().positive() }),
      handler: (arg) => chains.head((arg as { chainId: number }).chainId),
    },
    rpcs: { handler: () => chains.rpcs() },
    setRpc: {
      input: z.object({ chainId: z.number().int().positive(), url: z.string().url().nullable(), trace: z.string().url().nullable().optional() }),
      handler: async (arg) => {
        const { chainId, url, trace } = arg as { chainId: number; url: string | null; trace?: string | null }
        await chains.setRpc(chainId, url, trace)
      },
    },
  }
}
