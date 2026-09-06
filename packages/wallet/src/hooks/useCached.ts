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
  | { type: 'reset' }
  | { type: 'cached'; cached: Cached<T> }
  | { type: 'refreshing' }
  | { type: 'fresh'; value: T; at: number }
  | { type: 'error'; message: string }

export const INITIAL: CachedState<never> = { value: null, freshness: 'loading', observedAt: null, error: null, refreshing: false }

/** A value never becomes null on an error; an error next to a value is a note, not a state. */
export function reduceCached<T>(state: CachedState<T>, action: CachedAction<T>): CachedState<T> {
  switch (action.type) {
    case 'reset':
      return INITIAL
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
  fresh(engine: WalletEngine): Promise<T>
  /** Re-read `cached()` when a `cache.changed` event names this key (default true). */
  readonly live?: boolean
  /** Skip `fresh()` when the cached value is younger than this (default 0: always refresh). */
  readonly maxAgeMs?: number
}

export interface UseCachedResult<T> extends CachedState<T> {
  refresh(): void
}

export function useCached<T>(opts: UseCachedOptions<T>): UseCachedResult<T> {
  const engine = useEngine()
  const [state, dispatch] = useReducer(reduceCached as (s: CachedState<T>, a: CachedAction<T>) => CachedState<T>, INITIAL as CachedState<T>)
  // The readers may be inline lambdas; the effects key on `key` alone.
  const readers = useRef(opts)
  readers.current = opts
  const { key, live = true, maxAgeMs = 0 } = opts

  const runFresh = useCallback(
    (alive: () => boolean) => {
      dispatch({ type: 'refreshing' })
      readers.current.fresh(engine).then(
        (value) => alive() && dispatch({ type: 'fresh', value, at: Date.now() }),
        (err: unknown) => alive() && dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
      )
    },
    [engine],
  )

  useEffect(() => {
    dispatch({ type: 'reset' })
    if (key === null) return
    let on = true
    const alive = (): boolean => on
    readers.current.cached(engine).then(
      (hit) => {
        if (!on) return
        if (hit) dispatch({ type: 'cached', cached: hit })
        if (hit && maxAgeMs > 0 && Date.now() - hit.observedAt < maxAgeMs) return
        runFresh(alive)
      },
      () => on && runFresh(alive),
    )
    return () => {
      on = false
    }
  }, [engine, key, maxAgeMs, runFresh])

  useEffect(() => {
    if (key === null || !live) return
    return engine.events.subscribe((e) => {
      if (e.type !== 'cache.changed' || e.key !== key) return
      readers.current.cached(engine).then((hit) => hit && dispatch({ type: 'cached', cached: hit }), () => undefined)
    })
  }, [engine, key, live])

  const refresh = useCallback(() => {
    if (key !== null) runFresh(() => true)
  }, [key, runFresh])

  return { ...state, refresh }
}
