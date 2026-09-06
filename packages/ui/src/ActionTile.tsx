/**
 * ActionTile — one square of the Home action grid (plan B3): a raised glass
 * tile with the glyph centred in a lit disc, the label centred beneath it,
 * and an optional live badge ("1 live", "12 DYNO") pinned to the corner so
 * it never pushes the glyph off centre. Stacked in the popup and on the
 * phone, a row on the tab. Badges never animate.
 */
import { Pressable, View } from 'react-native'
import { Icon, type IconName } from './Icon'
import { Body, Column, Plate, Row } from './primitives'
import { Rim } from './Rim'
import { paint } from './tokens'

export interface ActionTileBadge {
  readonly text: string
  readonly tone: 'arc' | 'surge' | 'ember' | 'burn'
}

export interface ActionTileProps {
  readonly icon: IconName
  readonly label: string
  readonly badge?: ActionTileBadge | null
  readonly onPress: () => void
  readonly layout?: 'stacked' | 'row'
  readonly testID?: string
}

const BADGE_BG: Record<ActionTileBadge['tone'], string> = { arc: 'rgba(79, 195, 255, 0.18)', surge: 'rgba(62, 230, 165, 0.18)', ember: 'rgba(245, 198, 107, 0.2)', burn: 'rgba(255, 92, 122, 0.2)' }
const DISC = 'rgba(95, 216, 255, 0.10)'

export function Badge({ badge, corner = false }: { badge: ActionTileBadge; corner?: boolean }) {
  return (
    <View style={[{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: BADGE_BG[badge.tone], alignSelf: 'flex-start', maxWidth: '100%' }, corner ? { position: 'absolute', top: 6, right: 6, maxWidth: '70%', zIndex: 2 } : null]}>
      <Body size="caption" tone={badge.tone} fontWeight="600" fontSize={10.5} lineHeight={13} numberOfLines={1}>
        {badge.text}
      </Body>
    </View>
  )
}

/** The glyph in its disc: a soft arc tint, a faint rim, the icon at 20 px with the stroke the style bible sets. */
export function Glyph({ icon, size = 34 }: { icon: IconName; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: DISC, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
      <Icon name={icon} size={20} color={paint.arc} strokeWidth={2} />
      <Rim radius={size / 2} opacity={0.35} />
    </View>
  )
}

export function ActionTile({ icon, label, badge = null, onPress, layout = 'stacked', testID }: ActionTileProps) {
  const stacked = layout === 'stacked'
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={badge ? `${label}, ${badge.text}` : label} testID={testID} style={{ flex: stacked ? 1 : undefined, minHeight: 44 }}>
      {stacked ? (
        <Plate role="tile" height={68} paddingVertical={8} paddingHorizontal={8} alignItems="center" justifyContent="center" gap={5} position="relative">
          {badge ? <Badge badge={badge} corner /> : null}
          <Glyph icon={icon} size={32} />
          <Body size="caption" fontWeight="600" fontSize={12} lineHeight={15} numberOfLines={1} textAlign="center">
            {label}
          </Body>
        </Plate>
      ) : (
        <Plate role="tile" height={72} paddingHorizontal="$3" justifyContent="center">
          <Row gap="$3" alignItems="center">
            <Glyph icon={icon} size={36} />
            <Column flex={1} gap={3} alignItems="flex-start">
              <Body fontWeight="600" numberOfLines={1} textAlign="left">
                {label}
              </Body>
              {badge ? <Badge badge={badge} /> : null}
            </Column>
          </Row>
        </Plate>
      )}
    </Pressable>
  )
}
