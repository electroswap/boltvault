/** Display formatting — numbers only; copy lives with the screens. */

export function formatFiat(value: number, currency: 'USD' | 'ETN'): string {
  if (currency === 'ETN') return `${formatQuantity(String(value))} ETN`
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** What `amount` of a token is worth, from the portfolio row's price (fiat ÷ quantity); null when unpriced or empty. */
export function formatAmountFiat(amount: string, row: { fiat: number | null; quantity: string } | null | undefined, currency: 'USD' | 'ETN'): string | null {
  const n = Number(amount)
  if (!row || row.fiat === null || !Number.isFinite(n)) return null
  const qty = Number(row.quantity)
  if (!(qty > 0)) return null
  return formatFiat((row.fiat / qty) * n, currency)
}

/** A compact fiat amount for stat cells: $6,100 · $12.4K · $1.2M. */
export function formatCompactFiat(value: number, currency: 'USD' | 'ETN'): string {
  const abs = Math.abs(value)
  const short = (n: number, unit: string): string => `${Number(n.toFixed(1))}${unit}`
  const body = abs >= 1e9 ? short(value / 1e9, 'B') : abs >= 1e6 ? short(value / 1e6, 'M') : abs >= 1e4 ? short(value / 1e3, 'K') : Math.round(value).toLocaleString('en-US')
  return currency === 'USD' ? `$${body}` : `${body} ETN`
}

/** A unit price: two decimals from $1 up, four significant digits below (ETN at $0.00296, not "$0.00"). */
export function formatPrice(value: number | null, currency: 'USD' | 'ETN'): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value === 0 || value >= 1) return formatFiat(value, currency)
  const s = value.toLocaleString('en-US', { maximumSignificantDigits: 4, minimumSignificantDigits: 2 })
  return currency === 'USD' ? `$${s}` : `${s} ETN`
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

/**
 * A token amount at a length a person can read.
 *
 * Owner, on the farm position card: "better rounding logic". `formatRaw` is
 * exact, which is right for a receipt and wrong for a card — it produced
 * "0.00003429 DYNO" and "0.000005505 DYNO to collect" side by side, where the
 * digits carry no meaning and the eye cannot compare them.
 *
 * Four significant figures, never scientific notation, and anything smaller
 * than the shown precision says so rather than rounding to a bare zero.
 */
export function formatAmount(raw: string, decimals: number, significant = 4): string {
  let n = 0n
  try {
    n = BigInt(raw)
  } catch {
    return raw
  }
  if (n === 0n) return '0'
  const neg = n < 0n
  if (neg) n = -n
  const base = 10n ** BigInt(decimals)
  const whole = n / base
  const sign = neg ? '−' : ''
  // Big enough to read whole: group it and stop.
  if (whole > 0n) {
    const value = Number(n) / Number(base)
    const places = whole >= 1000n ? 0 : whole >= 100n ? 1 : whole >= 10n ? 2 : significant - 1
    return `${sign}${formatQuantity(value.toFixed(places))}`
  }
  // Below one: keep `significant` digits from the first that is not a zero.
  const frac = (n % base).toString().padStart(decimals, '0')
  const firstDigit = frac.search(/[1-9]/)
  if (firstDigit === -1) return '0'
  const places = firstDigit + significant
  if (places > decimals) return `${sign}0.${frac.slice(0, decimals).replace(/0+$/, '')}`
  const cut = `0.${frac.slice(0, places)}`
  const rounded = Number(cut).toFixed(places).replace(/0+$/, '').replace(/\.$/, '')
  return `${sign}${rounded}`
}
