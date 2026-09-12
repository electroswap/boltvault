/**
 * The loading vocabulary (plan A2). `Skeleton` is a glass bar with a slow
 * sweep of the current across it — the same Reanimated CSS-animation
 * pattern as LiveFilament, so it is real CSS on web and a UI-thread
 * animation on native; still under reduced motion. `Stale` marks a value
 * that is being shown from the last visit (the filament's still-and-mute
 * language), `Refreshing` is a 2 px sweep that never shifts layout.
 */
import { useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Animated from 'react-native-reanimated'
import { Body, Column, Row } from './primitives'
import { CurrentFill } from './Rim'
import { edge, metrics, paint, radius } from './tokens'

export interface SkeletonProps {
  readonly width?: number | `${number}%`
  readonly height?: number
  readonly radius?: number
  readonly reducedMotion?: boolean
  readonly testID?: string
}

function Sweep({ width, opacity, durationMs, reducedMotion }: { width: number; opacity: number; durationMs: number; reducedMotion: boolean }) {
  const band = Math.max(24, Math.round(width * 0.45))
  if (reducedMotion) {
    return (
      <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: opacity * 0.4 }} pointerEvents="none">
        <CurrentFill />
      </View>
    )
  }
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: band,
        opacity,
        animationName: { from: { transform: [{ translateX: -band }] }, to: { transform: [{ translateX: width }] } },
        animationDuration: `${durationMs}ms`,
        animationTimingFunction: 'linear',
        animationIterationCount: 'infinite',
      }}
    >
      <CurrentFill />
    </Animated.View>
  )
}

export function Skeleton({ width = '100%', height = 14, radius: r = radius.well, reducedMotion = false, testID }: SkeletonProps) {
  const [w, setW] = useState(0)
  const onLayout = (e: LayoutChangeEvent): void => {
    const x = Math.floor(e.nativeEvent.layout.width)
    if (x !== w) setW(x)
  }
  return (
    <View onLayout={onLayout} style={{ width, height, borderRadius: r, backgroundColor: paint.well, borderWidth: 1, borderColor: edge, overflow: 'hidden' }} testID={testID} accessibilityElementsHidden>
      {w > 0 ? <Sweep width={w} opacity={0.16} durationMs={1800} reducedMotion={reducedMotion} /> : null}
    </View>
  )
}

/** A list placeholder: a disc and two bars per row, the shape of a token row. */
export function SkeletonRows({ rows = 4, avatar = true, reducedMotion = false, testID }: { rows?: number; avatar?: boolean; reducedMotion?: boolean; testID?: string }) {
  return (
    <Column gap="$2" testID={testID}>
      {Array.from({ length: rows }, (_, i) => (
        <Row key={i} gap="$3" minHeight={metrics.busBar} paddingHorizontal="$3">
          {avatar ? <Skeleton width={28} height={28} radius={14} reducedMotion={reducedMotion} /> : null}
          <Column flex={1} gap={6}>
            <Skeleton width={`${55 - (i % 3) * 8}%`} height={12} reducedMotion={reducedMotion} />
            <Skeleton width={`${35 + (i % 2) * 10}%`} height={10} reducedMotion={reducedMotion} />
          </Column>
          <Skeleton width={48} height={12} reducedMotion={reducedMotion} />
        </Row>
      ))}
    </Column>
  )
}

/** A grid placeholder: square tiles, the shape of the Rack. */
export function SkeletonTiles({ count = 6, size = 100, columns = 3, gap = 8, reducedMotion = false, testID }: { count?: number; size?: number; columns?: number; gap?: number; reducedMotion?: boolean; testID?: string }) {
  const rows: number[][] = []
  for (let i = 0; i < count; i += columns) rows.push(Array.from({ length: Math.min(columns, count - i) }, (_, j) => i + j))
  return (
    <Column gap={gap} testID={testID}>
      {rows.map((r, i) => (
        <Row key={i} gap={gap}>
          {r.map((k) => (
            <Skeleton key={k} width={size} height={size} radius={12} reducedMotion={reducedMotion} />
          ))}
        </Row>
      ))}
    </Column>
  )
}

/** "As of 3 min ago": the caption is the wallet's (i18n stays out of ui). */
export function Stale({ label, testID }: { label: string; testID?: string }) {
  return (
    <Row gap="$2" testID={testID}>
      <View style={{ width: '35%', maxWidth: 96, height: metrics.filament, borderRadius: 1, backgroundColor: paint.mute, opacity: 0.6 }} />
      <Body tone="mute" size="caption">
        {label}
      </Body>
    </Row>
  )
}

/** An indeterminate 2 px sweep while a fresh read is in flight; the track is always there, so nothing moves. */
export function Refreshing({ active, reducedMotion = false, testID }: { active: boolean; reducedMotion?: boolean; testID?: string }) {
  const [w, setW] = useState(0)
  const onLayout = (e: LayoutChangeEvent): void => {
    const x = Math.floor(e.nativeEvent.layout.width)
    if (x !== w) setW(x)
  }
  return (
    <View onLayout={onLayout} style={{ height: metrics.filament, borderRadius: 1, backgroundColor: active ? edge : 'transparent', overflow: 'hidden' }} testID={testID} accessibilityElementsHidden>
      {active && w > 0 ? <Sweep width={w} opacity={reducedMotion ? 0.35 : 0.9} durationMs={1200} reducedMotion={reducedMotion} /> : null}
    </View>
  )
}
