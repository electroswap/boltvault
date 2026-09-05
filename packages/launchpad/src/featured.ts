export interface Featured {
  pool: string
  name?: string
}

/**
 * Parse the static featured.json payload ({ pool: string, name?: string }).
 * Returns null on 404/empty/invalid JSON, or when `pool` is missing/non-string.
 */
export function parseFeatured(json: string | null | undefined): Featured | null {
  if (json === null || json === undefined) return null
  const trimmed = json.trim()
  if (trimmed === '') return null
  let parsed: any
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  if (typeof parsed.pool !== 'string' || parsed.pool === '') return null
  const featured: Featured = { pool: parsed.pool }
  if (typeof parsed.name === 'string' && parsed.name !== '') {
    featured.name = parsed.name
  }
  return featured
}
