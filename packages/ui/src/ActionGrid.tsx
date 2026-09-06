/**
 * ActionGrid — Home's nine verbs as cells of one surface (style bible ›
 * plates): a recessed plate divided by hairlines, a glyph in its disc and a
 * label in every cell, a badge pinned to a cell's corner. One surface reads
 * calmer than nine plates with rims; the hover and press tints live on the
 * cell. `row` lays a cell out horizontally for the wide tab body.
 */
import { Pressable, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { Badge, Glyph, type ActionTileBadge } from './ActionTile'
import { useReducedMotionPref } from './motion/MotionContext'
import type { IconName } from './Icon'
import { Body, Column, Plate, Row } from './primitives'
import { edge, motion, paint } from './tokens'

export interface ActionGridItem {
  readonly id: string
  readonly icon: IconName
  readonly label: string
  readonly badge?: ActionTileBadge | null
  readonly onPress: () => void
}

export interface ActionGridProps {
  readonly items: readonly ActionGridItem[]
  readonly columns?: number
  readonly layout?: 'stacked' | 'row'
  readonly cellHeight?: number
  readonly testID?: string
}

export function ActionGrid({ items, columns = 3, layout = 'stacked', cellHeight, testID }: ActionGridProps) {
  const rows: ActionGridItem[][] = []
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns))
  const height = cellHeight ?? (layout === 'stacked' ? 72 : 64)
  const reduced = useReducedMotionPref()
  return (
    <Plate role="recessed" padding={0} overflow="hidden" testID={testID}>
      {rows.map((row, ri) => (
        <Row key={ri} borderBottomWidth={ri < rows.length - 1 ? 1 : 0} borderBottomColor="$edge">
          {row.map((it, ci) => (
            <Pressable
              key={it.id}
              onPress={it.onPress}
              accessibilityRole="button"
              accessibilityLabel={it.badge ? `${it.label}, ${it.badge.text}` : it.label}
              testID={`key-${it.id}`}
              style={{
                flex: 1,
                height,
                borderRightWidth: ci < row.length - 1 ? 1 : 0,
                borderRightColor: edge,
              }}
            >
              {({ pressed }) => (
              <Animated.View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? paint.glassRaised : 'rgba(22, 30, 78, 0)', transitionProperty: 'backgroundColor', transitionDuration: reduced ? 0 : motion.micro, transitionTimingFunction: 'ease-out' }}>
              {layout === 'stacked' ? (
                <View style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 5, position: 'relative' }}>
                  {it.badge ? <Badge badge={it.badge} corner /> : null}
                  <Glyph icon={it.icon} size={32} />
                  <Body size="caption" fontWeight="600" fontSize={12} lineHeight={15} numberOfLines={1} textAlign="center">
                    {it.label}
                  </Body>
                </View>
              ) : (
                <Row gap="$3" alignItems="center" paddingHorizontal={14} width="100%">
                  <Glyph icon={it.icon} size={34} />
                  <Column flex={1} gap={3} alignItems="flex-start">
                    <Body fontWeight="600" numberOfLines={1} textAlign="left">
                      {it.label}
                    </Body>
                    {it.badge ? <Badge badge={it.badge} /> : null}
                  </Column>
                </Row>
              )}
              </Animated.View>
              )}
            </Pressable>
          ))}
          {/* Pad a short last row so its cells keep the grid's width. */}
          {row.length < columns ? Array.from({ length: columns - row.length }, (_, i) => <View key={`pad-${i}`} style={{ flex: 1 }} />) : null}
        </Row>
      ))}
    </Plate>
  )
}
