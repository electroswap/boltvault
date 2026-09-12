/**
 * The Field — native renderer: a Skia RuntimeShader driven by a Reanimated
 * clock, touch from the gesture system. Same props as the web renderer
 * (Field.types.ts).
 *
 * This used to compile FIELD_SKSL unconditionally and never look at `scene`,
 * which is why the owner's Appearance choice did nothing on the phone: the
 * setting was plumbed all the way here and then dropped. Both shaders are
 * compiled once at module load — they are cheap to hold and swapping mid-run
 * should not stall a frame — and `off` returns before any of it, so choosing
 * Off genuinely stops the animation instead of merely hiding it.
 */
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia'
import { useEffect, useMemo } from 'react'
import { AppState, View } from 'react-native'
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated'
import { fieldSeed } from '../hash'
import { paint } from '../tokens'
import { CIRCUIT_SKSL } from './circuit.sksl'
import { FIELD_SKSL } from './field.sksl'
import type { FieldProps } from './Field.types'

const grid = Skia.RuntimeEffect.Make(FIELD_SKSL)
const circuit = Skia.RuntimeEffect.Make(CIRCUIT_SKSL)

export function Field({ address, pulse = 0, warmth = 0, intensity = 1, quiet = false, reducedMotion = false, scene = 'grid', width, height, testID }: FieldProps) {
  const seed = useMemo(() => fieldSeed(address), [address])
  const time = useSharedValue(reducedMotion ? 3.7 : 0)
  const pulseSv = useSharedValue(0)
  const touch = useSharedValue<[number, number, number]>([0.5, 0.5, 0])

  useEffect(() => {
    if (reducedMotion || scene === 'off') return
    // A slow, cheap clock: 30 fps is enough for a field that breathes.
    // Stop it when the app is not on screen — backgrounded shader work is waste.
    const started = Date.now()
    let pauseAccum = 0
    let pausedAt = 0
    let onScreen = AppState.currentState === 'active'
    if (!onScreen) pausedAt = started
    const id = setInterval(() => {
      if (!onScreen) return
      time.value = (Date.now() - started - pauseAccum) / 1000
    }, 1000 / 30)
    const sub = AppState.addEventListener('change', (state) => {
      const now = Date.now()
      if (state === 'active') {
        if (pausedAt) pauseAccum += now - pausedAt
        pausedAt = 0
        onScreen = true
      } else {
        onScreen = false
        pausedAt = now
      }
    })
    return () => {
      clearInterval(id)
      sub.remove()
    }
  }, [reducedMotion, scene, time])

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

  // Off is a real choice, not a hidden shader: nothing compiles, nothing ticks.
  const effect = scene === 'circuit' ? circuit : grid
  if (scene === 'off' || !effect || width < 1 || height < 1) return <View style={{ position: 'absolute', width, height, backgroundColor: paint.void }} testID={testID} />
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
