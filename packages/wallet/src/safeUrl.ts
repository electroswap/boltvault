/**
 * The one gate every outward link passes through (ES-BV-035).
 *
 * `host.openUrl` hands the string to `Linking.openURL` on mobile and to
 * `tabs.create` on the extension, and several of the strings it is given come
 * from the API: a token's homepage, its Twitter and Telegram, a campaign's
 * links. Those are typed as plain strings and were opened as received, so an
 * `intent://` or a custom app scheme from a compromised or careless index
 * launched another app straight from a tap inside the wallet — and a
 * `javascript:` URL is worse on any surface that will honour it.
 *
 * Nothing here needs a scheme other than https. A link that is not https, or
 * that carries credentials, or whose host the wallet knows to be a scam, is
 * not opened at all.
 */

/** Hosts a link must never reach, however it got into the data. */
export type ScamHosts = readonly string[]

function registrable(host: string): string {
  const parts = host.toLowerCase().split('.')
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.')
}

/**
 * The URL to open, or null to open nothing.
 *
 * Returns the parsed-and-reserialised form rather than the input, so what is
 * opened is what was checked.
 */
export function safeExternalUrl(url: string | null | undefined, scamHosts: ScamHosts = []): string | null {
  if (typeof url !== 'string' || url.trim() === '') return null
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  // `https://user:pass@real.site@evil.example` and its relatives.
  if (parsed.username !== '' || parsed.password !== '') return null
  if (parsed.hostname === '') return null
  const host = parsed.hostname.toLowerCase()
  const reg = registrable(host)
  if (scamHosts.some((s) => { const t = s.toLowerCase(); return host === t || reg === registrable(t) || host.endsWith(`.${t}`) })) return null
  return parsed.toString()
}
