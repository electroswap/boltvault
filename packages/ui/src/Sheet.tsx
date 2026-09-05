/**
 * Sheet — stacks from the bottom on every body (master plan §7.5). The
 * extension's sign.html mounts the same component full-window. Motion is a
 * Reanimated CSS animation so it is real CSS on web and a UI-thread animation
 * on native, with no worklet plugin dependency.
 */
import type { ReactNode } from 'react'
import { Pressable } from 'react-native'
import Animated from 'react-native-reanimated'
import { Icon } from './Icon'
import { Body, Column, Row } from './primitives'
import { motion, paint, radius } from './tokens'

export interface SheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title?: string
  readonly children: ReactNode
  /** Quiet custody mode: no motion, dimmer scrim (§7.9). */
  readonly quiet?: boolean
  /** Reduced motion (§7.6): the sheet simply appears. */
  readonly reducedMotion?: boolean
  readonly testID?: string
}

export function Sheet({ open, onClose, title, children, quiet = false, reducedMotion = false, testID }: SheetProps) {
  if (!open) return null
  const still = quiet || reducedMotion
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end', backgroundColor: quiet ? 'rgba(2,3,8,0.86)' : 'rgba(2,3,8,0.6)' },
        still
          ? null
          : { animationName: { from: { opacity: 0 }, to: { opacity: 1 } }, animationDuration: `${motion.sheet}ms`, animationFillMode: 'forwards' },
      ]}
      testID={testID}
    >
      <Pressable onPress={onClose} accessibilityLabel="Close" style={{ flex: 1 }} />
      <Animated.View
        style={[
          { backgroundColor: paint.glassRaised, borderTopLeftRadius: radius.raised, borderTopRightRadius: radius.raised, borderTopWidth: 1, borderColor: 'rgba(95,216,255,0.12)', maxHeight: '88%' },
          // The panel only slides: it is opaque at every frame, so a paused or skipped animation never shows the screen beneath.
          still
            ? null
            : {
                animationName: { from: { transform: [{ translateY: 24 }] }, to: { transform: [{ translateY: 0 }] } },
                animationDuration: `${motion.sheet}ms`,
                animationTimingFunction: 'ease-out',
                animationFillMode: 'forwards',
              },
        ]}
      >
        <Column padding="$5" gap="$4">
          {title ? (
            <Row justifyContent="space-between">
              <Body size="title">{title}</Body>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={20} color={paint.mute} />
              </Pressable>
            </Row>
          ) : null}
          {children}
        </Column>
      </Animated.View>
    </Animated.View>
  )
}
