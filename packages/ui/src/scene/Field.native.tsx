/**
 * The Field — native renderer: Skia RuntimeShader from field.sksl.ts, driven
 * by a Reanimated clock, touch from the gesture system. Same props as the
 * web renderer (Field.types.ts).
 */
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia'
import { useEffect, useMemo } from 'react'
import { View } from 'react-native'
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated'
import { fieldSeed } from '../hash'
import { paint } from '../tokens'
import { FIELD_SKSL } from './field.sksl'
import type { FieldProps } from './Field.types'

const effect = Skia.RuntimeEffect.Make(FIELD_SKSL)

export function Field({ address, pulse = 0, warmth = 0, intensity = 1, quiet = false, reducedMotion = false, width, height, testID }: FieldProps) {
  const seed = useMemo(() => fieldSeed(address), [address])
  const time = useSharedValue(reducedMotion ? 3.7 : 0)
  const pulseSv = useSharedValue(0)
  const touch = useSharedValue<[number, number, number]>([0.5, 0.5, 0])

  useEffect(() => {
    if (reducedMotion) return
    // A slow, cheap clock: 30 fps is enough for a field that breathes.
    const started = Date.now()
    const id = setInterval(() => {
      time.value = (Date.now() - started) / 1000
    }, 1000 / 30)
    return () => clearInterval(id)
  }, [reducedMotion, time])

  useEffect(() => {
    if (pulse > 0 && !quiet) {
      pulseSv.value = pulse
      pulseSv.value = withTiming(0, { duration: 700 })
    }
  }, [pulse, quiet, pulseSv])

  const uniforms = useDerivedValue(() => ({
    u_res: [width, height],
    u_time: time.value,
    u_seed: [seed[0], seed[1], seed[2], seed[3]],
    u_pulse: pulseSv.value,
    u_touch: quiet ? [0.5, 0.5, 0] : touch.value,
    u_warmth: warmth,
  }))

  if (!effect) return <View style={{ position: 'absolute', width, height, backgroundColor: paint.void }} testID={testID} />
  const opacity = (quiet ? 0.15 : 1) * intensity
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height, opacity }} testID={testID}>
      <Canvas style={{ width, height }}>
        <Fill>
          <Shader source={effect} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  )
}
