/**
 * Remote images, resolved through whatever disk cache the body provides.
 *
 * Owner: "Remote NFT images that should be cached are the collection banner
 * and logos. Actual NFT tokens should be cached on disk (not required to be
 * instant display, but anything that could preserve bandwidth by
 * redownloading would be ideal)."
 *
 * The CDN makes this our problem: measured 2026-09-06, static.electroswap.io
 * sends `etag` and `last-modified` but **no `Cache-Control`**, so the browser
 * has no freshness lifetime to work from and revalidates. One collection GIF
 * is 388 KB.
 *
 * packages/ui cannot open a cache itself — it has no host APIs and is shared
 * with the phone — so a body installs a resolver and this is the seam. With
 * none installed, everything behaves exactly as before.
 */
import { useEffect, useState } from 'react'

/**
 * Given a remote URL, return a URL to render.
 *
 * `null` means "no better answer than the original", which is the honest reply
 * on a cache miss: the caller shows the network URL, and the implementation is
 * expected to populate its cache for next time.
 */
export type ImageResolver = (uri: string) => Promise<string | null>

let resolver: ImageResolver | null = null
/** Resolved answers for this page, so a list scrolling back is synchronous. */
const resolved = new Map<string, string>()

export function setImageResolver(next: ImageResolver | null): void {
  resolver = next
}

/** What a body's resolver already answered for this URL, if anything. */
export function resolvedImage(uri: string): string | null {
  return resolved.get(uri) ?? null
}

/**
 * The best URL available for `uri` right now.
 *
 * Never slower than not caching: the original is returned immediately and the
 * cached copy swaps in only once it is genuinely ready. On a second visit the
 * answer is already in `resolved`, so the first render uses it.
 */
export function useCachedImage(uri: string | null | undefined): string | null {
  const remote = uri !== null && uri !== undefined && /^https?:/.test(uri) ? uri : null
  const [best, setBest] = useState<string | null>(() => (remote === null ? null : (resolved.get(remote) ?? remote)))

  useEffect(() => {
    if (remote === null) {
      setBest(null)
      return
    }
    const known = resolved.get(remote)
    setBest(known ?? remote)
    if (known !== undefined || resolver === null) return
    let on = true
    void resolver(remote).then(
      (hit) => {
        if (!on || hit === null) return
        resolved.set(remote, hit)
        setBest(hit)
      },
      () => undefined,
    )
    return () => {
      on = false
    }
  }, [remote])

  if (remote === null) return uri ?? null
  return best
}
