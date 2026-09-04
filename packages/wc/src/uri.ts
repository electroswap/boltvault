/**
 * WalletConnect v2 `wc:` pairing URI — pure build/parse (no WC SDK, no network).
 *
 * Format: `wc:${topic}@${relay}?symKey=${symKey}&protocols=${protocols}`
 *
 * `topic` and `symKey` are 64-hex (32-byte) values. `protocols` may be a
 * comma-joined list (e.g. `wallet,snap`). Query parsing is manual (split on
 * '?' / '&' / '='), NOT URLSearchParams — same approach as EIP-681, to avoid
 * `+` vs `%20` surprises.
 */
export interface WcPairing {
  readonly topic: string // 64 hex chars
  readonly relay: string // e.g. 'relay.walletconnect.com'
  readonly symKey: string // 64 hex chars
  readonly protocols: string // e.g. 'wallet' (or comma list)
}

export const WC_SCHEME = 'wc'

/** True if `s` looks like a WalletConnect `wc:` URI. */
export function isWcUri(s: string): boolean {
  return s.startsWith(`${WC_SCHEME}:`)
}

/** Build a `wc:` pairing URI from its parts. */
export function buildWcPairingUri(p: WcPairing): string {
  return `wc:${p.topic}@${p.relay}?symKey=${p.symKey}&protocols=${p.protocols}`
}

/**
 * Parse a `wc:` pairing URI. Throws on malformed input:
 * - missing `wc:` scheme
 * - missing `@` (no relay)
 * - missing topic
 * - missing `symKey` query param
 */
export function parseWcPairingUri(s: string): WcPairing {
  if (!isWcUri(s)) {
    throw new Error(`wc parse: missing 'wc:' scheme: ${s}`)
  }

  const [uriPart, queryPart] = s.split('?')
  if (uriPart === undefined) {
    throw new Error(`wc parse: malformed: ${s}`)
  }
  const topicAtRelay = uriPart.slice(WC_SCHEME.length + 1)

  const atIdx = topicAtRelay.lastIndexOf('@')
  if (atIdx === -1) {
    throw new Error(`wc parse: missing '@' (no relay): ${s}`)
  }

  const topic = topicAtRelay.slice(0, atIdx)
  const relay = topicAtRelay.slice(atIdx + 1)

  if (!topic) {
    throw new Error(`wc parse: missing topic: ${s}`)
  }
  if (!relay) {
    throw new Error(`wc parse: missing relay: ${s}`)
  }

  // Manual query parsing: split on '&' then on '=' — NOT URLSearchParams.
  const params: Record<string, string> = {}
  if (queryPart !== undefined) {
    for (const pair of queryPart.split('&')) {
      if (!pair) continue
      const eqIdx = pair.indexOf('=')
      if (eqIdx === -1) {
        params[pair] = ''
      } else {
        params[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1)
      }
    }
  }

  const symKey = params['symKey']
  if (symKey === undefined || symKey === '') {
    throw new Error(`wc parse: missing symKey param: ${s}`)
  }
  const protocols = params['protocols'] ?? ''

  return { topic, relay, symKey, protocols }
}

/**
 * True if `h` is exactly 64 hex chars, with or without a `0x` prefix.
 * (WC topics/symKeys are 32 bytes = 64 hex.)
 */
export function isHex64(h: string): boolean {
  return /^(?:0x)?[0-9a-fA-F]{64}$/.test(h)
}
