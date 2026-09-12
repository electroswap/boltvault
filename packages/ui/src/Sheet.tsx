/**
 * Sheet — stacks from the bottom on every body (master plan §7.5). The
 * extension's sign.html mounts the same component full-window. Motion is a
 * Reanimated CSS animation so it is real CSS on web and a UI-thread animation
 * on native, with no worklet plugin dependency. The panel is opaque navy
 * glass with the current as a hairline on its top edge.
 *
 * Layout contract (plan B1): the panel is a column capped at 88 % of the
 * screen; the title and `header` stay fixed, the children scroll inside a
 * bounded region, and `footer` (the Close / primary key) stays fixed under
 * it. A Sheet must be a sibling of its screen's ScrollView, never a child,
 * and callers never nest their own ScrollView.
 */
import { useEffect, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import Animated, { cubicBezier } from 'react-native-reanimated'
import { Icon } from './Icon'
import { Body, Column, Row } from './primitives'
import { CurrentFill } from './Rim'
import { useInsets } from './Insets'
import { useKeyboardHeight } from './useKeyboardHeight'
import { registerOverlay } from './overlays'
import { glow, motion, paint, radius } from './tokens'

export interface SheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title?: string
  readonly children: ReactNode
  /** Fixed under the title (a search field). */
  readonly header?: ReactNode
  /** Fixed under the scroll region (the Close or primary key). */
  readonly footer?: ReactNode
  /** Children scroll (default). `false` for a body that manages its own height. */
  readonly scroll?: boolean
  /** Quiet custody mode: no motion, dimmer scrim (§7.9). */
  readonly quiet?: boolean
  /** Reduced motion (§7.6): the sheet simply appears. */
  readonly reducedMotion?: boolean
  readonly testID?: string
}

export function Sheet({ open, onClose, title, children, header, footer, scroll = true, quiet = false, reducedMotion = false, testID }: SheetProps) {
  const insets = useInsets()
  const keyboard = useKeyboardHeight()
  // Android's back button dismisses the newest thing on screen, and that is a
  // sheet more often than it is a route. Registering here covers every sheet
  // in the product without each screen reporting its own state.
  useEffect(() => {
    if (!open) return
    return registerOverlay(onClose)
  }, [open, onClose])
  if (!open) return null
  const still = quiet || reducedMotion
  const topPad = title || header ? 12 : 20
  // A sheet rises from the bottom edge, so on a gesture-bar phone its last row
  // would otherwise sit under the system's own handle.
  const bottomPad = (footer ? 12 : 20) + (keyboard > 0 ? 0 : insets.bottom)
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 10, justifyContent: 'flex-end', paddingBottom: keyboard, backgroundColor: quiet ? 'rgba(3, 4, 14, 0.88)' : 'rgba(3, 4, 14, 0.62)' },
        still
          ? null
          : { animationName: { from: { opacity: 0 }, to: { opacity: 1 } }, animationDuration: `${motion.sheet}ms`, animationFillMode: 'forwards' },
      ]}
      testID={testID}
    >
      <Pressable onPress={onClose} accessibilityLabel="Close" style={{ flex: 1 }} />
      <Animated.View
        style={[
          { backgroundColor: paint.sheet, borderTopLeftRadius: radius.console, borderTopRightRadius: radius.console, maxHeight: '88%', overflow: 'hidden', flexDirection: 'column', shadowColor: glow.plate, shadowRadius: 32, shadowOpacity: 1, shadowOffset: { width: 0, height: -8 } },
          // The panel only slides: it is opaque at every frame, so a paused or skipped animation never shows the screen beneath.
          still
            ? null
            : {
                animationName: { from: { transform: [{ translateY: 28 }] }, to: { transform: [{ translateY: 0 }] } },
                animationDuration: `${motion.sheet}ms`,
                animationTimingFunction: cubicBezier(0.2, 0.9, 0.25, 1),
                animationFillMode: 'forwards',
              },
        ]}
      >
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, opacity: 0.8 }} pointerEvents="none">
          <CurrentFill />
        </View>
        {title || header ? (
          <Column paddingHorizontal="$5" paddingTop="$5" gap="$3" flexShrink={0}>
            {title ? (
              <Row justifyContent="space-between">
                <Body size="title" flexShrink={1} numberOfLines={1}>
                  {title}
                </Body>
                <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={20} color={paint.mute} />
                </Pressable>
              </Row>
            ) : null}
            {header}
          </Column>
        ) : null}
        {scroll ? (
          <ScrollView style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: topPad, paddingBottom: bottomPad, gap: 16 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <Column flexShrink={1} minHeight={0} paddingHorizontal="$5" paddingTop={topPad} paddingBottom={bottomPad} gap="$4">
            {children}
          </Column>
        )}
        {footer ? (
          /* When there is a footer it, not the content, is the sheet's bottom
             edge — so the gesture-bar inset is owed here. Owner: "the save
             button is cut off by bottom nav". */
          <Column paddingHorizontal="$5" paddingBottom={20 + (keyboard > 0 ? 0 : insets.bottom)} paddingTop={4} gap="$2" flexShrink={0}>
            {footer}
          </Column>
        ) : null}
      </Animated.View>
    </Animated.View>
  )
}
