import type { NftActivity, NftAsset, NftBid, NftCollection } from './types.js'

/**
 * @boltvault/nft — display-only parsing of raw marketplace objects.
 *
 * Each parser is **pure** and **defensive**: it accepts either a top-level
 * array or an object whose plural key (`collections`, `assets`, `bids`,
 * `activity`) holds the array. Missing fields degrade to undefined; bad rows
 * are skipped rather than throwing.
 */

/** Accept a top-level array or `{ <pluralKey>: [...] }`. */
function extractList(raw: unknown, pluralKey: string): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const inner = (raw as Record<string, unknown>)[pluralKey]
    if (Array.isArray(inner)) return inner
  }
  return []
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'bigint') return v.toString()
  return undefined
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

/** Coerce to bigint; undefined/'' → undefined, otherwise throws (bad money). */
function asBigInt(v: unknown): bigint | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v === 'bigint') return v
  const n = BigInt(v as any)
  return n
}

const ACTIVITY_KINDS = new Set(['sale', 'bid', 'list', 'transfer'])

export function parseCollections(raw: unknown): NftCollection[] {
  return extractList(raw, 'collections')
    .map((row): NftCollection | null => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      const id = asString(r.id ?? r.contract)
      const name = asString(r.name)
      if (id === undefined || name === undefined) return null
      const floor = asNumber(r.floor)
      return { id, name, ...(floor !== undefined ? { floor } : {}) }
    })
    .filter((c): c is NftCollection => c !== null)
}

export function parseAssets(raw: unknown): NftAsset[] {
  return extractList(raw, 'assets')
    .map((row): NftAsset | null => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      const collection = asString(r.collection ?? r.asset ?? r.contract)
      const tokenId = asString(r.tokenId ?? r.token_id)
      if (collection === undefined || tokenId === undefined) return null
      const name = asString(r.name)
      const mediaUri = asString(r.mediaUri ?? r.image ?? r.tokenUri)
      const floor = asNumber(r.floor)
      const owner = asString(r.owner)
      const listed = typeof r.listed === 'boolean' ? r.listed : undefined
      return {
        collection,
        tokenId,
        ...(name !== undefined ? { name } : {}),
        ...(mediaUri !== undefined ? { mediaUri } : {}),
        ...(floor !== undefined ? { floor } : {}),
        ...(owner !== undefined ? { owner } : {}),
        ...(listed !== undefined ? { listed } : {}),
      }
    })
    .filter((a): a is NftAsset => a !== null)
}

export function parseBids(raw: unknown): NftBid[] {
  return extractList(raw, 'bids')
    .map((row): NftBid | null => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      const asset = asString(r.asset ?? r.contract)
      const tokenId = asString(r.tokenId ?? r.token_id)
      const price = asBigInt(r.price)
      const bidder = asString(r.bidder)
      if (asset === undefined || tokenId === undefined || price === undefined || bidder === undefined) {
        return null
      }
      const expiresAt = asNumber(r.expiresAt)
      return {
        asset,
        tokenId,
        price,
        bidder,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      }
    })
    .filter((b): b is NftBid => b !== null)
}

export function parseActivity(raw: unknown): NftActivity[] {
  return extractList(raw, 'activity')
    .map((row): NftActivity | null => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      const asset = asString(r.asset ?? r.contract)
      const tokenId = asString(r.tokenId ?? r.token_id)
      const kind = r.kind
      if (asset === undefined || tokenId === undefined || typeof kind !== 'string' || !ACTIVITY_KINDS.has(kind)) {
        return null
      }
      const price = asBigInt(r.price)
      const from = asString(r.from)
      const to = asString(r.to)
      const at = asNumber(r.at)
      return {
        asset,
        tokenId,
        kind: kind as NftActivity['kind'],
        ...(price !== undefined ? { price } : {}),
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        ...(at !== undefined ? { at } : {}),
      }
    })
    .filter((a): a is NftActivity => a !== null)
}
