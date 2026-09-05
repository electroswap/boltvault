/**
 * Poison-pill address check (design: history-poisoning defense).
 *
 * The "4+4" rule: if the recipient address shares the FIRST 4 and LAST 4 hex
 * characters with an address the user has transacted with before, but is NOT
 * that exact address, it is almost certainly a copy/paste poisoning attack.
 *
 * Comparison is case-insensitive; addresses may be checksummed or lowercase.
 * The matched known address (as it appears in `history`) is returned so the
 * UI can show "matches 0xabc...def".
 */
export function poisonCheck(
  recipient: string,
  history: string[],
): { hit: boolean; match: string | null } {
  const r = recipient.trim().toLowerCase()
  for (const known of history) {
    const k = known.trim().toLowerCase()
    if (r === k) continue // exact match → the normal case, not a poison
    if (
      r.length >= 8 &&
      k.length >= 8 &&
      r.slice(0, 4) === k.slice(0, 4) &&
      r.slice(-4) === k.slice(-4)
    ) {
      return { hit: true, match: known }
    }
  }
  return { hit: false, match: null }
}
