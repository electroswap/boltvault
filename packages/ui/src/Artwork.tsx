/**
 * Artwork (master plan §8.10): a piece on a glass shelf — contact shadow,
 * a specular edge, and on the Piece view a single slow light sweep when it
 * opens. Images only (mp4 arrives with the mobile media host, M9); a
 * failed image falls back to an engraved placeholder, never a blank.
 */
import { useState } from 'react'
import { Image } from 'react-native'
import Animated from 'react-native-reanimated'
import { Body, Column } from './primitives'
import { light, motion, paint } from './tokens'

export interface ArtworkProps {
  readonly uri: string | null
  readonly label: string
  readonly size: number | { width: number; height: number }
  /** The one slow sweep on open (the Piece view); the Rack passes false. */
  readonly sweep?: boolean
  readonly reducedMotion?: boolean
  /** A listed piece's price tag glows `arc`; a piece with an offer carries an `ember` mark (§8.10). */
  readonly badge?: { readonly text: string; readonly tone: 'arc' | 'ember' } | null
  readonly testID?: string
}

export function Artwork({ uri, label, size, sweep = false, reducedMotion = false, badge = null, testID }: ArtworkProps) {
  const [failed, setFailed] = useState(false)
  const width = typeof size === 'number' ? size : size.width
  const height = typeof size === 'number' ? size : size.height
  const show = !!uri && !failed
  return (
    <Column width={width} height={height} borderRadius={12} overflow="hidden" backgroundColor="$glass" borderWidth={1} borderColor="rgba(95,216,255,0.12)" testID={testID}>
      {show ? (
        <Image source={{ uri: uri ?? '' }} onError={() => setFailed(true)} style={{ width, height }} resizeMode="cover" accessibilityLabel={label} />
      ) : (
        <Column flex={1} alignItems="center" justifyContent="center" padding={8}>
          <Body tone="mute" size="caption" numberOfLines={2} textAlign="center">
            {label}
          </Body>
        </Column>
      )}
      {/* Contact shadow at the shelf and the specular edge from the Field. */}
      <Column position="absolute" left={0} right={0} bottom={0} height={Math.max(6, height * 0.12)} backgroundColor="rgba(2,3,8,0.45)" />
      <Column position="absolute" left={0} right={0} top={0} height={1} backgroundColor={light.core} opacity={0.35} />
      {sweep && !reducedMotion && show ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: width * 0.4,
            left: -width * 0.4,
            backgroundColor: light.core,
            opacity: 0.16,
            transform: [{ skewX: '-18deg' }],
            animationName: { from: { left: -width * 0.4 }, to: { left: width * 1.1 } },
            animationDuration: `${motion.sheet * 5}ms`,
            animationFillMode: 'forwards',
            animationTimingFunction: 'ease-in-out',
          }}
        />
      ) : null}
      {badge ? (
        <Column position="absolute" right={6} bottom={6} paddingHorizontal={6} paddingVertical={2} borderRadius={6} backgroundColor="rgba(6,9,19,0.85)" borderWidth={1} borderColor={badge.tone === 'arc' ? paint.arc : paint.ember} testID={testID ? `${testID}-badge` : undefined}>
          <Body tone={badge.tone} size="caption">
            {badge.text}
          </Body>
        </Column>
      ) : null}
    </Column>
  )
}
