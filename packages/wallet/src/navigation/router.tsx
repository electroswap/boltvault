/**
 * The shared memory router (master plan §2.5). Screens are declared once in
 * ./registry.ts; every body mounts the same TabShell. Three tabs plus a push
 * stack over them; sheets are routes with `presentation: 'sheet'`. A tab can
 * carry a root route with params (Token → Swap prefills, plan B2): the root
 * survives pushes over it and a new `setTab` with params replaces it.
 *
 * The extension uses this directly (a popup has no history). Mobile mounts
 * the same shell; the React Navigation native-stack adapter (native
 * transitions, shared elements) is layered on in the mobile-only milestone
 * without changing a screen.
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { ScreenId, ScreenParams, TabId } from './registry'
import { TABS } from './registry'
import { routeTag, withSharedTransition } from './transitions'

export interface Route<S extends ScreenId = ScreenId> {
  readonly screen: S
  readonly params?: ScreenParams[S]
}

export interface RouterState {
  readonly tab: TabId
  /** Routes pushed over the active tab, oldest first. */
  readonly stack: readonly Route[]
  /** A tab's root route when it was opened with params (Swap prefilled from a token page). */
  readonly roots: Partial<Record<TabId, Route>>
}

export interface Router {
  readonly state: RouterState
  readonly current: Route
  navigate<S extends ScreenId>(screen: S, params?: ScreenParams[S]): void
  replace<S extends ScreenId>(screen: S, params?: ScreenParams[S]): void
  back(): void
  /** Switch tabs; with params, the tab's root remounts with them. On the active tab this pops the stack. */
  setTab(tab: TabId, params?: ScreenParams[ScreenId]): void
  /** Pop everything back to the tab. */
  reset(): void
  /**
   * Return to the tab visited before this one. False when there is no earlier
   * tab — Android's back button uses that to decide whether to close the app
   * rather than swallowing the press.
   */
  backTab(): boolean
}

type Listener = () => void

/** The route on top: the stack's top, else the tab's root with params, else the tab's plain root. */
export function currentRoute(state: RouterState): Route {
  const top = state.stack[state.stack.length - 1]
  return top ?? state.roots[state.tab] ?? { screen: TABS[state.tab].screen }
}

export class RouterStore {
  private state: RouterState
  private readonly listeners = new Set<Listener>()
  /**
   * Tabs visited before the current one, oldest first. RouterState deliberately
   * has no history — a tab switch clears the stack — but the hardware back
   * button has to answer "the prior tab", so the store keeps it beside the
   * state rather than inside it.
   */
  private readonly tabHistory: TabId[] = []

  constructor(initial: Partial<RouterState> = {}) {
    this.state = { tab: initial.tab ?? 'home', stack: initial.stack ?? [], roots: initial.roots ?? {} }
  }

  get(): RouterState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(next: RouterState): void {
    this.state = next
    for (const l of [...this.listeners]) l()
  }

  navigate(route: Route): void {
    this.set({ ...this.state, stack: [...this.state.stack, route] })
  }

  replace(route: Route): void {
    const stack = this.state.stack.slice(0, -1)
    this.set({ ...this.state, stack: [...stack, route] })
  }

  back(): void {
    if (this.state.stack.length === 0) return
    this.set({ ...this.state, stack: this.state.stack.slice(0, -1) })
  }

  setTab(tab: TabId, params?: ScreenParams[ScreenId]): void {
    const roots = params === undefined ? this.state.roots : { ...this.state.roots, [tab]: { screen: TABS[tab].screen, params } as Route }
    if (tab !== this.state.tab) {
      // Keep it shallow: this is a "go back one" trail, not a full journey.
      this.tabHistory.push(this.state.tab)
      if (this.tabHistory.length > 8) this.tabHistory.shift()
    }
    this.set({ tab, stack: [], roots })
  }

  backTab(): boolean {
    const previous = this.tabHistory.pop()
    if (previous === undefined) return false
    const roots = this.state.roots
    this.set({ tab: previous, stack: [], roots })
    return true
  }

  reset(): void {
    this.set({ ...this.state, stack: [] })
  }
}

const RouterContext = createContext<RouterStore | null>(null)

export function RouterProvider({ store, children }: { store: RouterStore; children: ReactNode }) {
  return <RouterContext.Provider value={store}>{children}</RouterContext.Provider>
}

export function useRouter(): Router {
  const store = useContext(RouterContext)
  if (!store) throw new Error('useRouter must be used inside <RouterProvider>')
  const state = useSyncExternalStore(
    useCallback((l: Listener) => store.subscribe(l), [store]),
    () => store.get(),
    () => store.get(),
  )
  const current = currentRoute(state)
  return useMemo<Router>(() => {
    /*
      Shared-element transitions (§7.7) wrap the three moves that carry one
      thing between two screens, in both directions: opening a token, a piece
      or a campaign uses the destination's identity, and coming back uses the
      one we are standing on. Everything else — tab changes, the rest of the
      stack — mutates the store directly, exactly as before.

      `setTab`, `reset` and `backTab` stay unwrapped on purpose. They are never
      one of the three moments, and `backTab` has to answer "was there an
      earlier tab" synchronously for Android's back button, which a transition
      callback (it runs at the browser's next rendering opportunity, not now)
      could not do.
    */
    const here = routeTag(current.screen, current.params)
    const move = (there: string | null, update: () => void): void => withSharedTransition(there ?? here, update)
    return {
      state,
      current,
      navigate: (screen, params) => move(routeTag(screen, params), () => store.navigate(params === undefined ? { screen } : { screen, params })),
      replace: (screen, params) => move(routeTag(screen, params), () => store.replace(params === undefined ? { screen } : { screen, params })),
      back: () => move(null, () => store.back()),
      setTab: (tab, params) => store.setTab(tab, params),
      reset: () => store.reset(),
      backTab: () => store.backTab(),
    }
  }, [state, current, store])
}
