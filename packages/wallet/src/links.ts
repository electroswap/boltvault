/**
 * Deep and universal links (master plan §5.3): `boltvault://…`,
 * `https://wallet.electroswap.io/…`, `wc:` pairing URIs and EIP-681
 * `ethereum:` payment links, parsed with zod into navigation actions. A link
 * never executes anything beyond navigation and a pairing.
 */
import { z } from 'zod'

const UNIVERSAL_HOST = 'wallet.electroswap.io'
const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

export type LinkAction =
  | { readonly kind: 'wc'; readonly uri: string }
  | {
      readonly kind: 'launchpad'
      readonly pool: string
      readonly referrer: string | null
      readonly url: string
    }
  | {
      readonly kind: 'pay'
      readonly to: string
      readonly chainId: number | null
      readonly token: string | null
      readonly amount: string | null
    }
  | {
      readonly kind: 'screen'
      readonly screen: 'home' | 'swap' | 'explore' | 'activity' | 'bridge' | 'receive' | 'browser'
      readonly url?: string
    }

function query(u: URL): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of u.searchParams) out[k] = v
  return out
}

function payFrom(
  to: string,
  chainId: number | null,
  q: Record<string, string>,
  token: string | null,
): LinkAction | null {
  const parsedTo = Address.safeParse(to)
  if (!parsedTo.success) return null
  const amount = q['amount'] ?? q['value'] ?? q['uint256'] ?? null
  return {
    kind: 'pay',
    to: parsedTo.data,
    chainId,
    token,
    amount: amount && /^[0-9.]+$/.test(amount) ? amount : null,
  }
}

/** EIP-681: `ethereum:0xTo@52014?value=…` or `ethereum:0xToken@52014/transfer?address=0xTo&uint256=…`. */
function eip681(raw: string): LinkAction | null {
  const m = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/(\w+))?(?:\?(.*))?$/.exec(raw)
  if (!m) return null
  const [, target, chain, fn, qs] = m
  const q: Record<string, string> = {}
  for (const part of (qs ?? '').split('&')) {
    const [k, v] = part.split('=')
    if (k) q[decodeURIComponent(k)] = decodeURIComponent(v ?? '')
  }
  const chainId = chain ? Number(chain) : null
  if (fn === 'transfer') return payFrom(q['address'] ?? '', chainId, q, target ?? null)
  if (fn) return null
  return payFrom(target ?? '', chainId, q, null)
}

export function parseLink(raw: string): LinkAction | null {
  const s = raw.trim()
  if (!s) return null
  // The raw form gets the same shape check as the one arriving through a link.
  if (s.startsWith('wc:')) return isWcPairingUri(s) ? { kind: 'wc', uri: s } : null
  if (s.startsWith('ethereum:')) return eip681(s)
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  const isApp = u.protocol === 'boltvault:'
  const isUniversal = u.protocol === 'https:' && u.host === UNIVERSAL_HOST
  if (!isApp && !isUniversal) return null
  // boltvault://wc?uri=…  →  host "wc"; https://wallet.electroswap.io/wc?uri=…  →  path "/wc"
  const segments = (isApp ? [u.host, ...u.pathname.split('/')] : u.pathname.split('/')).filter(
    Boolean,
  )
  const [head, second] = segments
  const q = query(u)
  switch (head) {
    case 'wc': {
      /*
        Any string starting `wc:` used to be forwarded to the WalletConnect SDK
        untouched. A pairing URI has a shape — a 64-hex topic, version 2, and a
        64-hex symmetric key — and anything that does not have it is not a
        pairing, so it has no business reaching the relay. The pairing itself
        still proceeds without a prompt, which is the expected WalletConnect
        flow; what follows it is a Connect sheet that can no longer be
        inherited from someone else's session.
      */
      return isWcPairingUri(q['uri'] ?? '') ? { kind: 'wc', uri: q['uri'] ?? '' } : null
    }
    case 'launchpad': {
      const pool = Address.safeParse(second ?? '')
      if (!pool.success) return null
      const ref = Address.safeParse(q['ref'] ?? q['refId'] ?? '')
      return { kind: 'launchpad', pool: pool.data, referrer: ref.success ? ref.data : null, url: s }
    }
    case 'pay':
      return payFrom(
        q['to'] ?? '',
        q['chainId'] ? Number(q['chainId']) : null,
        q,
        q['token'] ?? null,
      )
    case 'swap':
    case 'explore':
    case 'activity':
    case 'bridge':
    case 'receive':
      return { kind: 'screen', screen: head }
    case 'browser':
    case 'open': {
      // HTTPS only: an inbound link must not be able to put a page that can be
      // rewritten in flight inside the wallet's own chrome. Where it then goes
      // is still subject to the firewall's origin rules at signing time.
      const url = q['url'] ?? ''
      return /^https:\/\//i.test(url) ? { kind: 'screen', screen: 'browser', url } : null
    }
    case undefined:
    case 'home':
      return { kind: 'screen', screen: 'home' }
    default:
      return null
  }
}

/** A WalletConnect v2 pairing URI: `wc:<64 hex>@2?…symKey=<64 hex>`. */
const HEX64 = /^[0-9a-f]{64}$/i
export function isWcPairingUri(uri: string): boolean {
  if (!uri.startsWith('wc:')) return false
  const [head, queryString = ''] = uri.slice(3).split('?')
  const [topic, version] = (head ?? '').split('@')
  if (!topic || !HEX64.test(topic) || version !== '2') return false
  const symKey = new URLSearchParams(queryString).get('symKey') ?? ''
  return HEX64.test(symKey)
}
