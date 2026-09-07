/**
 * The extension's disk cache for remote artwork, on the Cache API.
 *
 * Collection logos and banners want to be instant on a second look; NFT
 * pieces mainly want to stop being downloaded again (one collection GIF on the
 * ElectroSwap CDN is 388 KB). The Cache API gives both: disk-backed, survives
 * the popup closing and the browser restarting, and the browser evicts it.
 *
 * Why we cache at all, rather than leaving it to the HTTP cache: measured
 * 2026-09-06, static.electroswap.io sends `etag` and `last-modified` but no
 * `Cache-Control`, so there is no freshness lifetime and the browser
 * revalidates. (Worth fixing on the CDN too — it would help the website.)
 *
 * Order matters: the cache is consulted first, and a miss falls back to the
 * network URL *and* fills the cache behind the render. So a first view is
 * never slower than before, and a second view does not touch the network.
 */
import { setImageResolver } from '@boltvault/ui'

const CACHE = 'bv-images-v1'
/** Artwork only. A cap keeps one absurd asset from filling the quota. */
const MAX_BYTES = 8 * 1024 * 1024
const HOSTS = ['static.electroswap.io', 'ipfs.io', 'gateway.pinata.cloud', 'cloudflare-ipfs.com']

function cacheable(uri: string): boolean {
  try {
    return HOSTS.includes(new URL(uri).hostname)
  } catch {
    return false
  }
}

async function fromCache(uri: string): Promise<string | null> {
  if (typeof caches === 'undefined' || !cacheable(uri)) return null
  try {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(uri)
    if (hit) return URL.createObjectURL(await hit.blob())
    // Miss: let the caller render the network URL, and store a copy for next
    // time. Deliberately not awaited into the render path.
    void (async () => {
      const res = await fetch(uri, { credentials: 'omit' })
      if (!res.ok) return
      const len = Number(res.headers.get('content-length') ?? '0')
      if (len > MAX_BYTES) return
      await cache.put(uri, res.clone())
    })().catch(() => undefined)
    return null
  } catch {
    return null
  }
}

/** Install the resolver. Safe to call more than once. */
export function installImageCache(): void {
  setImageResolver(fromCache)
}

/** Settings › clear cached artwork. */
export async function clearImageCache(): Promise<void> {
  if (typeof caches === 'undefined') return
  await caches.delete(CACHE).catch(() => undefined)
}
