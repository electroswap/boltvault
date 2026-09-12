/**
 * Opening an outward link, safely (ES-BV-035).
 *
 * Several of the links the wallet offers come from the API — a token's
 * homepage, its Twitter and Telegram, a campaign's links — and were handed
 * straight to `Linking.openURL` on mobile, which will launch whatever app
 * claims the scheme. This is the one door they go through: https only, no
 * credentials in the URL, and nothing on the signed scam list.
 *
 * The list is fetched once per mount and is not awaited on the tap: a link is
 * either allowed by its scheme or it is not, and the scam list only ever
 * removes more.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { safeExternalUrl } from '../safeUrl'

export interface SafeOpen {
  /** Opens the link if it passes; returns false when nothing was opened. */
  (url: string | null | undefined): boolean
}

export function useSafeOpen(): SafeOpen {
  const engine = useEngine()
  const host = useHost()
  const scam = useRef<readonly string[]>([])

  useEffect(() => {
    let alive = true
    engine.flags.scamOrigins().then(
      (list) => {
        if (alive) scam.current = list
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [engine])

  return useCallback(
    (url: string | null | undefined): boolean => {
      const safe = safeExternalUrl(url, scam.current)
      if (!safe || !host.openUrl) return false
      void host.openUrl(safe)
      return true
    },
    [host],
  )
}
