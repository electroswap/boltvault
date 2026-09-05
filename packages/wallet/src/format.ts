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

/** A raw token amount as a display quantity. */
export function formatRaw(raw: string, decimals: number): string {
  let n = 0n
  try {
    n = BigInt(raw)
  } catch {
    return raw
  }
  const neg = n < 0n
  if (neg) n = -n
  const base = 10n ** BigInt(decimals)
  const whole = n / base
  const frac = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  const s = frac ? `${whole.toString()}.${frac}` : whole.toString()
  return `${neg ? '−' : ''}${formatQuantity(s)}`
}

/** Bips as a percentage with two decimals: 30 → "0.30%". */
export function formatPct(bips: number): string {
  return `${(bips / 100).toFixed(2)}%`
}

/** A BOLT-equivalent score (18 decimals) as a whole-number quantity. */
export function formatBolt(rawScore: string): string {
  return formatRaw(rawScore, 18)
}

/** A rate line: "1 ETN = 0.00296 USDC". */
export function formatRate(rate: number | null, symbolIn: string, symbolOut: string): string | null {
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null
  const r = rate >= 1 ? rate.toLocaleString('en-US', { maximumFractionDigits: 4 }) : rate.toLocaleString('en-US', { maximumSignificantDigits: 4 })
  return `1 ${symbolIn} = ${r} ${symbolOut}`
}
