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
import { CurrentFill, Rim } from './Rim'
import { metrics, paint, type as typeScale } from './tokens'

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

export function Badge({ badge, corner = false }: { badge: ActionTileBadge; corner?: boolean }) {
  return (
    <View style={[{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: BADGE_BG[badge.tone], alignSelf: 'flex-start', maxWidth: '100%' }, corner ? { position: 'absolute', top: 6, right: 6, maxWidth: '70%', zIndex: 2 } : null]}>
      <Body size="caption" tone={badge.tone} fontWeight="600" fontSize={10.5} lineHeight={13} numberOfLines={1}>
        {badge.text}
      </Body>
    </View>
  )
}

/**
 * The glyph in its disc.
 *
 * Owner: "they look a bit boring and I'm not crazy about the way those icons
 * are styled." It was a flat 10%-cyan wash with a cyan glyph on it — one hue,
 * one plane, nothing catching light. It carries the brand's own current now,
 * dimmed so it reads as material rather than as a button, with the lit rim
 * over it and the glyph in ink so it separates from the colour instead of
 * dissolving into it. The glyph scales with the disc rather than sitting at a
 * fixed 20 px, so a bigger disc reads as a bigger icon and not as more
 * padding.
 */
export function Glyph({ icon, size = 34 }: { icon: IconName; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', backgroundColor: paint.glassRaisedSolid }}>
      <CurrentFill radius={size / 2} opacity={0.5} />
      <Icon name={icon} size={Math.round(size * 0.56)} color={paint.ink} strokeWidth={1.9} />
      <Rim radius={size / 2} opacity={0.5} />
    </View>
  )
}

export function ActionTile({ icon, label, badge = null, onPress, layout = 'stacked', testID }: ActionTileProps) {
  const stacked = layout === 'stacked'
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={badge ? `${label}, ${badge.text}` : label} testID={testID} style={{ flex: stacked ? 1 : undefined, minHeight: 44 }}>
      {stacked ? (
        <Plate role="tile" height={metrics.actionCell} paddingVertical={8} paddingHorizontal={8} alignItems="center" justifyContent="center" gap={5} position="relative">
          {badge ? <Badge badge={badge} corner /> : null}
          <Glyph icon={icon} size={38} />
          <Body size="caption" fontWeight="600" fontSize={typeScale.caption.size} lineHeight={typeScale.caption.size + 3} numberOfLines={1} textAlign="center">
            {label}
          </Body>
        </Plate>
      ) : (
        <Plate role="tile" height={metrics.actionCellRow} paddingHorizontal="$3" justifyContent="center">
          <Row gap="$3" alignItems="center">
            <Glyph icon={icon} size={40} />
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
