/**
 * One budget for everything the wallet asks of the outside world.
 *
 * Every remote call in the engine — JSON-RPC on ten chains, the ElectroSwap
 * indexer, GeckoTerminal, the signed statics, the public token lists — is made
 * through the single `fetchImpl` that `createEngine` builds. That makes it the
 * one place where "how often do we ask" can actually be answered, rather than
 * ten places each being reasonable on their own and unreasonable together.
 *
 * Two mechanisms, and the difference between them matters:
 *
 *   A budget, per host. A token bucket refilled at a sustained rate with room
 *   for a burst, because a portfolio refresh is a burst by nature — a balance
 *   and a multicall on each chain at once — and smoothing that into a trickle
 *   would only make the wallet slow.
 *
 *   Over budget, a request waits for its slot if one is close, and is refused
 *   if it is not (`MAX_WAIT_MS`). Which of those happens is decided by the
 *   host's own budget, and the split falls where it should: an RPC endpoint is
 *   allowed enough that a slot is always moments away, so a transaction being
 *   broadcast waits at worst and is never dropped because a price poll spent
 *   the minute. A price API is allowed little, so a request past its budget is
 *   refused at once — which for display data is the right answer, an unpriced
 *   row now rather than a stalled portfolio, and the caller already treats it
 *   that way.
 *
 *   Health, per host. A 429 or a run of failures puts a host in a cooldown,
 *   and a request to a cooling host fails AT ONCE rather than waiting. That is
 *   deliberate: it is what makes failover free. viem's `fallback` walks to the
 *   next endpoint when one throws, so a cooling primary costs microseconds
 *   instead of a timeout, and the user sees the secondary's answer with no
 *   sign anything happened. `Retry-After` is honoured when the host sends one;
 *   otherwise the cooldown doubles per consecutive refusal, and one success
 *   clears it.
 *
 * The budgets below are deliberately under what each host publishes. Being
 * right at the edge of a limit means being over it whenever a retry, a second
 * window, or another wallet on the same address happens.
 */

/** What we allow ourselves against one host. */
export interface HostBudget {
  /** Sustained requests a minute. */
  readonly perMinute: number
  /** How many may go at once before the sustained rate takes over. */
  readonly burst: number
}

/**
 * The default for a public endpoint.
 *
 * Deliberately generous, because for JSON-RPC the budget is a backstop and
 * not the control: what keeps the wallet inside an endpoint's limit is asking
 * at the chain's own cadence (`pollMs`) and rebuilding a portfolio at the
 * scope's, which together put ordinary use around forty requests a minute
 * spread over ten hosts. This number exists to stop a loop that has gone
 * wrong from becoming a ban, and it should never be felt in normal use — a
 * budget that bites during a portfolio refresh would only make the wallet
 * slow, which is not what a rate limit is protecting anyone from.
 */
const DEFAULT_BUDGET: HostBudget = { perMinute: 600, burst: 60 }

/**
 * A node the user runs is nobody else's to ration.
 *
 * Settings › Networks lets an address be pointed at a local or LAN node, and
 * the tests point the chains at a mock on loopback. Neither has a shared
 * quota to protect, so neither is metered — the governor is here for public
 * endpoints we do not own.
 */
function isPrivateHost(host: string): boolean {
  const name = host.split(':')[0] ?? host
  if (name === 'localhost' || name === '::1' || name.endsWith('.local') || name.endsWith('.localhost')) return true
  if (/^127\./.test(name) || /^10\./.test(name) || /^192\.168\./.test(name)) return true
  return /^172\.(1[6-9]|2\d|3[01])\./.test(name)
}

/**
 * Hosts whose real limit is tighter than the default, or whose refusal costs
 * us more than a retry.
 *
 * GeckoTerminal's free tier is about thirty calls a minute *per address and
 * across every network*, which is the tightest budget the wallet lives under
 * and the one that has actually bitten: exceeding it blanked prices on every
 * chain at once. Twenty leaves room for the retry we did not plan.
 */
const BUDGETS: Readonly<Record<string, HostBudget>> = {
  'api.geckoterminal.com': { perMinute: 20, burst: 4 },
  'api.coingecko.com': { perMinute: 20, burst: 4 },
  /*
    Our own API. The price and history routes are rate-limited at 120/min per
    key server-side, so staying under that is staying inside a limit we set
    ourselves — and being throttled by our own service is a worse look than
    asking for less. The GraphQL indexer shares the host.
  */
  'electroswap.io': { perMinute: 100, burst: 20 },
  'static.electroswap.io': { perMinute: 30, burst: 6 },
  // drpc and Ankr's keyless tiers are the strictest of the RPCs we ship.
  'rpc.ankr.com': { perMinute: 120, burst: 12 },
  'eth.drpc.org': { perMinute: 120, burst: 12 },
  'polygon.drpc.org': { perMinute: 120, burst: 12 },
  'linea.drpc.org': { perMinute: 120, burst: 12 },
}

/** Longest a request will wait for a slot before giving up on the host. */
const MAX_WAIT_MS = 2_000
/** First cooldown after a refusal; doubles per consecutive refusal. */
const COOLDOWN_BASE_MS = 5_000
const COOLDOWN_MAX_MS = 5 * 60_000
/** Consecutive transport failures before a host is treated as down. */
const STRIKES = 3
/**
 * First cooldown after the host refused our credentials; doubles per consecutive
 * refusal. Far longer than the 429 backoff on purpose: a rejected key or a
 * clock-skewed request signature will still be rejected a second later, so
 * retrying quickly only burns the budget and, on a host that bans by behaviour,
 * digs the hole deeper.
 */
const REFUSED_COOLDOWN_MS = 15 * 60_000
const REFUSED_COOLDOWN_MAX_MS = 60 * 60_000

/** Thrown when a host is cooling or the budget could not be met in time. */
export class RateLimited extends Error {
  readonly host: string
  constructor(host: string, reason: string) {
    super(`${host}: ${reason}`)
    this.name = 'RateLimited'
    this.host = host
  }
}

interface HostState {
  tokens: number
  lastRefill: number
  coolUntil: number
  /** Consecutive refusals — 429s and transport failures alike. */
  strikes: number
  /** Consecutive cooldowns, for the doubling. */
  cooldowns: number
  /** The host rejected our credentials and has not accepted them since. */
  refused: boolean
}

export interface GovernorSnapshot {
  readonly host: string
  readonly available: boolean
  readonly coolingMs: number
  readonly tokens: number
  readonly perMinute: number
  /**
   * The host answered 401 or 403 and has not accepted a request since. This is a
   * configuration problem the user can act on — a key the API no longer honours,
   * or a device clock far enough out that the request signature is rejected — so
   * it is surfaced rather than retried in silence.
   */
  readonly refused: boolean
}

export class Governor {
  private readonly hosts = new Map<string, HostState>()

  constructor(
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  budget(host: string): HostBudget {
    return BUDGETS[host] ?? DEFAULT_BUDGET
  }

  private state(host: string): HostState {
    let s = this.hosts.get(host)
    if (!s) {
      s = { tokens: this.budget(host).burst, lastRefill: this.now(), coolUntil: 0, strikes: 0, cooldowns: 0, refused: false }
      this.hosts.set(host, s)
    }
    return s
  }

  private refill(host: string, s: HostState): void {
    const b = this.budget(host)
    const now = this.now()
    const gained = ((now - s.lastRefill) / 60_000) * b.perMinute
    if (gained <= 0) return
    s.tokens = Math.min(b.burst, s.tokens + gained)
    s.lastRefill = now
  }

  /** True when this host is not in a cooldown. */
  available(host: string): boolean {
    const s = this.hosts.get(host)
    return !s || this.now() >= s.coolUntil
  }

  /**
   * Wait for this host's next slot. Throws at once when it is cooling — the
   * caller (viem's fallback) should try somewhere else, not sit here.
   */
  async reserve(host: string): Promise<void> {
    const s = this.state(host)
    const now = this.now()
    if (now < s.coolUntil) throw new RateLimited(host, `backing off for another ${Math.ceil((s.coolUntil - now) / 1000)}s`)
    this.refill(host, s)
    if (s.tokens >= 1) {
      s.tokens -= 1
      return
    }
    const b = this.budget(host)
    const waitMs = Math.ceil(((1 - s.tokens) / b.perMinute) * 60_000)
    if (waitMs > MAX_WAIT_MS) throw new RateLimited(host, `over budget (${b.perMinute}/min)`)
    await this.sleep(waitMs)
    this.refill(host, s)
    s.tokens = Math.max(0, s.tokens - 1)
  }

  /** A refusal: start (or lengthen) the cooldown. */
  private cool(host: string, retryAfterMs: number | null): void {
    const s = this.state(host)
    s.cooldowns += 1
    const backoff = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** (s.cooldowns - 1))
    s.coolUntil = this.now() + Math.max(retryAfterMs ?? 0, backoff)
    s.strikes = 0
  }

  /** A refusal of our credentials: cool for a long time and say so. */
  private refuse(host: string): void {
    const s = this.state(host)
    s.cooldowns += 1
    s.coolUntil = this.now() + Math.min(REFUSED_COOLDOWN_MAX_MS, REFUSED_COOLDOWN_MS * 2 ** (s.cooldowns - 1))
    s.strikes = 0
    s.refused = true
  }

  /** What the host answered. */
  observe(host: string, status: number, retryAfter?: string | null): void {
    const s = this.state(host)
    if (status === 429 || status === 503) {
      this.cool(host, parseRetryAfter(retryAfter, this.now()))
      return
    }
    /*
      A ban is not a transient failure. 401 and 403 used to fall through to the
      success branch below, which cleared both strikes and cooldowns — so a
      client the API had just refused kept its full budget, kept hammering, and
      nothing anywhere said why every request was failing.
    */
    if (status === 401 || status === 403) {
      this.refuse(host)
      return
    }
    if (status >= 500) {
      s.strikes += 1
      if (s.strikes >= STRIKES) this.cool(host, null)
      return
    }
    // The host answered us. That clears the refusal too: a call that got through
    // is proof the credentials are good again.
    s.strikes = 0
    s.cooldowns = 0
    s.refused = false
  }

  /** The request never got an answer: a timeout, a DNS failure, a dropped socket. */
  observeError(host: string): void {
    const s = this.state(host)
    s.strikes += 1
    if (s.strikes >= STRIKES) this.cool(host, null)
  }

  /** For Settings › Networks and the tests: what the governor currently thinks. */
  snapshot(): GovernorSnapshot[] {
    const now = this.now()
    return [...this.hosts].map(([host, s]) => ({
      host,
      available: now >= s.coolUntil,
      coolingMs: Math.max(0, s.coolUntil - now),
      tokens: Math.floor(s.tokens),
      perMinute: this.budget(host).perMinute,
      refused: s.refused,
    }))
  }
}

/** `Retry-After` is either seconds or an HTTP date; both appear in the wild. */
function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - now) : null
}

function hostOf(input: RequestInfo | URL): string | null {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return new URL(url).host
  } catch {
    return null
  }
}

/**
 * `fetch`, under the governor. Everything the engine sends outward goes
 * through this one wrapper, so the budget is real rather than advisory.
 */
export function governedFetch(inner: typeof fetch, governor: Governor): typeof fetch {
  return async (input, init) => {
    const host = hostOf(input)
    if (host === null || isPrivateHost(host)) return inner(input, init)
    await governor.reserve(host)
    try {
      const res = await inner(input, init)
      governor.observe(host, res.status, res.headers.get('retry-after'))
      return res
    } catch (err) {
      governor.observeError(host)
      throw err
    }
  }
}
