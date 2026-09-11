/**
 * A name where an address would go (master plan §8.1 identity).
 *
 * The wallet could already turn a typed `name.etn` into an address; this is the
 * other direction, which is the one the screens need: the seat, the accounts
 * rail and an activity row all print six nibbles and four, and a person reading
 * them cannot tell one of their own addresses from a stranger's.
 *
 * Two things this deliberately is not:
 *
 *  - it is not a lookup per render. Resolved answers live in a module map for
 *    the life of the page, so a list of twelve rows re-rendering on every block
 *    asks the engine nothing. The engine's own `names.lookup` is the second
 *    layer (a session map, then the sealed document cache, then the resolver),
 *    so even the first mount after a popup open usually answers off disk.
 *  - it is not a trust boundary. The name arrives bounded and sanitised from
 *    the engine (`displayName` in namespaces/names.ts), and only when the
 *    reverse record forward-verified; a screen renders what it is given.
 *
 * An address with no name resolves to `null` and is remembered as such, so the
 * miss is asked once rather than on every mount.
 */
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

/** `.etn` names live on Electroneum, and an address is the same address on every chain. */
const ETN = 52014

/** Resolved (or definitively absent) names for this page, keyed `chainId:address`. */
const known = new Map<string, string | null>()
/** In flight, so two screens mounting at once ask once. */
const asking = new Set<string>()
/**
 * Everyone waiting for an answer.
 *
 * Without this, the second component to want an address it found already
 * in-flight would never hear that it landed — it skipped the request, so it had
 * nothing to re-render on, and the name appeared only when something else
 * happened to move. A page has a handful of these at most.
 */
const waiting = new Set<() => void>()

function cacheKeyFor(address: string): string {
  return `${ETN}:${address.toLowerCase()}`
}

/** The engine's cache key for one address's name — the same string `cache.changed` carries. */
const NAMES_FAMILY = 'names.reverse.'

/**
 * Names for a set of addresses, lowercase-keyed. Absent from the map means
 * "no name" — show the shortened address.
 */
export function useNames(addresses: ReadonlyArray<string | null | undefined>): ReadonlyMap<string, string> {
  const engine = useEngine()
  const [, bump] = useState(0)
  const wanted = [...new Set(addresses.filter((a): a is string => typeof a === 'string' && a.length > 0).map((a) => a.toLowerCase()))]
  // The effect keys on the addresses themselves, not on the array identity: a
  // parent that rebuilds the list every render must not re-run the lookup.
  const signature = wanted.join(',')

  useEffect(() => {
    const subscriber = (): void => bump((n) => n + 1)
    waiting.add(subscriber)
    /*
      A name that was just re-pointed is not this page's to keep.

      `setPrimary` invalidates the engine's entry, which announces itself as a
      `cache.changed`; without listening for it, a page that is open for hours —
      the phone, not the popup — would keep printing the name the user just
      replaced, because the map above is only ever added to.
    */
    const off = engine.events.subscribe((e) => {
      if (e.type !== 'cache.changed' || !e.key.startsWith(NAMES_FAMILY)) return
      // `names.reverse.<chainId>.<address>` — the chain is part of it, so an
      // invalidation on another chain does not drop this one's answer.
      const [chain, address] = e.key.slice(NAMES_FAMILY.length).split('.')
      if (!address || Number(chain) !== ETN) return
      known.delete(cacheKeyFor(address))
      for (const notify of waiting) notify()
    })
    return () => {
      waiting.delete(subscriber)
      off()
    }
  }, [engine])

  useEffect(() => {
    const missing = signature
      .split(',')
      .filter(Boolean)
      .filter((a) => !known.has(cacheKeyFor(a)) && !asking.has(cacheKeyFor(a)))
    if (missing.length === 0) return
    for (const a of missing) asking.add(cacheKeyFor(a))
    const done = (): void => {
      for (const a of missing) asking.delete(cacheKeyFor(a))
      for (const notify of waiting) notify()
    }
    engine.names.lookup({ chainId: ETN, addresses: missing }).then((rows) => {
      // `verified` is the forward check: an unverified reverse record is a
      // claim, not a name, and §3.6 does not display claims.
      for (const r of rows) known.set(cacheKeyFor(r.address), r.verified ? r.name : null)
      done()
    }, done)
  }, [engine, signature])

  const out = new Map<string, string>()
  for (const a of wanted) {
    const name = known.get(cacheKeyFor(a))
    if (name) out.set(a, name)
  }
  return out
}

/** One address — the seat, a subtitle, a detail row. */
export function useName(address: string | null | undefined): string | null {
  const names = useNames([address])
  return address ? (names.get(address.toLowerCase()) ?? null) : null
}
