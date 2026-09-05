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
  | { readonly kind: 'launchpad'; readonly pool: string; readonly referrer: string | null; readonly url: string }
  | { readonly kind: 'pay'; readonly to: string; readonly chainId: number | null; readonly token: string | null; readonly amount: string | null }
  | { readonly kind: 'screen'; readonly screen: 'home' | 'swap' | 'explore' | 'activity' | 'bridge' | 'receive' | 'browser'; readonly url?: string }

function query(u: URL): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of u.searchParams) out[k] = v
  return out
}

function payFrom(to: string, chainId: number | null, q: Record<string, string>, token: string | null): LinkAction | null {
  const parsedTo = Address.safeParse(to)
  if (!parsedTo.success) return null
  const amount = q['amount'] ?? q['value'] ?? q['uint256'] ?? null
  return { kind: 'pay', to: parsedTo.data, chainId, token, amount: amount && /^[0-9.]+$/.test(amount) ? amount : null }
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
  if (s.startsWith('wc:')) return { kind: 'wc', uri: s }
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
  const segments = (isApp ? [u.host, ...u.pathname.split('/')] : u.pathname.split('/')).filter(Boolean)
  const [head, second] = segments
  const q = query(u)
  switch (head) {
    case 'wc': {
      const uri = q['uri'] ?? ''
      return uri.startsWith('wc:') ? { kind: 'wc', uri } : null
    }
    case 'launchpad': {
      const pool = Address.safeParse(second ?? '')
      if (!pool.success) return null
      const ref = Address.safeParse(q['ref'] ?? q['refId'] ?? '')
      return { kind: 'launchpad', pool: pool.data, referrer: ref.success ? ref.data : null, url: s }
    }
    case 'pay':
      return payFrom(q['to'] ?? '', q['chainId'] ? Number(q['chainId']) : null, q, q['token'] ?? null)
    case 'swap':
    case 'explore':
    case 'activity':
    case 'bridge':
    case 'receive':
      return { kind: 'screen', screen: head }
    case 'browser':
    case 'open': {
      const url = q['url'] ?? ''
      return /^https?:\/\//.test(url) ? { kind: 'screen', screen: 'browser', url } : null
    }
    case undefined:
    case 'home':
      return { kind: 'screen', screen: 'home' }
    default:
      return null
  }
}
