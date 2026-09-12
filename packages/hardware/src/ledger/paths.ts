/**
 * Derivation paths (master plan §8.1): BIP-44 `m/44'/60'/0'/0/i` and Ledger
 * Live `m/44'/60'/i'/0/0`. Both are shown side by side on import because
 * the wrong scheme is the #1 "my funds are gone" ticket.
 */

export type PathScheme = 'bip44' | 'live'

const HARDENED = 0x80000000

export function pathFor(scheme: PathScheme, index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('bad index')
  return scheme === 'bip44' ? `m/44'/60'/0'/0/${index}` : `m/44'/60'/${index}'/0/0`
}

export function schemeOf(path: string): PathScheme | 'custom' {
  if (/^m\/44'\/60'\/0'\/0\/\d+$/.test(path)) return 'bip44'
  if (/^m\/44'\/60'\/\d+'\/0\/0$/.test(path)) return 'live'
  return 'custom'
}

/** `m/44'/60'/0'/0/1` → `[5, 0x8000002c, 0x8000003c, 0x80000000, 0, 1]` as the app expects. */
export function pathToBytes(path: string): Uint8Array {
  const parts = path.replace(/^m\//, '').split('/').filter(Boolean)
  if (parts.length === 0 || parts.length > 10) throw new Error(`bad derivation path: ${path}`)
  const out = new Uint8Array(1 + parts.length * 4)
  out[0] = parts.length
  const view = new DataView(out.buffer)
  parts.forEach((p, i) => {
    const hardened = p.endsWith("'") || p.endsWith('h')
    const n = Number(p.replace(/['h]$/, ''))
    if (!Number.isInteger(n) || n < 0 || n >= HARDENED) throw new Error(`bad derivation path: ${path}`)
    view.setUint32(1 + i * 4, hardened ? (n | HARDENED) >>> 0 : n)
  })
  return out
}
