/** Display formatting — numbers only; copy lives with the screens. */

export function formatFiat(value: number, currency: 'USD' | 'ETN'): string {
  if (currency === 'ETN') return `${formatQuantity(String(value))} ETN`
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatQuantity(q: string): string {
  const n = Number(q)
  if (!Number.isFinite(n)) return q
  if (n === 0) return '0'
  if (n >= 1_000_000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return n.toLocaleString('en-US', { maximumSignificantDigits: 4 })
}

export function formatChange(fraction: number | null): string | null {
  if (fraction === null) return null
  const pct = fraction * 100
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : ''
  return `${sign}${Math.abs(pct).toFixed(1)}%`
}

export function formatBlock(n: string): string {
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
