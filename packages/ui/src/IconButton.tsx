/**
 * IconButton — a 44 px pressable around a `metrics.disc` glass disc with one
 * glyph (style bible › chrome). Headers, contract rows, pin/hide, alerts. The
 * optional badge is a small ember pill at the top-right corner.
 *
 * The disc used to be a 34 px literal here while the account seat's circle was
 * a 40 px literal there, and the two trade places on the same header line —
 * Home opens with the account circle, a pushed screen opens with the round
 * Back — so navigating shrank the circle at the top left. Both read
 * `metrics.disc` now. The pressable frame is still `metrics.hit`, so the
 * bigger disc costs no hit target.
 */
import { Pressable, View } from 'react-native'
import { Icon, type IconName } from './Icon'
import { Body } from './primitives'
import { Rim } from './Rim'
import { metrics, paint } from './tokens'

export interface IconButtonProps {
  readonly icon: IconName
  /** The accessible name; there is no visible label. */
  readonly label: string
  readonly onPress?: () => void
  /** Lit rim and an arc glyph: the pinned state, the open filter. */
  readonly active?: boolean
  readonly tone?: 'mute' | 'ink' | 'arc' | 'burn'
  readonly badge?: number | string | null
  readonly disabled?: boolean
  readonly testID?: string
}

export function IconButton({
  icon,
  label,
  onPress,
  active = false,
  tone = 'mute',
  badge = null,
  disabled = false,
  testID,
}: IconButtonProps) {
  const color = active
    ? paint.arc
    : tone === 'ink'
      ? paint.ink
      : tone === 'arc'
        ? paint.arc
        : tone === 'burn'
          ? paint.burn
          : paint.mute
  const showBadge = badge !== null && badge !== undefined && badge !== 0 && badge !== ''
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      testID={testID}
      style={{
        width: metrics.hit,
        height: metrics.hit,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <View
        style={{
          width: metrics.disc,
          height: metrics.disc,
          borderRadius: metrics.disc / 2,
          backgroundColor: paint.glassRaised,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <View style={{ zIndex: 1 }}>
          <Icon name={icon} size={18} color={color} />
        </View>
        <Rim radius={metrics.disc / 2} opacity={active ? 0.7 : 0.35} />
      </View>
      {showBadge ? (
        <View
          style={{
            position: 'absolute',
            top: 2,
            right: 0,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            backgroundColor: paint.ember,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          pointerEvents="none"
        >
          <Body size="caption" fontSize={11} lineHeight={14} fontWeight="600" color={paint.void}>
            {String(badge)}
          </Body>
        </View>
      ) : null}
    </Pressable>
  )
}
