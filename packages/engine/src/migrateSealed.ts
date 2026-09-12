/**
 * Move the pre-2026-09 plaintext documents into their sealed blobs, once.
 *
 * Without this, sealing only protects *new* writes: an installed wallet would
 * keep the plaintext `portfolio.<accountId>`, `sites`, `allowances.*` and the
 * rest on disk forever, which is precisely what the at-rest audit read.
 *
 * Two rules matter here:
 *
 * 1. **Read raw, never through `readDoc`.** `readDoc` quarantines anything it
 *    cannot parse by *copying it verbatim* to `<key>.quarantine.<ts>`
 *    (`storage.ts`). Routing a legacy plaintext document through it during a
 *    migration would faithfully re-create the plaintext under a new key.
 * 2. **Delete, don't leave.** Every migrated key is removed, and any
 *    pre-existing `*.quarantine.*` is swept — those are verbatim plaintext
 *    copies of whatever failed to parse earlier.
 *
 * Runs on unlock, because the DEK is what the blobs are sealed under. It is
 * idempotent: a second run finds no legacy keys and does nothing.
 */
import type { Platform } from '@boltvault/platform'
import type { ConnectedSite } from '@boltvault/protocol'
import type { SealedStores } from './blobs'

/** Unwrap the `{ v, data }` envelope without `readDoc`'s quarantine behaviour. */
function envelope(raw: string): unknown {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const rec = parsed as Record<string, unknown>
    return 'data' in rec ? rec['data'] : undefined
  } catch {
    return undefined
  }
}

/** Parse a value stored without an envelope (`positions.*` was raw JSON). */
function bare(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export interface MigrationReport {
  readonly moved: number
  readonly removed: readonly string[]
}

export async function migrateSealed(platform: Platform, sealed: SealedStores): Promise<MigrationReport> {
  const local = platform.storage.local
  const keys = await local.keys()
  const removed: string[] = []
  let moved = 0

  // `storage.secret` is "ciphertext only" by convention, but `writeDoc` never
  // enforced it: on the extension that area is the same chrome.storage.local
  // with a different key prefix, so the device's ed25519 signing key and every
  // paired device's channel key were written there as plain JSON.
  const secret = platform.storage.secret
  for (const key of await secret.keys()) {
    if (key === 'sync.identity') {
      const data = envelope((await secret.get(key)) ?? '')
      const id = data as { signingPrivateKey?: unknown } | undefined
      if (id && typeof id.signingPrivateKey === 'string') {
        await sealed.syncIdentity.set('me', id as never)
        moved++
      }
      await secret.remove(key)
      removed.push(`secret:${key}`)
    } else if (key === 'sync.devices') {
      const data = envelope((await secret.get(key)) ?? '')
      if (Array.isArray(data)) {
        await sealed.syncDevices.set('all', data as never)
        moved++
      }
      await secret.remove(key)
      removed.push(`secret:${key}`)
    }
  }

  const take = async (key: string): Promise<string | null> => {
    const raw = await local.get(key)
    return raw
  }
  const drop = async (key: string): Promise<void> => {
    await local.remove(key)
    removed.push(key)
  }

  for (const key of keys) {
    // Verbatim plaintext copies left by an earlier failed parse.
    if (key.includes('.quarantine.')) {
      await drop(key)
      continue
    }

    // The old per-resource cache documents. These are caches: re-fetching is
    // cheaper and safer than re-encrypting them, and it guarantees no stale
    // shape survives into the sealed shards.
    if (key.startsWith('cache.') && !key.endsWith('.blob')) {
      await drop(key)
      continue
    }

    if (key === 'accounts.active') {
      const data = envelope((await take(key)) ?? '')
      const id = (data as { id?: unknown } | undefined)?.id
      if (typeof id === 'string' || id === null) {
        await sealed.active.set('active', { id: id ?? null })
        moved++
      }
      await drop(key)
      continue
    }

    if (key === 'sites') {
      const data = envelope((await take(key)) ?? '')
      if (data && typeof data === 'object') {
        for (const [origin, row] of Object.entries(data as Record<string, ConnectedSite>)) {
          if (row && typeof row === 'object' && typeof row.chainId === 'number') {
            await sealed.sites.set(origin, row)
            moved++
          }
        }
      }
      // The public half is rewritten by SitesService on its next save; the row
      // set it needs is already carried by the sealed half above.
      await drop(key)
      continue
    }

    if (key === 'bridge.transfers') {
      const data = envelope((await take(key)) ?? '')
      if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
        await sealed.bridge.set('all', data as { items: [] })
        moved++
      }
      await drop(key)
      continue
    }

    if (key === 'notifications') {
      const data = envelope((await take(key)) ?? '')
      if (Array.isArray(data)) {
        await sealed.notifications.set('all', data as [])
        moved++
      }
      await drop(key)
      continue
    }

    // `portfolio.look.<accountId>` must be tested before `portfolio.<id>`.
    const look = /^portfolio\.look\.(.+)$/.exec(key)
    if (look?.[1]) {
      const data = envelope((await take(key)) ?? '')
      if (data && typeof data === 'object') {
        await sealed.looks.set(look[1], data as { at: number; total: number | null })
        moved++
      }
      await drop(key)
      continue
    }

    const snap = /^portfolio\.(.+)$/.exec(key)
    if (snap?.[1]) {
      const data = envelope((await take(key)) ?? '')
      if (data && typeof data === 'object') {
        await sealed.portfolio.set(snap[1], data as never)
        moved++
      }
      await drop(key)
      continue
    }

    const allow = /^allowances\.(.+)\.(\d+)$/.exec(key)
    if (allow?.[1] && allow[2]) {
      const data = envelope((await take(key)) ?? '')
      if (data && typeof data === 'object') {
        await sealed.allowances.set(`${allow[1]}.${allow[2]}`, data as never)
        moved++
      }
      await drop(key)
      continue
    }

    // Stored without an envelope: raw `JSON.stringify(positions)`.
    const pos = /^positions\.(\d+)\.(.+)$/.exec(key)
    if (pos?.[1] && pos[2]) {
      const data = bare((await take(key)) ?? '')
      if (data && typeof data === 'object') {
        await sealed.positions.set(`${pos[1]}.${pos[2]}`, data as never)
        moved++
      }
      await drop(key)
      continue
    }

    if (key === 'sync.label' || key === 'sync.applied') {
      const data = envelope((await take(key)) ?? '')
      const cur = (await sealed.syncMeta.get('me')) ?? { label: null, applied: {} }
      if (key === 'sync.label') {
        const label = (data as { label?: unknown } | undefined)?.label
        if (typeof label === 'string' || label === null) {
          await sealed.syncMeta.set('me', { ...cur, label: label ?? null })
          moved++
        }
      } else if (data && typeof data === 'object') {
        await sealed.syncMeta.set('me', { ...cur, applied: data as Record<string, number> })
        moved++
      }
      await drop(key)
      continue
    }

    if (key === 'watchlist') {
      const data = envelope((await take(key)) ?? '')
      if (data && typeof data === 'object') {
        await sealed.watchlist.set('all', data as never)
        moved++
      }
      await drop(key)
      continue
    }

    if (key === 'tokens.custom') {
      const data = envelope((await take(key)) ?? '')
      if (Array.isArray(data)) {
        await sealed.tokensCustom.set('custom', data as never)
        moved++
      }
      await drop(key)
      continue
    }

    if (key === 'tokens.prefs') {
      const data = envelope((await take(key)) ?? '')
      if (data && typeof data === 'object') {
        await sealed.tokenPrefs.set('prefs', data as never)
        moved++
      }
      await drop(key)
      continue
    }

    const nftList = /^nft\.custom\.(\d+)$/.exec(key)
    if (nftList?.[1]) {
      const data = envelope((await take(key)) ?? '')
      if (Array.isArray(data)) {
        await sealed.nftCustom.set(nftList[1], data as never)
        moved++
      }
      await drop(key)
      continue
    }

    const nftMeta = /^nft\.meta\.(.+)$/.exec(key)
    if (nftMeta?.[1]) {
      const data = envelope((await take(key)) ?? '')
      if (data && typeof data === 'object') {
        await sealed.nftMeta.set(nftMeta[1], data as never)
        moved++
      }
      await drop(key)
      continue
    }

    // Stored as a bare decimal string, and the key itself carried the address.
    const legends = /^legends\.bestClaim\.(\d+)\.(0x[0-9a-fA-F]{40})$/.exec(key)
    if (legends?.[1] && legends[2]) {
      const wei = (await take(key)) ?? ''
      if (/^\d+$/.test(wei)) {
        await sealed.legends.set(`${legends[1]}.${legends[2].toLowerCase()}`, { wei })
        moved++
      }
      await drop(key)
      continue
    }

    // Stored without an envelope.
    const ref = /^launchpad\.ref\.(\d+)\.(.+)$/.exec(key)
    if (ref?.[1] && ref[2]) {
      const data = bare((await take(key)) ?? '')
      const referrer = (data as { referrer?: unknown } | undefined)?.referrer
      const at = (data as { at?: unknown } | undefined)?.at
      if (typeof referrer === 'string' && typeof at === 'number') {
        await sealed.launchpadRef.set(`${ref[1]}.${ref[2]}`, { referrer, at })
        moved++
      }
      await drop(key)
      continue
    }

    const scan = /^activity\.scan\.(.+)\.(\d+)$/.exec(key)
    if (scan?.[1] && scan[2]) {
      const data = envelope((await take(key)) ?? '')
      const block = (data as { block?: unknown } | undefined)?.block
      if (typeof block === 'number') {
        await sealed.scan.set(`${scan[1]}.${scan[2]}`, { block })
        moved++
      }
      await drop(key)
      continue
    }
  }

  return { moved, removed }
}
