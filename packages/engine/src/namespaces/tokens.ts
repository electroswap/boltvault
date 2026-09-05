/**
 * Tokens — the universe per chain (master plan §2.8, §10.2):
 * native ∪ pinned public list ∪ custom (user / wallet_watchAsset). The list
 * is fetched at most every 6 h and kept last-good; custom tokens are
 * verified against the chain (code + name/symbol/decimals) before they join.
 */
import { ALL_CHAINS, HOME_CHAIN_ID, isElectroneumChainId } from '@boltvault/chains'
import type { Platform } from '@boltvault/platform'
import { fetchTokenList, type CustomToken, type TokenEntry } from '@boltvault/token-catalog'
import { getAddress, isAddress, parseAbi, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import { readMany } from '../multicall'
import type { TokenView } from '../schema'
import { readDoc, writeDoc, type DocSpec } from '../storage'
import type { ChainsService } from './chains'

const TokenEntrySchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string(),
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
  logoURI: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

const CustomTokenSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string(),
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
  logoURI: z.string().optional(),
  source: z.enum(['user', 'dapp']),
  origin: z.string().optional(),
})

const listDoc = (chainId: number): DocSpec<{ tokens: TokenEntry[]; at: number }> => ({
  key: `tokens.list.${chainId}`,
  version: 1,
  schema: z.object({ tokens: z.array(TokenEntrySchema), at: z.number().int().nonnegative() }),
  defaultValue: () => ({ tokens: [], at: 0 }),
})

const CUSTOM_DOC: DocSpec<CustomToken[]> = { key: 'tokens.custom', version: 1, schema: z.array(CustomTokenSchema), defaultValue: () => [] }
const PREFS_DOC: DocSpec<{ pinned: string[]; hidden: string[] }> = {
  key: 'tokens.prefs',
  version: 1,
  schema: z.object({ pinned: z.array(z.string()), hidden: z.array(z.string()) }),
  defaultValue: () => ({ pinned: [], hidden: [] }),
}

const LIST_TTL_MS = 6 * 60 * 60 * 1000
const ERC20_META = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)'])

const key = (chainId: number, address: string): string => `${chainId}:${address.toLowerCase()}`

export interface TokenMetadata {
  readonly address: Hex
  readonly name: string
  readonly symbol: string
  readonly decimals: number
  readonly hasCode: boolean
}

export class TokensService {
  private lists = new Map<number, Promise<TokenEntry[]>>()

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    private readonly chains: ChainsService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** The pinned public list for a chain, refreshed at most every 6 h; last-good on failure. */
  async list(chainId: number): Promise<TokenEntry[]> {
    const cached = this.lists.get(chainId)
    if (cached) return cached
    const p = (async () => {
      const { value } = await readDoc(this.platform.storage.local, listDoc(chainId), () => this.platform.now())
      if (value.tokens.length > 0 && this.platform.now() - value.at < LIST_TTL_MS) return value.tokens
      try {
        const fetched = await fetchTokenList(chainId, { fetchImpl: this.fetchImpl })
        if (fetched.tokens.length > 0) {
          await writeDoc(this.platform.storage.local, listDoc(chainId), { tokens: fetched.tokens, at: this.platform.now() })
          return fetched.tokens
        }
      } catch {
        // keep last-good
      }
      return value.tokens
    })()
    this.lists.set(chainId, p)
    p.finally(() => {
      // Allow a refresh on the next call once the TTL lapses.
      setTimeout(() => this.lists.delete(chainId), 60_000)
    }).catch(() => undefined)
    return p
  }

  private async custom(): Promise<CustomToken[]> {
    return (await readDoc(this.platform.storage.local, CUSTOM_DOC, () => this.platform.now())).value
  }

  private async prefs(): Promise<{ pinned: string[]; hidden: string[] }> {
    return (await readDoc(this.platform.storage.local, PREFS_DOC, () => this.platform.now())).value
  }

  logoFor(chainId: number, address: string, listUri?: string | undefined): string | null {
    if (listUri && /^https?:\/\//.test(listUri)) return listUri
    if (isElectroneumChainId(chainId) && isAddress(address)) return `https://static.electroswap.io/tokens/images/${getAddress(address)}.png`
    return null
  }

  async universe(chainId: number): Promise<TokenView[]> {
    const def = ALL_CHAINS.find((c) => c.chainId === chainId)
    if (!def) throw new EngineError('invalid_argument', `unknown chain ${chainId}`)
    const [list, custom, prefs] = await Promise.all([this.list(chainId), this.custom(), this.prefs()])
    const pinned = new Set(prefs.pinned)
    const hidden = new Set(prefs.hidden)
    const out: TokenView[] = [
      { chainId, address: 'native', symbol: def.nativeCurrency.symbol, name: def.nativeCurrency.name, decimals: def.nativeCurrency.decimals, logoUri: null, source: 'native', pinned: true, hidden: false, tags: [] },
    ]
    const seen = new Set<string>()
    for (const c of custom.filter((x) => x.chainId === chainId)) {
      const k = key(chainId, c.address)
      seen.add(k)
      out.push({ chainId, address: getAddress(c.address), symbol: c.symbol, name: c.name, decimals: c.decimals, logoUri: this.logoFor(chainId, c.address, c.logoURI), source: c.source, pinned: pinned.has(k), hidden: hidden.has(k), tags: [] })
    }
    for (const t of list) {
      const k = key(chainId, t.address)
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ chainId, address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logoUri: this.logoFor(chainId, t.address, t.logoURI), source: 'list', pinned: pinned.has(k), hidden: hidden.has(k), tags: [...(t.tags ?? [])] })
    }
    return out
  }

  async get(chainId: number, address: string): Promise<TokenView | null> {
    const all = await this.universe(chainId)
    const a = address.toLowerCase()
    return all.find((t) => t.address.toLowerCase() === a) ?? null
  }

  async search(chainId: number, query: string): Promise<TokenView[]> {
    const q = query.trim().toLowerCase()
    const all = await this.universe(chainId)
    if (!q) return all.filter((t) => !t.hidden)
    const hits = all.filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase() === q)
    if (hits.length === 0 && isAddress(query)) {
      const meta = await this.metadata(chainId, query).catch(() => null)
      if (meta?.hasCode) return [{ chainId, address: meta.address, symbol: meta.symbol, name: meta.name, decimals: meta.decimals, logoUri: this.logoFor(chainId, meta.address), source: 'lookup', pinned: false, hidden: false, tags: [] }]
    }
    return hits
  }

  /** On-chain metadata for a token contract; `hasCode` false means it is not a contract. */
  async metadata(chainId: number, address: string): Promise<TokenMetadata> {
    if (!isAddress(address)) throw new EngineError('invalid_argument', 'not an address')
    const checksummed = getAddress(address)
    const code = (await this.chains.rpc(chainId, 'eth_getCode', [checksummed, 'latest']).catch(() => '0x')) as string
    const hasCode = typeof code === 'string' && code.length > 2
    if (!hasCode) return { address: checksummed, name: '', symbol: '', decimals: 18, hasCode: false }
    const [name, symbol, decimals] = await readMany(this.chains, chainId, [
      { address: checksummed, abi: ERC20_META, functionName: 'name' },
      { address: checksummed, abi: ERC20_META, functionName: 'symbol' },
      { address: checksummed, abi: ERC20_META, functionName: 'decimals' },
    ])
    if (!decimals?.ok) throw new EngineError('invalid_argument', 'this contract does not look like a token')
    return {
      address: checksummed,
      name: name?.ok && typeof name.value === 'string' ? name.value : checksummed.slice(0, 10),
      symbol: symbol?.ok && typeof symbol.value === 'string' ? symbol.value : '???',
      decimals: Number(decimals.value),
      hasCode: true,
    }
  }

  /** Add a custom token after verifying it on chain; a dApp's claim that disagrees with the chain loses. */
  async addCustom(input: { chainId: number; address: string; source: 'user' | 'dapp'; origin?: string; claimed?: { symbol?: string; decimals?: number } }): Promise<TokenView> {
    const meta = await this.metadata(input.chainId, input.address)
    if (!meta.hasCode) throw new EngineError('invalid_argument', 'that address is not a contract')
    const custom = await this.custom()
    const k = key(input.chainId, meta.address)
    const next = custom.filter((c) => key(c.chainId, c.address) !== k)
    next.push({ chainId: input.chainId, address: meta.address, name: meta.name, symbol: meta.symbol, decimals: meta.decimals, source: input.source, ...(input.origin ? { origin: input.origin } : {}) })
    await writeDoc(this.platform.storage.local, CUSTOM_DOC, next)
    this.lists.delete(input.chainId)
    this.bus.emit({ type: 'tokens.changed', chainId: input.chainId })
    const view = await this.get(input.chainId, meta.address)
    if (!view) throw new EngineError('internal', 'token vanished')
    return view
  }

  async removeCustom(chainId: number, address: string): Promise<void> {
    const custom = await this.custom()
    const k = key(chainId, address)
    await writeDoc(this.platform.storage.local, CUSTOM_DOC, custom.filter((c) => key(c.chainId, c.address) !== k))
    this.bus.emit({ type: 'tokens.changed', chainId })
  }

  async setPrefs(chainId: number, address: string, patch: { pinned?: boolean; hidden?: boolean }): Promise<void> {
    const prefs = await this.prefs()
    const k = key(chainId, address)
    const toggle = (list: string[], on: boolean | undefined): string[] => (on === undefined ? list : on ? [...new Set([...list, k])] : list.filter((x) => x !== k))
    await writeDoc(this.platform.storage.local, PREFS_DOC, { pinned: toggle(prefs.pinned, patch.pinned), hidden: toggle(prefs.hidden, patch.hidden) })
    this.bus.emit({ type: 'tokens.changed', chainId })
  }
}

const ChainIdSchema = z.number().int().positive().default(HOME_CHAIN_ID)

export function tokensNamespace(tokens: TokensService): NamespaceSpec {
  return {
    universe: { input: z.object({ chainId: ChainIdSchema }), handler: (arg) => tokens.universe((arg as { chainId: number }).chainId) },
    get: { input: z.object({ chainId: ChainIdSchema, address: z.string() }), handler: (arg) => tokens.get((arg as { chainId: number; address: string }).chainId, (arg as { address: string }).address) },
    search: { input: z.object({ chainId: ChainIdSchema, query: z.string().max(200) }), handler: (arg) => tokens.search((arg as { chainId: number }).chainId, (arg as { query: string }).query) },
    metadata: { input: z.object({ chainId: ChainIdSchema, address: z.string() }), handler: (arg) => tokens.metadata((arg as { chainId: number }).chainId, (arg as { address: string }).address) },
    addCustom: {
      input: z.object({ chainId: ChainIdSchema, address: z.string(), source: z.enum(['user', 'dapp']).default('user'), origin: z.string().optional() }),
      handler: (arg) => tokens.addCustom(arg as { chainId: number; address: string; source: 'user' | 'dapp'; origin?: string }),
    },
    removeCustom: { input: z.object({ chainId: ChainIdSchema, address: z.string() }), handler: (arg) => tokens.removeCustom((arg as { chainId: number }).chainId, (arg as { address: string }).address) },
    setPrefs: {
      input: z.object({ chainId: ChainIdSchema, address: z.string(), pinned: z.boolean().optional(), hidden: z.boolean().optional() }),
      handler: (arg) => {
        const { chainId, address, pinned, hidden } = arg as { chainId: number; address: string; pinned?: boolean; hidden?: boolean }
        return tokens.setPrefs(chainId, address, { ...(pinned !== undefined ? { pinned } : {}), ...(hidden !== undefined ? { hidden } : {}) })
      },
    },
  }
}
