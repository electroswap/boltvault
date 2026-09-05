/**
 * The shared memory router (master plan §2.5). Screens are declared once in
 * ./registry.ts; every body mounts the same TabShell. Four tabs plus a push
 * stack over them; sheets are routes with `presentation: 'sheet'`.
 *
 * The extension uses this directly (a popup has no history). Mobile mounts
 * the same shell; the React Navigation native-stack adapter (native
 * transitions, shared elements) is layered on in the mobile-only milestone
 * without changing a screen.
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { ScreenId, ScreenParams, TabId } from './registry'
import { TABS } from './registry'

export interface Route<S extends ScreenId = ScreenId> {
  readonly screen: S
  readonly params?: ScreenParams[S]
}

export interface RouterState {
  readonly tab: TabId
  /** Routes pushed over the active tab, oldest first. */
  readonly stack: readonly Route[]
}

export interface Router {
  readonly state: RouterState
  readonly current: Route
  navigate<S extends ScreenId>(screen: S, params?: ScreenParams[S]): void
  replace<S extends ScreenId>(screen: S, params?: ScreenParams[S]): void
  back(): void
  setTab(tab: TabId): void
  /** Pop everything back to the tab. */
  reset(): void
}

type Listener = () => void

export class RouterStore {
  private state: RouterState
  private readonly listeners = new Set<Listener>()

  constructor(initial: Partial<RouterState> = {}) {
    this.state = { tab: initial.tab ?? 'home', stack: initial.stack ?? [] }
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

  setTab(tab: TabId): void {
    this.set({ tab, stack: [] })
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
  return useMemo<Router>(() => {
    const top = state.stack[state.stack.length - 1]
    const current: Route = top ?? { screen: TABS[state.tab].screen }
    return {
      state,
      current,
      navigate: (screen, params) => store.navigate(params === undefined ? { screen } : { screen, params }),
      replace: (screen, params) => store.replace(params === undefined ? { screen } : { screen, params }),
      back: () => store.back(),
      setTab: (tab) => store.setTab(tab),
      reset: () => store.reset(),
    }
  }, [state, store])
}
