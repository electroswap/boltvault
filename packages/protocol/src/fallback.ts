/**
 * The isolated-world half of the AMO fallback (master plan §4.7, §4.2).
 *
 * When a browser or a store rejects a manifest-declared `world: 'MAIN'`
 * content script, the isolated bridge is still running and still minting a
 * channel nonce — but nothing installs `window.ethereum`, and the wallet is
 * invisible to every dApp. This module decides whether that has happened and
 * puts the standalone provider IIFE into the page itself.
 *
 * Pure over small interfaces, so the decision and the DOM surgery are both
 * unit-tested without a browser.
 */

/** The provider IIFE, emitted into the build root by `wxt.config.ts`. */
export const PAGE_PROVIDER_FILE = 'page-provider.js'

export interface ManifestContentScript {
  readonly js?: readonly string[]
  readonly world?: string
}

export interface ManifestWebAccessibleResource {
  readonly resources?: readonly string[]
}

export interface ManifestLike {
  readonly content_scripts?: readonly ManifestContentScript[]
  readonly web_accessible_resources?: readonly ManifestWebAccessibleResource[]
}

/**
 * Did the browser accept a MAIN-world content script?
 *
 * `runtime.getManifest()` returns the manifest **as the browser normalised
 * it**, not as we wrote it, and Gecko drops keys its schema does not know. So
 * a Firefox that does not support `world` reports the entry without it, and an
 * AMO build that had to remove the entry reports no entry at all — both read
 * here as "the manifest path is not there". That makes this a synchronous,
 * authoritative answer at `document_start`, which is the whole point: we never
 * have to wait to see whether the MAIN-world script turns up, so the fallback
 * never races it.
 *
 * The check is deliberately not keyed to a file name. Ours is the only entry
 * that ever asks for the MAIN world, and coupling to the bundler's output
 * name (`content-scripts/content-main.js`) would silently start injecting a
 * second provider the day that name changes.
 */
export function mainWorldDeclared(manifest: ManifestLike): boolean {
  return (manifest.content_scripts ?? []).some((cs) => cs.world === 'MAIN')
}

/**
 * Did this build publish the provider script to web pages?
 *
 * The second half of the decision, and the reason a browser that honours
 * `world: 'MAIN'` never sees a failed request in its console: only the Firefox
 * manifest declares the resource (§3.5 keeps `web_accessible_resources` empty
 * everywhere else), so only there is there anything for a page to load. Asking
 * the normalised manifest rather than a build-time flag keeps both halves of
 * the decision answerable from one source.
 */
export function pageProviderWebAccessible(manifest: ManifestLike, file: string): boolean {
  return (manifest.web_accessible_resources ?? []).some((entry) =>
    (entry.resources ?? []).includes(file),
  )
}

export interface InjectableScript {
  src: string
  async: boolean
  remove(): void
}

export interface InjectableRoot {
  readonly firstChild: unknown
  insertBefore(node: InjectableScript, ref: unknown): unknown
}

export interface InjectableDocument {
  readonly documentElement: InjectableRoot | null
  createElement(tag: 'script'): InjectableScript
}

/**
 * Put the provider into the page as the first child of `<html>`, then take the
 * element straight back out (§4.7).
 *
 * Why `src` and not an inline script whose text we already hold: Gecko exempts
 * `moz-extension:` script URLs from the *page's* CSP, and exempts nothing
 * else. A dApp serving `script-src 'self'` — which is most of them — would
 * block an inline injection outright, so the linked form is the only one that
 * survives where it matters.
 *
 * Why the element is removed in the same breath: a script that has already
 * started is not cancelled by removal, so the fetch and the execution still
 * happen, and the page's DOM never contains anything of ours for page script
 * to find. That is also why the channel nonce does **not** ride here in a
 * `data-` attribute: unlike the element, the nonce would have to survive the
 * whole asynchronous load, and an attribute that survives is an attribute a
 * parser-inserted page script can read. The injected IIFE asks the bridge for
 * the nonce over the same `CustomEvent` handshake the manifest path uses.
 *
 * `document.write` would beat the parser outright, and is refused: it throws
 * in XML documents and destroys the document if the parser has already closed.
 */
export function injectPageProvider(doc: InjectableDocument, src: string): boolean {
  const root = doc.documentElement
  if (!root) return false
  try {
    const el = doc.createElement('script')
    el.src = src
    // A dynamically created script defaults to `async`; "in order" costs
    // nothing when ours is the only one queued and keeps it ahead of anything
    // the page inserts later.
    el.async = false
    root.insertBefore(el, root.firstChild)
    el.remove()
    return true
  } catch {
    // A page cannot have run yet at document_start, so there is nothing here to
    // report to; a frame we could not inject simply has no wallet.
    return false
  }
}
