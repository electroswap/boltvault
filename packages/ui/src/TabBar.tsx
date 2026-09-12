/**
 * The dock (master plan §7.5, plan B2): Home · Swap · Activity. Settings
 * lives behind the seat. 44 px minimum targets in a 52 px bar; a glass bar
 * with the current as a hairline on top; the active tab is lit and
 * underlined; a tab can carry a count (Activity: what needs attention).
 */
import { useState } from 'react'
import { Pressable, View, type LayoutChangeEvent } from 'react-native'
import Animated, { cubicBezier } from 'react-native-reanimated'
import { Icon, type IconName } from './Icon'
import { useReducedMotionPref } from './motion/MotionContext'
import { Body, Row } from './primitives'
import { CurrentFill } from './Rim'
import { useInsets } from './Insets'
import { glow, metrics, motion, paint } from './tokens'

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
  const reduced = useReducedMotionPref()
  const [width, setWidth] = useState(0)
  const insets = useInsets()
  const index = Math.max(0, items.findIndex((i) => i.id === activeId))
  const cell = items.length ? width / items.length : 0
  // The dock keeps its own height and stands the gesture bar off beneath it,
  // so the tabs never share pixels with the system's back/home/recents.
  return (
    <Row backgroundColor="rgba(9, 13, 38, 0.9)" height={metrics.tabBar + insets.bottom} paddingBottom={insets.bottom} testID={testID} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
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
            <View style={{ height: 2 }} />
          </Pressable>
        )
      })}
      {/* The one indicator: it slides to the chosen tab instead of lighting up in place. */}
      {width > 0 ? (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 5, left: 0, width: 18, height: 2, borderRadius: 1, overflow: 'hidden', shadowColor: glow.tab, shadowRadius: 8, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 }, transform: [{ translateX: cell * index + cell / 2 - 9 }], transitionProperty: 'transform', transitionDuration: reduced ? 0 : motion.screen, transitionTimingFunction: cubicBezier(0.2, 0.8, 0.2, 1) }}>
          <CurrentFill radius={1} />
        </Animated.View>
      ) : null}
    </Row>
  )
}
