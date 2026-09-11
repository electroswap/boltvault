/**
 * SharedElement — web half (master plan §7.7). Metro picks
 * SharedElement.native.tsx instead.
 *
 * The browser does the work: an element with a `view-transition-name` is
 * snapshotted on both sides of a `document.startViewTransition` call and the
 * two snapshots are tweened into each other. Our job is only to put the same
 * name on the origin and the destination — the navigation itself is wrapped
 * in packages/wallet/src/navigation/transitions.ts, because this app's router
 * is a hand-written memory store rather than react-router.
 *
 * The name is set on the DOM node rather than passed through `style`. React
 * Native's `ViewStyle` has no word for a property only the web has, and
 * reaching for the real node is honest about that: this file only ever runs
 * in a browser. It also means the name exists for exactly as long as the
 * element does, and a screen that unmounts leaves no stale name behind to
 * collide with the next one (a duplicate name aborts the whole transition).
 */
import { useLayoutEffect, useRef } from 'react'
import { View } from 'react-native'
import { useReducedMotionPref } from './motion/MotionContext'
import { sharedElementTag, type SharedElementProps } from './SharedElement.types'
import { motion } from './tokens'

/**
 * The browser's default is a 250 ms cross-fade for every group. One rule,
 * installed once, puts the pair on our own clock instead (§7.12: the token
 * file is the contract, including durations).
 */
let timingInstalled = false

function installTiming(): void {
  if (timingInstalled || typeof document === 'undefined') return
  timingInstalled = true
  try {
    const style = document.createElement('style')
    style.textContent = `::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation-duration:${motion.shared}ms}`
    document.head.appendChild(style)
  } catch {
    // Styling the transition is a refinement; failing to must never stop one.
  }
}

export function SharedElement({ id, active = true, style, children, testID }: SharedElementProps) {
  // Reduced motion skips the move entirely (§7.6): with no name on either
  // side, the browser has nothing to pair and the navigation is a plain swap.
  const reduced = useReducedMotionPref()
  const ref = useRef<View | null>(null)
  const on = active && !reduced
  const tag = sharedElementTag(id)

  // Layout, not passive: the browser photographs the new state as soon as the
  // navigation's update settles, and a name applied a frame later is a name
  // the destination did not have when its picture was taken.
  useLayoutEffect(() => {
    if (!on) return
    installTiming()
    // react-native-web renders View as a div; this is that div.
    const node = ref.current as unknown as HTMLElement | null
    if (node === null || typeof node.style === 'undefined') return
    node.style.setProperty('view-transition-name', tag)
    return () => {
      node.style.removeProperty('view-transition-name')
    }
  }, [on, tag])

  return (
    <View ref={ref} style={style} testID={testID}>
      {children}
    </View>
  )
}
