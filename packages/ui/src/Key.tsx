import { useState, type ReactNode } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { Charge } from './motion/Charge'
import { useReducedMotionPref } from './motion/MotionContext'
import { KeyFrame, KeyLabel, Row } from './primitives'
import { CurrentFill, Rim } from './Rim'
import { radius } from './tokens'

export interface KeyProps {
  readonly label: string
  readonly onPress?: () => void
  readonly kind?: 'primary' | 'secondary' | 'danger'
  /** `regular` (56 px) only for a screen's primary verb; `compact` (44 px) for everything else. */
  readonly size?: 'regular' | 'compact'
  readonly disabled?: boolean
  readonly testID?: string
  readonly icon?: ReactNode
  /** Icon above the label — the stacked keys of a narrow body. */
  readonly stacked?: boolean
}

/**
 * One verb per key, from the closed set in master plan §7.10. The primary is
 * the current (blue into violet) with a glow; the secondary is glass with a
 * lit rim; danger is copper.
 */
export function Key({ label, onPress, kind = 'primary', size = 'regular', disabled = false, testID, icon, stacked = false }: KeyProps) {
  const compact = size === 'compact'
  const r = compact ? 12 : radius.key
  const reduced = useReducedMotionPref()
  const [charge, setCharge] = useState(0)
  const [width, setWidth] = useState(0)
  return (
    <KeyFrame
      kind={kind}
      size={size}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      // A disabled key does nothing, so it must also look like it did nothing:
      // no charge sweeping across it (the `disabled` term here) and no press
      // tint or scale either — that half lives in `KeyFrame`'s disabled
      // variant, because `pressStyle` is CSS `:active` and fires with no
      // handler attached at all.
      onPressIn={disabled || reduced || kind !== 'primary' ? undefined : () => setCharge((c) => c + 1)}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
      testID={testID}
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      flexDirection={stacked ? 'column' : 'row'}
      gap={stacked ? 2 : compact ? 6 : 8}
      paddingHorizontal={stacked ? '$2' : compact ? '$4' : '$6'}
      height={stacked ? (compact ? 52 : 60) : compact ? 44 : 56}
      flex={stacked ? 1 : undefined}
    >
      {kind === 'primary' ? <CurrentFill radius={r} /> : null}
      {charge > 0 && width > 0 ? <Charge key={charge} width={width} radius={r} /> : null}
      {kind === 'secondary' ? <Rim radius={r} opacity={0.35} /> : null}
      {/* A positioned layer: on the web an absolute SVG paints above in-flow text whatever the order. */}
      <Row flexDirection={stacked ? 'column' : 'row'} alignItems="center" justifyContent="center" gap={stacked ? 2 : compact ? 6 : 8} zIndex={1}>
        {icon}
        <KeyLabel fontSize={stacked || compact ? '$2' : '$3'}>{label}</KeyLabel>
      </Row>
    </KeyFrame>
  )
}
