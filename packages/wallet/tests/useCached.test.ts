/**
 * The serve-stale reducer (plan A2): a value is never taken away by an
 * error, a cached read never downgrades a fresh value, refreshing is a flag
 * beside the value rather than a state of its own.
 */
import { describe, expect, it } from 'vitest'
import { INITIAL, reduceCached, type CachedState } from '../src/hooks/useCached'

const start: CachedState<string> = INITIAL

describe('reduceCached', () => {
  it('starts loading with nothing, paints a cached hit, then marks it refreshing', () => {
    expect(start).toEqual({ value: null, freshness: 'loading', observedAt: null, error: null, refreshing: false })
    const cached = reduceCached(start, { type: 'cached', cached: { value: 'old', observedAt: 10 } })
    expect(cached).toEqual({ value: 'old', freshness: 'cached', observedAt: 10, error: null, refreshing: false })
    expect(reduceCached(cached, { type: 'refreshing' })).toEqual({ ...cached, refreshing: true })
  })

  it('a fresh value replaces everything and clears refreshing and any error', () => {
    const s = reduceCached(reduceCached(start, { type: 'refreshing' }), { type: 'error', message: 'offline' })
    expect(reduceCached(s, { type: 'fresh', value: 'new', at: 20 })).toEqual({ value: 'new', freshness: 'fresh', observedAt: 20, error: null, refreshing: false })
  })

  it('an error with a value keeps the value and its freshness; without one it is the error state', () => {
    const cached = reduceCached(start, { type: 'cached', cached: { value: 'old', observedAt: 10 } })
    const failed = reduceCached(reduceCached(cached, { type: 'refreshing' }), { type: 'error', message: 'offline' })
    expect(failed).toEqual({ value: 'old', freshness: 'cached', observedAt: 10, error: 'offline', refreshing: false })
    expect(reduceCached(reduceCached(start, { type: 'refreshing' }), { type: 'error', message: 'offline' })).toEqual({ value: null, freshness: 'error', observedAt: null, error: 'offline', refreshing: false })
  })

  it('a cached read that arrives after a fresh value is ignored', () => {
    const fresh = reduceCached(start, { type: 'fresh', value: 'new', at: 20 })
    expect(reduceCached(fresh, { type: 'cached', cached: { value: 'old', observedAt: 10 } })).toBe(fresh)
  })

  it('seeding with nothing returns to the initial state', () => {
    const fresh = reduceCached(start, { type: 'fresh', value: 'new', at: 20 })
    expect(reduceCached(fresh, { type: 'seed', seeded: null })).toBe(INITIAL)
  })

  it('seeding with a remembered value paints it at once, still refreshing', () => {
    // The point of the seed: a screen that has been open before must not go
    // back through `loading` on the way in. There -> there (refreshing) ->
    // there, never there -> gone -> there.
    const seeded = reduceCached(INITIAL as typeof start, { type: 'seed', seeded: { value: 'remembered', observedAt: 7 } })
    expect(seeded.value).toBe('remembered')
    expect(seeded.freshness).toBe('cached')
    expect(seeded.observedAt).toBe(7)
    expect(seeded.refreshing).toBe(true)
  })

  it('a seeded value survives until the fresh one replaces it', () => {
    const seeded = reduceCached(INITIAL as typeof start, { type: 'seed', seeded: { value: 'remembered', observedAt: 7 } })
    const refreshing = reduceCached(seeded, { type: 'refreshing' })
    expect(refreshing.value).toBe('remembered')
    const failed = reduceCached(refreshing, { type: 'error', message: 'offline' })
    expect(failed.value).toBe('remembered')
    expect(reduceCached(refreshing, { type: 'fresh', value: 'new', at: 20 }).value).toBe('new')
  })
})
