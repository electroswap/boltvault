/**
 * TokenAvatar — a token's logo, with TokenMark as the last frame.
 *
 * This walks the §10.3 pipeline — the URLs come from tokenLogos.ts, in order,
 * and the first one that actually draws wins. Two frames are ours rather than
 * the plan's: the coin mark for a chain's own currency and its wrapped form,
 * and TokenMark (the symbol on a glass disc) in place of the plan's
 * identicon, because the owner asked for pixel placeholders to be gone
 * everywhere.
 *
 * The coin mark is the resting frame rather than a last resort: it needs no
 * network, so a native row paints its real mark on the first frame and a
 * remote logo, if there is one, replaces it when it arrives.
 *
 * The winner is remembered by `(chainId, address)` — in memory and, where the
 * body has storage, on disk (§10.3) — so scrolling a list or reopening the
 * popup never re-walks the candidates. "Nothing drew" is remembered too: that
 * is the case worth caching, since it cost five hosts to establish.
 *
 * Each candidate gets `LOGO_TIMEOUT_MS` (§10.3). A 404 or a refused
 * connection fires `onError` immediately and the walk moves on by itself; the
 * timer is for the host that accepts the request and then says nothing, which
 * would otherwise leave the disc empty for as long as the screen is open.
 *
 * A bundled source arrives as markup or an asset module rather than a URL (see
 * tokenLogos.ts). That matters on Android, where `Image` cannot decode SVG:
 * every candidate used to be a "/tokens/…" web path that could never resolve,
 * and because such a path counted as "bundled" the component also latched
 * `loaded` true and never cleared it on error — so the phone drew neither the
 * logo nor the lettered fallback, just an empty disc. Now only a source that
 * genuinely needs no load event is treated as settled, and a failed load walks
 * on *and* puts the mark back.
 */
import { useEffect, useMemo, useState } from 'react'
import { Image, View } from 'react-native'
import { ChainMark } from './ChainMark'
import { coinMarkChain } from './coinMarks'
import { SvgImage } from './SvgImage'
import { TokenMark } from './TokenMark'
import { cacheTokenLogo, cachedTokenLogo, normaliseTokenAddress, tokenLogoSources, LOGO_TIMEOUT_MS, type LogoSource } from './tokenLogos'
import { paint } from './tokens'

export interface TokenAvatarProps {
  readonly chainId: number
  readonly address: string
  /** Drawn on the disc when no image loads. */
  readonly symbol?: string | null
  readonly logoUri?: string | null
  /** This token's CoinGecko image id, when the caller happens to know it (§10.3 step 5). */
  readonly coingeckoId?: string | null
  readonly size?: number
  readonly testID?: string
}

/** Markup and asset modules are already in the bundle: nothing can fail. */
function isLocal(source: LogoSource | undefined): boolean {
  return source !== undefined && source.kind !== 'uri'
}

export function TokenAvatar({ chainId, address, symbol, logoUri, coingeckoId, size = 32, testID }: TokenAvatarProps) {
  const key = `${chainId}:${normaliseTokenAddress(address)}`
  const sources = useMemo(() => tokenLogoSources(chainId, address, logoUri, coingeckoId), [chainId, address, logoUri, coingeckoId])
  const coin = coinMarkChain(chainId, address)

  // A previously resolved winner short-circuits the walk entirely. It is kept
  // as a URL rather than an index because the candidate list changes shape —
  // a logoUri arrives, a CoinGecko id is learned — and an index into last
  // week's list would point at the wrong host.
  const known = cachedTokenLogo(chainId, address)
  const startAt = known === null ? 0 : known.uri === null ? sources.length : Math.max(0, sources.findIndex((s) => s.kind === 'uri' && s.uri === known.uri))

  const [index, setIndex] = useState(startAt)
  const [loaded, setLoaded] = useState(isLocal(sources[startAt]))

  useEffect(() => {
    setIndex(startAt)
    setLoaded(isLocal(sources[startAt]))
  }, [key, startAt, sources])

  const source = index < sources.length ? sources[index] : undefined

  const fail = (): void => {
    const next = index + 1
    if (next >= sources.length) cacheTokenLogo(chainId, address, null)
    setIndex(next)
    // Without this the mark stays hidden behind a picture that never arrives.
    setLoaded(isLocal(sources[next]))
  }

  // 2 s per candidate (§10.3). A host that never answers is the same as a
  // host that 404s, only slower, so treat it the same and walk on.
  useEffect(() => {
    if (loaded || source === undefined || source.kind !== 'uri') return
    // The timer is cleared whenever `index` or `loaded` changes, so if it does
    // fire it is still talking about this candidate.
    const timer = setTimeout(() => {
      const next = index + 1
      if (next >= sources.length) cacheTokenLogo(chainId, address, null)
      setIndex(next)
      setLoaded(isLocal(sources[next]))
    }, LOGO_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [chainId, address, index, loaded, source, sources])

  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: paint.glassRaisedSolid }} testID={testID}>
      {loaded ? null : (
        <View style={{ position: 'absolute' }}>{coin === null ? <TokenMark symbol={symbol} size={size} /> : <ChainMark chainId={coin} size={size} />}</View>
      )}
      {source === undefined ? null : source.kind === 'svg' ? (
        <SvgImage xml={source.xml} uri="" width={size} height={size} />
      ) : source.kind === 'asset' ? (
        <Image source={source.module} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
      ) : (
        <Image
          source={{ uri: source.uri }}
          style={{ width: size, height: size, opacity: loaded ? 1 : 0 }}
          onLoad={() => {
            cacheTokenLogo(chainId, address, source.uri)
            setLoaded(true)
          }}
          onError={fail}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  )
}
