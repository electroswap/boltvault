/**
 * Tokens — the universe per chain (master plan §2.8, §10.2):
 * native ∪ pinned public list ∪ custom (user / wallet_watchAsset). The list
 * is fetched at most every 6 h and kept last-good; custom tokens are
 * verified against the chain (code + name/symbol/decimals) before they join.
 */
import { ALL_CHAINS, ELECTRONEUM_ADDRESSES, HOME_CHAIN_ID, isElectroneumChainId } from '@boltvault/chains'
import type { Platform } from '@boltvault/platform'
import { fetchTokenList, type CustomToken, type TokenEntry } from '@boltvault/token-catalog'
import { getAddress, isAddress, parseAbi, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { SealedMap } from '../sealed'
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

export const CustomTokenSchema = z.object({
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

/** Sealed under the DEK: user-added tokens name what this wallet cares about. */
const CUSTOM_ID = 'custom'
const PREFS_ID = 'prefs'

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

const isEtnChain = (chainId: number): chainId is 52014 | 5201420 => chainId === 52014 || chainId === 5201420

/*
  A token's name and symbol are whatever its contract chose to return. They
  reach the portfolio, the swap picker, the approval sheet and the hardware
  panel, so they are bounded here — at the point they enter the wallet — rather
  than at each of the places that render them. Strip the characters that move
  text about (control, format, separators: U+202E and friends), then cap.
*/
const UNSAFE_LABEL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
function label(raw: string, max: number): string {
  const clean = raw.normalize('NFKC').replace(UNSAFE_LABEL, '').trim()
  return clean.length > max ? clean.slice(0, max) : clean
}

export class TokensService {
  private lists = new Map<number, Promise<TokenEntry[]>>()

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    private readonly chains: ChainsService,
    private readonly fetchImpl: typeof fetch = fetch,
    /** User-added tokens and pin/hide preferences, sealed under the DEK. */
    private readonly customTokens: SealedMap<CustomToken[]>,
    private readonly tokenPrefs: SealedMap<{ pinned: string[]; hidden: string[] }>,
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
    return (await this.customTokens.get(CUSTOM_ID)) ?? []
  }

  /** Pinned / hidden token keys (`chainId:address`), read by Explore to mark pins at serve time. */
  async prefs(): Promise<{ pinned: string[]; hidden: string[] }> {
    return (await this.tokenPrefs.get(PREFS_ID)) ?? { pinned: [], hidden: [] }
  }

  logoFor(chainId: number, address: string, listUri?: string | undefined): string | null {
    if (listUri && /^https?:\/\//.test(listUri)) return listUri
    // The static host serves .svg for most tokens and .png for a few; the old
    // `.png` convention 404'd for WETN, USDC, USDT, BOLT, DYNO and — because
    // native falls through to the wrapped token's file — for native ETN, which
    // is why ETN showed a placeholder and never a logo. Ask for .svg; the UI
    // tries the sibling extension if it misses, and the 15 listed tokens plus
    // native are bundled anyway so they never reach the network.
    if (address === 'native') return isEtnChain(chainId) ? `https://static.electroswap.io/tokens/images/${getAddress(ELECTRONEUM_ADDRESSES[chainId].wetn)}.svg` : null
    if (isElectroneumChainId(chainId) && isAddress(address)) return `https://static.electroswap.io/tokens/images/${getAddress(address)}.svg`
    return null
  }

  async universe(chainId: number): Promise<TokenView[]> {
    const def = ALL_CHAINS.find((c) => c.chainId === chainId)
    if (!def) throw new EngineError('invalid_argument', `unknown chain ${chainId}`)
    const [list, custom, prefs] = await Promise.all([this.list(chainId), this.custom(), this.prefs()])
    const pinned = new Set(prefs.pinned)
    const hidden = new Set(prefs.hidden)
    const out: TokenView[] = [
      { chainId, address: 'native', symbol: def.nativeCurrency.symbol, name: def.nativeCurrency.name, decimals: def.nativeCurrency.decimals, logoUri: this.logoFor(chainId, 'native'), source: 'native', pinned: true, hidden: false, tags: [] },
    ]
    const seen = new Set<string>()
    for (const c of custom.filter((x) => x.chainId === chainId)) {
      const k = key(chainId, c.address)
      seen.add(k)
      out.push({ chainId, address: getAddress(c.address), symbol: c.symbol, name: c.name, decimals: c.decimals, logoUri: this.logoFor(chainId, c.address, c.logoURI), source: c.source, pinned: pinned.has(k), hidden: hidden.has(k), tags: [] })
    }
    /*
      A second "USDC" at another address (ES-BV-037).

      The list is fetched over the network and is not signed, and the picker
      searches by symbol — so an entry that borrows a major's symbol sits in
      the results beside the real one with nothing to tell them apart. The
      build knows where the majors live; anything wearing one of those symbols
      from somewhere else is marked, and the screens show its address.
    */
    const majors = this.majorSymbols(chainId)
    for (const t of list) {
      const k = key(chainId, t.address)
      if (seen.has(k)) continue
      seen.add(k)
      const real = majors.get(t.symbol.toLowerCase())
      const lookalike = real !== undefined && real !== t.address.toLowerCase()
      out.push({ chainId, address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logoUri: this.logoFor(chainId, t.address, t.logoURI), source: 'list', pinned: pinned.has(k), hidden: hidden.has(k), tags: [...(t.tags ?? [])], ...(lookalike ? { lookalike: true } : {}) })
    }
    return out
  }

  /** Symbol → address for the tokens this build ships addresses for. */
  private majorSymbols(chainId: number): Map<string, string> {
    const out = new Map<string, string>()
    const chain = ALL_CHAINS.find((c) => c.chainId === chainId)
    if (chain?.nativeCurrency?.symbol) out.set(chain.nativeCurrency.symbol.toLowerCase(), 'native')
    if (!isEtnChain(chainId)) return out
    const a = ELECTRONEUM_ADDRESSES[chainId]
    const pairs: Array<[string, string | null]> = [
      ['wetn', a.wetn],
      ['bolt', a.bolt],
      ['usdc', a.usdc],
    ]
    for (const [symbol, address] of pairs) if (address) out.set(symbol, address.toLowerCase())
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
      name: (name?.ok && typeof name.value === 'string' ? label(name.value, 48) : '') || checksummed.slice(0, 10),
      symbol: (symbol?.ok && typeof symbol.value === 'string' ? label(symbol.value, 12) : '') || '???',
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
    await this.customTokens.set(CUSTOM_ID, next)
    this.lists.delete(input.chainId)
    this.bus.emit({ type: 'tokens.changed', chainId: input.chainId })
    const view = await this.get(input.chainId, meta.address)
    if (!view) throw new EngineError('internal', 'token vanished')
    return view
  }

  /** The user-added tokens themselves. Sync reads these as the §6 "custom tokens" family. */
  async customList(): Promise<CustomToken[]> {
    return this.custom()
  }

  /**
   * A custom token a paired device sent.
   *
   * Unlike `addCustom` it does not ask the chain: the record may arrive while
   * the device is offline or on a chain it has no RPC for, and the peer's word
   * is all there is either way. §6 does not trust a paired device for token
   * identity, so sync records the arrival as unconfirmed and keeps it out of
   * the firewall's "known token" map until the user confirms it here.
   */
  async addSynced(input: { chainId: number; address: string; name: string; symbol: string; decimals: number }): Promise<void> {
    if (!isAddress(input.address)) throw new EngineError('invalid_argument', 'not an address')
    const address = getAddress(input.address)
    const custom = await this.custom()
    const k = key(input.chainId, address)
    const next = custom.filter((c) => key(c.chainId, c.address) !== k)
    next.push({ chainId: input.chainId, address, name: label(input.name, 48) || address.slice(0, 10), symbol: label(input.symbol, 12) || '???', decimals: input.decimals, source: 'user' })
    await this.customTokens.set(CUSTOM_ID, next)
    this.lists.delete(input.chainId)
    this.bus.emit({ type: 'tokens.changed', chainId: input.chainId })
  }

  async removeCustom(chainId: number, address: string): Promise<void> {
    const custom = await this.custom()
    const k = key(chainId, address)
    await this.customTokens.set(CUSTOM_ID, custom.filter((c) => key(c.chainId, c.address) !== k))
    this.bus.emit({ type: 'tokens.changed', chainId })
  }

  async setPrefs(chainId: number, address: string, patch: { pinned?: boolean; hidden?: boolean }): Promise<void> {
    const prefs = await this.prefs()
    const k = key(chainId, address)
    const toggle = (list: string[], on: boolean | undefined): string[] => (on === undefined ? list : on ? [...new Set([...list, k])] : list.filter((x) => x !== k))
    await this.tokenPrefs.set(PREFS_ID, { pinned: toggle(prefs.pinned, patch.pinned), hidden: toggle(prefs.hidden, patch.hidden) })
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
