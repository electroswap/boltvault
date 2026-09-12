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

import { isScamOrigin } from '@boltvault/security'

/** Entries as the signed list writes them: a host, or an origin with a scheme. */
export type ScamHosts = readonly string[]

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
  /*
    The same reading of the list as the firewall's (ES-BV-065).

    This gate compared the link's host against the raw strings while the
    firewall first normalised each entry with `hostOf()`, which strips a
    scheme, a port and a path. The signed list documents its entries as
    registrable origins or hosts, so an entry written `https://evil.example`
    blocked a dApp sheet and was silently ignored here — the Token, Campaign,
    Piece and Activity links opened it. The naive two-label fallback that used
    to sit here also treated a listed `x.co.uk` as blocking every `.co.uk`
    host, which was safe and wrong.
  */
  if (isScamOrigin(parsed.hostname, scamHosts)) return null
  return parsed.toString()
}
