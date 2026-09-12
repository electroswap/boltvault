/**
 * The wallet is cooling off, and says so (ES-BV-008).
 *
 * Five wrong attempts arm a wait that doubles to fifteen minutes, checked
 * before the KDF runs on every path that tests a factor. Every screen that
 * asks for a password reported that refusal with its own "wrong password"
 * copy — so somebody whose password was right was told it was wrong, and
 * re-typed it into a door that was not going to open for another half a
 * minute. The engine already carries the seconds on the error; this reads
 * them.
 */
import { t } from './i18n'

/**
 * The sentence to show, or null when this error is not a cooling-off refusal.
 *
 * Read structurally rather than with `instanceof`: on the extension the error
 * crosses a port and arrives as a plain object with the same two fields, and a
 * class check there would silently never match.
 */
export function throttleMessage(err: unknown): string | null {
  const e = err as { code?: unknown; data?: { seconds?: unknown } } | null
  if (e?.code !== 'throttled') return null
  const seconds = typeof e.data?.seconds === 'number' ? e.data.seconds : null
  if (seconds === null)
    return t({ id: 'throttle.wait', message: 'Too many wrong attempts. Wait a moment and try again.' })
  return seconds > 90
    ? t({
        id: 'throttle.wait.minutes',
        message: 'Too many wrong attempts. Try again in about {n} minutes.',
        values: { n: Math.ceil(seconds / 60) },
      })
    : t({
        id: 'throttle.wait.seconds',
        message: 'Too many wrong attempts. Try again in {n} seconds.',
        values: { n: seconds },
      })
}
