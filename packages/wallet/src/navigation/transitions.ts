/**
 * Shared-element transitions, driven from the router (master plan §7.7).
 *
 * The plan describes react-router's `viewTransition` flag wrapping
 * `document.startViewTransition`. This app has no react-router — navigation is
 * the memory store in ./router.tsx — so the wrapping lives here instead, and
 * `useRouter` runs its mutations through `withSharedTransition`.
 *
 * Only the three named moments get one. `routeTag` answers non-null for the
 * token dossier, a piece and a campaign page, and a navigation with no tag on
 * either side runs exactly as it did before — a plain push with `ScreenEnter`.
 * That is the whole point of gating on the tag: a view transition costs the
 * browser a snapshot per named element, and paying that on every tab change
 * to get a cross-fade nobody asked for would be the motion budget's "hover
 * lift on every card" all over again.
 *
 * Everything here degrades to a plain push: Firefox and Chrome < 111 have no
 * `startViewTransition`, React Native has no `document` at all, and reduced
 * motion turns it off outright (§7.6 — the app is complete without motion).
 */
import type { ScreenId } from './registry'

/**
 * How long to wait for React to commit the new screen before letting the
 * browser photograph it. Two frames is the normal answer; the timeout is for
 * a body with no frame loop running (a background tab), where waiting on
 * `requestAnimationFrame` would hang the navigation itself.
 */
const COMMIT_BUDGET_MS = 50

/** Off while motion is reduced; the shell sets this from the resolved preference. */
let enabled = true

/** True only between "the router changed" and "the browser finished the move". */
let active = false

export function setSharedTransitions(on: boolean): void {
  enabled = on
  if (!on) active = false
}

/**
 * Whether a shared move is in flight right now.
 *
 * `ScreenEnter` asks, because the two must not both run: a screen that slides
 * in from 14 px while its header is being tweened out of a list row is two
 * animations arguing about where the same pixels are. During a shared move
 * the screen simply arrives, and the moving element carries the eye.
 */
export function sharedTransitionActive(): boolean {
  return active
}

/** The View Transitions API, as much of it as we use. */
interface TransitionDocument {
  startViewTransition(update: () => void | Promise<void>): { readonly finished: Promise<void> }
}

function transitionDocument(): TransitionDocument | null {
  if (typeof document === 'undefined') return null
  const start: unknown = (document as unknown as { startViewTransition?: unknown })
    .startViewTransition
  return typeof start === 'function' ? (document as unknown as TransitionDocument) : null
}

/**
 * Run a navigation, moving the shared element if this body can.
 *
 * `tag` is the identity the two screens have in common; null means there is
 * nothing to move and the update runs plainly.
 */
export function withSharedTransition(tag: string | null, update: () => void): void {
  const doc = tag === null || !enabled ? null : transitionDocument()
  if (doc === null) {
    update()
    return
  }
  try {
    const transition = doc.startViewTransition(() =>
      committed(() => {
        active = true
        update()
      }),
    )
    const done = (): void => {
      active = false
    }
    void transition.finished.then(done, done)
  } catch {
    // A browser that has the method but refuses the call (an inert document,
    // a transition already running) still owes the user the navigation.
    active = false
    update()
  }
}

/**
 * Apply the update and resolve once React has actually drawn it.
 *
 * The router's state lives in a store React reads through
 * `useSyncExternalStore`, so the new screen is committed on React's schedule,
 * not inside this callback — and the browser photographs the new state the
 * moment the callback settles. react-router reaches for `flushSync` here;
 * packages/wallet has no react-dom to reach for (this same file runs on the
 * phone, where there is none), so it waits for the paint instead.
 */
function committed(update: () => void): Promise<void> {
  update()
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
    if (raf !== null) raf(() => raf(finish))
    setTimeout(finish, COMMIT_BUDGET_MS)
  })
}

/** One field of a route's params, when it is there and is a string or a number. */
function param(params: unknown, key: string): string | null {
  if (typeof params !== 'object' || params === null) return null
  const value = (params as Record<string, unknown>)[key]
  if (typeof value === 'string') return value
  return typeof value === 'number' ? String(value) : null
}

/**
 * The identity a screen shares with the row, thumb or cell that opens it.
 *
 * Built from the route rather than from a press handler, so the origin and
 * the destination cannot drift apart: both derive the id from the same
 * `{ chainId, address }` the router already carries.
 */
export function tokenSharedId(chainId: number | string, address: string): string {
  return `token:${chainId}:${address.toLowerCase()}`
}

export function pieceSharedId(chainId: number | string, address: string, tokenId: string): string {
  return `nft:${chainId}:${address.toLowerCase()}:${tokenId}`
}

export function campaignSharedId(chainId: number | string, pool: string): string {
  return `campaign:${chainId}:${pool.toLowerCase()}`
}

/** The shared identity of a route, or null when the route is not one of the three moments. */
export function routeTag(screen: ScreenId, params?: unknown): string | null {
  const chainId = param(params, 'chainId')
  const address = param(params, 'address')
  switch (screen) {
    case 'token':
      return chainId !== null && address !== null ? tokenSharedId(chainId, address) : null
    case 'nft': {
      const tokenId = param(params, 'tokenId')
      return chainId !== null && address !== null && tokenId !== null
        ? pieceSharedId(chainId, address, tokenId)
        : null
    }
    case 'campaign': {
      const pool = param(params, 'pool')
      return chainId !== null && pool !== null ? campaignSharedId(chainId, pool) : null
    }
    default:
      return null
  }
}
