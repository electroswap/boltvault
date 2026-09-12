/** Display formatting — numbers only; copy lives with the screens. */

export function formatFiat(value: number, currency: 'USD' | 'ETN'): string {
  if (currency === 'ETN') return `${formatQuantity(String(value))} ETN`
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * A stand-in for a fiat figure the user has chosen not to show.
 *
 * Fixed length on purpose: masking digit-by-digit would still leak how
 * large the number is.
 */
export function maskedFiat(currency: 'USD' | 'ETN'): string {
  return currency === 'USD' ? '$****.**' : '**** ETN'
}

/** `formatFiat`, or asterisks when the portfolio eye is closed. */
export function displayFiat(value: number | null, currency: 'USD' | 'ETN', hidden: boolean): string {
  if (value === null) return '—'
  return hidden ? maskedFiat(currency) : formatFiat(value, currency)
}

/** What `amount` of a token is worth, from the portfolio row's price (fiat ÷ quantity); null when unpriced or empty. */
export function formatAmountFiat(
  amount: string,
  row: { fiat: number | null; quantity: string } | null | undefined,
  currency: 'USD' | 'ETN',
): string | null {
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
  const body =
    abs >= 1e9
      ? short(value / 1e9, 'B')
      : abs >= 1e6
        ? short(value / 1e6, 'M')
        : abs >= 1e4
          ? short(value / 1e3, 'K')
          : Math.round(value).toLocaleString('en-US')
  return currency === 'USD' ? `$${body}` : `${body} ETN`
}

/** A unit price: two decimals from $1 up, four significant digits below (ETN at $0.00296, not "$0.00"). */
export function formatPrice(value: number | null, currency: 'USD' | 'ETN'): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value === 0 || value >= 1) return formatFiat(value, currency)
  const s = value.toLocaleString('en-US', {
    maximumSignificantDigits: 4,
    minimumSignificantDigits: 2,
  })
  return currency === 'USD' ? `$${s}` : `${s} ETN`
}

/**
 * A compact magnitude: 12,345,678 -> "12.34M".
 *
 * Owner: "Extremely large balances more than 10,000,000 should use 12.34M
 * format." Past ten million the grouped digits stop being a number a person
 * reads and become a wall that pushes the symbol off the row — and the last
 * six of them never carry a decision. Below that the exact figure still fits,
 * so grouping stays.
 *
 * The ladder stops at trillions and says so. A wallet holding a token that
 * mints 5,699,999,958,198,627,000 of itself is holding a joke, not a figure,
 * and it was running off the end of the row; "5699999.96T" would only be a
 * shorter wall. ">999T" is the honest reading: more than this column can
 * usefully say.
 */
const COMPACT_FROM = 10_000_000
const CEILING = 1e15

/*
  Cut a decimal string at `places`, never rounding.

  Every formatter below used to round to its display precision, which rounds
  *up* half the time — so a balance read fractionally higher than it is, and a
  swap's "minimum received" advertised a floor above the one the calldata
  enforces. A number the wallet shows should never be larger than the number
  the wallet holds. Done on the string, so nothing depends on `Number`'s
  precision either.
*/
export function cut(q: string, places: number): string {
  const neg = q.startsWith('-') || q.startsWith('−')
  const body = neg ? q.slice(1) : q
  const [i = '0', f = ''] = body.split('.')
  const kept = places > 0 ? f.slice(0, places).replace(/0+$/, '') : ''
  return `${neg ? '−' : ''}${kept ? `${i}.${kept}` : i}`
}

function compact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= CEILING) return `${n < 0 ? '−' : ''}>999T`
  const scale = abs >= 1e12 ? 1e12 : abs >= 1e9 ? 1e9 : 1e6
  const unit = abs >= 1e12 ? 'T' : abs >= 1e9 ? 'B' : 'M'
  // Truncated first so 999,999,999 cannot read as "1.00B", then padded back to
  // two places — `toFixed` on an already-truncated value only pads.
  return `${Number(cut((n / scale).toFixed(6), 2)).toFixed(2)}${unit}`
}

export function formatQuantity(q: string): string {
  const n = Number(q)
  if (!Number.isFinite(n)) return q
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= COMPACT_FROM) return compact(n)
  // Truncate first, then group: `toLocaleString`'s own rounding would round up.
  if (abs >= 1_000_000) return Number(cut(q, 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (abs >= 1) return Number(cut(q, 2)).toLocaleString('en-US', { maximumFractionDigits: 2 })
  // Below one, "4 significant digits" starts at the first non-zero decimal.
  const f = q.split('.')[1] ?? ''
  const firstDigit = f.search(/[1-9]/)
  const places = firstDigit === -1 ? 4 : firstDigit + 4
  return Number(cut(q, places)).toLocaleString('en-US', { maximumSignificantDigits: 4 })
}

/**
 * A count or an amount at its shortest honest length: 1.2K, 3.4M, 1.2B.
 *
 * `formatQuantity` only compacts past ten million, which is right for a token
 * balance — the exact figure still fits and someone may want to read it. A
 * collection's stat strip is the opposite case: five numbers side by side in a
 * 400 px popup, where "12,483" and "1,204,663" push the label out of its cell
 * and nobody is counting the units. Owner: "the stats should be more compact,
 * use K/M for 1000's and 1000000's."
 *
 * One decimal, and never a trailing ".0" — "12K" reads better than "12.0K".
 */
const COMPACT_UNITS = ['', 'K', 'M', 'B', 'T'] as const

export function formatCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (abs === 0) return '0'
  if (abs >= 1e15) return `${sign}>999T`
  let unit = Math.min(COMPACT_UNITS.length - 1, Math.max(0, Math.floor(Math.log10(abs) / 3)))
  let n = Number((abs / 10 ** (unit * 3)).toFixed(unit === 0 ? 2 : 1))
  /*
    Rounding can tip a number into the unit above: 999,999 is 1000.0K, which is
    not how anyone writes 1M. Choose the unit from the rounded figure, not the
    raw one.
  */
  if (n >= 1000 && unit < COMPACT_UNITS.length - 1) {
    unit += 1
    n = Number((abs / 10 ** (unit * 3)).toFixed(1))
  }
  return `${sign}${n}${COMPACT_UNITS[unit]}`
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

/**
 * One term of a holder score, at a length a person can read.
 *
 * `formatBolt` falls through to four significant figures for anything under 1,
 * which for a score term is a wall of zeros: a single wei of DYNO dust, weighted
 * at 828 BOLT per DYNO, rendered in the fee sheet as "0.000000000000000828
 * BOLT-eq from DYNO". Twenty characters, in a plate whose other numbers are in
 * the millions, for a quantity that cannot move a threshold measured in
 * thousands. Below a hundredth it is not a number worth printing, it is nothing.
 */
export function formatBoltPart(rawScore: string): string {
  let n = 0n
  try {
    n = BigInt(rawScore)
  } catch {
    return rawScore
  }
  if (n <= 0n) return '0'
  // 0.01 at 18 decimals.
  if (n < 10n ** 16n) return '<0.01'
  return formatBolt(rawScore)
}

/** A rate line: "1 ETN = 0.00296 USDC". */
export function formatRate(
  rate: number | null,
  symbolIn: string,
  symbolOut: string,
): string | null {
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null
  const r =
    rate >= 1
      ? rate.toLocaleString('en-US', { maximumFractionDigits: 4 })
      : rate.toLocaleString('en-US', { maximumSignificantDigits: 4 })
  return `1 ${symbolIn} = ${r} ${symbolOut}`
}

/**
 * A quoted amount as a field value: no grouping commas, the fraction cut
 * short so the units stay in view.
 *
 * `formatRaw` is for reading (it groups thousands); putting that string back
 * into a numeric input would turn "1,234.5" into "1.2345". Exact token
 * decimals — eighteen of them on ETN — overflow the well and hide everything
 * before the point, which is the number that matters. The independent well
 * still shows what the user typed; this is only the other side, from the
 * quote.
 *
 * Two places from 1 up, six significant figures below (the interface's
 * `SwapTradeAmount` length), never rounded up.
 */
export function formatInputAmount(raw: string, decimals: number): string {
  let n: bigint
  try {
    n = BigInt(raw)
  } catch {
    return ''
  }
  if (n === 0n) return '0'
  const base = 10n ** BigInt(decimals)
  const whole = n / base
  const frac = decimals > 0 ? (n % base).toString().padStart(decimals, '0') : ''
  const exact = frac ? `${whole.toString()}.${frac}` : whole.toString()
  const places =
    whole > 0n
      ? 2
      : (() => {
          const firstDigit = frac.search(/[1-9]/)
          return firstDigit === -1 ? 0 : firstDigit + 6
        })()
  return cut(exact, places)
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
  // Big enough to read whole: group it and stop. Built from the integer and
  // its fraction as strings, so nothing is rounded up on the way.
  if (whole > 0n) {
    const places = whole >= 1000n ? 0 : whole >= 100n ? 1 : whole >= 10n ? 2 : significant - 1
    const fracDigits = (n % base).toString().padStart(decimals, '0')
    const exact = `${whole.toString()}.${fracDigits}`
    return `${sign}${formatQuantity(cut(exact, places))}`
  }
  // Below one: keep `significant` digits from the first that is not a zero.
  const frac = (n % base).toString().padStart(decimals, '0')
  const firstDigit = frac.search(/[1-9]/)
  if (firstDigit === -1) return '0'
  const places = firstDigit + significant
  if (places > decimals) return `${sign}0.${frac.slice(0, decimals).replace(/0+$/, '')}`
  // Truncated, not `toFixed`: 0.0999999 must not read as 0.1.
  return `${sign}${cut(`0.${frac.slice(0, places)}`, places)}`
}

/**
 * A guaranteed floor, never rounded up.
 *
 * Where a number is a *promise* rather than an observation — a swap's minimum
 * received, a limit order's floor — displaying one wei more than the contract
 * enforces is telling the user they will get something they might not. Pure
 * BigInt: no `Number`, so precision does not come into it either.
 */
export function formatFloor(raw: string, decimals: number, places = 6): string {
  let n: bigint
  try {
    n = BigInt(raw)
  } catch {
    return raw
  }
  const neg = n < 0n
  if (neg) n = -n
  const base = 10n ** BigInt(decimals)
  const whole = (n / base).toString()
  const frac = decimals > 0 ? (n % base).toString().padStart(decimals, '0').slice(0, places).replace(/0+$/, '') : ''
  const grouped = Number(whole) >= 1000 ? Number(whole).toLocaleString('en-US') : whole
  return `${neg ? '−' : ''}${frac ? `${grouped}.${frac}` : grouped}`
}
