/**
 * ActionTile — one square of the Home action grid (plan B3): a raised glass
 * tile with a glyph, a label and an optional live badge ("1 live",
 * "12 DYNO"). Stacked in the popup, a row on the tab. Badges never animate.
 */
import { Pressable, View } from 'react-native'
import { Icon, type IconName } from './Icon'
import { Body, Column, Plate, Row } from './primitives'
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

const BADGE_BG: Record<ActionTileBadge['tone'], string> = { arc: 'rgba(79, 195, 255, 0.16)', surge: 'rgba(62, 230, 165, 0.16)', ember: 'rgba(245, 198, 107, 0.18)', burn: 'rgba(255, 92, 122, 0.18)' }

function Badge({ badge }: { badge: ActionTileBadge }) {
  return (
    <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: BADGE_BG[badge.tone], alignSelf: 'flex-start', maxWidth: '100%' }}>
      <Body size="caption" tone={badge.tone} fontWeight="600" fontSize={11} lineHeight={14} numberOfLines={1}>
        {badge.text}
      </Body>
    </View>
  )
}

export function ActionTile({ icon, label, badge = null, onPress, layout = 'stacked', testID }: ActionTileProps) {
  const stacked = layout === 'stacked'
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={badge ? `${label}, ${badge.text}` : label} testID={testID} style={{ flex: stacked ? 1 : undefined, minHeight: 44 }}>
      {stacked ? (
        <Plate role="tile" height={70} paddingVertical={10} paddingHorizontal={10} justifyContent="space-between">
          <Row justifyContent="space-between" alignItems="flex-start">
            <Icon name={icon} size={22} color={paint.arc} />
            {badge ? <Badge badge={badge} /> : null}
          </Row>
          <Body size="caption" fontWeight="600" fontSize={12} lineHeight={16} numberOfLines={1}>
            {label}
          </Body>
        </Plate>
      ) : (
        <Plate role="tile" height={72} padding="$3" justifyContent="center">
          <Row gap="$3">
            <Icon name={icon} size={22} color={paint.arc} />
            <Column flex={1} gap={4}>
              <Body fontWeight="600" numberOfLines={1}>
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
