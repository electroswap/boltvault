/**
 * TokenAvatar — a token's logo, with TokenMark as the last frame.
 *
 * Resolution order, first that loads wins:
 *   1. the bundled file (all 15 listed ElectroSwap tokens + native ETN)
 *   2. the list/custom logoUri the engine handed us
 *   3. the sibling extension on the ElectroSwap static host — it serves .svg
 *      for most tokens and .png for a few, and asking for the wrong one 404s
 *   4. TokenMark: the symbol on a glass disc
 *
 * The winner is remembered in a module-level map, so scrolling a list or
 * reopening the popup never re-walks the candidates. Previously this component
 * held `loaded`/`failed` in local state only, so every remount retried a URL
 * already known to 404 and showed the placeholder while it did.
 */
import { useEffect, useMemo, useState } from 'react'
import { Image, View } from 'react-native'
import { TokenMark } from './TokenMark'
import { normaliseTokenAddress, tokenLogoCandidates } from './tokenLogos'
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

/** Resolved winners (or null for "nothing loaded"), by chain and address. */
const resolved = new Map<string, string | null>()

export function TokenAvatar({ chainId, address, symbol, logoUri, size = 32, testID }: TokenAvatarProps) {
  const key = `${chainId}:${normaliseTokenAddress(address)}`
  const candidates = useMemo(() => tokenLogoCandidates(chainId, address, logoUri), [chainId, address, logoUri])

  // A previously resolved winner short-circuits the walk entirely.
  const known = resolved.get(key)
  const settled = known !== undefined && known !== null
  const startAt = known === undefined ? 0 : known === null ? candidates.length : Math.max(0, candidates.indexOf(known))

  const [index, setIndex] = useState(startAt)
  const [loaded, setLoaded] = useState(settled)

  useEffect(() => {
    setIndex(startAt)
    setLoaded(settled)
  }, [key, startAt, settled])

  const uri = index < candidates.length ? candidates[index] : undefined

  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: paint.glassRaisedSolid }} testID={testID}>
      {loaded ? null : (
        <View style={{ position: 'absolute' }}>
          <TokenMark symbol={symbol} size={size} />
        </View>
      )}
      {uri === undefined ? null : (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, opacity: loaded ? 1 : 0 }}
          onLoad={() => {
            resolved.set(key, uri)
            setLoaded(true)
          }}
          onError={() => {
            const next = index + 1
            if (next >= candidates.length) resolved.set(key, null)
            setIndex(next)
          }}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  )
}
