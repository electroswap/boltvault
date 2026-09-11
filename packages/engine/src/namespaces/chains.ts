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
import { ALL_CHAINS, HOME_CHAIN_ID, pollMs, type ChainDef } from '@boltvault/chains'
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

/** Loopback, where there is no network for anyone to sit on. */
const LOOPBACK = /^(localhost|127(?:\.\d+){3}|\[::1\])$/i

/** A custom endpoint must be HTTPS, or loopback. */
export function assertUsableRpcUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new EngineError('invalid_argument', 'That is not a valid URL.')
  }
  if (parsed.protocol === 'https:') return
  if (parsed.protocol === 'http:' && LOOPBACK.test(parsed.hostname)) return
  throw new EngineError('invalid_argument', 'A custom RPC must use https:// — over plain http anyone on the network can change the balances and fees this wallet shows you.')
}

export class ChainsService implements HeadSource {
  private readonly cache = new Map<number, ChainHead>()
  private readonly inFlight = new Map<number, Promise<ChainHead>>()
  private readonly clients = new Map<number, PublicClient>()
  private readonly epochs = new Map<number, number>()
  private overrides: Record<string, { url: string; trace?: string }> = {}
  private loaded: Promise<void> | null = null
  private readonly heads: HeadSource

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    heads?: HeadSource,
    /**
     * The engine's governed `fetch`. Every JSON-RPC request goes through it,
     * so RPC endpoints share one budget with the indexer and the price APIs
     * and a refusal from one endpoint is remembered rather than retried into.
     */
    private readonly fetchImpl?: typeof fetch,
    /** Overrides the per-chain head cache; tests pin it, nothing else should. */
    private readonly cacheMsOverride?: number,
  ) {
    this.heads = heads ?? this
  }

  /**
   * How long a head observation stands for a chain.
   *
   * Was a flat four seconds for every chain, which is a sensible number for
   * Electroneum and a wasteful one for Ethereum — three requests per block,
   * two of them returning the number we already had. It is now the chain's own
   * polling cadence, so however many surfaces ask, the network is asked once
   * per block-worth of time.
   */
  private cacheMsFor(chainId: number): number {
    // Just under the cadence, not equal to it: at exactly the poll interval a
    // poll arriving on time finds an observation a hair younger than the TTL
    // and is served the old number, so every other tick was skipped and a 5 s
    // chain's heartbeat ran at 10 s. Four fifths leaves the margin.
    return this.cacheMsOverride ?? Math.max(1_000, Math.round(pollMs(chainId, 'foreground') * 0.8))
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
    // JSON-RPC batching only. Requests scheduled in the same tick go out as
    // one POST, at no added latency (wait defaults to 0).
    //
    // Not `batch: { multicall: true }`: that aggregates readContract calls
    // through Multicall3 at the address viem reads from `chain.contracts`,
    // and this client is deliberately built without a `chain` — the registry
    // owns the addresses, and neither ETN chain uses the canonical
    // deployment. Turning it on silently broke reads (a token's decimals came
    // back empty, so adding a custom token reported "this contract does not
    // look like a token"). The aggregation we want is explicit, in
    // multicall.ts, where the address comes from the registry.
    /*
      Order is preference, and health does the rest.

      `fallback` walks to the next transport whenever one throws — anything but
      a user rejection or an execution revert, so a 429, a 5xx and a timeout all
      fail over silently. The governor is what makes that cheap: a request to an
      endpoint that is cooling throws in microseconds instead of spending a
      timeout, so the wallet slides to the next URL without the user seeing a
      pause. When the cooldown ends the preferred endpoint is simply used again.

      `retryCount: 0` because retrying the endpoint that just refused us is how
      a rate limit becomes a longer rate limit; the next URL is the better
      answer, and it is already right there.
    */
    const client = createPublicClient({
      transport: fallback(
        urls.map((u) => http(u, { timeout: 10_000, batch: true, ...(this.fetchImpl ? { fetchFn: this.fetchImpl } : {}) })),
        { retryCount: 0 },
      ),
    })
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
      /*
        An RPC endpoint decides the balances, the gas price, the nonce and the
        simulation the sheet is built from, and it sees every address the
        wallet asks about. Over cleartext, anyone on the path chooses all of
        that. The check belongs here rather than only on the Networks screen,
        because the screen is not the only caller.

        A loopback address is exempt: running a node on the same machine is
        how this gets tested, and there is no network to sit on.
      */
      assertUsableRpcUrl(url)
      if (trace) assertUsableRpcUrl(trace)
      const probe = createPublicClient({ transport: http(url, { timeout: 8_000, ...(this.fetchImpl ? { fetchFn: this.fetchImpl } : {}) }) })
      const answered = await probe.getChainId().catch(() => null)
      if (answered !== chainId) throw new EngineError('invalid_argument', `${url} answers chain ${answered ?? 'nothing'}, not ${chainId}`)
      this.overrides[String(chainId)] = { url, ...(trace ? { trace } : {}) }
    }
    await writeDoc(this.platform.storage.local, RPC_DOC, this.overrides)
    this.clients.delete(chainId)
    this.cache.delete(chainId)
    this.epochs.set(chainId, this.rpcEpoch(chainId) + 1)
  }

  /**
   * How many times this chain's endpoint has been changed in this session.
   *
   * `setRpc` drops this service's own client and head cache, but other services
   * cache what they read *through* it — the holder tier stands for five seconds
   * — and those kept answering from the endpoint the user had just moved away
   * from. A counter is enough: a cache that puts it in its key simply misses
   * the moment the endpoint changes, and costs nothing while it does not.
   */
  rpcEpoch(chainId: number): number {
    return this.epochs.get(chainId) ?? 0
  }

  async blockNumber(chainId: number): Promise<bigint> {
    return (await this.client(chainId)).getBlockNumber({ cacheTime: 0 })
  }

  async head(chainId: number): Promise<ChainHead> {
    const def = this.def(chainId)
    const cached = this.cache.get(chainId)
    const now = this.platform.now()
    if (cached && now - cached.observedAt < this.cacheMsFor(chainId)) return cached
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
