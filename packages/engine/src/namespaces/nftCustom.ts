/**
 * Custom collections (plan A3, owner item G7): a collection the indexer does
 * not know, added by contract address. The chain says what it is (name,
 * symbol, ERC-721 or ERC-1155), which pieces the account holds (Enumerable
 * when the contract supports it, else a bounded Transfer-log scan), and
 * where each piece's metadata lives (tokenURI / uri → data: inline, ipfs://
 * through a gateway, https with a four-second budget). Metadata is
 * persisted per piece; images only ever render through Artwork.
 */
import type { Platform } from '@boltvault/platform'
import { getAddress, isAddress, pad, parseAbi, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { readMany, type ReadCall } from '../multicall'
import type { SealedMap } from '../sealed'
import type { ChainsService } from './chains'

export const CustomCollectionSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string(),
  name: z.string(),
  symbol: z.string(),
  standard: z.enum(['ERC721', 'ERC1155']),
  enumerable: z.boolean(),
  addedAt: z.number().int().nonnegative(),
})
export type CustomCollection = z.infer<typeof CustomCollectionSchema>

export const NftMetadataSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  image: z.string().nullable(),
  attributes: z.array(z.object({ name: z.string(), value: z.string() })),
})
export type NftMetadata = z.infer<typeof NftMetadataSchema>

export interface CustomPiece {
  readonly address: string
  readonly tokenId: string
  readonly name: string
  readonly description: string | null
  readonly imageUrl: string | null
  readonly standard: 'ERC721' | 'ERC1155'
  readonly traits: Array<{ name: string; value: string }>
}

const ERC721 = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function supportsInterface(bytes4 id) view returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 id) view returns (address)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function tokenURI(uint256 id) view returns (string)',
])
const ERC1155 = parseAbi(['function balanceOf(address owner, uint256 id) view returns (uint256)', 'function uri(uint256 id) view returns (string)'])
const IFACE_721 = '0x80ac58cd'
const IFACE_721_ENUMERABLE = '0x780e9d63'
const IFACE_1155 = '0xd9b67a26'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'
const TRANSFER_BATCH_TOPIC = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'
const SCAN_WINDOW = 400_000
const SCAN_CHUNK = 20_000
const MAX_PIECES = 200
const FETCH_BUDGET_MS = 4_000
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'

/** Sealed under the DEK; the ids used to be storage keys naming chain, contract and token. */
const listId = (chainId: number): string => String(chainId)
const metaId = (chainId: number, address: string, tokenId: string): string => `${chainId}.${address.toLowerCase()}.${tokenId}`

/** `ipfs://…` and `ar://`-less gateways become https; data: and https pass through; anything else is not an image we load. */
export function resolveMediaUrl(uri: string | null | undefined): string | null {
  if (!uri) return null
  if (uri.startsWith('ipfs://')) return `${IPFS_GATEWAY}${uri.slice('ipfs://'.length).replace(/^ipfs\//, '')}`
  if (uri.startsWith('https://') || uri.startsWith('data:image/')) return uri
  return null
}

/** Parse a tokenURI payload into metadata: JSON, or data:application/json (plain or base64). */
export function parseMetadata(text: string): NftMetadata | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return null
    const o = parsed as Record<string, unknown>
    const attrs = Array.isArray(o['attributes'])
      ? (o['attributes'] as unknown[])
          .map((a) => {
            if (!a || typeof a !== 'object') return null
            const x = a as Record<string, unknown>
            const name = typeof x['trait_type'] === 'string' ? x['trait_type'] : typeof x['name'] === 'string' ? x['name'] : null
            const value = x['value']
            if (!name || (typeof value !== 'string' && typeof value !== 'number')) return null
            return { name, value: String(value) }
          })
          .filter((a): a is { name: string; value: string } => a !== null)
      : []
    return { name: typeof o['name'] === 'string' ? o['name'] : null, description: typeof o['description'] === 'string' ? o['description'] : null, image: typeof o['image'] === 'string' ? o['image'] : typeof o['image_url'] === 'string' ? o['image_url'] : null, attributes: attrs.slice(0, 24) }
  } catch {
    return null
  }
}

export interface CustomCollectionsDeps {
  readonly platform: Platform
  readonly chains: ChainsService
  readonly fetch: typeof fetch
  /** Custom collections per chain and NFT metadata per token, sealed under the DEK. */
  readonly collections: SealedMap<CustomCollection[]>
  readonly meta: SealedMap<NftMetadata | null>
}

export class CustomCollectionsService {
  constructor(private readonly deps: CustomCollectionsDeps) {}

  async list(chainId: number): Promise<CustomCollection[]> {
    return (await this.deps.collections.get(listId(chainId))) ?? []
  }

  /** What the chain says about a contract before it is added. */
  async preview(chainId: number, address: string): Promise<Omit<CustomCollection, 'addedAt'>> {
    if (!isAddress(address)) throw new EngineError('invalid_argument', 'not an address')
    const a = getAddress(address)
    const code = (await this.deps.chains.rpc(chainId, 'eth_getCode', [a, 'latest']).catch(() => '0x')) as string
    if (typeof code !== 'string' || code.length <= 2) throw new EngineError('invalid_argument', 'There is no contract at that address on this chain.')
    const [name, symbol, is721, isEnum, is1155] = await readMany(this.deps.chains, chainId, [
      { address: a, abi: ERC721, functionName: 'name' },
      { address: a, abi: ERC721, functionName: 'symbol' },
      { address: a, abi: ERC721, functionName: 'supportsInterface', args: [IFACE_721] },
      { address: a, abi: ERC721, functionName: 'supportsInterface', args: [IFACE_721_ENUMERABLE] },
      { address: a, abi: ERC721, functionName: 'supportsInterface', args: [IFACE_1155] },
    ])
    const flag = (r: (typeof is721) | undefined): boolean => r?.ok === true && r.value === true
    const standard: 'ERC721' | 'ERC1155' | null = flag(is1155) ? 'ERC1155' : flag(is721) ? 'ERC721' : null
    if (!standard) throw new EngineError('invalid_argument', 'This contract is not an ERC-721 or ERC-1155 collection.')
    return {
      chainId,
      address: a,
      name: name?.ok && typeof name.value === 'string' && name.value ? name.value : a.slice(0, 10),
      symbol: symbol?.ok && typeof symbol.value === 'string' ? symbol.value : '',
      standard,
      enumerable: standard === 'ERC721' && flag(isEnum),
    }
  }

  async add(chainId: number, address: string): Promise<CustomCollection> {
    const p = await this.preview(chainId, address)
    const row: CustomCollection = { ...p, addedAt: this.deps.platform.now() }
    const cur = await this.list(chainId)
    const next = [...cur.filter((c) => c.address.toLowerCase() !== row.address.toLowerCase()), row]
    await this.deps.collections.set(listId(chainId), next)
    return row
  }

  async remove(chainId: number, address: string): Promise<void> {
    const cur = await this.list(chainId)
    await this.deps.collections.set(listId(chainId), cur.filter((c) => c.address.toLowerCase() !== address.toLowerCase()))
  }

  /** Token ids the owner holds in a custom collection. Enumerable contracts answer directly; the rest come from a bounded Transfer scan, confirmed on chain. */
  async ownedIds(chainId: number, c: CustomCollection, owner: Hex): Promise<string[]> {
    const address = c.address as Hex
    if (c.standard === 'ERC721' && c.enumerable) {
      const [bal] = await readMany(this.deps.chains, chainId, [{ address, abi: ERC721, functionName: 'balanceOf', args: [owner] }])
      const n = bal?.ok && typeof bal.value === 'bigint' ? Number(bal.value) : 0
      if (n === 0) return []
      const calls: ReadCall[] = []
      for (let i = 0; i < Math.min(n, MAX_PIECES); i += 1) calls.push({ address, abi: ERC721, functionName: 'tokenOfOwnerByIndex', args: [owner, BigInt(i)] })
      return (await readMany(this.deps.chains, chainId, calls)).flatMap((r) => (r.ok && typeof r.value === 'bigint' ? [r.value.toString()] : []))
    }
    const head = Number((await this.deps.chains.head(chainId)).blockNumber)
    const from = Math.max(0, head - SCAN_WINDOW)
    const candidates = new Set<string>()
    const topics = c.standard === 'ERC721' ? [TRANSFER_TOPIC, null, pad(owner, { size: 32 })] : [[TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC], null, null, pad(owner, { size: 32 })]
    for (let start = from; start <= head && candidates.size < MAX_PIECES * 4; start += SCAN_CHUNK) {
      const end = Math.min(head, start + SCAN_CHUNK - 1)
      const logs = (await this.deps.chains.rpc(chainId, 'eth_getLogs', [{ address, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, topics }]).catch(() => [])) as Array<{ topics: Hex[]; data: Hex }>
      for (const log of logs) {
        if (c.standard === 'ERC721') {
          if (log.topics.length === 4 && log.topics[3]) candidates.add(BigInt(log.topics[3]).toString())
        } else if (log.topics[0] === TRANSFER_SINGLE_TOPIC) {
          candidates.add(BigInt(`0x${log.data.slice(2, 66)}`).toString())
        } else {
          // TransferBatch: (uint256[] ids, uint256[] values) — ids start at word 2 after two offsets.
          const words = log.data.slice(2).match(/.{64}/g) ?? []
          const idsOffset = Number(BigInt(`0x${words[0] ?? '0'}`)) / 32
          const count = Number(BigInt(`0x${words[idsOffset] ?? '0'}`))
          for (let i = 0; i < Math.min(count, 64); i += 1) candidates.add(BigInt(`0x${words[idsOffset + 1 + i] ?? '0'}`).toString())
        }
      }
    }
    const ids = [...candidates].slice(0, MAX_PIECES * 2)
    if (ids.length === 0) return []
    const checks: ReadCall[] = ids.map((id) => (c.standard === 'ERC721' ? { address, abi: ERC721, functionName: 'ownerOf', args: [BigInt(id)] } : { address, abi: ERC1155, functionName: 'balanceOf', args: [owner, BigInt(id)] }))
    const results = await readMany(this.deps.chains, chainId, checks)
    return ids.filter((_, i) => {
      const r = results[i]
      if (!r?.ok) return false
      return c.standard === 'ERC721' ? typeof r.value === 'string' && r.value.toLowerCase() === owner.toLowerCase() : typeof r.value === 'bigint' && r.value > 0n
    }).slice(0, MAX_PIECES)
  }

  /** A piece's metadata, from the persisted copy or the token's URI (four-second budget, never blocking the inventory on a slow host). */
  async metadata(chainId: number, c: CustomCollection, tokenId: string): Promise<NftMetadata | null> {
    const stored = await this.deps.meta.get(metaId(chainId, c.address, tokenId))
    if (stored) return stored
    const address = c.address as Hex
    const [uriRes] = await readMany(this.deps.chains, chainId, [c.standard === 'ERC721' ? { address, abi: ERC721, functionName: 'tokenURI', args: [BigInt(tokenId)] } : { address, abi: ERC1155, functionName: 'uri', args: [BigInt(tokenId)] }])
    let uri = uriRes?.ok && typeof uriRes.value === 'string' ? uriRes.value : ''
    if (!uri) return null
    // ERC-1155 `{id}` substitution: 64 hex digits, lowercase, no prefix.
    uri = uri.replace('{id}', BigInt(tokenId).toString(16).padStart(64, '0'))
    let text: string | null = null
    if (uri.startsWith('data:')) {
      const comma = uri.indexOf(',')
      const header = uri.slice(5, comma)
      const body = uri.slice(comma + 1)
      text = header.includes('base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body)
    } else {
      const url = uri.startsWith('ipfs://') ? resolveMediaUrl(uri) : uri.startsWith('https://') ? uri : null
      if (url) {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), FETCH_BUDGET_MS)
        try {
          const res = await this.deps.fetch(url, { signal: ctrl.signal })
          if (res.ok) text = await res.text()
        } catch {
          text = null
        } finally {
          clearTimeout(timer)
        }
      }
    }
    const meta = text ? parseMetadata(text) : null
    if (meta) await this.deps.meta.set(metaId(chainId, c.address, tokenId), meta)
    return meta
  }

  /** Every piece the owner holds across the chain's custom collections, with metadata where it could be read. */
  async ownedPieces(chainId: number, owner: Hex): Promise<{ collections: Array<CustomCollection & { balance: number }>; pieces: CustomPiece[] }> {
    const collections = await this.list(chainId)
    const out: CustomPiece[] = []
    const withBalance: Array<CustomCollection & { balance: number }> = []
    for (const c of collections) {
      let ids: string[] = []
      try {
        ids = await this.ownedIds(chainId, c, owner)
      } catch {
        ids = []
      }
      withBalance.push({ ...c, balance: ids.length })
      for (const id of ids) {
        const meta = await this.metadata(chainId, c, id).catch(() => null)
        out.push({ address: c.address, tokenId: id, name: meta?.name ?? `${c.symbol || c.name} #${id}`, description: meta?.description ?? null, imageUrl: resolveMediaUrl(meta?.image), standard: c.standard, traits: meta?.attributes ?? [] })
      }
    }
    return { collections: withBalance, pieces: out }
  }
}

const Chain = z.object({ chainId: z.number().int().positive() })

export function customCollectionsNamespace(custom: CustomCollectionsService): NamespaceSpec {
  return {
    previewCollection: { input: Chain.extend({ address: z.string() }), handler: (arg) => custom.preview((arg as { chainId: number }).chainId, (arg as { address: string }).address) },
    addCollection: { input: Chain.extend({ address: z.string() }), handler: (arg) => custom.add((arg as { chainId: number }).chainId, (arg as { address: string }).address) },
    removeCollection: { input: Chain.extend({ address: z.string() }), handler: (arg) => custom.remove((arg as { chainId: number }).chainId, (arg as { address: string }).address) },
    customCollections: { input: Chain, handler: (arg) => custom.list((arg as { chainId: number }).chainId) },
  }
}
