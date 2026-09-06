/**
 * Keep showing what a screen last showed, for screens that hold their own
 * state instead of going through `useCached`.
 *
 * Reported: "It'll show the cached data, but then the loader shows again and
 * then the refreshed data shows again. There (stale) -> gone (loading) ->
 * there (refreshed) ... I would expect: there (stale) -> there (refresh in the
 * background) -> there (refreshed)."
 *
 * The cause is the same everywhere: the shell unmounts a screen on every
 * navigation, React state goes with it, and the reload is a round trip to the
 * service worker. So the screen renders its empty state first, however good
 * the engine's cache is. `useCached` solves this by seeding its reducer;
 * screens with bespoke effects use this instead, which needs one line at the
 * point of render and no restructuring.
 *
 *   const shown = useLastGood(`collection:${chainId}:${address}`, collection)
 *
 * Keyed, so navigating to a *different* collection never shows the previous
 * one's rows — an unseen key has nothing to remember and correctly starts
 * empty.
 */
import { useEffect, useRef } from 'react'

const memory = new Map<string, unknown>()
/** A popup session is short; this only guards against unbounded growth. */
const MAX = 80

function keep(key: string, value: unknown): void {
  if (memory.size >= MAX && !memory.has(key)) {
    const oldest = memory.keys().next().value
    if (oldest !== undefined) memory.delete(oldest)
  }
  memory.delete(key)
  memory.set(key, value)
}

/** True when a value is worth remembering — an empty list is not an answer. */
function present(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

/**
 * The live value when there is one, otherwise whatever this key last had.
 * `null` for a key never seen, so a first visit still shows its skeleton.
 */
export function useLastGood<T>(key: string | null, value: T | null | undefined): T | null {
  const latest = useRef<T | null>(null)
  if (key !== null && present(value)) latest.current = value as T
  useEffect(() => {
    // The write lands in an effect so render stays free of side effects; the
    // read below is synchronous, which is the whole point.
    if (key !== null && present(latest.current)) keep(key, latest.current)
  })
  if (present(value)) return value as T
  if (key === null) return null
  return (memory.get(key) as T | undefined) ?? null
}

/** Tests and the harness: forget everything remembered. */
export function clearLastGood(): void {
  memory.clear()
}
