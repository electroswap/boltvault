/**
 * The four tabs (master plan §7.5): Home · Swap · Explore · Activity.
 * Settings lives behind the seat. 44 px minimum targets. A glass bar with
 * the current as a hairline on top; the active tab is lit and underlined.
 */
import { Pressable, View } from 'react-native'
import { Icon, type IconName } from './Icon'
import { Body, Row } from './primitives'
import { CurrentFill } from './Rim'
import { glow, metrics, paint } from './tokens'

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
    <Row backgroundColor="rgba(9, 13, 38, 0.9)" paddingBottom="$1" testID={testID}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, opacity: 0.55 }} pointerEvents="none">
        <CurrentFill />
      </View>
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
            style={{ flex: 1, minHeight: metrics.hit + 8, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 7 }}
          >
            <Icon name={item.icon} size={22} color={active ? paint.arc : paint.mute} />
            <Body size="caption" tone={active ? 'arc' : 'mute'}>
              {item.label}
            </Body>
            <View style={{ width: 18, height: 2, borderRadius: 1, overflow: 'hidden', opacity: active ? 1 : 0, marginTop: 1, shadowColor: glow.tab, shadowRadius: 8, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } }}>
              <CurrentFill radius={1} />
            </View>
          </Pressable>
        )
      })}
    </Row>
  )
}
