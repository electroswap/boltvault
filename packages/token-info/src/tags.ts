/**
 * Tag normalization (design T5.5). Tags are free-form upstream; the token info
 * UI wants trimmed, deduped, bounded tag chips.
 */
/** Max number of tags kept after normalization. */
export const MAX_TAGS = 4

export const SWAP_TAG = 'swap'

/**
 * Trim, drop empty, dedupe case-insensitively (keep first occurrence),
 * cap at 4. Order of first occurrence is preserved.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (trimmed === '') continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

/** Case-insensitive membership test over raw or normalized tags. */
export function hasTag(tags: readonly string[], tag: string): boolean {
  const needle = tag.trim().toLowerCase()
  return tags.some((t) => t.trim().toLowerCase() === needle)
}
