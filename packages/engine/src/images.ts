/**
 * An image URL the wallet did not choose (ES-BV-059).
 *
 * Token logos come from an unsigned list, a price index or a page's own
 * favicon. Rendering one over plain http leaks the token a user is looking at
 * to anybody on the path and lets it be replaced in flight; a `data:` URI is
 * not an image the wallet asked for; and anything else is a scheme the host
 * may act on. https or nothing.
 */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.trim() === '') return null
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'https:') return null
    if (u.username !== '' || u.password !== '') return null
    return u.toString()
  } catch {
    return null
  }
}
