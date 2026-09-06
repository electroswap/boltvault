/**
 * The dock (master plan §7.5, plan B2): Home · Swap · Activity. Settings
 * lives behind the seat. 44 px minimum targets in a 52 px bar; a glass bar
 * with the current as a hairline on top; the active tab is lit and
 * underlined; a tab can carry a count (Activity: what needs attention).
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
    <Row backgroundColor="rgba(9, 13, 38, 0.9)" height={metrics.tabBar} testID={testID}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, opacity: 0.55 }} pointerEvents="none">
        <CurrentFill />
      </View>
      {items.map((item) => {
        const active = item.id === activeId
        const badge = item.badge !== undefined && item.badge > 0 ? (item.badge > 99 ? '99+' : String(item.badge)) : null
        return (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={badge ? `${item.label}, ${item.badge} new` : item.label}
            testID={`tab-${item.id}`}
            style={{ flex: 1, minHeight: metrics.hit + 4, alignItems: 'center', justifyContent: 'center', gap: 1, paddingTop: 5 }}
          >
            <View>
              <Icon name={item.icon} size={22} color={active ? paint.arc : paint.mute} />
              {badge ? (
                <View style={{ position: 'absolute', top: -5, left: 14, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: paint.ember, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none" testID={`tab-${item.id}-badge`}>
                  <Body size="caption" fontSize={11} lineHeight={14} fontWeight="600" color={paint.void}>
                    {badge}
                  </Body>
                </View>
              ) : null}
            </View>
            <Body size="caption" tone={active ? 'arc' : 'mute'} fontSize={12} lineHeight={16}>
              {item.label}
            </Body>
            <View style={{ width: 18, height: 2, borderRadius: 1, overflow: 'hidden', opacity: active ? 1 : 0, shadowColor: glow.tab, shadowRadius: 8, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } }}>
              <CurrentFill radius={1} />
            </View>
          </Pressable>
        )
      })}
    </Row>
  )
}
