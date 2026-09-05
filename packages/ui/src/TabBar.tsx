/**
 * The four tabs (master plan §7.5): Home · Swap · Explore · Activity.
 * Settings lives behind the seat. 44 px minimum targets.
 */
import { Pressable } from 'react-native'
import { Icon, type IconName } from './Icon'
import { Body, Row } from './primitives'
import { edge, metrics, paint } from './tokens'

export interface TabItem {
  readonly id: string
  readonly label: string
  readonly icon: IconName
  readonly badge?: number
}

export interface TabBarProps {
  readonly items: readonly TabItem[]
  readonly activeId: string
  readonly onSelect: (id: string) => void
  readonly testID?: string
}

export function TabBar({ items, activeId, onSelect, testID }: TabBarProps) {
  return (
    <Row borderTopWidth={1} borderTopColor={edge} backgroundColor="$void" paddingBottom="$1" testID={testID}>
      {items.map((item) => {
        const active = item.id === activeId
        return (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            testID={`tab-${item.id}`}
            style={{ flex: 1, minHeight: metrics.hit + 8, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 6 }}
          >
            <Icon name={item.icon} size={22} color={active ? paint.arc : paint.mute} />
            <Body size="caption" tone={active ? 'arc' : 'mute'}>
              {item.label}
            </Body>
          </Pressable>
        )
      })}
    </Row>
  )
}
