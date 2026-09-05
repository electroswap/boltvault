/**
 * LiveFilament — the 2 px line under the readout that completes one travel
 * per Electroneum block and holds (mute, still) when the RPC stalls
 * (master plan §7.6). No blur, no glow: the a11y bug is the glow.
 */
import { useEffect, useState } from 'react'
import Animated, { cubicBezier } from 'react-native-reanimated'
import { View } from 'react-native'
import { edge, metrics, paint } from './tokens'

export interface LiveFilamentProps {
  /** Any change triggers one travel. Use the block number. */
  readonly tick: string | number | null
  readonly live: boolean
  readonly reducedMotion?: boolean
  readonly testID?: string
}

export function LiveFilament({ tick, live, reducedMotion = false, testID }: LiveFilamentProps) {
  const [runId, setRunId] = useState(0)
  useEffect(() => {
    if (tick !== null) setRunId((n) => n + 1)
  }, [tick])
  const still = !live || reducedMotion || tick === null
  return (
    <View style={{ height: metrics.filament, backgroundColor: edge, borderRadius: 1, overflow: 'hidden' }} testID={testID} accessibilityElementsHidden>
      {still ? (
        <View style={{ height: metrics.filament, width: live ? '100%' : '35%', backgroundColor: live ? paint.arc : paint.mute, borderRadius: 1 }} />
      ) : (
        <Animated.View
          key={runId}
          style={{
            height: metrics.filament,
            width: '100%',
            backgroundColor: paint.arc,
            borderRadius: 1,
            transformOrigin: 'left',
            animationName: { from: { transform: [{ scaleX: 0 }] }, to: { transform: [{ scaleX: 1 }] } },
            animationDuration: '700ms',
            animationTimingFunction: cubicBezier(0.2, 0.9, 0.3, 1),
            animationFillMode: 'forwards',
          }}
        />
      )}
    </View>
  )
}
