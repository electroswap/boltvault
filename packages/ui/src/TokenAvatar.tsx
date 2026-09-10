/**
 * TokenAvatar — a token's logo, with TokenMark as the last frame.
 *
 * Resolution order, first that draws wins:
 *   1. the bundled mark (all 15 listed ElectroSwap tokens + native ETN)
 *   2. the list/custom logoUri the engine handed us
 *   3. the sibling extension on the ElectroSwap static host — it serves .svg
 *      for most tokens and .png for a few, and asking for the wrong one 404s
 *   4. the coin mark, for a chain's own currency and its wrapped form
 *   5. TokenMark: the symbol on a glass disc
 *
 * The coin mark is the resting frame rather than a last resort: it needs no
 * network, so a native row paints its real mark on the first frame and a
 * remote logo, if there is one, replaces it when it arrives.
 *
 * The winner is remembered in a module-level map, so scrolling a list or
 * reopening the popup never re-walks the candidates.
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
import { normaliseTokenAddress, tokenLogoSources, type LogoSource } from './tokenLogos'
import { paint } from './tokens'

export interface TokenAvatarProps {
  readonly chainId: number
  readonly address: string
  /** Drawn on the disc when no image loads. */
  readonly symbol?: string | null
  readonly logoUri?: string | null
  readonly size?: number
  readonly testID?: string
}

/** Resolved winners (or null for "nothing drew"), by chain and address. */
const resolved = new Map<string, number | null>()

/** Markup and asset modules are already in the bundle: nothing can fail. */
function isLocal(source: LogoSource | undefined): boolean {
  return source !== undefined && source.kind !== 'uri'
}

export function TokenAvatar({ chainId, address, symbol, logoUri, size = 32, testID }: TokenAvatarProps) {
  const key = `${chainId}:${normaliseTokenAddress(address)}`
  const sources = useMemo(() => tokenLogoSources(chainId, address, logoUri), [chainId, address, logoUri])
  const coin = coinMarkChain(chainId, address)

  // A previously resolved winner short-circuits the walk entirely.
  const known = resolved.get(key)
  const startAt = known === undefined ? 0 : known === null ? sources.length : known

  const [index, setIndex] = useState(startAt)
  const [loaded, setLoaded] = useState(isLocal(sources[startAt]))

  useEffect(() => {
    setIndex(startAt)
    setLoaded(isLocal(sources[startAt]))
  }, [key, startAt, sources])

  const source = index < sources.length ? sources[index] : undefined

  const fail = (): void => {
    const next = index + 1
    if (next >= sources.length) resolved.set(key, null)
    setIndex(next)
    // Without this the mark stays hidden behind a picture that never arrives.
    setLoaded(isLocal(sources[next]))
  }

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
            resolved.set(key, index)
            setLoaded(true)
          }}
          onError={fail}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  )
}
