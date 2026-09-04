/**
 * Keep-alive window (pure timing).
 *
 * The offscreen document keeps the WebHID session alive while the device is
 * signing. This models a keep-alive token with a TTL, in pure time-math terms
 * (no timers, no device) so it is fully testable.
 *
 * Ping cadence (simplified, documented): the offscreen doc sends ONE ping at
 * 80% of the TTL window — i.e. at `startedAt + floor(ttlMs * 0.8)` — which is
 * comfortably inside the window, so a single scheduled ping re-arms the
 * session before expiry. (A production loop would refresh at 80% cadence and
 * re-baseline startedAt on each successful ping; the token shape stays the same.)
 */

/** A keep-alive token: when it started and its time-to-live in ms. */
export interface KeepAlive {
  readonly startedAt: number
  readonly ttlMs: number
}

/**
 * Is the session still alive at time `now`?
 * Alive strictly while `now - startedAt < ttlMs` (at or after expiry: dead).
 */
export function isAlive(ka: KeepAlive, now: number): boolean {
  return now - ka.startedAt < ka.ttlMs
}

/**
 * When to send the next keep-alive ping, or null if already dead.
 *
 * Alive:  returns `startedAt + floor(ttlMs * 0.8)` (one ping at 80% of window).
 * Dead:   returns null (no point pinging an expired window).
 */
export function nextPingAt(ka: KeepAlive, now: number): number | null {
  if (!isAlive(ka, now)) {
    return null
  }
  return ka.startedAt + Math.floor(ka.ttlMs * 0.8)
}

/**
 * Create a keep-alive token starting at `now`.
 * Default TTL is 30000 ms (30 s).
 */
export function defaultKeepAlive(now: number, ttlMs?: number): KeepAlive {
  return { startedAt: now, ttlMs: ttlMs ?? 30000 }
}
