/**
 * A screen says "I have nothing worth showing yet"; the shell draws the
 * loader.
 *
 * Owner: "I'm still not seeing the loader present until everything on the
 * collections page has been loaded. It's almost as if the loader should
 * actually be an overlay until the rest of the page is rendered ... That would
 * probably be the best way to apply the loader throughout."
 *
 * That is what this is. Screens declare readiness; TabShell owns the one
 * overlay. Two things fall out of putting it there rather than in each screen:
 *
 *  - it centres against the viewport. A loader inside a screen is a flex child
 *    of the scroll content and centres inside *that*, which is why it appeared
 *    near the top and jumped as content arrived.
 *  - the screen still mounts, fetches and lays out underneath, so lifting the
 *    loader reveals a finished page instead of starting one.
 */
import { useEffect, useState } from 'react'

type Listener = () => void

const busy = new Set<string>()
const listeners = new Set<Listener>()

function emit(): void {
  for (const l of listeners) l()
}

/**
 * Report this screen's readiness. The id keeps two screens from clearing each
 * other's flag across a navigation, and unmounting always clears it — a screen
 * that goes away can never leave the shell stuck behind a loader.
 */
export function useScreenBusy(id: string, isBusy: boolean): void {
  useEffect(() => {
    const had = busy.has(id)
    if (isBusy && !had) {
      busy.add(id)
      emit()
    } else if (!isBusy && had) {
      busy.delete(id)
      emit()
    }
  }, [id, isBusy])

  useEffect(() => {
    return () => {
      if (busy.delete(id)) emit()
    }
  }, [id])
}

/** True while any mounted screen is still assembling itself. */
export function useAnyScreenBusy(): boolean {
  const [value, setValue] = useState(busy.size > 0)
  useEffect(() => {
    const listener = (): void => setValue(busy.size > 0)
    listeners.add(listener)
    listener()
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return value
}
