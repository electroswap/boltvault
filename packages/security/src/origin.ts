/**
 * Origin identity (master plan §3.6): registrable origins, the scam list, and
 * typosquat scoring against the protected set. Pure string work.
 */

/** The names a phisher imitates. Subdomains of these are fine; lookalikes are not. */
export const PROTECTED_HOSTS: readonly string[] = [
  'electroswap.io',
  'electroneum.com',
  'ens.electroneum.com',
  'hyperlane.xyz',
  'metamask.io',
  'ledger.com',
  'trezor.io',
  'walletconnect.com',
]

/**
 * ElectroSwap's own web surfaces — the sites that are us rather than a dApp.
 *
 * Two things key off this and nothing else should: the wallet answers
 * `boltvault_feePolicy` only here (an account's tier is a reading of what it
 * holds, and any site being able to ask would be a fingerprint), and the
 * firewall reads a `PAY_PORTION` to our own sink from here as our wallet fee
 * rather than as a third party's tip.
 *
 * It is deliberately a suffix match over one registrable name, not a list of
 * hosts: `app.`, `www.` and whatever ops serves next are all ElectroSwap, and a
 * list that has to be edited per subdomain is a list that will be wrong. It is
 * not a trust grant — a first-party origin still goes through every rule, and
 * `typosquat` above is what stops `electroswap.io.evil.net` reaching here.
 */
export const FIRST_PARTY_HOSTS: readonly string[] = ['electroswap.io']

/** True for ElectroSwap's own origins (and their subdomains) over https. */
export function isFirstPartyOrigin(
  origin: string,
  firstParty: readonly string[] = FIRST_PARTY_HOSTS,
): boolean {
  // http:// is never us. The in-app browser upgrades what a user types, but a
  // cleartext page is one an attacker can rewrite in flight, and handing it the
  // fee policy — or believing its fee — would be trusting the rewrite.
  if (!origin.toLowerCase().startsWith('https://')) return false
  const host = hostOf(origin)
  if (!host) return false
  return firstParty.some((p) => host === p || host.endsWith(`.${p}`))
}

/** `scheme://host[:port]` for http(s); null for anything a session may not be keyed by. */
export function registrableOrigin(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname) return null
  return u.origin
}

export function hostOf(origin: string): string | null {
  const trimmed = origin.trim().toLowerCase()
  if (!trimmed) return null
  const withoutScheme = trimmed.includes('://')
    ? trimmed.slice(trimmed.indexOf('://') + 3)
    : trimmed
  const hostPart = withoutScheme.split('/')[0] ?? ''
  const host = hostPart.split(':')[0] ?? ''
  return host === '' ? null : host
}

export function isScamOrigin(origin: string, scamOrigins: readonly string[]): boolean {
  const host = hostOf(origin)
  if (!host) return false
  for (const s of scamOrigins) {
    const scamHost = hostOf(s)
    if (scamHost && (scamHost === host || host.endsWith(`.${scamHost}`))) return true
  }
  return false
}

const HOMOGLYPHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/0/g, 'o'],
  [/1/g, 'l'],
  [/а/g, 'a'],
  [/е/g, 'e'],
  [/о/g, 'o'],
  [/р/g, 'p'],
  [/с/g, 'c'],
  [/х/g, 'x'],
  [/і/g, 'i'],
  [/у/g, 'y'],
]

export function normaliseHomoglyphs(host: string): string {
  let out = host.normalize('NFKC').toLowerCase()
  for (const [re, to] of HOMOGLYPHS) out = out.replace(re, to)
  return out
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    prev = cur
  }
  return prev[n] ?? 0
}

export interface TyposquatHit {
  readonly protectedHost: string
  readonly reason: 'edit_distance' | 'homoglyph' | 'embedded'
}

/**
 * A host is a typosquat when it is within two edits of a protected host (or
 * equal after homoglyph folding) without being that host or one of its
 * subdomains, or when a protected host appears as a label prefix of an
 * unrelated domain (`electroswap.io.claim-airdrop.net`).
 */
export function typosquat(
  host: string,
  protectedHosts: readonly string[] = PROTECTED_HOSTS,
): TyposquatHit | null {
  const h = host.toLowerCase()
  for (const p of protectedHosts) {
    if (h === p || h.endsWith(`.${p}`)) return null
  }
  for (const p of protectedHosts) {
    const registrable = h.split('.').slice(-2).join('.')
    const pRegistrable = p.split('.').slice(-2).join('.')
    if (h.startsWith(`${p}.`) || h.includes(`.${p}.`))
      return { protectedHost: p, reason: 'embedded' }
    const folded = normaliseHomoglyphs(registrable)
    if (folded === pRegistrable && registrable !== pRegistrable)
      return { protectedHost: p, reason: 'homoglyph' }
    const [pName] = pRegistrable.split('.')
    const [name] = registrable.split('.')
    if (
      pName &&
      name &&
      name !== pName &&
      levenshtein(folded.split('.')[0] ?? '', pName) <= 2 &&
      Math.abs(name.length - pName.length) <= 2
    ) {
      return { protectedHost: p, reason: 'edit_distance' }
    }
    if (registrable !== pRegistrable && levenshtein(folded, pRegistrable) <= 2)
      return { protectedHost: p, reason: 'edit_distance' }
  }
  return null
}
