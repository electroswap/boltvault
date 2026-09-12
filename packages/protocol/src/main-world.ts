/**
 * The MAIN-world half of injection (master plan §4.2, §4.7).
 *
 * Two different scripts can reach this world with the same job: the
 * manifest-declared `world: 'MAIN'` content script (Chrome ≥ 111, Firefox
 * ≥ 128), and the standalone IIFE the isolated bridge injects when that
 * manifest entry is not there (the AMO fallback, §4.7). Both call this
 * function, and the realm-wide claim below guarantees that whichever arrives
 * first is the only one that ever installs a provider.
 */
import { hasOpaqueOrigin } from './bridge'
import { installProvider, windowTransport, type WindowLike } from './page-provider'
import { CHANNEL_EVENT, CHANNEL_REQUEST_EVENT } from './wire'

/** What `windowTransport` needs on top of `WindowLike`: the same-origin message channel. */
interface SameOriginMessaging {
  readonly location: { readonly origin: string }
  postMessage(message: unknown, targetOrigin: string): void
  addEventListener(
    type: string,
    listener: (ev: { source: unknown; origin: string; data: unknown }) => void,
  ): void
}

export type MainWorldWindow = WindowLike & SameOriginMessaging

export interface MainWorldOptions {
  readonly win: MainWorldWindow
  readonly uuid: string
  readonly icon: string
  readonly name?: string
  readonly rdns?: string
}

/*
  Why a registered symbol rather than a module-level flag or a named global:
  the manifest script and the injected IIFE are separate compilation units
  sharing one realm, so a module flag cannot be seen across them, while
  `Symbol.for` resolves to the same key in both. It is a *claim*, not a secret
  — a page can find it through `Object.getOwnPropertySymbols(window)`, and all
  that buys an attacker is suppressing our own provider, which any page script
  can already do by defining `window.ethereum` before we get there.
*/
const CLAIM = Symbol.for('io.electroswap.boltvault.mainworld')

/**
 * Claim this realm and install `window.ethereum` as soon as the isolated
 * bridge hands over the per-load channel nonce.
 *
 * Returns false when someone else already owns the realm or the frame has an
 * opaque origin (§3.6) — in both cases nothing is registered and nothing is
 * installed.
 */
export function installFromChannel(o: MainWorldOptions): boolean {
  const win = o.win
  // No provider in an opaque origin (§3.6). The isolated bridge refuses too,
  // but the MAIN world must not depend on that to stay safe.
  if (hasOpaqueOrigin(win)) return false
  const claims = win as unknown as Record<symbol, unknown>
  if (claims[CLAIM] === true) return false
  claims[CLAIM] = true

  let installed = false
  win.addEventListener(CHANNEL_EVENT, (ev) => {
    const nonce = String((ev as { detail?: unknown }).detail ?? '')
    if (installed || !nonce) return
    installed = true
    installProvider({
      transport: windowTransport(win, nonce),
      channel: nonce,
      win,
      uuid: o.uuid,
      icon: o.icon,
      ...(o.name === undefined ? {} : { name: o.name }),
      ...(o.rdns === undefined ? {} : { rdns: o.rdns }),
    })
  })
  // Either ordering: the bridge announces unprompted at document_start, and
  // re-announces whenever it hears this. The injected fallback always lands
  // after the bridge, so the request is what actually delivers the nonce there.
  win.dispatchEvent(new win.CustomEvent(CHANNEL_REQUEST_EVENT))
  return true
}
