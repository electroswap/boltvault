/**
 * Phishing / known-scam origin check.
 *
 * `origin` may be a full URL or a bare host. We compare against the scam list
 * on the host (without port) so that `https://etn-scam.io/path?q=1` matches a
 * listed `etn-scam.io`, and a listed full URL also matches.
 */
function hostOf(origin: string): string | null {
  const trimmed = origin.trim().toLowerCase()
  if (!trimmed) return null
  // strip scheme if present
  const withoutScheme = trimmed.includes('://') ? trimmed.slice(trimmed.indexOf('://') + 3) : trimmed
  const hostPart = withoutScheme.split('/')[0] // drop path
  if (hostPart === undefined || hostPart === '') return null
  const host = hostPart.split(':')[0] // drop port
  return host === undefined || host === '' ? null : host
}

export function phishingCheck(origin: string, scamOrigins: string[]): 'known-scam' | 'ok' {
  const host = hostOf(origin)
  if (host == null) return 'ok'
  for (const scam of scamOrigins) {
    const s = scam.trim().toLowerCase()
    if (!s) continue
    if (s === host) return 'known-scam'
    const scamHost = hostOf(s)
    if (scamHost !== null && scamHost === host) return 'known-scam'
    // also allow a full-URL exact match (different path doesn't matter, host does)
    if (s === origin.trim().toLowerCase()) return 'known-scam'
  }
  return 'ok'
}

/**
 * Load a static scam-origins list from a JSON string (array of strings).
 * Returns [] on null/undefined or invalid JSON (e.g. first run, no file).
 */
export function loadScamList(json: string | null): string[] {
  if (json == null) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}
