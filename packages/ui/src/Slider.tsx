/**
 * Slider — a 0..100 control on a recessed track (the farm's Withdraw slider,
 * §8.8). Tap or drag anywhere on the track; the thumb is a 44 px hit area.
 * Keyboard: the step chips beside it do the same job.
 */
import { useRef, useState } from 'react'
import { PanResponder, View, type LayoutChangeEvent } from 'react-native'
import { Body, Row } from './primitives'
import { metrics, paint } from './tokens'

export interface SliderProps {
  readonly value: number
  readonly onChange: (value: number) => void
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly disabled?: boolean
  readonly testID?: string
}

export function Slider({ value, onChange, min = 0, max = 100, step = 1, disabled = false, testID }: SliderProps) {
  const [width, setWidth] = useState(0)
  const widthRef = useRef(0)
  const onLayout = (e: LayoutChangeEvent): void => {
    widthRef.current = e.nativeEvent.layout.width
    setWidth(e.nativeEvent.layout.width)
  }
  const fromX = (x: number): number => {
    const w = widthRef.current || 1
    const raw = min + (Math.max(0, Math.min(w, x)) / w) * (max - min)
    const snapped = Math.round(raw / step) * step
    return Math.max(min, Math.min(max, snapped))
  }
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (e) => onChange(fromX(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => onChange(fromX(e.nativeEvent.locationX)),
    }),
  ).current
  const fraction = max > min ? (value - min) / (max - min) : 0
  const thumbX = Math.max(0, Math.min(width, fraction * width))
  return (
    <Row alignItems="center" gap="$3" testID={testID}>
      <View onLayout={onLayout} {...pan.panHandlers} style={{ flex: 1, height: metrics.hit, justifyContent: 'center' }} accessibilityRole="adjustable" accessibilityValue={{ min, max, now: value }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(95,216,255,0.14)' }}>
          <View style={{ width: `${fraction * 100}%`, height: 6, borderRadius: 3, backgroundColor: paint.arc }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: thumbX - 11, width: 22, height: 22, borderRadius: 11, backgroundColor: paint.ink, borderWidth: 2, borderColor: paint.arc, opacity: disabled ? 0.4 : 1 }} testID={testID ? `${testID}-thumb` : undefined} />
      </View>
      <Body size="caption" tone="ink" minWidth={40} textAlign="right" testID={testID ? `${testID}-value` : undefined}>
        {`${Math.round(value)}%`}
      </Body>
    </Row>
  )
}
