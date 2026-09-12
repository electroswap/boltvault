/**
 * Serve stale, refresh behind it (plan A2), the UI half. A screen hands in
 * two reads — `cached()` (the engine's last-good document, instant) and
 * `fresh()` (the network or chain) — and gets a value at once, a freshness
 * mark, and a silent refresh whenever the engine says the key changed. The
 * state machine is a pure reducer so it can be tested without a renderer.
 */
import type { Cached, WalletEngine } from '@boltvault/engine'
import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useEngine } from '../engine/EngineProvider'

export type Freshness = 'loading' | 'cached' | 'fresh' | 'error'

export interface CachedState<T> {
  readonly value: T | null
  readonly freshness: Freshness
  readonly observedAt: number | null
  readonly error: string | null
  readonly refreshing: boolean
}

export type CachedAction<T> =
  | { type: 'seed'; seeded: Cached<T> | null }
  | { type: 'cached'; cached: Cached<T> }
  | { type: 'refreshing' }
  | { type: 'fresh'; value: T; at: number }
  | { type: 'error'; message: string }

export const INITIAL: CachedState<never> = { value: null, freshness: 'loading', observedAt: null, error: null, refreshing: false }

/** A value never becomes null on an error; an error next to a value is a note, not a state. */
export function reduceCached<T>(state: CachedState<T>, action: CachedAction<T>): CachedState<T> {
  switch (action.type) {
    case 'seed':
      // A remount starts from what this key last showed, not from nothing.
      // `cached()` is a round trip to the service worker, so resetting to
      // INITIAL meant every mount rendered a skeleton first and the screen
      // went there -> gone -> there. Refreshing is true because the effect
      // that seeds also goes and revalidates.
      if (action.seeded === null) return INITIAL as CachedState<T>
      return { value: action.seeded.value, observedAt: action.seeded.observedAt, freshness: 'cached', error: null, refreshing: true }
    case 'cached':
      // A cached read never downgrades a fresh value.
      if (state.freshness === 'fresh') return state
      return { ...state, value: action.cached.value, observedAt: action.cached.observedAt, freshness: 'cached', error: null }
    case 'refreshing':
      return { ...state, refreshing: true }
    case 'fresh':
      return { value: action.value, observedAt: action.at, freshness: 'fresh', error: null, refreshing: false }
    case 'error':
      return { ...state, refreshing: false, error: action.message, freshness: state.value === null ? 'error' : state.freshness }
  }
}

export interface UseCachedOptions<T> {
  /** Null disables the hook (no account yet). Must equal the engine's `cacheKey(...)` for the resource. */
  readonly key: string | null
  cached(engine: WalletEngine): Promise<Cached<T> | null>
  /** Absent = never refresh from here; the value comes from the cache and its `cache.changed` events only. */
  fresh?(engine: WalletEngine): Promise<T>
  /** Re-read `cached()` when a `cache.changed` event names this key (default true). */
  readonly live?: boolean
  /** Skip `fresh()` when the cached value is younger than this (default 0: always refresh). */
  readonly maxAgeMs?: number
}

export interface UseCachedResult<T> extends CachedState<T> {
  refresh(): void
}

/**
 * What each key last showed, for the life of this page.
 *
 * The engine already persists last-good documents, but reading one is a Port
 * round trip, and React state does not survive an unmount — and the shell
 * unmounts a screen on every navigation. So a screen you had already seen
 * still blanked on the way back in. This is the synchronous half: it lets the
 * very first render paint, and the engine's answer arrives behind it.
 */
const lastGood = new Map<string, Cached<unknown>>()
/** A popup session is short; this is only a guard against unbounded growth. */
const LAST_GOOD_MAX = 60

function remember(key: string, hit: Cached<unknown>): void {
  if (lastGood.size >= LAST_GOOD_MAX && !lastGood.has(key)) {
    const oldest = lastGood.keys().next().value
    if (oldest !== undefined) lastGood.delete(oldest)
  }
  lastGood.delete(key)
  lastGood.set(key, hit)
}

function seedOf<T>(key: string | null): Cached<T> | null {
  if (key === null) return null
  return (lastGood.get(key) as Cached<T> | undefined) ?? null
}

export function useCached<T>(opts: UseCachedOptions<T>): UseCachedResult<T> {
  const engine = useEngine()
  const [state, dispatch] = useReducer(
    reduceCached as (s: CachedState<T>, a: CachedAction<T>) => CachedState<T>,
    // Seeded on the first render, so a screen that has been open before never
    // shows a skeleton on the way back in.
    opts.key,
    (k: string | null): CachedState<T> => {
      const hit = seedOf<T>(k)
      return hit === null ? (INITIAL as CachedState<T>) : { value: hit.value, observedAt: hit.observedAt, freshness: 'cached', error: null, refreshing: true }
    },
  )
  // The readers may be inline lambdas; the effects key on `key` alone.
  const readers = useRef(opts)
  readers.current = opts
  const { key, live = true, maxAgeMs = 0 } = opts

  const runFresh = useCallback(
    (alive: () => boolean, forKey: string | null) => {
      const fresh = readers.current.fresh
      if (!fresh) return
      dispatch({ type: 'refreshing' })
      fresh(engine).then(
        (value) => {
          if (!alive()) return
          const at = Date.now()
          if (forKey !== null) remember(forKey, { value, observedAt: at })
          dispatch({ type: 'fresh', value, at })
        },
        (err: unknown) => alive() && dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
      )
    },
    [engine],
  )

  useEffect(() => {
    dispatch({ type: 'seed', seeded: seedOf<T>(key) })
    if (key === null) return
    let on = true
    const alive = (): boolean => on
    readers.current.cached(engine).then(
      (hit) => {
        if (!on) return
        if (hit) {
          remember(key, hit)
          dispatch({ type: 'cached', cached: hit })
        }
        if (hit && maxAgeMs > 0 && Date.now() - hit.observedAt < maxAgeMs) return
        runFresh(alive, key)
      },
      () => on && runFresh(alive, key),
    )
    return () => {
      on = false
    }
  }, [engine, key, maxAgeMs, runFresh])

  useEffect(() => {
    if (key === null || !live) return
    return engine.events.subscribe((e) => {
      if (e.type !== 'cache.changed' || e.key !== key) return
      readers.current.cached(engine).then(
        (hit) => {
          if (!hit) return
          remember(key, hit)
          dispatch({ type: 'cached', cached: hit })
        },
        () => undefined,
      )
    })
  }, [engine, key, live])

  const refresh = useCallback(() => {
    if (key !== null) runFresh(() => true, key)
  }, [key, runFresh])

  return { ...state, refresh }
}
