/**
 * SharedElement — native half (master plan §7.7).
 *
 * Reanimated carries a tagged view between two screens itself: give the same
 * `sharedTransitionTag` to a view on the outgoing screen and to one on the
 * incoming screen and it interpolates position and size across the push. No
 * document, no snapshots, no `startViewTransition` — the web mechanism has no
 * counterpart here and the navigator, not the router, drives it.
 *
 * Strictly progressive enhancement, as the plan insists. Shared transitions
 * are still experimental on Fabric, so the tag may simply be ignored at
 * runtime; what is left is `Animated.View` wrapping its children and the
 * plain push that was always the baseline. Nothing here is allowed to become
 * a dependency of the navigation working.
 */
import Animated from 'react-native-reanimated'
import { useReducedMotionPref } from './motion/MotionContext'
import { sharedElementTag, type SharedElementProps } from './SharedElement.types'

export function SharedElement({ id, active = true, style, children, testID }: SharedElementProps) {
  // Reduced motion skips the move entirely (§7.6): no tag, so nothing pairs.
  const reduced = useReducedMotionPref()
  const on = active && !reduced
  return (
    <Animated.View
      style={style}
      testID={testID}
      {...(on ? { sharedTransitionTag: sharedElementTag(id) } : {})}
    >
      {children}
    </Animated.View>
  )
}
