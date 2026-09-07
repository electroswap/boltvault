/**
 * Artwork (master plan §8.10): a piece on a glass shelf — contact shadow,
 * a specular edge, and on the Piece view a single slow light sweep when it
 * opens. Images only (mp4 arrives with the mobile media host, M9); a
 * failed image falls back to an engraved placeholder, never a blank.
 */
import { useEffect, useRef, useState } from 'react'
import { Image } from 'react-native'
import Animated from 'react-native-reanimated'
import { useCachedImage } from './imageCache'
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
  /**
   * Fires once this slot has settled — the image painted, or it failed and the
   * placeholder is what you get. Either way it will not change again, which is
   * what a screen needs to know before it stops showing a loader over itself.
   */
  readonly onSettled?: () => void
  /**
   * Corner radius. Pass 0 when a parent already clips this to its own shape:
   * two radii on one corner draw it twice, which is the doubled edge the
   * owner flagged on cards nested inside cards.
   */
  readonly radius?: number
  readonly testID?: string
}

/** Up to two initials from a name; leading punctuation is skipped so "Legend #12" reads L1. */
function initials(label: string): string {
  const words = label
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean)
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
}

export function Artwork({ uri: source, label, size, sweep = false, reducedMotion = false, badge = null, radius = 12, onSettled, testID }: ArtworkProps) {
  // Served from the body's disk cache when it has a copy; otherwise the
  // network URL, with the cache filled behind this render.
  const uri = useCachedImage(source)
  const [failedUri, setFailedUri] = useState<string | null>(null)
  const settled = useRef(false)
  const settle = (): void => {
    if (settled.current) return
    settled.current = true
    onSettled?.()
  }
  // Nothing to wait for: no image means this slot is already final.
  useEffect(() => {
    if (source === null || source === undefined || source === '') settle()
    // `settle` is idempotent and reads a ref, so the source is the only input.
  }, [source])
  // Keyed by the uri, not a bare boolean: a recycled row that swapped in a new
  // image used to stay stuck on the placeholder because `failed` never reset.
  const failed = uri !== undefined && uri !== null && uri === failedUri
  const width = typeof size === 'number' ? size : size.width
  const height = typeof size === 'number' ? size : size.height
  const show = !!uri && !failed
  // A small box cannot hold a name: it shows the name's initials instead ("Electric Legends" → EL).
  const small = Math.min(width, height) < 80
  return (
    <Column width={width} height={height} borderRadius={radius} overflow="hidden" backgroundColor="$glass" borderWidth={1} borderColor="rgba(95,216,255,0.12)" testID={testID}>
      {show ? (
        <Image source={{ uri: uri ?? '' }} onLoad={settle} onError={() => { setFailedUri(uri ?? null); settle() }} style={{ width, height }} resizeMode="cover" accessibilityLabel={label} />
      ) : (
        <Column flex={1} alignItems="center" justifyContent="center" padding={small ? 2 : 8}>
          {small ? (
            <Body tone="mute" fontWeight="600" fontSize={Math.round(Math.min(width, height) * 0.36)} lineHeight={Math.round(Math.min(width, height) * 0.5)} numberOfLines={1}>
              {initials(label)}
            </Body>
          ) : (
            <Body tone="mute" size="caption" numberOfLines={2} textAlign="center">
              {label}
            </Body>
          )}
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
