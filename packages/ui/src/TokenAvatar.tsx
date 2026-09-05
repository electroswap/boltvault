/**
 * TokenAvatar — identicon in 50 ms, photo fades in if a logo loads
 * (master plan §10.3). The identicon is deterministic from (chainId, address)
 * so a bus bar is never a blank disc.
 */
import { useState } from 'react'
import { Image, View } from 'react-native'
import Svg, { Rect } from 'react-native-svg'
import { fnv1a32, seededRandom } from './hash'
import { paint, light } from './tokens'

export interface TokenAvatarProps {
  readonly chainId: number
  readonly address: string
  readonly logoUri?: string | null
  readonly size?: number
  readonly testID?: string
}

const PALETTE = [light.arc, light.plasma, light.flare, paint.ember, light.core]

export function identiconCells(chainId: number, address: string): { cells: boolean[]; color: string } {
  const rnd = seededRandom(fnv1a32(`${chainId}:${address.toLowerCase()}`))
  const color = PALETTE[Math.floor(rnd() * PALETTE.length)] ?? light.arc
  // 5×5, mirrored horizontally: 15 random bits.
  const half: boolean[] = []
  for (let i = 0; i < 15; i++) half.push(rnd() > 0.45)
  const cells: boolean[] = []
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const hx = x < 3 ? x : 4 - x
      cells.push(half[y * 3 + hx] ?? false)
    }
  }
  return { cells, color }
}

export function TokenAvatar({ chainId, address, logoUri, size = 32, testID }: TokenAvatarProps) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const { cells, color } = identiconCells(chainId, address)
  const cell = size / 5
  const showImage = !!logoUri && !failed
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: paint.glassRaised }} testID={testID}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', opacity: loaded ? 0 : 1 }}>
        {cells.map((on, i) =>
          on ? <Rect key={i} x={(i % 5) * cell} y={Math.floor(i / 5) * cell} width={cell} height={cell} fill={color} opacity={0.9} /> : null,
        )}
      </Svg>
      {showImage ? (
        <Image
          source={{ uri: logoUri }}
          style={{ width: size, height: size, opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  )
}
