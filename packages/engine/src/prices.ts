/**
 * Display prices off Electroneum (master plan §10.4, §9.4): by token address,
 * cached, 429/timeouts → unpriced. Only token addresses ever leave the wallet
 * — never the account.
 *
 * Two sources, one client. ElectroSwap's proxy answers
 * `/api/wallet/prices/networks/:network/tokens/multi/:addresses` in
 * GeckoTerminal's own request and response shape, deliberately, so adopting it
 * is a base URL and a header rather than a second implementation. The proxy is
 * preferred when the build carries a wallet key: it holds the upstream API
 * keys, caches server-side, and means no third party ever sees a user's IP
 * alongside the tokens they hold. Without a key the class talks to
 * GeckoTerminal directly, which is the fallback the plan allows.
 *
 * The key goes to our own host and nowhere else — see `headers()`.
 *
 * The free tier allows about thirty calls a minute, across every network, per
 * address. That budget is the whole design constraint here, and it was being
 * spent in seconds: the caller asked for the price of every token in a
 * chain's *public list* — hundreds of them, thirty per request — so a single
 * Base refresh made four calls, an Ethereum refresh more, and the fourth came
 * back 429. The cooldown that followed is shared (the quota is per address,
 * not per network), so one chain exhausting it left every other chain unpriced
 * too. Observed live: Base priced 16 of 24 rows and then Ethereum and BNB
 * showed "without price" for everything.
 *
 * Two things keep it inside the budget now. The caller asks only about tokens
 * the account actually holds (see `PortfolioService.build`), which is a
 * handful rather than a list. And a token GeckoTerminal does not know is
 * remembered as unknown, instead of being asked about again on every block.
 */
import { getChain } from '@boltvault/chains'
import { authHeaders } from './apiAuth'
import { safeImageUrl } from './images'

/** What a price source knows about one token. */
export interface PriceQuote {
  readonly price: number
  readonly change24h: number | null
  /**
   * A logo the price source happens to carry. GeckoTerminal returns one for
   * most listed tokens, which is a real answer for the majors on chains whose
   * token list ships none.
   */
  readonly logoUri: string | null
}

export interface PriceSource {
  prices(chainId: number, addresses: readonly string[]): Promise<Map<string, PriceQuote>>
}

/** GeckoTerminal network slugs for the registry's chains. */
const NETWORKS: Readonly<Record<number, string>> = {
  1: 'eth',
  56: 'bsc',
  8453: 'base',
  10: 'optimism',
  137: 'polygon_pos',
  43114: 'avax',
  42161: 'arbitrum',
  130: 'unichain',
  59144: 'linea',
}

/**
 * A price is good for two minutes.
 *
 * A portfolio with several chains in scope now rebuilds about every 48 s
 * (`refreshEveryMs`), so a one-minute price TTL meant nearly every rebuild
 * paid for prices again. Two minutes is still an honest number next to a
 * balance — nobody decides anything on the difference — and it roughly halves
 * what the tightest budget we live under is asked for.
 */
const TTL_MS = 120_000
/**
 * How long "GeckoTerminal has no price for this" is believed.
 *
 * Longer than a price, because it is a fact about the token rather than about
 * the market, and because re-asking is what burns the minute's calls. Only
 * successful rows used to be cached, so every token the answer omitted — the
 * long tail of any wallet — was requested again on the next block, forever.
 */
const MISS_TTL_MS = 10 * 60_000
/** GeckoTerminal's documented cap for `/tokens/multi/`. */
const BATCH = 30
/**
 * How long to stand down after a 429.
 *
 * Was five minutes, which turned one overrun into five minutes of a wallet
 * with no prices anywhere. A minute is enough for the window to roll over,
 * and asking only about held tokens is what stops us arriving here at all.
 */
const COOLDOWN_MS = 60_000

interface Entry {
  readonly at: number
  readonly ttl: number
  /** Null records a token this source has no price for. */
  readonly quote: PriceQuote | null
}

/** The public feed. Anything else is assumed to be ours. */
const PUBLIC_FEED_HOST = 'api.geckoterminal.com'

export class GeckoTerminalPrices implements PriceSource {
  private cache = new Map<string, Entry>()
  private cooldownUntil = 0

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => number,
    private readonly base = `https://${PUBLIC_FEED_HOST}/api/v2`,
    /** The wallet key, when this build has one. Sent to our proxy, never to the public feed. */
    private readonly apiKey?: string,
  ) {}

  /**
   * A key identifies which client is calling; handing it to a third party
   * would tell them that too, and buy us nothing. The credential goes out only
   * when the base is not the public feed — and it is a per-request signature,
   * never the key itself (§9.1), so what a third party would see even by
   * accident is a MAC that expires in a minute.
   */
  private headers(url: string): Record<string, string> {
    const accept = { accept: 'application/json' }
    if (!this.apiKey) return accept
    try {
      if (new URL(this.base).host === PUBLIC_FEED_HOST) return accept
    } catch {
      return accept
    }
    return { ...accept, ...authHeaders({ key: this.apiKey, method: 'GET', url, now: this.now() }) }
  }

  private remember(chainId: number, address: string, quote: PriceQuote | null): void {
    this.cache.set(`${chainId}:${address}`, {
      at: this.now(),
      ttl: quote ? TTL_MS : MISS_TTL_MS,
      quote,
    })
  }

  async prices(chainId: number, addresses: readonly string[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>()
    const network = NETWORKS[chainId]
    if (!network) return out
    const wrapped = getChain(chainId)?.wrappedNative ?? null
    const wanted = [
      ...new Set(
        addresses
          .map((a) => (a === 'native' ? wrapped : a))
          .filter((a): a is string => !!a)
          .map((a) => a.toLowerCase()),
      ),
    ]
    const missing: string[] = []
    for (const a of wanted) {
      const hit = this.cache.get(`${chainId}:${a}`)
      if (hit && this.now() - hit.at < hit.ttl) {
        if (hit.quote) out.set(a, hit.quote)
      } else missing.push(a)
    }
    if (missing.length && this.now() >= this.cooldownUntil) {
      for (let i = 0; i < missing.length; i += BATCH) {
        const chunk = missing.slice(i, i + BATCH)
        try {
          const url = `${this.base}/networks/${network}/tokens/multi/${chunk.join(',')}`
          const res = await this.fetchImpl(url, {
            headers: this.headers(url),
            signal: AbortSignal.timeout(6_000),
          })
          if (res.status === 429) {
            this.cooldownUntil = this.now() + COOLDOWN_MS
            break
          }
          if (!res.ok) break
          const json = (await res.json()) as {
            data?: Array<{
              attributes?: {
                address?: string
                price_usd?: string | null
                image_url?: string | null
              }
            }>
          }
          const answered = new Set<string>()
          for (const row of json.data ?? []) {
            const addr = row.attributes?.address?.toLowerCase()
            if (!addr) continue
            answered.add(addr)
            const price = Number(row.attributes?.price_usd)
            if (!Number.isFinite(price) || price <= 0) {
              this.remember(chainId, addr, null)
              continue
            }
            // "missing.png" is GeckoTerminal's placeholder, not a logo.
            const image = row.attributes?.image_url
            const quote: PriceQuote = {
              price,
              change24h: null,
              // https only (ES-BV-059): a price index's image URL is not ours.
              logoUri: typeof image === 'string' ? safeImageUrl(image) : null,
            }
            this.remember(chainId, addr, quote)
            out.set(addr, quote)
          }
          // Silence is an answer: this source has nothing for those addresses.
          for (const a of chunk) if (!answered.has(a)) this.remember(chainId, a, null)
        } catch {
          break
        }
      }
    }
    // Map the wrapped native back to 'native' for the caller.
    if (wrapped) {
      const w = out.get(wrapped.toLowerCase())
      if (w) out.set('native', w)
    }
    return out
  }
}
